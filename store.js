/**
 * store.js
 * -----------------------------------------------------------------------
 * Capa única de persistencia. Se expone como window.Store.
 *
 * ANTES: todo vivía en localStorage (sincrónico, un solo dispositivo).
 * AHORA: todo vive en Firestore (la nube), compartido en tiempo real por
 * las 3 PCs. Para que el resto de la app (app.js, informes.js,
 * pricelist.js) NO tenga que cambiar casi nada, Store mantiene una copia
 * en memoria ("cache") que se actualiza sola cada vez que cambia algo en
 * Firestore -- incluso si el cambio lo hizo OTRO dispositivo. Las lecturas
 * (obtenerHistorial, obtenerConfig, etc.) siguen siendo instantáneas,
 * leyendo de esa copia. Las escrituras mandan el dato a Firestore por
 * detrás y a la vez actualizan la copia al toque, para que la pantalla
 * responda igual de rápido que antes.
 *
 * Única excepción real: tomarSiguienteNumero() ahora devuelve una Promise,
 * porque necesita una "transacción" de Firestore para garantizar que dos
 * PCs nunca se lleven el mismo número si guardan un presupuesto al mismo
 * tiempo. Es el único lugar de toda la app que tuvo que volverse asíncrono
 * (ver los 2 cambios puntuales en app.js).
 * -----------------------------------------------------------------------
 */

