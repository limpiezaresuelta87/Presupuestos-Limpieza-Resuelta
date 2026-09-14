/*
 * Firebase — inicialización y control de acceso
 * -------------------------------------------------------------
 * Se carga DESPUÉS de los scripts de Firebase (compat, por CDN,
 * sin npm/build) y ANTES de app.js / store.js / etc.
 *
 * Qué hace:
 *  1) Inicializa Firebase con tu configuración del proyecto.
 *  2) Muestra una pantalla de login (Google) tapando toda la app
 *     hasta que haya una sesión válida.
 *  3) Solo deja pasar a los emails de EMAILS_AUTORIZADOS. A
 *     cualquier otro lo desloguea automáticamente y muestra un
 *     aviso — esto es solo para UX; la seguridad real la ponen
 *     las Reglas de Firestore (firestore.rules), que rechazan
 *     igual cualquier lectura/escritura de un email no permitido
 *     aunque alguien desactive este archivo a mano.
 *  4) Expone window.Auth.currentUser() y window.Auth.onReady(fn)
 *     para que el resto de la app (store.js) sepa cuándo ya hay
 *     sesión y pueda empezar a leer/escribir en Firestore.
 */

// EDITAR ACÁ: los correos de Google de las 3 PCs / personas que
// pueden usar la app. Agregar o sacar líneas según haga falta.
const EMAILS_AUTORIZADOS = [
  "limpiezaresuelta87@gmail.com",
  "cpn.jauregui@gmail.com",
  "jaureguipablog@hotmail.com",
];

const firebaseConfig = {
  apiKey: "AIzaSyDjpcxlgVPn8ECOOZ-6j-fB3hxQJm5Odig",
  authDomain: "presupuestos-limpieza-resuelta.firebaseapp.com",
  projectId: "presupuestos-limpieza-resuelta",
  storageBucket: "presupuestos-limpieza-resuelta.firebasestorage.app",
  messagingSenderId: "656608907232",
  appId: "1:656608907232:web:7d78546d4cb3a3f1a46585"
};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();

// Guardado local automático: si se pierde la conexión, las
// lecturas/escrituras se encolan en el dispositivo y se sincronizan
// solas al volver la señal. Esto es lo que nos da el "offline real".
db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
  console.warn('[firebase] Persistencia offline no disponible:', err.code);
});

// ---------- Overlay de login (se inyecta en cualquier página) ----------
function crearOverlayLogin() {
  const overlay = document.createElement('div');
  overlay.id = 'auth-overlay';
  overlay.innerHTML = `
    <div class="auth-caja">
      <div class="auth-icono">▣</div>
      <h1>Presupuestos</h1>
      <p id="auth-mensaje">Iniciá sesión con tu cuenta de Google autorizada para continuar.</p>
      <button id="auth-btn-login" type="button">Iniciar sesión con Google</button>
    </div>
  `;
  const estilos = document.createElement('style');
  estilos.textContent = `
    #auth-overlay {
      position: fixed; inset: 0; z-index: 9999;
      background: #1f2937;
      display: flex; align-items: center; justify-content: center;
      font-family: 'Inter', sans-serif;
    }
    .auth-caja {
      background: #fff; border-radius: 16px; padding: 40px 32px;
      max-width: 320px; width: 90%; text-align: center;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    .auth-icono { font-size: 40px; color: #1f2937; margin-bottom: 8px; }
    .auth-caja h1 { font-family: 'Sora', sans-serif; font-size: 20px; margin: 0 0 12px; color: #1f2937; }
    .auth-caja p { font-size: 14px; color: #4b5563; margin: 0 0 20px; line-height: 1.4; }
    #auth-btn-login {
      width: 100%; padding: 12px 16px; border-radius: 8px; border: none;
      background: #1f2937; color: #fff; font-size: 14px; font-weight: 600;
      cursor: pointer;
    }
    #auth-btn-login:hover { background: #111827; }
    #auth-btn-login:disabled { opacity: 0.6; cursor: default; }
  `;
  document.head.appendChild(estilos);
  document.body.appendChild(overlay);
  return overlay;
}

function mostrarOverlay(mensaje, mostrarBoton) {
  let overlay = document.getElementById('auth-overlay');
  if (!overlay) overlay = crearOverlayLogin();
  overlay.style.display = 'flex';
  document.getElementById('auth-mensaje').textContent = mensaje;
  document.getElementById('auth-btn-login').style.display = mostrarBoton ? 'block' : 'none';
}

function ocultarOverlay() {
  const overlay = document.getElementById('auth-overlay');
  if (overlay) overlay.style.display = 'none';
}

// ---------- API pública para el resto de la app ----------
let usuarioActual = null;
const callbacksListos = [];

window.Auth = {
  currentUser: () => usuarioActual,
  onReady: (fn) => {
    if (usuarioActual) fn(usuarioActual);
    else callbacksListos.push(fn);
  },
  signOut: () => auth.signOut(),
};

// ---------- Lógica de sesión ----------
document.addEventListener('DOMContentLoaded', () => {
  mostrarOverlay('Verificando sesión…', false);

  document.body.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'auth-btn-login') {
      e.target.disabled = true;
      e.target.textContent = 'Abriendo Google…';
      const provider = new firebase.auth.GoogleAuthProvider();
      // signInWithPopup: Chrome viene "limpiando" a propósito el estado de
      // sitios intermedios en cadenas de redirección (para bloquear
      // rastreo), y eso rompe signInWithRedirect porque el login pasa por
      // el dominio intermedio de Firebase antes de volver a la app. Un
      // popup no navega por esa cadena, así que no se ve afectado.
      auth.signInWithPopup(provider).catch((err) => {
        console.error('[firebase] Error al iniciar sesión:', err);
        e.target.disabled = false;
        e.target.textContent = 'Iniciar sesión con Google';
        if (err.code === 'auth/popup-blocked') {
          mostrarOverlay('El navegador bloqueó la ventana de Google. Permití ventanas emergentes para este sitio y probá de nuevo.', true);
        } else if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') {
          mostrarOverlay('Se cerró la ventana antes de terminar. Probá de nuevo.', true);
        } else {
          mostrarOverlay('No se pudo iniciar sesión (' + (err.code || 'error') + '). Probá de nuevo.', true);
        }
      });
    }
  });

  auth.onAuthStateChanged((user) => {
    if (!user) {
      usuarioActual = null;
      mostrarOverlay('Iniciá sesión con tu cuenta de Google autorizada para continuar.', true);
      return;
    }

    const email = (user.email || '').toLowerCase();
    const autorizado = EMAILS_AUTORIZADOS.map((e) => e.toLowerCase()).includes(email);

    if (!autorizado) {
      auth.signOut();
      usuarioActual = null;
      mostrarOverlay(`El correo ${user.email} no está autorizado para usar esta app.`, true);
      return;
    }

    usuarioActual = user;
    ocultarOverlay();
    callbacksListos.splice(0).forEach((fn) => fn(user));
  });
});
