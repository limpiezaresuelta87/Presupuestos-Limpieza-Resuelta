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
  /**
   * Regla de redondeo de precios de Limpieza Resuelta: centavos menores a
   * ,50 bajan al peso entero; ,50 exacto se mantiene; mayores a ,50 suben
   * al peso siguiente (1933,3 -> 1933 · 1933,5 -> 1933,5 · 1933,7 -> 1934).
   */
  function redondearPrecio(valor) {
    const entero = Math.floor(valor);
    const centavos = Math.round((valor - entero) * 100) / 100;
    if (centavos < 0.5) return entero;
    if (centavos === 0.5) return entero + 0.5;
    return entero + 1;
  }

  /** Precio de venta a partir del costo y el % de ganancia sobre el precio: costo / (1 - margen). */
  function precioSegunMargen(costo, margenPct) {
    const c = Number(costo);
    const m = Number(margenPct) / 100;
    if (!(c > 0) || !(m > 0) || m >= 1) return 0;
    return redondearPrecio(c / (1 - m));
  }

  /**
   * `extra` (todo opcional): { hoja, costoUnitario, cantidadPack, margenUnit,
   * margenPack } con los márgenes en %. Si no se indica precio pero sí costo y
   * margen, el precio se calcula (con la regla de redondeo). Si además hay
   * cantidad por pack y margen de pack, la línea queda con precio unitario y
   * de pack, y se elige sola según la cantidad (igual que un artículo de la
   * lista). Sigue marcada esManual para que "Recalcular" no la toque.
   */
  function crearLineaManual(nombre, cantidad, precioUnitario, proveedor, extra) {
    extra = extra || {};
    const cantidadFinal = Math.max(1, Math.floor(Number(cantidad) || 1));
    let precio = Math.max(0, Number(precioUnitario) || 0);
    const costo = Number(extra.costoUnitario) > 0 ? Number(extra.costoUnitario) : null;
    const cantPack = Math.floor(Number(extra.cantidadPack)) > 0 ? Math.floor(Number(extra.cantidadPack)) : null;
    const margenUnit = Number(extra.margenUnit) > 0 ? Number(extra.margenUnit) : null;
    const margenPack = Number(extra.margenPack) > 0 ? Number(extra.margenPack) : null;
    if (!(precio > 0) && costo && margenUnit) precio = precioSegunMargen(costo, margenUnit);
    const precioPack = (costo && cantPack && margenPack) ? precioSegunMargen(costo, margenPack) : 0;
    const datosExtra = {
      hoja: Number(extra.hoja) > 0 ? Math.floor(Number(extra.hoja)) : null,
      costoManual: costo,
      margenUnitManual: margenUnit,
      margenPackManual: margenPack,
    };
    // Con precio de pack y de unidad: se comporta como un artículo de lista.
    if (precio > 0 && precioPack > 0 && precioPack <= precio) {
      const base = crearLineaCarrito({ articulo: String(nombre).trim(), precioUnitario: precio, precioPack: precioPack, cantidadPack: cantPack }, cantidadFinal);
      return Object.assign(base, datosExtra, { esManual: true, proveedor: String(proveedor || '').trim() });
    }
    return Object.assign({
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
    }, datosExtra);
  }

  /** Recalcula una línea manual "de dos precios" (unidad y pack) para una nueva cantidad. */
  function recalcularLineaManualConPacks(linea, nuevaCantidad) {
    const nueva = crearLineaCarrito({
      articulo: linea.articulo, precioUnitario: linea.precioUnitarioOriginal,
      precioPack: linea.precioPackOriginal, cantidadPack: linea.cantidadPack,
    }, nuevaCantidad);
    return Object.assign({}, linea, nueva);
  }

  /** ¿Es una línea manual con precio de unidad y de pack (se recalcula con la cantidad)? */
  function esManualConPacks(linea) {
    return !!linea.esManual && !linea.editadoManualmente && linea.cantidadPack > 0 &&
      linea.precioUnitarioOriginal > 0 && linea.precioPackOriginal > 0;
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
    recalcularLineaManualConPacks: recalcularLineaManualConPacks,
    esManualConPacks: esManualConPacks,
    redondearPrecio: redondearPrecio,
    precioSegunMargen: precioSegunMargen,
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
