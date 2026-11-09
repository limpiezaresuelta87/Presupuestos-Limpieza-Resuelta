/**
 * pdf.js
 * -----------------------------------------------------------------------
 * Genera el PDF del presupuesto con jsPDF + jspdf-autotable (CDN, MIT).
 * Expuesto como window.PdfGen.
 * -----------------------------------------------------------------------
 */

(function () {
  function construirPDF(presupuesto, config) {
    const formatoMoneda = window.Quote.formatoMoneda;
    const formatoFecha = window.Quote.formatoFecha;
    const jsPDF = window.jspdf.jsPDF;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const margenIzq = 40;
    let y = 50;

    // ---------- Encabezado: logo + datos de empresa ----------
    if (config.empresa.logoBase64) {
      try {
        doc.addImage(config.empresa.logoBase64, 'PNG', margenIzq, y - 10, 70, 70);
      } catch (e) {
        console.warn('No se pudo insertar el logo en el PDF:', e);
      }
    }

    const xDatosEmpresa = config.empresa.logoBase64 ? margenIzq + 90 : margenIzq;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(config.empresa.nombre || '', xDatosEmpresa, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(90);
    let yEmpresa = y + 16;
    [config.empresa.direccion, config.empresa.telefono, config.empresa.email, config.empresa.cuit]
      .filter(Boolean)
      .forEach(function (linea) {
        doc.text(String(linea), xDatosEmpresa, yEmpresa);
        yEmpresa += 12;
      });

    // ---------- Datos del presupuesto ----------
    doc.setTextColor(0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('PRESUPUESTO', 555, 55, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text('N°: ' + presupuesto.numero, 555, 72, { align: 'right' });
    doc.text('Fecha: ' + formatoFecha(presupuesto.fecha), 555, 86, { align: 'right' });
    doc.text('Válido por ' + presupuesto.validezDias + ' días', 555, 100, { align: 'right' });

    y = Math.max(yEmpresa, 110) + 20;
    doc.setDrawColor(210);
    doc.line(margenIzq, y, 555, y);
    y += 20;

    // ---------- Cliente ----------
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('Cliente', margenIzq, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    y += 16;
    doc.text(presupuesto.cliente.nombre || '(sin especificar)', margenIzq, y);
    if (presupuesto.cliente.contacto) {
      y += 14;
      doc.text(presupuesto.cliente.contacto, margenIzq, y);
    }
    y += 20;

    // ---------- Tabla de productos: cada renglón, uno debajo del otro ----------
    doc.autoTable({
      startY: y,
      head: [['Producto', 'Cant.', 'Tipo precio', 'P. Unit.', 'Subtotal']],
      body: presupuesto.lineas.map(function (l) {
        return [
          l.articulo,
          String(l.cantidad),
          l.tipoPrecio === 'pack' ? 'Pack' : '',
          formatoMoneda(l.precioUnitarioAplicado),
          formatoMoneda(l.importe),
        ];
      }),
      margin: { left: margenIzq, right: 40 },
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 6, textColor: [0, 0, 0] },
      headStyles: { fillColor: [15, 107, 92], textColor: 255, fontStyle: 'bold' },
      bodyStyles: { textColor: [0, 0, 0] },
      alternateRowStyles: { fillColor: [245, 247, 246], textColor: [0, 0, 0] },
      columnStyles: {
        1: { halign: 'center', cellWidth: 45 },
        2: { halign: 'center', cellWidth: 65 },
        3: { halign: 'right', cellWidth: 80 },
        4: { halign: 'right', cellWidth: 80 },
      },
    });

    let yFinal = doc.lastAutoTable.finalY + 20;
    doc.setTextColor(0);

    // ---------- Totales (sin impuestos: es un presupuesto) ----------
    const xTotalesLabel = 380;
    const xTotalesValor = 555;
    function lineaTotales(label, valor, negrita) {
      doc.setFont('helvetica', negrita ? 'bold' : 'normal');
      doc.setFontSize(negrita ? 12 : 10);
      doc.text(label, xTotalesLabel, yFinal);
      doc.text(valor, xTotalesValor, yFinal, { align: 'right' });
      yFinal += negrita ? 20 : 16;
    }

    lineaTotales('Subtotal', formatoMoneda(presupuesto.subtotal), false);
    if (presupuesto.descuentoPct > 0) {
      lineaTotales('Descuento (' + presupuesto.descuentoPct + '%)', '- ' + formatoMoneda(presupuesto.descuentoMonto), false);
    }
    doc.setDrawColor(15, 107, 92);
    doc.line(xTotalesLabel, yFinal - 8, xTotalesValor, yFinal - 8);
    lineaTotales('TOTAL', formatoMoneda(presupuesto.total), true);

    yFinal += 20;

    // ---------- Condiciones, observaciones ----------
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(0);
    doc.text('Condiciones de pago', margenIzq, yFinal);
    doc.setFont('helvetica', 'normal');
    doc.text(presupuesto.condicionesPago || '-', margenIzq, yFinal + 14);
    yFinal += 34;

    if (presupuesto.observaciones) {
      doc.setFont('helvetica', 'bold');
      doc.text('Observaciones', margenIzq, yFinal);
      doc.setFont('helvetica', 'normal');
      const obsLineas = doc.splitTextToSize(presupuesto.observaciones, 515);
      doc.text(obsLineas, margenIzq, yFinal + 14);
      yFinal += 14 + obsLineas.length * 12 + 10;
    }

    // ---------- Firma ----------
    const yFirma = Math.min(Math.max(yFinal + 40, 720), 780);
    doc.setDrawColor(150);
    doc.line(margenIzq, yFirma, margenIzq + 200, yFirma);
    doc.setFontSize(9);
    doc.setTextColor(90);
    doc.text('Firma / Aclaración', margenIzq, yFirma + 14);

    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text('Presupuesto generado el ' + formatoFecha(new Date().toISOString()), margenIzq, 820);

    return doc;
  }

  function nombreArchivoPDF(presupuesto) {
    return ('Presupuesto_' + presupuesto.numero + '_' + (presupuesto.cliente.nombre || 'cliente'))
      .replace(/[^a-zA-Z0-9_\-]+/g, '_')
      .slice(0, 80) + '.pdf';
  }

  const SIN_PROVEEDOR = 'Sin proveedor asignado';

  // Estos proveedores van SIEMPRE en hojas separadas, sin mezclar nada de otro
  // proveedor en la misma hoja (el resto sí puede compartir hoja).
  const PROVEEDORES_EN_HOJA_PROPIA = ['garra', 'mundobazar'];
  function claveProveedorPdf(texto) {
    return String(texto || '').toLowerCase().normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  }
  function esProveedorExclusivo(nombre) {
    return PROVEEDORES_EN_HOJA_PROPIA.indexOf(claveProveedorPdf(nombre)) !== -1;
  }
  // Artículos cargados a mano sin proveedor elegido: no es un error, simplemente no se sabe a quién.
  const OTROS_PROVEEDORES = 'Otros proveedores';

  /**
   * Arma la "lista de compras": las mismas líneas del presupuesto, pero
   * agrupadas por proveedor (para saber a quién comprarle cada cosa) y
   * ordenadas alfabéticamente dentro de cada grupo. Es un documento de uso
   * interno (no para el cliente): muestra costo, no precio de venta.
   * `obtenerCosto(articulo)` es una función que devuelve el costo unitario
   * vigente de ese artículo a la fecha del presupuesto (o null si no hay
   * dato). El grupo "Sin proveedor asignado" (si hay) siempre va al final.
   */
  function construirPDFCompras(presupuesto, mapaProveedores, normalizar, obtenerCosto) {
    const jsPDF = window.jspdf.jsPDF;
    const formatoFecha = window.Quote.formatoFecha;
    const formatoMoneda = window.Quote.formatoMoneda;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const margenIzq = 40;
    let y = 50;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('LISTA DE COMPRAS', margenIzq, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(90);
    y += 20;
    doc.text('Para el presupuesto ' + presupuesto.numero + ' — Cliente: ' + (presupuesto.cliente.nombre || '—'), margenIzq, y);
    y += 14;
    doc.text('Generada el ' + formatoFecha(new Date().toISOString()), margenIzq, y);
    y += 20;
    doc.setDrawColor(210);
    doc.line(margenIzq, y, 555, y);
    y += 15;
    doc.setTextColor(0);

    // Agrupar por proveedor, calculando costo unitario y costo total de cada línea
    const grupos = {};
    // Un mapa guardado con una hoja de costos como "proveedor" (error de una
    // carga anterior del Excel) no sirve para agrupar: se lo ignora.
    const esNombreValido = function (p) { return !!p && !/costo/i.test(String(p)); };
    const proveedoresOficiales = Array.from(new Set(Object.keys(mapaProveedores).map(function (k) { return mapaProveedores[k]; }).filter(esNombreValido)));
    let totalGeneral = 0;
    let totalGeneralCompleto = true; // se pone en false si falta el costo de algún artículo
    presupuesto.lineas.forEach(function (l) {
      // Si la línea trae proveedor cargado a mano (artículo fuera de la
      // lista), manda ese; si no, el del mapa del Excel. Se busca por el
      // nombre de la lista, aunque la línea se haya renombrado.
      const nombreLista = l.articuloLista || l.articulo;
      // Si el proveedor escrito a mano es igual o parecido a uno oficial del
      // Excel (ej. "Mundo vazar" -> "MundoBazar"), se agrupa con ese.
      let proveedorManual = (l.proveedor || '').trim();
      if (proveedorManual) {
        const hallado = window.Quote.buscarProveedorParecido(proveedorManual, proveedoresOficiales);
        if (hallado) proveedorManual = hallado.nombre;
      }
      const delMapa = mapaProveedores[normalizar(nombreLista)];
      const proveedor = proveedorManual || (esNombreValido(delMapa) ? delMapa : '') || (l.esManual ? OTROS_PROVEEDORES : SIN_PROVEEDOR);
      // Manuales: el costo es el que se cargó a mano (si se cargó). Los de la lista: el del historial de costos.
      let costoUnitario = l.esManual
        ? (l.costoManual > 0 ? l.costoManual : null)
        : (obtenerCosto ? obtenerCosto(nombreLista) : null);
      if (!(costoUnitario > 0)) costoUnitario = null; // costo en cero = costo no cargado, nunca "$ 0,00"
      const costoTotal = costoUnitario === null ? null : costoUnitario * l.cantidad;
      if (costoTotal === null) totalGeneralCompleto = false;
      else totalGeneral += costoTotal;
      if (!grupos[proveedor]) grupos[proveedor] = [];
      grupos[proveedor].push(Object.assign({}, l, { costoUnitario: costoUnitario, costoTotal: costoTotal }));
    });

    // Proveedores en orden alfabético, con "Sin proveedor asignado" siempre al final
    const nombresProveedores = Object.keys(grupos)
      .filter(function (p) { return p !== SIN_PROVEEDOR && p !== OTROS_PROVEEDORES; })
      .sort(function (a, b) { return a.localeCompare(b, 'es'); });
    // Al final: primero "Otros proveedores", y último el aviso de "Sin proveedor asignado"
    if (grupos[OTROS_PROVEEDORES]) nombresProveedores.push(OTROS_PROVEEDORES);
    if (grupos[SIN_PROVEEDOR]) nombresProveedores.push(SIN_PROVEEDOR);
    // Garra y Mundo Bazar siempre van primero y cada uno en su(s) propia(s) hoja(s).
    nombresProveedores.sort(function (a, b) { return (esProveedorExclusivo(b) ? 1 : 0) - (esProveedorExclusivo(a) ? 1 : 0); });

    // En la página 1 el encabezado no cuenta como "contenido de un proveedor".
    let hayProveedorEnPagina = false;
    let siguienteEnPaginaNueva = false;
    const resumen = [];

    nombresProveedores.forEach(function (proveedor) {
      const exclusivo = esProveedorExclusivo(proveedor);
      const items = grupos[proveedor].slice().sort(function (a, b) {
        return a.articulo.localeCompare(b.articulo, 'es', { sensitivity: 'base' });
      });
      const subtotalProveedor = items.reduce(function (acc, l) { return acc + (l.costoTotal || 0); }, 0);
      const subtotalCompleto = items.every(function (l) { return l.costoTotal !== null; });

      // Garra y Mundo Bazar empiezan hoja nueva; y el proveedor que viene
      // después de uno de ellos también, así nunca se mezclan.
      if ((exclusivo && hayProveedorEnPagina) || siguienteEnPaginaNueva) {
        doc.addPage();
        y = 50;
      } else if (y > 740) {
        // Si no entra el título del proveedor + al menos una fila, saltar de página
        doc.addPage();
        y = 50;
      }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(15, 107, 92);
      doc.text(proveedor === SIN_PROVEEDOR ? '(!) ' + SIN_PROVEEDOR : proveedor, margenIzq, y);
      doc.setTextColor(0);
      y += 8;

      doc.autoTable({
        startY: y,
        head: [['Producto', 'Cantidad', 'Costo unit.', 'Costo total']],
        body: items.map(function (l) {
          return [
            l.articulo,
            String(l.cantidad),
            l.costoUnitario === null ? 'Sin costo' : formatoMoneda(l.costoUnitario),
            l.costoTotal === null ? 'Sin costo' : formatoMoneda(l.costoTotal),
          ];
        }),
        margin: { left: margenIzq, right: 40 },
        styles: { font: 'helvetica', fontSize: 9, cellPadding: 5, textColor: [0, 0, 0] },
        headStyles: { fillColor: [230, 230, 230], textColor: [0, 0, 0], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [245, 247, 246], textColor: [0, 0, 0] },
        columnStyles: {
          1: { halign: 'center', cellWidth: 60 },
          2: { halign: 'right', cellWidth: 75 },
          3: { halign: 'right', cellWidth: 75 },
        },
      });

      y = doc.lastAutoTable.finalY + 4;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text(
        'Subtotal ' + proveedor + ': ' + formatoMoneda(subtotalProveedor) + (subtotalCompleto ? '' : ' (incompleto, falta el costo de algún artículo)'),
        margenIzq, y + 12, { align: 'left' }
      );
      doc.setFont('helvetica', 'normal');
      y += 28;

      hayProveedorEnPagina = true;
      siguienteEnPaginaNueva = exclusivo;
      resumen.push({ proveedor: proveedor, subtotal: subtotalProveedor, completo: subtotalCompleto });
    });

    // El total va en una hoja aparte si el último proveedor fue Garra o Mundo Bazar.
    if (siguienteEnPaginaNueva || y > 700) { doc.addPage(); y = 50; }
    doc.setDrawColor(210);
    doc.line(margenIzq, y, 555, y);
    y += 20;
    if (resumen.length > 1) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text('Resumen por proveedor', margenIzq, y);
      y += 6;
      doc.autoTable({
        startY: y,
        body: resumen.map(function (r) {
          return [r.proveedor, formatoMoneda(r.subtotal) + (r.completo ? '' : ' (incompleto)')];
        }),
        margin: { left: margenIzq, right: 40 },
        styles: { font: 'helvetica', fontSize: 9, cellPadding: 4, textColor: [0, 0, 0] },
        columnStyles: { 1: { halign: 'right', cellWidth: 140 } },
      });
      y = doc.lastAutoTable.finalY + 22;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(
      'TOTAL ESTIMADO A COMPRAR: ' + (totalGeneral > 0 ? formatoMoneda(totalGeneral) : 'sin costos cargados') + (totalGeneralCompleto ? '' : ' (incompleto)'),
      margenIzq, y
    );
    if (!totalGeneralCompleto) {
      y += 16;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(140);
      doc.text('Algunos artículos no tienen costo cargado todavía y no están sumados en este total.', margenIzq, y);
      doc.setTextColor(0);
    }

    return doc;
  }

  function nombreArchivoListaCompras(presupuesto) {
    return ('Lista_compras_' + presupuesto.numero)
      .replace(/[^a-zA-Z0-9_\-]+/g, '_')
      .slice(0, 80) + '.pdf';
  }


  // ---------------------------------------------------------------------
  // Lista de precios para clientes: se arma sola con la lista vigente,
  // ordenada por hoja del catálogo y por el orden del Excel, centrada.
  // ---------------------------------------------------------------------
  function construirPDFListaPrecios(lista, config) {
    const jsPDF = window.jspdf.jsPDF;
    const formatoMoneda = window.Quote.formatoMoneda;
    const formatoFecha = window.Quote.formatoFecha;
    const empresa = (config && config.empresa) || {};
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const centro = W / 2;
    const anchoTabla = 500;
    const margenLateral = (W - anchoTabla) / 2;
    const arriba = 50;
    const abajo = H - 50;
    let y = 40;

    // ---------- Encabezado centrado ----------
    if (empresa.logoBase64) {
      try {
        doc.addImage(empresa.logoBase64, 'PNG', centro - 32, y, 64, 64);
        y += 74;
      } catch (e) {
        console.warn('No se pudo insertar el logo en el PDF:', e);
      }
    }
    if (empresa.nombre) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(15);
      doc.setTextColor(0);
      doc.text(String(empresa.nombre), centro, y + 8, { align: 'center' });
      y += 20;
    }
    const contacto = [empresa.telefono, empresa.email, empresa.direccion].filter(Boolean).join('   ·   ');
    if (contacto) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(90);
      doc.text(contacto, centro, y + 8, { align: 'center' });
      y += 16;
    }
    y += 10;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.setTextColor(15, 107, 92);
    doc.text('LISTA DE PRECIOS', centro, y + 14, { align: 'center' });
    y += 28;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(90);
    doc.text('Vigente al ' + formatoFecha(lista.actualizado), centro, y + 8, { align: 'center' });
    y += 20;
    doc.setFontSize(8);
    doc.text('El precio por pack se aplica a partir de la cantidad indicada en "Cant. pack".', centro, y + 6, { align: 'center' });
    y += 18;
    doc.setDrawColor(210);
    doc.line(margenLateral, y, W - margenLateral, y);
    y += 16;
    doc.setTextColor(0);

    // ---------- Agrupar por hoja y ordenar ----------
    const items = (lista.items || []).map(function (it, i) { return Object.assign({ _i: i }, it); });
    const hayHojas = items.some(function (it) { return it.hoja !== null && it.hoja !== undefined; });
    let grupos;
    if (hayHojas) {
      const porHoja = {};
      items.forEach(function (it) {
        const k = (it.hoja === null || it.hoja === undefined) ? 'sin' : String(it.hoja);
        if (!porHoja[k]) porHoja[k] = { hoja: k === 'sin' ? null : Number(k), items: [] };
        porHoja[k].items.push(it);
      });
      grupos = Object.keys(porHoja).map(function (k) { return porHoja[k]; }).sort(function (a, b) {
        if (a.hoja === null) return 1;
        if (b.hoja === null) return -1;
        return a.hoja - b.hoja;
      });
      grupos.forEach(function (g) {
        g.items.sort(function (a, b) { return (a.orden || a._i) - (b.orden || b._i); });
      });
    } else {
      // Lista cargada antes de guardar la hoja: queda de la A a la Z sin separadores.
      grupos = [{
        hoja: null,
        items: items.sort(function (a, b) { return a.articulo.localeCompare(b.articulo, 'es', { sensitivity: 'base' }); }),
      }];
    }

    const alturaFila = 18;
    const alturaCabecera = 30;
    const alturaBanda = 26;

    grupos.forEach(function (g) {
      const conBanda = hayHojas;
      const alto = (conBanda ? alturaBanda : 0) + alturaCabecera + g.items.length * alturaFila;
      // Una hoja que entra en una página no se corta; si es más larga, necesita lugar para al menos 4 filas.
      const necesita = alto <= (abajo - arriba) ? alto : (conBanda ? alturaBanda : 0) + alturaCabecera + 4 * alturaFila;
      if (necesita > abajo - y) { doc.addPage(); y = arriba; }

      if (conBanda) {
        doc.setFillColor(15, 107, 92);
        doc.roundedRect(margenLateral, y, anchoTabla, 20, 3, 3, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(255);
        doc.text(g.hoja === null ? 'OTROS ARTÍCULOS' : 'HOJA ' + g.hoja, centro, y + 14, { align: 'center' });
        doc.setTextColor(0);
        y += alturaBanda;
      }

      doc.autoTable({
        startY: y,
        head: [['ARTÍCULO', 'PRECIO UNIDAD', 'CANT. PACK', 'PRECIO POR UNIDAD EN PACK']],
        body: g.items.map(function (it) {
          return [it.articulo, formatoMoneda(it.precioUnitario), String(it.cantidadPack), formatoMoneda(it.precioPack)];
        }),
        margin: { left: margenLateral, right: margenLateral, top: arriba, bottom: 50 },
        tableWidth: anchoTabla,
        styles: { font: 'helvetica', fontSize: 9, cellPadding: 4, textColor: [0, 0, 0], valign: 'middle' },
        headStyles: { fillColor: [230, 240, 237], textColor: [15, 107, 92], fontStyle: 'bold', halign: 'center', fontSize: 8 },
        alternateRowStyles: { fillColor: [247, 249, 248] },
        columnStyles: {
          0: { cellWidth: 232, halign: 'left' },
          1: { cellWidth: 82, halign: 'center' },
          2: { cellWidth: 56, halign: 'center' },
          3: { cellWidth: 130, halign: 'center' },
        },
      });
      y = doc.lastAutoTable.finalY + 14;
    });

    // ---------- Pie de página en todas las hojas ----------
    const total = doc.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
      doc.setPage(i);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(140);
      doc.text(
        (empresa.nombre ? empresa.nombre + '  ·  ' : '') + 'Lista de precios  ·  Página ' + i + ' de ' + total,
        centro, H - 28, { align: 'center' }
      );
    }
    return doc;
  }

  function nombreArchivoListaPrecios(lista) {
    const fecha = (lista && lista.actualizado ? String(lista.actualizado) : new Date().toISOString()).slice(0, 10);
    return 'Lista_de_precios_' + fecha + '.pdf';
  }

  window.PdfGen = {
    construirPDF: construirPDF,
    nombreArchivoPDF: nombreArchivoPDF,
    construirPDFCompras: construirPDFCompras,
    nombreArchivoListaCompras: nombreArchivoListaCompras,
    construirPDFListaPrecios: construirPDFListaPrecios,
    nombreArchivoListaPrecios: nombreArchivoListaPrecios,
  };
})();
