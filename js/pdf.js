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
          l.tipoPrecio === 'pack' ? 'Pack' : (l.tipoPrecio === 'manual' ? 'Manual' : 'Unitario'),
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

  /**
   * Arma la "lista de compras": las mismas líneas del presupuesto, pero
   * agrupadas por proveedor (para saber a quién comprarle cada cosa) y
   * ordenadas alfabéticamente dentro de cada grupo. No es un documento
   * para el cliente -- no muestra precios de venta, solo qué comprar y
   * cuánto. El grupo "Sin proveedor asignado" (si hay) siempre va al final.
   */
  function construirPDFCompras(presupuesto, mapaProveedores, normalizar) {
    const jsPDF = window.jspdf.jsPDF;
    const formatoFecha = window.Quote.formatoFecha;
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

    // Agrupar por proveedor
    const grupos = {};
    presupuesto.lineas.forEach(function (l) {
      const proveedor = mapaProveedores[normalizar(l.articulo)] || SIN_PROVEEDOR;
      if (!grupos[proveedor]) grupos[proveedor] = [];
      grupos[proveedor].push(l);
    });

    // Proveedores en orden alfabético, con "Sin proveedor asignado" siempre al final
    const nombresProveedores = Object.keys(grupos)
      .filter(function (p) { return p !== SIN_PROVEEDOR; })
      .sort(function (a, b) { return a.localeCompare(b, 'es'); });
    if (grupos[SIN_PROVEEDOR]) nombresProveedores.push(SIN_PROVEEDOR);

    nombresProveedores.forEach(function (proveedor) {
      const items = grupos[proveedor].slice().sort(function (a, b) {
        return a.articulo.localeCompare(b.articulo, 'es', { sensitivity: 'base' });
      });

      // Si no entra el título del proveedor + al menos una fila, saltar de página
      if (y > 760) { doc.addPage(); y = 50; }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(15, 107, 92);
      doc.text(proveedor === SIN_PROVEEDOR ? '⚠ ' + SIN_PROVEEDOR : proveedor, margenIzq, y);
      doc.setTextColor(0);
      y += 8;

      doc.autoTable({
        startY: y,
        head: [['Producto', 'Cantidad']],
        body: items.map(function (l) { return [l.articulo, String(l.cantidad)]; }),
        margin: { left: margenIzq, right: 40 },
        styles: { font: 'helvetica', fontSize: 9, cellPadding: 5, textColor: [0, 0, 0] },
        headStyles: { fillColor: [230, 230, 230], textColor: [0, 0, 0], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [245, 247, 246], textColor: [0, 0, 0] },
        columnStyles: { 1: { halign: 'center', cellWidth: 80 } },
      });

      y = doc.lastAutoTable.finalY + 22;
    });

    return doc;
  }

  function nombreArchivoListaCompras(presupuesto) {
    return ('Lista_compras_' + presupuesto.numero)
      .replace(/[^a-zA-Z0-9_\-]+/g, '_')
      .slice(0, 80) + '.pdf';
  }

  window.PdfGen = {
    construirPDF: construirPDF,
    nombreArchivoPDF: nombreArchivoPDF,
    construirPDFCompras: construirPDFCompras,
    nombreArchivoListaCompras: nombreArchivoListaCompras,
  };
})();
