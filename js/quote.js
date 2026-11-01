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

  /** Nombre con el que el artículo figura en la lista de precios (puede diferir del que se muestra si se lo renombró). */
  function nombreEnLista(linea) {
    return linea.articuloLista || linea.articulo;
  }

  /**
   * Cambia el nombre que se muestra/imprime de una línea, sin perder el
   * vínculo con la lista de precios (para poder recalcular y buscar el
   * costo/proveedor igual). Si vuelve a quedar igual al de la lista, se
   * limpia el vínculo.
   */
  function renombrarLinea(linea, nuevoNombre) {
    const nombre = String(nuevoNombre || '').trim();
    if (!nombre) return linea;
    if (linea.esManual) return Object.assign({}, linea, { articulo: nombre });
    const original = nombreEnLista(linea);
    const copia = Object.assign({}, linea, { articulo: nombre });
    if (nombre === original) delete copia.articuloLista;
    else copia.articuloLista = original;
    return copia;
  }

  function recalcularLinea(linea, listaVigente) {
    // Los artículos manuales (agregados a mano, no están en la lista de
    // precios) nunca se tocan al recalcular: no tienen un "precio vigente"
    // contra el cual actualizarse.
    if (linea.esManual) return linea;
    const producto = listaVigente.items.find(function (p) { return p.articulo === nombreEnLista(linea); });
    if (!producto) {
      return Object.assign({}, linea, { noEncontradoEnListaVigente: true });
    }
    const nueva = crearLineaCarrito(producto, linea.cantidad);
    // Se conserva el nombre que se le puso a mano (si se lo renombró).
    if (linea.articuloLista) {
      nueva.articulo = linea.articulo;
      nueva.articuloLista = linea.articuloLista;
    }
    return nueva;
  }

  /**
   * Crea una línea de carrito para un artículo que NO está en la lista de
   * precios (por ejemplo, algo que pidió puntualmente un cliente). Se marca
   * con esManual:true para que "Recalcular con lista vigente" la deje
   * intacta en vez de marcarla como "no encontrada".
   */
  function crearLineaManual(nombre, cantidad, precioUnitario, proveedor) {
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
      proveedor: String(proveedor || '').trim(),
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

  // -------------------------------------------------------------------
  // Proveedores: detectar que "Mundo vazar", "mundo bazar" o "MUNDOBAZAR"
  // son el mismo proveedor que "MundoBazar", para no duplicarlos.
  // -------------------------------------------------------------------
  function claveProveedor(texto) {
    return String(texto || '').toLowerCase().normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  }

  function distanciaEdicion(a, b) {
    let prev = [];
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }

  /**
   * Busca entre `candidatos` (nombres de proveedores, los oficiales primero)
   * el que corresponde a `texto`. Devuelve null si no hay ninguno, o
   * { nombre, tipo } con tipo 'exacto' (igual sin mayúsculas, espacios ni
   * tildes) o 'parecido' (con un error de tipeo o una parte del nombre).
   */
  function buscarProveedorParecido(texto, candidatos) {
    const k = claveProveedor(texto);
    if (!k) return null;
    const lista = (candidatos || []).filter(Boolean);
    const exacto = lista.find(function (n) { return claveProveedor(n) === k; });
    if (exacto) return { nombre: exacto, tipo: 'exacto' };
    if (k.length < 5) return null; // nombres muy cortos (ej. "KB") solo se unen si son iguales
    let mejor = null;
    lista.forEach(function (n) {
      const kn = claveProveedor(n);
      if (kn.length < 5) return;
      const maxDist = Math.max(k.length, kn.length) >= 8 ? 2 : 1;
      const d = distanciaEdicion(k, kn);
      const contenido = kn.indexOf(k) !== -1 || k.indexOf(kn) !== -1;
      if (d <= maxDist || contenido) {
        const puntaje = contenido ? 0 : d;
        if (!mejor || puntaje < mejor.puntaje) mejor = { nombre: n, tipo: 'parecido', puntaje: puntaje };
      }
    });
    return mejor ? { nombre: mejor.nombre, tipo: mejor.tipo } : null;
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
    nombreEnLista: nombreEnLista,
    buscarProveedorParecido: buscarProveedorParecido,
    renombrarLinea: renombrarLinea,
    marcarPrecioManual: marcarPrecioManual,
    recalcularImporteConPrecioActual: recalcularImporteConPrecioActual,
    calcularTotales: calcularTotales,
    formatoMoneda: formatoMoneda,
    formatoFecha: formatoFecha,
  };
})();
