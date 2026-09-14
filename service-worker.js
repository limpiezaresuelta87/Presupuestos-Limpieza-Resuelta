/*
 * Service Worker — Generador de Presupuestos
 * -------------------------------------------------------------
 * Qué hace:
 *  1) Al instalarse, descarga y guarda en caché TODOS los archivos
 *     necesarios para que la app funcione (HTML, CSS, JS propios
 *     y las 3 librerías externas que hoy se cargan por CDN).
 *  2) A partir de ahí, sirve esos archivos desde la caché primero
 *     ("cache first"), así la app abre y funciona sin internet.
 *  3) Si hay internet, intenta traer la versión más nueva de cada
 *     archivo en segundo plano y actualiza la caché para la
 *     próxima vez ("stale-while-revalidate" liviano).
 *
 * Importante: subir el número de CACHE_VERSION cada vez que cambies
 * cualquiera de los archivos de APP_SHELL. Si no lo subís, los
 * usuarios van a seguir viendo la versión vieja cacheada.
 */

const CACHE_VERSION = 'v12';
const CACHE_NAME = `presupuestos-cache-${CACHE_VERSION}`;

// Todo lo que la app necesita para funcionar SIN conexión.
// Si agregás una página o script nuevo, sumalo acá.
const APP_SHELL = [
  './',
  './index.html',
  './informes.html',
  './manifest.json',

  './css/styles.css',
  './css/informes.css',

  './js/data-precios-iniciales.js',
  './js/store.js',
  './js/pricelist.js',
  './js/quote.js',
  './js/pdf.js',
  './js/app.js',
  './js/informes.js',

  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',

  // Librerías externas (CDN) usadas para Excel y PDF
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',

  // Firebase (compat, por CDN)
  'https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore-compat.js',
  './js/firebase-init.js',

  // Tipografías (Google Fonts)
  'https://fonts.googleapis.com/css2?family=Sora:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@500;600&display=swap'
];

// ---------- INSTALL: descarga y guarda el "app shell" ----------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // addAll falla entero si UN solo archivo falla, así que
      // los agregamos de a uno para no perder toda la instalación
      // por, por ejemplo, un ícono que todavía no subiste.
      return Promise.all(
        APP_SHELL.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[service-worker] No se pudo cachear:', url, err);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// ---------- ACTIVATE: borra cachés de versiones viejas ----------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('presupuestos-cache-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ---------- FETCH: cache-first con actualización en segundo plano ----------
self.addEventListener('fetch', (event) => {
  // Solo interceptamos GET; el resto (si lo hubiera) pasa directo.
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchAndUpdate = fetch(event.request)
        .then((response) => {
          // Solo cacheamos respuestas válidas (evita guardar errores)
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => null);

      // Si ya está en caché, la mostramos al instante y actualizamos
      // en segundo plano. Si no está, esperamos la red.
      if (cached) {
        fetchAndUpdate; // dispara la actualización, no bloquea la respuesta
        return cached;
      }

      return fetchAndUpdate.then((response) => {
        if (response) return response;
        // Sin caché y sin red: si pidieron una página HTML, mostramos
        // el index como último recurso en vez de un error feo.
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return new Response('', { status: 504, statusText: 'Sin conexión y sin caché' });
      });
    })
  );
});
