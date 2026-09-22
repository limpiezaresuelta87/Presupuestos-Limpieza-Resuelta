/**
 * scripts/backup-firestore.js
 * -----------------------------------------------------------------------
 * Lee todo lo importante de Firestore y arma un archivo .json con el
 * mismo formato que usa el botón "Exportar copia completa" de la app --
 * así, si algún día hay que restaurar, se puede usar el mismo botón
 * "Importar copia completa" de siempre, sin nada especial.
 *
 * Se ejecuta solo, una vez por semana, desde GitHub Actions (ver
 * .github/workflows/backup.yml). No hace falta correrlo a mano nunca,
 * pero si quisieran probarlo en una compu con Node instalado:
 *   FIREBASE_SERVICE_ACCOUNT='{"...": "..."}' node scripts/backup-firestore.js
 * -----------------------------------------------------------------------
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const credencialesJson = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!credencialesJson) {
  console.error('Falta la variable de entorno FIREBASE_SERVICE_ACCOUNT.');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(credencialesJson)),
});

const db = admin.firestore();

async function leerDoc(coleccion, id) {
  const snap = await db.collection(coleccion).doc(id).get();
  return snap.exists ? snap.data() : null;
}

async function leerColeccion(coleccion) {
  const snap = await db.collection(coleccion).get();
  return snap.docs.map((d) => d.data());
}

async function main() {
  const [config, historial, listaPrecios, clientes, proveedores, costosHistoricos] = await Promise.all([
    leerDoc('config', 'general'),
    leerColeccion('historial'),
    leerDoc('listaPrecios', 'vigente'),
    leerDoc('clientes', 'lista'),
    leerDoc('proveedores', 'mapa'),
    leerColeccion('costosHistoricos'),
  ]);

  const payload = {
    exportadoEl: new Date().toISOString(),
    tipo: 'backup-completo-presupuestos',
    origen: 'automatico-github-actions',
    config: config,
    historial: historial,
    listaPrecios: listaPrecios,
    clientes: clientes ? { nombres: clientes.nombres || [], contactos: clientes.contactos || {} } : { nombres: [], contactos: {} },
    proveedores: proveedores ? proveedores.mapa || {} : {},
    costosHistoricos: costosHistoricos,
  };

  const carpeta = path.join(__dirname, '..', 'backups');
  if (!fs.existsSync(carpeta)) fs.mkdirSync(carpeta, { recursive: true });

  const fecha = new Date().toISOString().slice(0, 10);
  const archivo = path.join(carpeta, `backup-${fecha}.json`);
  fs.writeFileSync(archivo, JSON.stringify(payload, null, 2));

  console.log(`Backup guardado: ${archivo}`);
  console.log(`  Presupuestos: ${historial.length}`);
  console.log(`  Clientes: ${(payload.clientes.nombres || []).length}`);
  console.log(`  Snapshots de precios/costos: ${costosHistoricos.length}`);
}

main().catch((err) => {
  console.error('Error al hacer el backup:', err);
  process.exit(1);
});
