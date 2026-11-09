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
    precioUnitario: ['$ UNIDAD', '$ X UNIDAD', '$ X UNI.', 'PRECIO UNITARIO', 'PRECIO UNIDAD', 'PRECIO_UNIDAD'],
    precioPack: ['$ PACK', '$ X PACK', 'PRECIO PACK', 'PRECIO POR UNIDAD PACK', 'PRECIO_PACK'],
    cantidadPack: ['PACK', 'CANTIDAD PACK', 'CANTIDAD POR PACK', 'CANT_PACK'],
    // Opcional: página/hoja del catálogo a la que pertenece el artículo.
    hoja: ['HOJA'],
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

  function redondear(valor) {
    return valor === null || valor === undefined ? null : Math.round(valor * 100) / 100;
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
        // Hoja del catálogo: puede venir en una columna HOJA (formato Lista
        // Maestra) o en filas separadoras "HOJA 7" (formato anterior).
        let hojaActual = null;
        let orden = 0;
        // En el formato anterior el cartel "HOJA 1" está ARRIBA del encabezado.
        for (let k = 0; k < f; k++) {
          const celda0 = normalizar(filas[k] && filas[k][mapa.articulo !== undefined ? mapa.articulo : 0]);
          const m0 = celda0.match(/^HOJA\s*(\d+)/);
          if (m0) hojaActual = parseInt(m0[1], 10);
        }
        for (let r = f + 1; r < filas.length; r++) {
          const fila = filas[r];
          if (!fila) continue;
          const nombre = fila[mapa.articulo];
          if (nombre === null || nombre === undefined || String(nombre).trim() === '') continue;
          const nombreNorm = normalizar(nombre);
          if (nombreNorm.indexOf('HOJA') === 0 || nombreNorm === 'PRODUCTO' || nombreNorm === 'PRODUCTOS') {
            const mh = nombreNorm.match(/^HOJA\s*(\d+)/);
            if (mh) hojaActual = parseInt(mh[1], 10);
            continue;
          }
          const pu = aNumero(fila[mapa.precioUnitario]);
          const pp = aNumero(fila[mapa.precioPack]);
          const cp = aNumero(fila[mapa.cantidadPack]);
          if (pu === null || pp === null || cp === null || cp <= 0) {
            filasIgnoradas++;
            continue;
          }
          const hojaDeFila = 'hoja' in mapa ? aNumero(fila[mapa.hoja]) : null;
          orden++;
          items.push({
            articulo: String(nombre).trim().replace(/\s+/g, ' '),
            precioUnitario: Math.round(pu * 100) / 100,
            precioPack: Math.round(pp * 100) / 100,
            cantidadPack: Math.round(cp),
            hoja: hojaDeFila !== null ? Math.round(hojaDeFila) : hojaActual,
            orden: orden,
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
   * Formato "Lista Maestra" (desde noviembre 2026): una única hoja "Maestra"
   * con una fila por artículo que trae PROVEEDOR, costos, márgenes y precios.
   * De ahí salen (a) el costo de cada artículo para Informes y (b) el
   * proveedor de cada artículo para la lista de compras. Las demás pestañas
   * (hojas de pedido por proveedor, Costos Garra, Auditoría, Retirados...)
   * son de trabajo y NO se interpretan como proveedores.
   * Devuelve null si el Excel no tiene ese formato (se usa el método viejo).
   */
  function parsearMaestra(workbook) {
    const nombreHoja = workbook.SheetNames.find(function (n) { return normalizar(n) === 'MAESTRA'; });
    if (!nombreHoja) return null;
    const filas = XLSX.utils.sheet_to_json(workbook.Sheets[nombreHoja], { header: 1, defval: null, raw: true });

    const COLS = {
      articulo: 'ARTICULO', proveedor: 'PROVEEDOR', costoUnit: 'COSTO UNIT.', costoPack: 'COSTO PACK (TOTAL)',
      margenUnit: '% MARGEN UNIT.', margenPack: '% MARGEN PACK', precioUnit: 'PRECIO UNIT.',
      precioPackTotal: 'PRECIO PACK TOTAL',
    };
    for (let f = 0; f < Math.min(filas.length, 10); f++) {
      const mapa = {};
      filas[f].forEach(function (celda, i) {
        const val = normalizar(celda);
        Object.keys(COLS).forEach(function (k) { if (!(k in mapa) && val === COLS[k]) mapa[k] = i; });
      });
      if (!('articulo' in mapa && 'proveedor' in mapa && 'costoUnit' in mapa && 'precioUnit' in mapa)) continue;

      const items = [];
      for (let r = f + 1; r < filas.length; r++) {
        const fila = filas[r];
        if (!fila) continue;
        const nombre = fila[mapa.articulo];
        if (nombre === null || nombre === undefined || String(nombre).trim() === '') continue;
        const costo = aNumero(fila[mapa.costoUnit]);
        const precioU = aNumero(fila[mapa.precioUnit]);
        const costoPack = 'costoPack' in mapa ? aNumero(fila[mapa.costoPack]) : null;
        const precioPackTotal = 'precioPackTotal' in mapa ? aNumero(fila[mapa.precioPackTotal]) : null;
        const mU = 'margenUnit' in mapa ? aNumero(fila[mapa.margenUnit]) : null;
        const mP = 'margenPack' in mapa ? aNumero(fila[mapa.margenPack]) : null;
        const prov = fila[mapa.proveedor];
        items.push({
          articulo: String(nombre).trim().replace(/\s+/g, ' '),
          proveedor: prov === null || prov === undefined ? null : String(prov).trim(),
          costoUnitario: costo !== null && costo > 0 ? Math.round(costo * 100) / 100 : null,
          gananciaUnitario: costo > 0 && precioU !== null ? redondear(precioU - costo) : null,
          pctGananciaEsperadoUnitario: mU,
          precioSegunPctUnitario: costo > 0 && mU !== null && mU < 1 ? redondear(costo / (1 - mU)) : null,
          costoPack: costoPack !== null && costoPack > 0 ? redondear(costoPack) : null,
          gananciaPack: costoPack > 0 && precioPackTotal !== null ? redondear(precioPackTotal - costoPack) : null,
          pctGananciaEsperadoPack: mP,
          precioSegunPctPack: costoPack > 0 && mP !== null && mP < 1 ? redondear(costoPack / (1 - mP)) : null,
        });
      }
      if (items.length > 0) return { items: items, hojaUsada: nombreHoja };
    }
    return null;
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

        const colCosto = mapa.cantidadPack + 2;              // F: costo unitario
        const colGanancia = colCosto + 1;                     // G: ganancia $ (unitario)
        const colPctGanancia = colCosto + 2;                  // H: % ganancia esperado (unitario)
        const colPrecioSegunPct = colCosto + 3;               // I: precio sugerido según % (unitario)
        const colCostoPack = colCosto + 5;                    // K: costo total del pack
        const colGananciaPack = colCosto + 6;                 // L: ganancia $ (pack)
        const colPctGananciaPack = colCosto + 7;              // M: % ganancia esperado (pack)
        const colPrecioSegunPctPack = colCosto + 8;           // N: precio sugerido según % (pack)
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

          // El resto de las columnas (ganancia $, % esperado, precio según
          // %, y sus equivalentes de pack) se guardan "tal cual estén" --
          // si faltan en alguna fila, quedan en null, sin que eso invalide
          // el costo unitario (que es el dato imprescindible para Informes).
          items.push({
            articulo: String(nombre).trim().replace(/\s+/g, ' '),
            costoUnitario: Math.round(costo * 100) / 100,
            gananciaUnitario: redondear(aNumero(fila[colGanancia])),
            pctGananciaEsperadoUnitario: aNumero(fila[colPctGanancia]),
            precioSegunPctUnitario: redondear(aNumero(fila[colPrecioSegunPct])),
            costoPack: redondear(aNumero(fila[colCostoPack])),
            gananciaPack: redondear(aNumero(fila[colGananciaPack])),
            pctGananciaEsperadoPack: aNumero(fila[colPctGananciaPack]),
            precioSegunPctPack: redondear(aNumero(fila[colPrecioSegunPctPack])),
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

  /**
   * Lee TODAS las hojas del Excel que no son la de venta ni la de costos, y
   * arma un mapa artículo -> proveedor. Se basa en que cada hoja adicional
   * (Garra, MundoBazar, KB, etc.) es justamente la lista de productos de
   * ESE proveedor -- el nombre de la hoja se usa tal cual como nombre del
   * proveedor. Usa la comparación normalizada (sin tildes, mayúscula, sin
   * espacios de más) para calzar con los nombres de la hoja de venta.
   */
  function esHojaDeCostos(nombreHoja) {
    const n = normalizar(nombreHoja);
    return PISTAS_HOJA_COSTOS.some(function (p) { return n.indexOf(p) !== -1; });
  }

  function parsearHojasProveedores(workbook, hojasAExcluir) {
    const mapa = {};
    workbook.SheetNames.forEach(function (nombreHoja) {
      if (hojasAExcluir.indexOf(nombreHoja) !== -1) return;
      // La hoja de costos NUNCA es un proveedor, aunque no se haya podido
      // leer (si se la contaba como proveedor, TODOS los artículos quedaban
      // asignados a "Precios y costos unitarios" y la lista de compras no
      // se agrupaba por proveedor).
      if (esHojaDeCostos(nombreHoja)) return;
      const hoja = workbook.Sheets[nombreHoja];
      const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: null, raw: true });

      let colArticulo = null;
      let filaInicio = 0;
      for (let f = 0; f < Math.min(filas.length, 10); f++) {
        const mapaCols = detectarColumnas(filas[f]);
        if ('articulo' in mapaCols) {
          colArticulo = mapaCols.articulo;
          filaInicio = f + 1;
          break;
        }
      }

      if (colArticulo === null) {
        // Algunas hojas de proveedor no tienen fila de encabezado real: los
        // productos arrancan directo en la columna A, justo después del
        // título "HOJA N" (así son, por ejemplo, "KB" y "Surpack"). En ese
        // caso usamos la columna A tal cual, saltando solo esa primera fila
        // de título si existe.
        colArticulo = 0;
        filaInicio = 0;
        for (let f = 0; f < Math.min(filas.length, 5); f++) {
          const primeraCelda = normalizar(filas[f] && filas[f][0]);
          if (primeraCelda.indexOf('HOJA') === 0) { filaInicio = f + 1; break; }
        }
      }

      for (let r = filaInicio; r < filas.length; r++) {
        const fila = filas[r];
        if (!fila) continue;
        const nombre = fila[colArticulo];
        if (nombre === null || nombre === undefined || String(nombre).trim() === '') continue;
        const nombreNorm = normalizar(nombre);
        if (nombreNorm.indexOf('HOJA') === 0 || nombreNorm === 'PRODUCTO' || nombreNorm === 'PRODUCTOS') continue;
        // Si el mismo artículo aparece en más de una hoja de proveedor, se
        // queda con el primero que se encontró (caso raro, no crítico).
        if (!(nombreNorm in mapa)) mapa[nombreNorm] = nombreHoja.trim();
      }
    });
    return mapa;
  }

  /**
   * Plan B para los costos: lee el costo directamente de las hojas de los
   * proveedores (columna B = costo unitario, C = costo del pack, D = cantidad
   * por pack, contando desde la columna del nombre). Son los mismos datos
   * de los que la hoja "Precios y costos unitarios" saca su costo (con
   * fórmulas tipo =MundoBazar!B3), pero acá son números cargados a mano, así
   * que se pueden leer siempre, aunque la hoja de costos venga con las
   * fórmulas sin calcular o con otro formato.
   * Devuelve { nombreNormalizado: { costoUnitario, costoPack } }.
   */
  function parsearCostosDesdeProveedores(workbook, hojasAExcluir) {
    const mapa = {};
    workbook.SheetNames.forEach(function (nombreHoja) {
      if (hojasAExcluir.indexOf(nombreHoja) !== -1 || esHojaDeCostos(nombreHoja)) return;
      const hoja = workbook.Sheets[nombreHoja];
      const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: null, raw: true });

      let colArticulo = 0;
      let filaInicio = 0;
      let encontroEncabezado = false;
      for (let f = 0; f < Math.min(filas.length, 10); f++) {
        const mapaCols = detectarColumnas(filas[f]);
        if ('articulo' in mapaCols) {
          colArticulo = mapaCols.articulo;
          filaInicio = f + 1;
          encontroEncabezado = true;
          break;
        }
      }
      if (!encontroEncabezado) {
        for (let f = 0; f < Math.min(filas.length, 5); f++) {
          const primeraCelda = normalizar(filas[f] && filas[f][0]);
          if (primeraCelda.indexOf('HOJA') === 0) { filaInicio = f + 1; break; }
        }
      }

      for (let r = filaInicio; r < filas.length; r++) {
        const fila = filas[r];
        if (!fila) continue;
        const nombre = fila[colArticulo];
        if (nombre === null || nombre === undefined || String(nombre).trim() === '') continue;
        const nombreNorm = normalizar(nombre);
        if (nombreNorm.indexOf('HOJA') === 0 || nombreNorm === 'PRODUCTO' || nombreNorm === 'PRODUCTOS') continue;
        if (nombreNorm in mapa) continue; // el primero que aparece manda (igual que el mapa de proveedores)

        const cantidadPack = aNumero(fila[colArticulo + 3]);
        let costoPack = aNumero(fila[colArticulo + 2]);
        let costoUnitario = aNumero(fila[colArticulo + 1]);
        if (costoPack !== null && costoPack <= 0) costoPack = null;
        if ((costoUnitario === null || costoUnitario <= 0) && costoPack !== null && cantidadPack > 0) {
          costoUnitario = costoPack / cantidadPack;
        }
        if (costoUnitario === null || costoUnitario <= 0) continue; // sin costo cargado: no inventamos nada
        mapa[nombreNorm] = {
          costoUnitario: Math.round(costoUnitario * 100) / 100,
          costoPack: costoPack === null ? null : Math.round(costoPack * 100) / 100,
        };
      }
    });
    return mapa;
  }


  /**
   * Compara la lista nueva contra la que estaba vigente y arma un informe:
   * precios que cambiaron, artículos nuevos y retirados, y alertas (sin
   * costo, precio por debajo del objetivo de ganancia, pack más caro que
   * la unidad, precios en cero). `itemsConCosto` es el snapshot de costos
   * recién armado (trae costo y % de ganancia esperado de cada artículo).
   */
  function armarInforme(listaAnterior, itemsNuevos, itemsConCosto) {
    const idxAnt = {};
    ((listaAnterior && listaAnterior.items) || []).forEach(function (it) { idxAnt[normalizar(it.articulo)] = it; });
    const idxNue = {};
    itemsNuevos.forEach(function (it) { idxNue[normalizar(it.articulo)] = it; });

    const nuevos = [];
    const cambios = [];
    let iguales = 0;
    itemsNuevos.forEach(function (it) {
      const ant = idxAnt[normalizar(it.articulo)];
      if (!ant) { nuevos.push(it); return; }
      const dU = ant.precioUnitario > 0 ? (it.precioUnitario - ant.precioUnitario) / ant.precioUnitario : null;
      const dP = ant.precioPack > 0 ? (it.precioPack - ant.precioPack) / ant.precioPack : null;
      const cambioPrecio = Math.abs(it.precioUnitario - ant.precioUnitario) > 0.005 || Math.abs(it.precioPack - ant.precioPack) > 0.005;
      const cambioPack = it.cantidadPack !== ant.cantidadPack;
      if (!cambioPrecio && !cambioPack) { iguales++; return; }
      cambios.push({
        articulo: it.articulo, hoja: it.hoja === undefined ? null : it.hoja,
        unitAntes: ant.precioUnitario, unitAhora: it.precioUnitario, pctUnit: dU,
        packAntes: ant.precioPack, packAhora: it.precioPack, pctPack: dP,
        cantAntes: ant.cantidadPack, cantAhora: it.cantidadPack,
      });
    });
    cambios.sort(function (a, b) { return Math.abs(b.pctUnit || 0) - Math.abs(a.pctUnit || 0); });
    const retirados = ((listaAnterior && listaAnterior.items) || []).filter(function (it) { return !(normalizar(it.articulo) in idxNue); });
    const subieron = cambios.filter(function (c) { return (c.pctUnit || 0) > 0.0005; }).length;
    const bajaron = cambios.filter(function (c) { return (c.pctUnit || 0) < -0.0005; }).length;

    // Alertas sobre la lista nueva
    const sinCosto = [];
    const margenBajo = [];
    const packMasCaro = [];
    const precioCero = [];
    (itemsConCosto || []).forEach(function (it) {
      if (!(it.precioUnitario > 0) || !(it.precioPack > 0)) { precioCero.push(it.articulo); return; }
      if (it.precioPack > it.precioUnitario + 0.005) packMasCaro.push({ articulo: it.articulo, unit: it.precioUnitario, pack: it.precioPack });
      if (!(it.costoUnitario > 0)) { sinCosto.push(it.articulo); return; }
      const realU = (it.precioUnitario - it.costoUnitario) / it.precioUnitario;
      const realP = (it.precioPack - it.costoUnitario) / it.precioPack;
      const espU = it.pctGananciaEsperadoUnitario;
      const espP = it.pctGananciaEsperadoPack;
      const bajoU = espU !== null && espU !== undefined && realU < espU - 0.01;
      const bajoP = espP !== null && espP !== undefined && realP < espP - 0.01;
      if (bajoU || bajoP || realU < 0 || realP < 0) {
        margenBajo.push({
          articulo: it.articulo, costo: it.costoUnitario,
          realUnit: realU, esperadoUnit: espU === undefined ? null : espU,
          realPack: realP, esperadoPack: espP === undefined ? null : espP,
          bajoCosto: realU < 0 || realP < 0,
        });
      }
    });
    margenBajo.sort(function (a, b) { return Math.min(a.realUnit, a.realPack) - Math.min(b.realUnit, b.realPack); });

    return {
      hayListaAnterior: !!(listaAnterior && listaAnterior.items && listaAnterior.items.length),
      resumen: { total: itemsNuevos.length, iguales: iguales, cambiaron: cambios.length, subieron: subieron, bajaron: bajaron, nuevos: nuevos.length, retirados: retirados.length },
      cambios: cambios, nuevos: nuevos, retirados: retirados,
      alertas: { sinCosto: sinCosto, margenBajo: margenBajo, packMasCaro: packMasCaro, precioCero: precioCero },
    };
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

  /**
   * Devuelve la lista vigente guardada en Firestore. Si todavía no hay
   * ninguna, NO inventa una: avisa que hay que cargar el Excel. (Antes se
   * usaba una lista "semilla" vieja y se grababa sobre la real: eso pisó la
   * lista de septiembre con la de julio.)
   */
  function cargarListaVigente() {
    const cache = window.Store.obtenerListaPrecios();
    if (cache && Array.isArray(cache.items) && cache.items.length > 0) {
      return Promise.resolve(cache);
    }
    return Promise.reject(new Error('No hay lista de precios cargada.'));
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

      const listaAnteriorParaInforme = listaActual ? JSON.parse(JSON.stringify(listaActual)) : null;
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
      // Formato nuevo (hoja "Maestra"): costos y proveedor salen de ahí.
      const maestra = parsearMaestra(workbook);
      try {
        resultadoCostos = maestra || parsearHojaCostos(workbook);
      } catch (errCostos) {
        console.warn('No se pudo leer la hoja de costos de este Excel:', errCostos);
      }

      const datosCostoPorArticulo = {};
      if (resultadoCostos && resultadoCostos.items.length > 0) {
        resultadoCostos.items.forEach(function (it) { datosCostoPorArticulo[it.articulo] = it; });
      }

      // Plan B: costos leídos de las hojas de proveedores. Se usan para los
      // artículos que la hoja de costos no trajo (o trajo en cero/vacío), y
      // para TODOS si la hoja de costos no se pudo leer.
      const hojasExcluirCostos = [resultado.hojaUsada];
      if (resultadoCostos) hojasExcluirCostos.push(resultadoCostos.hojaUsada);
      // Con la hoja Maestra no hace falta el "plan B": las demás pestañas son
      // de trabajo y no tienen el formato de costos por proveedor.
      const costosProveedores = maestra ? {} : parsearCostosDesdeProveedores(workbook, hojasExcluirCostos);
      let costosDesdeProveedores = 0;

      const ahora = new Date().toISOString();
      const snapshotListaPrecios = {
        fecha: ahora,
        mes: ahora.slice(0, 7), // solo informativo, ya no se usa para buscar
        origenArchivo: file.name,
        // Se guarda TODO lo que trae el Excel para cada artículo: precio de
        // venta (unidad y pack), costo, ganancia en $ y en %, y el precio
        // "sugerido" según el % de ganancia esperado -- tal cual está en tu
        // planilla. Así este historial sirve tanto para Informes de hoy
        // como para cualquier análisis de márgenes que quieras hacer más
        // adelante, sin tener que volver a subir el Excel para conseguirlo.
        items: resultado.items.map(function (it) {
          let datosCosto = datosCostoPorArticulo[it.articulo] || null;
          // Si la hoja de costos no trajo un costo válido para este artículo,
          // se usa el de la hoja de su proveedor (si lo tiene cargado).
          if (!datosCosto || !(datosCosto.costoUnitario > 0)) {
            const deProveedor = costosProveedores[normalizar(it.articulo)];
            if (deProveedor) {
              costosDesdeProveedores++;
              datosCosto = {
                costoUnitario: deProveedor.costoUnitario,
                gananciaUnitario: redondear(it.precioUnitario - deProveedor.costoUnitario),
                pctGananciaEsperadoUnitario: null,
                precioSegunPctUnitario: null,
                costoPack: deProveedor.costoPack,
                gananciaPack: deProveedor.costoPack === null ? null
                  : redondear(it.precioPack * it.cantidadPack - deProveedor.costoPack),
                pctGananciaEsperadoPack: null,
                precioSegunPctPack: null,
              };
            }
          }
          return {
            articulo: it.articulo,
            precioUnitario: it.precioUnitario,
            precioPack: it.precioPack,
            cantidadPack: it.cantidadPack,
            costoUnitario: datosCosto ? datosCosto.costoUnitario : null,
            gananciaUnitario: datosCosto ? datosCosto.gananciaUnitario : null,
            pctGananciaEsperadoUnitario: datosCosto ? datosCosto.pctGananciaEsperadoUnitario : null,
            precioSegunPctUnitario: datosCosto ? datosCosto.precioSegunPctUnitario : null,
            costoPack: datosCosto ? datosCosto.costoPack : null,
            gananciaPack: datosCosto ? datosCosto.gananciaPack : null,
            pctGananciaEsperadoPack: datosCosto ? datosCosto.pctGananciaEsperadoPack : null,
            precioSegunPctPack: datosCosto ? datosCosto.precioSegunPctPack : null,
          };
        }),
      };
      const articulosConCosto = snapshotListaPrecios.items.filter(function (it) { return it.costoUnitario > 0; }).length;
      window.Store.agregarSnapshotCostos(snapshotListaPrecios);

      // Mapa artículo -> proveedor, leyendo el resto de las hojas del Excel
      // (cada una es la lista de un proveedor puntual). Se guarda aparte
      // para usarlo después al generar la "lista de compras" de cualquier
      // presupuesto, sin tener que volver a tocar el Excel.
      const hojasExcluir = hojasExcluirCostos;
      let mapaProveedores;
      if (maestra) {
        // Proveedor de cada artículo = columna PROVEEDOR de la hoja Maestra.
        mapaProveedores = {};
        maestra.items.forEach(function (it) {
          if (it.proveedor && !(normalizar(it.articulo) in mapaProveedores)) {
            mapaProveedores[normalizar(it.articulo)] = it.proveedor;
          }
        });
      } else {
        mapaProveedores = parsearHojasProveedores(workbook, hojasExcluir);
      }

      // Salvaguarda: si NINGÚN artículo de la lista quedó asignado a un
      // proveedor, el Excel tiene algo raro: no pisamos el mapa bueno que ya
      // estaba guardado con uno vacío.
      const asignados = resultado.items.filter(function (it) { return normalizar(it.articulo) in mapaProveedores; }).length;
      if (asignados > 0) window.Store.guardarMapaProveedores(mapaProveedores);

      const sinProveedor = resultado.items
        .map(function (it) { return it.articulo; })
        .filter(function (articulo) { return !(normalizar(articulo) in mapaProveedores); });

      // Informe de cambios + alertas (contra la lista que estaba vigente).
      // Se arma con los datos de costo de este mismo archivo.
      const informe = armarInforme(listaAnteriorParaInforme, resultado.items, snapshotListaPrecios.items);

      // Los artículos cargados a mano que ahora YA están en el Excel salen
      // solos de la bandeja de pendientes.
      const pendientesIncorporados = [];
      if (typeof window.Store.obtenerPendientes === 'function') {
        const clavesNuevas = {};
        resultado.items.forEach(function (it) { clavesNuevas[window.Store.claveArticulo(it.articulo)] = true; });
        window.Store.obtenerPendientes().forEach(function (p) {
          if (clavesNuevas[p.clave || window.Store.claveArticulo(p.articulo)]) {
            window.Store.eliminarPendiente(p.id);
            pendientesIncorporados.push(p.articulo);
          }
        });
      }

      return {
        lista: lista,
        informe: informe,
        pendientesIncorporados: pendientesIncorporados,
        filasIgnoradas: resultado.filasIgnoradas,
        snapshotCostos: snapshotListaPrecios,
        sinProveedor: sinProveedor,
        // Para avisarle a quien sube el Excel qué pasó con los costos:
        costosDesdeHojaCostos: !!resultadoCostos,
        costosDesdeProveedores: costosDesdeProveedores,
        articulosConCosto: articulosConCosto,
        articulosSinCosto: snapshotListaPrecios.items
          .filter(function (it) { return !(it.costoUnitario > 0); })
          .map(function (it) { return it.articulo; }),
        mapaProveedoresActualizado: asignados > 0,
      };
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
    parsearMaestra: parsearMaestra,
    armarInforme: armarInforme,
    parsearHojasProveedores: parsearHojasProveedores,
    parsearCostosDesdeProveedores: parsearCostosDesdeProveedores,
    leerArchivoExcel: leerArchivoExcel,
    cargarListaVigente: cargarListaVigente,
    actualizarListaDesdeArchivo: actualizarListaDesdeArchivo,
    buscarProductos: buscarProductos,
    normalizar: normalizar,
  };
})();
