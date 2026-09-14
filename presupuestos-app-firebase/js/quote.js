/**
 * quote.js
 * -----------------------------------------------------------------------
 * Lógica del carrito, la regla de precio unitario/pack, y los totales.
 * Es un PRESUPUESTO (no una factura): no calcula impuestos, solo
 * Subtotal, Descuento y Total. Expuesto como window.Quote.
 * -----------------------------------------------------------------------
 */

(function () {
  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  /**
   * Regla de precios:
   *   - cantidad <  cantidadPack  -> precio unitario * cantidad
   *   - cantidad >= cantidadPack  -> precio pack (precio por unidad en
   *                                   escala de pack) * cantidad
   * El usuario nunca elige el tipo de precio: se decide solo.
   */
  function calcularPrecioAplicado(producto, cantidad) {
    const usaPack = cantidad >= producto.cantidadPack;
    const precioUnitarioAplicado = usaPack ? producto.precioPack : producto.precioUnitario;
    const importe = round2(precioUnitarioAplicado * cantidad);
    return {
      tipoPrecio: usaPack ? 'pack' : 'unitario',
      precioUnitarioAplicado: precioUnitarioAplicado,
      importe: importe,
    };
  }

  function crearLineaCarrito(producto, cantidad) {
    const r = calcularPrecioAplicado(producto, cantidad);
    return {
      articulo: producto.articulo,
      cantidad: cantidad,
      cantidadPack: producto.cantidadPack,
      precioUnitarioOriginal: producto.precioUnitario,
      precioPackOriginal: producto.precioPack,
      tipoPrecio: r.tipoPrecio,
      precioUnitarioAplicado: r.precioUnitarioAplicado,
      importe: r.importe,
    };
  }

  function recalcularLinea(linea, listaVigente) {
    // Los artículos manuales (agregados a mano, no están en la lista de
    // precios) nunca se tocan al recalcular: no tienen un "precio vigente"
    // contra el cual actualizarse.
    if (linea.esManual) return linea;
    const producto = listaVigente.items.find(function (p) { return p.articulo === linea.articulo; });
    if (!producto) {
      return Object.assign({}, linea, { noEncontradoEnListaVigente: true });
    }
    return crearLineaCarrito(producto, linea.cantidad);
  }

  /**
   * Crea una línea de carrito para un artículo que NO está en la lista de
   * precios (por ejemplo, algo que pidió puntualmente un cliente). Se marca
   * con esManual:true para que "Recalcular con lista vigente" la deje
   * intacta en vez de marcarla como "no encontrada".
   */
  function crearLineaManual(nombre, cantidad, precioUnitario) {
    const cantidadFinal = Math.max(1, Math.floor(Number(cantidad) || 1));
    const precio = Math.max(0, Number(precioUnitario) || 0);
    return {
      articulo: String(nombre).trim(),
      cantidad: cantidadFinal,
      cantidadPack: null,
      precioUnitarioOriginal: null,
      precioPackOriginal: null,
      tipoPrecio: 'manual',
      precioUnitarioAplicado: precio,
      importe: round2(precio * cantidadFinal),
      esManual: true,
      editadoManualmente: true,
    };
  }

  /** Fija un precio unitario manual para este presupuesto puntual, sin tocar la lista de precios. */
  function marcarPrecioManual(linea, nuevoPrecioUnitario) {
    const precio = Math.max(0, Number(nuevoPrecioUnitario) || 0);
    return Object.assign({}, linea, {
      tipoPrecio: 'manual',
      precioUnitarioAplicado: precio,
      importe: round2(precio * linea.cantidad),
      editadoManualmente: true,
    });
  }

  /** Recalcula el importe de una línea manteniendo su precio unitario actual (para cambios de cantidad). */
  function recalcularImporteConPrecioActual(linea, nuevaCantidad) {
    return Object.assign({}, linea, {
      cantidad: nuevaCantidad,
      importe: round2(linea.precioUnitarioAplicado * nuevaCantidad),
    });
  }

  /** Subtotal, descuento y total (presupuesto: sin impuestos). */
  function calcularTotales(lineas, descuentoPct) {
    descuentoPct = descuentoPct || 0;
    const subtotal = round2(lineas.reduce(function (acc, l) { return acc + l.importe; }, 0));
    const descuentoMonto = round2(subtotal * (descuentoPct / 100));
    const total = round2(subtotal - descuentoMonto);
    return { subtotal: subtotal, descuentoPct: descuentoPct, descuentoMonto: descuentoMonto, total: total };
  }

  function formatoMoneda(n) {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      minimumFractionDigits: 2,
    }).format(n || 0);
  }

  function formatoFecha(iso) {
    const d = iso ? new Date(iso) : new Date();
    return new Intl.DateTimeFormat('es-AR', { dateStyle: 'long' }).format(d);
  }

  window.Quote = {
    calcularPrecioAplicado: calcularPrecioAplicado,
    crearLineaCarrito: crearLineaCarrito,
    crearLineaManual: crearLineaManual,
    recalcularLinea: recalcularLinea,
    marcarPrecioManual: marcarPrecioManual,
    recalcularImporteConPrecioActual: recalcularImporteConPrecioActual,
    calcularTotales: calcularTotales,
    formatoMoneda: formatoMoneda,
    formatoFecha: formatoFecha,
  };
})();