(function () {
  const db = firebase.firestore();

  // Un solo "espacio" compartido por todo el negocio -- no hay conceptos
  // de usuario/tenant separados a propósito, porque las 3 PCs son la misma
  // empresa y necesitan ver exactamente los mismos datos.
  const DOC_CONFIG = db.collection('config').doc('general');
  const COL_HISTORIAL = db.collection('historial');
  const DOC_LISTA_PRECIOS = db.collection('listaPrecios').doc('vigente');
  const COL_COSTOS = db.collection('costosHistoricos');
  const DOC_CLIENTES = db.collection('clientes').doc('lista');

  const SCHEMA_VERSION_ACTUAL = 3;

  const CLIENTES_POR_DEFECTO = [
    'VILLANUEVA CAROLINA',
    'RIERA JAIME',
    'UHRIG NÉLIDA',
    'PALACIO JORGE',
    'LARRAÑAGA MAXIMILIANO',
  ];

  const CONFIG_POR_DEFECTO = {
    empresa: {
      nombre: 'MI EMPRESA S.R.L.',
      direccion: 'Dirección de la empresa 123',
      telefono: '+54 9 341 000-0000',
      email: 'ventas@miempresa.com',
      cuit: '30-00000000-0',
      logoBase64: '',
    },
    condicionesPagoPorDefecto: 'Contado / Transferencia bancaria',
    validezDiasPorDefecto: 15,
    numeracion: {
      prefijo: 'PRES-',
      siguienteNumero: 1,
      padding: 4,
    },
    schemaVersion: 1,
  };

  function clonar(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function completarConfig(datos) {
    const base = datos || {};
    return Object.assign(clonar(CONFIG_POR_DEFECTO), base, {
      empresa: Object.assign({}, CONFIG_POR_DEFECTO.empresa, base.empresa || {}),
      numeracion: Object.assign({}, CONFIG_POR_DEFECTO.numeracion, base.numeracion || {}),
    });
  }

  /** ID de documento válido para Firestore: sin barras. Defensivo, no debería hacer falta. */
  function idSeguro(numero) {
    return String(numero).replace(/\//g, '_');
  }

  /** Número base de un presupuesto: le saca el "-R2" si es una revisión. */
  function calcularNumeroBase(numero) {
    const m = String(numero).match(/^(.*)-R\d+$/);
    return m ? m[1] : String(numero);
  }

  function numeroRevision(numero) {
    const m = String(numero).match(/^.*-R(\d+)$/);
    return m ? Number(m[1]) : 0;
  }

  // -----------------------------------------------------------------------
  // Cache en memoria + listeners en tiempo real
  // -----------------------------------------------------------------------
  const cache = {
    config: clonar(CONFIG_POR_DEFECTO),
    historial: [],       // incluye los de la papelera
    listaPrecios: null,
    costosHistoricos: [],
    clientes: [],
  };

  let listenersIniciados = false;
  const fuentesListas = { config: false, historial: false, listaPrecios: false, costos: false, clientes: false };
  let resolversListo = [];

  function chequearListo() {
    const todasListas = Object.keys(fuentesListas).every(function (k) { return fuentesListas[k]; });
    if (todasListas && resolversListo.length > 0) {
      resolversListo.splice(0).forEach(function (fn) { fn(); });
    }
  }

  function iniciarListeners() {
    if (listenersIniciados) return;
    listenersIniciados = true;

    DOC_CONFIG.onSnapshot(function (snap) {
      cache.config = completarConfig(snap.exists ? snap.data() : null);
      fuentesListas.config = true;
      chequearListo();
    }, function (err) {
      console.error('[store] Error escuchando config:', err);
      fuentesListas.config = true;
      chequearListo();
    });

    COL_HISTORIAL.onSnapshot(function (snap) {
      cache.historial = snap.docs.map(function (d) { return d.data(); });
      fuentesListas.historial = true;
      chequearListo();
    }, function (err) {
      console.error('[store] Error escuchando historial:', err);
      fuentesListas.historial = true;
      chequearListo();
    });

    DOC_LISTA_PRECIOS.onSnapshot(function (snap) {
      cache.listaPrecios = snap.exists ? snap.data() : null;
      fuentesListas.listaPrecios = true;
      chequearListo();
    }, function (err) {
      console.error('[store] Error escuchando lista de precios:', err);
      fuentesListas.listaPrecios = true;
      chequearListo();
    });

    COL_COSTOS.onSnapshot(function (snap) {
      cache.costosHistoricos = snap.docs
        .map(function (d) { return d.data(); })
        .sort(function (a, b) { return a.mes < b.mes ? -1 : 1; });
      fuentesListas.costos = true;
      chequearListo();
    }, function (err) {
      console.error('[store] Error escuchando costos históricos:', err);
      fuentesListas.costos = true;
      chequearListo();
    });

    DOC_CLIENTES.onSnapshot(function (snap) {
      const nombres = snap.exists && Array.isArray(snap.data().nombres) ? snap.data().nombres : [];
      cache.clientes = nombres.slice().sort(function (a, b) { return a.localeCompare(b, 'es'); });
      fuentesListas.clientes = true;
      chequearListo();
    }, function (err) {
      console.error('[store] Error escuchando clientes:', err);
      fuentesListas.clientes = true;
      chequearListo();
    });
  }

  /** Escritura en bloque de varios documentos, respetando el límite de 500 por batch de Firestore. */
  function escribirEnLotes(coleccion, items, idDe) {
    const LOTE = 450;
    const lotes = [];
    for (let i = 0; i < items.length; i += LOTE) {
      const grupo = items.slice(i, i + LOTE);
      const batch = db.batch();
      grupo.forEach(function (item) {
        batch.set(coleccion.doc(idSeguro(idDe(item))), item);
      });
      lotes.push(batch.commit());
    }
    return Promise.all(lotes);
  }

  const Store = {
    /**
     * Hay que llamar esto UNA vez, después de que haya sesión iniciada
     * (Firestore rechaza leer datos sin login), y esperar a que la Promise
     * resuelva antes de arrancar el resto de la app -- así la primera
     * pantalla ya tiene datos reales y no aparece todo vacío un instante.
     */
    inicializar: function () {
      return new Promise(function (resolve) {
        resolversListo.push(resolve);
        iniciarListeners();
      });
    },

    // -------------------------------------------------------------------
    // Configuración
    // -------------------------------------------------------------------
    obtenerConfig: function () {
      return clonar(cache.config);
    },

    guardarConfig: function (config) {
      cache.config = completarConfig(config); // actualización optimista, instantánea
      DOC_CONFIG.set(cache.config).catch(function (err) {
        console.error('[store] No se pudo guardar la configuración:', err);
      });
      return true;
    },

    /**
     * Asigna el próximo número de presupuesto de forma ATÓMICA: si dos PCs
     * lo piden al mismo tiempo, Firestore garantiza que cada una se lleve
     * un número distinto (reintenta solo si hay choque). Por eso es la
     * única función de Store que devuelve una Promise en vez del valor
     * directo -- ver los 2 puntos en app.js que hacen .then() con esto.
     */
    tomarSiguienteNumero: function () {
      return db.runTransaction(function (tx) {
        return tx.get(DOC_CONFIG).then(function (doc) {
          const config = completarConfig(doc.exists ? doc.data() : null);
          const n = config.numeracion.siguienteNumero;
          const numeroFormateado = config.numeracion.prefijo + String(n).padStart(config.numeracion.padding, '0');
          config.numeracion.siguienteNumero = n + 1;
          tx.set(DOC_CONFIG, config);
          return numeroFormateado;
        });
      });
    },

    // -------------------------------------------------------------------
    // Historial de presupuestos
    // -------------------------------------------------------------------
    obtenerHistorial: function (incluirPapelera) {
      if (incluirPapelera) return clonar(cache.historial);
      return clonar(cache.historial.filter(function (p) { return !p.enPapelera; }));
    },

    obtenerPapelera: function () {
      return clonar(cache.historial.filter(function (p) { return !!p.enPapelera; }));
    },

    guardarPresupuesto: function (presupuesto) {
      cache.historial = [presupuesto].concat(cache.historial); // optimista
      COL_HISTORIAL.doc(idSeguro(presupuesto.numero)).set(presupuesto).catch(function (err) {
        console.error('[store] No se pudo guardar el presupuesto:', err);
      });
      return true;
    },

    actualizarPresupuesto: function (numero, cambios) {
      const idx = cache.historial.findIndex(function (p) { return p.numero === numero; });
      if (idx === -1) return false;
      const actualizado = Object.assign({}, cache.historial[idx], cambios);
      cache.historial = cache.historial.slice();
      cache.historial[idx] = actualizado;
      COL_HISTORIAL.doc(idSeguro(numero)).set(actualizado, { merge: true }).catch(function (err) {
        console.error('[store] No se pudo actualizar el presupuesto:', err);
      });
      return true;
    },

    buscarPresupuesto: function (numero) {
      const encontrado = cache.historial.find(function (p) { return p.numero === numero; });
      return encontrado ? clonar(encontrado) : null;
    },

    /** Borrado suave: el presupuesto pasa a la papelera pero no se pierde. */
    moverAPapelera: function (numero) {
      return this.actualizarPresupuesto(numero, {
        enPapelera: true,
        papeleraFecha: new Date().toISOString(),
      });
    },

    restaurarDePapelera: function (numero) {
      const idx = cache.historial.findIndex(function (p) { return p.numero === numero; });
      if (idx === -1) return false;
      const actualizado = Object.assign({}, cache.historial[idx]);
      delete actualizado.enPapelera;
      delete actualizado.papeleraFecha;
      cache.historial = cache.historial.slice();
      cache.historial[idx] = actualizado;
      // set() completo (sin merge) para asegurarnos de que los campos
      // eliminados también desaparezcan del lado de Firestore.
      COL_HISTORIAL.doc(idSeguro(numero)).set(actualizado).catch(function (err) {
        console.error('[store] No se pudo restaurar el presupuesto:', err);
      });
      return true;
    },

    /** Borrado definitivo (irreversible). Solo se usa desde la papelera. */
    eliminarDefinitivo: function (numero) {
      cache.historial = cache.historial.filter(function (p) { return p.numero !== numero; });
      COL_HISTORIAL.doc(idSeguro(numero)).delete().catch(function (err) {
        console.error('[store] No se pudo eliminar el presupuesto:', err);
      });
      return true;
    },

    /** Compatibilidad con código viejo: alias de moverAPapelera. */
    eliminarPresupuesto: function (numero) {
      return this.moverAPapelera(numero);
    },

    /**
     * Guarda de una vez una lista completa de presupuestos (upsert: los que
     * ya existen se pisan con el mismo contenido, los nuevos se agregan).
     * La usa "Importar historial" e "Importar copia completa" -- ambas ya
     * llegan acá con la lista combinada y sin duplicados calculada de
     * antemano en app.js, así que acá solo hace falta escribirla.
     */
    guardarHistorialCompleto: function (historial) {
      cache.historial = historial.slice();
      escribirEnLotes(COL_HISTORIAL, historial, function (p) { return p.numero; }).catch(function (err) {
        console.error('[store] No se pudo guardar el historial importado:', err);
      });
      return true;
    },

    /**
     * Historial "limpio" para informes/estadísticas: saca los de la
     * papelera y, de cada grupo de revisiones, deja solo la última.
     */
    obtenerHistorialParaInformes: function () {
      const activos = this.obtenerHistorial(false);
      const porBase = {};
      activos.forEach(function (p) {
        const base = p.numeroBase || calcularNumeroBase(p.numero);
        const actual = porBase[base];
        if (!actual || numeroRevision(p.numero) >= numeroRevision(actual.numero)) {
          porBase[base] = p;
        }
      });
      return Object.keys(porBase).map(function (k) { return porBase[k]; });
    },

    // -------------------------------------------------------------------
    // Lista de precios vigente
    // -------------------------------------------------------------------
    obtenerListaPrecios: function () {
      return cache.listaPrecios ? clonar(cache.listaPrecios) : null;
    },

    guardarListaPrecios: function (lista) {
      cache.listaPrecios = lista;
      DOC_LISTA_PRECIOS.set(lista).catch(function (err) {
        console.error('[store] No se pudo guardar la lista de precios:', err);
      });
      return true;
    },

    // -------------------------------------------------------------------
    // Historial de costos (para informes de ganancia)
    // -------------------------------------------------------------------
    obtenerHistorialCostos: function () {
      return clonar(cache.costosHistoricos);
    },

    agregarSnapshotCostos: function (snapshot) {
      const idx = cache.costosHistoricos.findIndex(function (s) { return s.mes === snapshot.mes; });
      cache.costosHistoricos = cache.costosHistoricos.slice();
      if (idx === -1) cache.costosHistoricos.push(snapshot);
      else cache.costosHistoricos[idx] = snapshot;
      cache.costosHistoricos.sort(function (a, b) { return a.mes < b.mes ? -1 : 1; });

      COL_COSTOS.doc(idSeguro(snapshot.mes)).set(snapshot).catch(function (err) {
        console.error('[store] No se pudo guardar el snapshot de costos:', err);
      });
      return true;
    },

    obtenerSnapshotCostosMasCercano: function (fechaIso) {
      const historial = this.obtenerHistorialCostos();
      if (historial.length === 0) return null;
      const objetivo = fechaIso ? fechaIso.slice(0, 7) : null;
      let elegido = null;
      historial.forEach(function (s) {
        if (!objetivo || s.mes <= objetivo) elegido = s;
      });
      return elegido || historial[historial.length - 1];
    },

    // -------------------------------------------------------------------
    // Clientes (para el desplegable del formulario de presupuesto)
    // -------------------------------------------------------------------
    obtenerClientes: function () {
      return cache.clientes.slice();
    },

    /**
     * Agrega un cliente nuevo a la lista compartida (si no existía ya).
     * Los nombres se guardan siempre en MAYÚSCULA. Devuelve el nombre
     * final (ya normalizado) para que el que llama sepa qué seleccionar.
     */
    agregarCliente: function (nombre) {
      const limpio = String(nombre || '').trim().toUpperCase().replace(/\s+/g, ' ');
      if (!limpio) return null;
      if (cache.clientes.indexOf(limpio) === -1) {
        cache.clientes = cache.clientes.concat([limpio]).sort(function (a, b) { return a.localeCompare(b, 'es'); });
        DOC_CLIENTES.set({ nombres: cache.clientes }).catch(function (err) {
          console.error('[store] No se pudo guardar el cliente nuevo:', err);
        });
      }
      return limpio;
    },

    // -------------------------------------------------------------------
    // Versionado de esquema y migraciones automáticas
    // -------------------------------------------------------------------
    SCHEMA_VERSION_ACTUAL: SCHEMA_VERSION_ACTUAL,

    obtenerVersionEsquema: function () {
      return Number(cache.config.schemaVersion) || 1;
    },

    /**
     * Aplica, en orden, las migraciones que falten. Se llama una vez al
     * arrancar la app (ver app.js), después de Store.inicializar(). Cada
     * migración es idempotente: puede ejecutarse sobre datos ya migrados
     * sin romper nada, y si dos PCs la disparan casi a la vez no pasa nada
     * grave (a lo sumo se escribe el mismo número dos veces).
     */
    migrarSiNecesario: function () {
      let version = this.obtenerVersionEsquema();

      // v1 -> v2: los presupuestos no tenían el campo enPapelera; no hace
      // falta tocar nada porque su ausencia ya se interpreta como "activo".
      if (version < 2) {
        version = 2;
      }

      // v2 -> v3: se agrega la lista de clientes (desplegable). La primera
      // vez que corre esta migración, la precarga con los clientes que ya
      // tenías cargados a mano. Es idempotente: si ya hay clientes
      // guardados (por ejemplo porque otra PC ya migró), no hace nada.
      if (version < 3) {
        if (cache.clientes.length === 0) {
          const iniciales = CLIENTES_POR_DEFECTO.slice().sort(function (a, b) { return a.localeCompare(b, 'es'); });
          cache.clientes = iniciales;
          DOC_CLIENTES.set({ nombres: iniciales }).catch(function (err) {
            console.error('[store] No se pudo precargar la lista de clientes:', err);
          });
        }
        version = 3;
      }

      if (version !== cache.config.schemaVersion) {
        const config = this.obtenerConfig();
        config.schemaVersion = version;
        this.guardarConfig(config);
      }
      return version;
    },
  };

  window.Store = Store;
})();
