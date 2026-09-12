/**
 * pricelist.js
 * -----------------------------------------------------------------------
 * Carga y parseo de la lista de precios, y (por separado) del costo de
 * cada artículo para los informes de ganancia. Expuesto como
 * window.Pricelist.
 * -----------------------------------------------------------------------
 */

(function () {
  const ALIAS_COLUMNAS = {
    articulo: ['PRODUCTO', 'PRODUCTOS', 'ARTICULO', 'ARTÍCULO'],
    precioUnitario: ['$ UNIDAD', '$ X UNIDAD', '$ X UNI.', 'PRECIO UNITARIO', 'PRECIO UNIDAD'],
    precioPack: ['$ PACK', '$ X PACK', 'PRECIO PACK', 'PRECIO POR UNIDAD PACK'],
    cantidadPack: ['PACK', 'CANTIDAD PACK', 'CANTIDAD POR PACK'],
  };

  // Palabras que identifican la hoja de precios "al público" / venta, para
  // preferirla por sobre hojas de costos o de proveedores que puedan tener
  // columnas con nombres parecidos.
  const PISTAS_HOJA_VENTA = ['CLIENTE', 'VENTA', 'REVENTA', 'PRINCIPAL', 'PUBLICO', 'LISTA DE PRECIOS'];

  // Palabra que identifica la hoja de costos internos (para el informe de
  // ganancia). Esta hoja NUNCA se usa para presupuestar, solo para informes.
  const PISTAS_HOJA_COSTOS = ['COSTO'];

  function normalizar(texto) {
    return String(texto == null ? '' : texto)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[\r\n]+/g, ' ')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, ' ');
  }

  function detectarColumnas(filaEncabezado) {
    const mapa = {};
    filaEncabezado.forEach(function (celda, i) {
      const val = normalizar(celda);
      Object.keys(ALIAS_COLUMNAS).forEach(function (campo) {
        if (campo in mapa) return;
        const alias = ALIAS_COLUMNAS[campo];
        if (alias.some(function (a) { return normalizar(a) === val; })) {
          mapa[campo] = i;
        }
      });
    });
    return mapa;
  }

  function aNumero(valor) {
    if (valor === null || valor === undefined || valor === '') return null;
    if (typeof valor === 'number') return valor;
    const n = parseFloat(String(valor).trim().replace(',', '.'));
    return Number.isNaN(n) ? null : n;
  }

  function ordenarHojasPorPrioridad(workbook, pistas) {
    const nombres = workbook.SheetNames;
    const conPista = nombres.filter(function (n) {
      return pistas.some(function (p) { return normalizar(n).indexOf(p) !== -1; });
    });
    const sinPista = nombres.filter(function (n) { return conPista.indexOf(n) === -1; });
    return conPista.concat(sinPista);
  }

  function parsearWorkbook(workbook) {
    const hojas = ordenarHojasPorPrioridad(workbook, PISTAS_HOJA_VENTA);
    for (let h = 0; h < hojas.length; h++) {
      const nombreHoja = hojas[h];
      const hoja = workbook.Sheets[nombreHoja];
      const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: null, raw: true });

      for (let f = 0; f < Math.min(filas.length, 10); f++) {
        const mapa = detectarColumnas(filas[f]);
        const camposNecesarios = ['articulo', 'precioUnitario', 'precioPack', 'cantidadPack'];
        const encontroTodos = camposNecesarios.every(function (c) { return c in mapa; });
        if (!encontroTodos) continue;

        const items = [];
        let filasIgnoradas = 0;
        for (let r = f + 1; r < filas.length; r++) {
          const fila = filas[r];
          if (!fila) continue;
          const nombre = fila[mapa.articulo];
          if (nombre === null || nombre === undefined || String(nombre).trim() === '') continue;
          const nombreNorm = normalizar(nombre);
          if (nombreNorm.indexOf('HOJA') === 0 || nombreNorm === 'PRODUCTO' || nombreNorm === 'PRODUCTOS') {
            continue;
          }
          const pu = aNumero(fila[mapa.precioUnitario]);
          const pp = aNumero(fila[mapa.precioPack]);
          const cp = aNumero(fila[mapa.cantidadPack]);
          if (pu === null || pp === null || cp === null || cp <= 0) {
            filasIgnoradas++;
            continue;
          }
          items.push({
            articulo: String(nombre).trim().replace(/\s+/g, ' '),
            precioUnitario: Math.round(pu * 100) / 100,
            precioPack: Math.round(pp * 100) / 100,
            cantidadPack: Math.round(cp),
          });
        }

        if (items.length > 0) {
          return { items: items, hojaUsada: nombreHoja, filasIgnoradas: filasIgnoradas };
        }
      }
    }
    throw new Error(
      'No se encontró una hoja con las columnas esperadas (Producto, $ Unidad, $ Pack, Pack). ' +
      'Verificá que el Excel tenga una hoja con esos encabezados.'
    );
  }

  /**
   * Parsea la hoja de costos internos (ej. "Precios y costos unitarios").
   * Estructura observada en el Excel de la empresa: dentro de cada bloque
   * "HOJA N" hay un encabezado PRODUCTO/$ UNIDAD/$ PACK/PACK igual que en la
   * hoja de venta, y el costo unitario vive 2 columnas a la derecha de PACK
   * (el resto de columnas son ganancia / % / precio sugerido, que no usamos).
   * Como el encabezado de "Costo Unitario" solo aparece una vez arriba de
   * todo el archivo (no se repite por cada HOJA), se ubica por posición
   * relativa a PACK en vez de por texto de encabezado -- y se valida con
   * una comprobación de sanidad (el costo debería ser menor al precio de
   * venta en la mayoría de los artículos) antes de aceptar el resultado.
   */
  function parsearHojaCostos(workbook) {
    const hojas = ordenarHojasPorPrioridad(workbook, PISTAS_HOJA_COSTOS);
    for (let h = 0; h < hojas.length; h++) {
      const nombreHoja = hojas[h];
      const hoja = workbook.Sheets[nombreHoja];
      const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: null, raw: true });

      for (let f = 0; f < filas.length; f++) {
        const mapa = detectarColumnas(filas[f]);
        const camposNecesarios = ['articulo', 'precioUnitario', 'cantidadPack'];
        if (!camposNecesarios.every(function (c) { return c in mapa; })) continue;

        const colCosto = mapa.cantidadPack + 2;
        const items = [];
        let comparables = 0;
        let costoMenorAPrecio = 0;

        for (let r = f + 1; r < filas.length; r++) {
          const fila = filas[r];
          if (!fila) continue;
          const nombre = fila[mapa.articulo];
          if (nombre === null || nombre === undefined || String(nombre).trim() === '') continue;
          const nombreNorm = normalizar(nombre);
          if (nombreNorm.indexOf('HOJA') === 0 || nombreNorm === 'PRODUCTO' || nombreNorm === 'PRODUCTOS') {
            continue;
          }
          const costo = aNumero(fila[colCosto]);
          if (costo === null || costo < 0) continue;

          const precioVenta = aNumero(fila[mapa.precioUnitario]);
          if (precioVenta !== null) {
            comparables++;
            if (costo <= precioVenta * 1.05) costoMenorAPrecio++;
          }

          items.push({
            articulo: String(nombre).trim().replace(/\s+/g, ' '),
            costoUnitario: Math.round(costo * 100) / 100,
          });
        }

        if (items.length === 0) continue;

        // Comprobación de sanidad: si en la mayoría de las filas el "costo"
        // detectado termina siendo mayor al precio de venta, probablemente
        // la posición de columna asumida está mal (estructura del Excel
        // distinta a la esperada). En ese caso no devolvemos estos datos:
        // mejor no guardar costos que guardar costos incorrectos.
        if (comparables > 0 && costoMenorAPrecio / comparables < 0.6) {
          continue;
        }

        return { items: items, hojaUsada: nombreHoja };
      }
    }
    return null;
  }

  function leerArchivoExcel(file) {
    return new Promise(function (resolve, reject) {
      const lector = new FileReader();
      lector.onload = function (e) {
        try {
          const datos = new Uint8Array(e.target.result);
          const workbook = XLSX.read(datos, { type: 'array' });
          resolve(workbook);
        } catch (err) {
          reject(err);
        }
      };
      lector.onerror = function () { reject(new Error('No se pudo leer el archivo.')); };
      lector.readAsArrayBuffer(file);
    });
  }

  /** Carga la lista vigente: la del cache local, o si no existe, la semilla embebida en el JS. */
  function cargarListaVigente() {
    const cache = window.Store.obtenerListaPrecios();
    if (cache && Array.isArray(cache.items) && cache.items.length > 0) {
      return Promise.resolve(cache);
    }
    const semilla = window.PRECIOS_INICIALES;
    if (!semilla || !Array.isArray(semilla.items)) {
      return Promise.reject(new Error('No hay lista de precios en caché ni semilla incluida.'));
    }
    window.Store.guardarListaPrecios(semilla);
    return Promise.resolve(semilla);
  }

  function actualizarListaDesdeArchivo(file) {
    return leerArchivoExcel(file).then(function (workbook) {
      const resultado = parsearWorkbook(workbook);

      // Salvavidas: si la lista vigente tenía bastantes más artículos que la
      // que se acaba de leer, probablemente se subió el Excel equivocado (o
      // una hoja incompleta). Pedimos confirmación en vez de pisarla directo,
      // para no perder precios por error.
      const listaActual = window.Store.obtenerListaPrecios();
      if (listaActual && Array.isArray(listaActual.items) && listaActual.items.length > 0) {
        const cayoMucho = resultado.items.length < listaActual.items.length * 0.6;
        if (cayoMucho) {
          const confirmar = window.confirm(
            'La lista vigente tiene ' + listaActual.items.length + ' artículos, y en este archivo ' +
            'se detectaron solo ' + resultado.items.length + '. ¿Seguro que es el archivo correcto?\n\n' +
            'Aceptar = reemplazar de todos modos. Cancelar = no hacer nada (la lista vigente queda igual).'
          );
          if (!confirmar) {
            const err = new Error('Actualización cancelada: no se modificó la lista de precios vigente.');
            err.cancelado = true;
            throw err;
          }
        }
      }

      const lista = {
        actualizado: new Date().toISOString(),
        origenArchivo: file.name + ' (hoja: ' + resultado.hojaUsada + ')',
        items: resultado.items,
      };
      // Esto SOLO toca la clave de la lista de precios en localStorage.
      // El historial y la configuración viven en otras claves separadas y
      // nunca se tocan acá (ver store.js).
      window.Store.guardarListaPrecios(lista);

      // Guardamos SIEMPRE un snapshot histórico de esta actualización — con
      // el precio de venta de cada artículo y, si se pudo leer la hoja de
      // costos del mismo archivo, también su costo interno de ese momento.
      // Cada actualización queda como un registro propio y permanente (no
      // se pisa ni se resume por mes), sin importar cada cuánto se suba un
      // Excel nuevo: así, un informe de un mes puntual siempre usa el
      // precio y el costo que realmente estaban vigentes en esa fecha.
      let resultadoCostos = null;
      try {
        resultadoCostos = parsearHojaCostos(workbook);
      } catch (errCostos) {
        console.warn('No se pudo leer la hoja de costos de este Excel:', errCostos);
      }

      const costoPorArticulo = {};
      if (resultadoCostos && resultadoCostos.items.length > 0) {
        resultadoCostos.items.forEach(function (it) { costoPorArticulo[it.articulo] = it.costoUnitario; });
      }

      const ahora = new Date().toISOString();
      const snapshotListaPrecios = {
        fecha: ahora,
        mes: ahora.slice(0, 7), // solo informativo, ya no se usa para buscar
        origenArchivo: file.name,
        items: resultado.items.map(function (it) {
          return {
            articulo: it.articulo,
            precioUnitario: it.precioUnitario,
            precioPack: it.precioPack,
            cantidadPack: it.cantidadPack,
            costoUnitario: costoPorArticulo.hasOwnProperty(it.articulo) ? costoPorArticulo[it.articulo] : null,
          };
        }),
      };
      window.Store.agregarSnapshotCostos(snapshotListaPrecios);

      return { lista: lista, filasIgnoradas: resultado.filasIgnoradas, snapshotCostos: snapshotListaPrecios };
    });
  }

  function buscarProductos(lista, consulta, maxResultados) {
    maxResultados = maxResultados || 12;
    const q = normalizar(consulta);
    if (!q) return [];
    const palabras = q.split(' ').filter(Boolean);
    return lista.items
      .map(function (item) {
        const nombreNorm = normalizar(item.articulo);
        const coincideTodas = palabras.every(function (p) { return nombreNorm.indexOf(p) !== -1; });
        if (!coincideTodas) return null;
        const score = nombreNorm.indexOf(q) === 0 ? 0 : nombreNorm.indexOf(palabras[0]);
        return { item: item, score: score };
      })
      .filter(Boolean)
      .sort(function (a, b) { return a.score - b.score; })
      .slice(0, maxResultados)
      .map(function (r) { return r.item; });
  }

  window.Pricelist = {
    parsearWorkbook: parsearWorkbook,
    parsearHojaCostos: parsearHojaCostos,
    leerArchivoExcel: leerArchivoExcel,
    cargarListaVigente: cargarListaVigente,
    actualizarListaDesdeArchivo: actualizarListaDesdeArchivo,
    buscarProductos: buscarProductos,
  };
})();
