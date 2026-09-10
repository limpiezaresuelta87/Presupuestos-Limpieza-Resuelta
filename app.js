/**
 * app.js
 * -----------------------------------------------------------------------
 * Orquestación de la interfaz. Script normal (sin import/export): usa
 * las variables globales window.Store, window.Pricelist, window.Quote
 * y window.PdfGen definidas por los otros archivos, que se cargan antes
 * que este en index.html.
 * -----------------------------------------------------------------------
 */

(function () {
  const Store = window.Store;
  const Pricelist = window.Pricelist;
  const Quote = window.Quote;
  const PdfGen = window.PdfGen;

  const estadoApp = {
    listaPrecios: null,
    config: null,
    carrito: [],
    presupuestoAbiertoNumero: null,
    // Si no es null, el carrito activo es una EDICIÓN de un presupuesto ya
    // guardado: { numeroOriginal, numeroBase }. Al guardar se crea una
    // revisión nueva (numeroBase + "-R" + n), nunca se pisa el original.
    edicion: null,
    // Producto elegido en el buscador, pendiente de confirmar cantidad en
    // el panel de carga rápida (evita tener que bajar hasta el carrito).
    seleccionRapida: null,
    // Si está en true, el panel de Historial muestra la papelera en vez del
    // historial activo.
    verPapelera: false,
  };

  const $ = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  const $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };

  function crearElemento(tag, attrs, hijos) {
    attrs = attrs || {};
    hijos = hijos || [];
    const el = document.createElement(tag);
    Object.keys(attrs).forEach(function (k) {
      const v = attrs[k];
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.indexOf('on') === 0 && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    });
    hijos.forEach(function (h) {
      el.appendChild(typeof h === 'string' ? document.createTextNode(h) : h);
    });
    return el;
  }

  function debounce(fn, ms) {
    let t;
    return function () {
      const args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(null, args); }, ms);
    };
  }

  // ---------------------------------------------------------------------
  // Navegación por pestañas
  // ---------------------------------------------------------------------
  function initNavegacion() {
    $$('.tab-btn').forEach(function (btn) {
      if (!btn.dataset.tab) return; // ej: el link a informes.html, que navega solo
      btn.addEventListener('click', function () { cambiarPestana(btn.dataset.tab); });
    });
  }

  function cambiarPestana(tabId) {
    $$('.tab-btn').forEach(function (b) { b.classList.toggle('activo', b.dataset.tab === tabId); });
    $$('.tab-panel').forEach(function (p) { p.classList.toggle('activo', p.id === 'panel-' + tabId); });
    if (tabId === 'historial') renderHistorial();
    if (tabId === 'configuracion') renderConfiguracion();
    if (tabId === 'lista-precios') renderListaPreciosInfo();
  }

  // ---------------------------------------------------------------------
  // Buscador de productos
  // ---------------------------------------------------------------------
  function initBuscador() {
    const input = $('#buscador-producto');
    const resultados = $('#resultados-busqueda');
    let indiceActivo = -1;

    function actualizarResultados() {
      const coincidencias = Pricelist.buscarProductos(estadoApp.listaPrecios, input.value);
      resultados.innerHTML = '';
      indiceActivo = -1;
      if (!input.value.trim()) {
        resultados.classList.remove('visible');
        return;
      }
      if (coincidencias.length === 0) {
        resultados.appendChild(
          crearElemento('li', { class: 'resultado-vacio' }, ['Sin coincidencias en la lista de precios vigente.'])
        );
        resultados.classList.add('visible');
        return;
      }
      coincidencias.forEach(function (producto) {
        const li = crearElemento(
          'li',
          {
            class: 'resultado-item',
            tabindex: '0',
            onclick: function () { abrirSeleccionRapida(producto); },
            onkeydown: function (e) { if (e.key === 'Enter') abrirSeleccionRapida(producto); },
          },
          [
            crearElemento('span', { class: 'resultado-nombre' }, [producto.articulo]),
            crearElemento('span', { class: 'resultado-precio' }, [
              Quote.formatoMoneda(producto.precioUnitario) + ' / u · desde ' + producto.cantidadPack + 'u: ' +
              Quote.formatoMoneda(producto.precioPack) + ' / u',
            ]),
          ]
        );
        resultados.appendChild(li);
      });
      resultados.classList.add('visible');
    }

    input.addEventListener('input', debounce(actualizarResultados, 120));
    input.addEventListener('focus', actualizarResultados);
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.buscador-wrap')) resultados.classList.remove('visible');
    });

    input.addEventListener('keydown', function (e) {
      const items = $$('.resultado-item', resultados);
      if (!items.length) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        indiceActivo = Math.min(indiceActivo + 1, items.length - 1);
        items.forEach(function (it, i) { it.classList.toggle('activo', i === indiceActivo); });
        items[indiceActivo].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        indiceActivo = Math.max(indiceActivo - 1, 0);
        items.forEach(function (it, i) { it.classList.toggle('activo', i === indiceActivo); });
      } else if (e.key === 'Enter' && indiceActivo >= 0) {
        items[indiceActivo].click();
      }
    });
  }

  function agregarProductoAlCarrito(producto, cantidad) {
    cantidad = Math.max(1, Math.floor(Number(cantidad) || 1));
    const existente = estadoApp.carrito.find(function (l) { return l.articulo === producto.articulo; });
    if (existente) {
      actualizarCantidad(producto.articulo, existente.cantidad + cantidad);
    } else {
      estadoApp.carrito.push(Quote.crearLineaCarrito(producto, cantidad));
    }
    renderCarrito();
  }

  // ---------------------------------------------------------------------
  // Panel de carga rápida: al elegir un producto del buscador, en vez de
  // agregarlo directo se muestra acá mismo (pegado al buscador) un mini
  // formulario con la cantidad y el precio que va a aplicar. Así, cuando
  // hay que cargar muchos artículos seguidos, nunca hace falta bajar hasta
  // el final del carrito para tocar la cantidad.
  // ---------------------------------------------------------------------
  function abrirSeleccionRapida(producto) {
    estadoApp.seleccionRapida = { producto: producto };
    $('#resultados-busqueda').classList.remove('visible');
    renderSeleccionRapida();
    const inputCantidad = $('#rapido-cantidad');
    inputCantidad.focus();
    inputCantidad.select();
  }

  function cerrarSeleccionRapida() {
    estadoApp.seleccionRapida = null;
    renderSeleccionRapida();
    const input = $('#buscador-producto');
    input.value = '';
    input.focus();
  }

  function renderSeleccionRapida() {
    const panel = $('#panel-agregar-rapido');
    const sel = estadoApp.seleccionRapida;
    if (!sel) {
      panel.style.display = 'none';
      return;
    }
    const cantidadInput = $('#rapido-cantidad');
    const cantidad = Math.max(1, Math.floor(Number(cantidadInput.value) || 1));
    const r = Quote.calcularPrecioAplicado(sel.producto, cantidad);
    const yaEnCarrito = estadoApp.carrito.find(function (l) { return l.articulo === sel.producto.articulo; });

    $('#rapido-nombre').textContent = sel.producto.articulo;
    $('#rapido-preview').textContent =
      (r.tipoPrecio === 'pack' ? 'Precio pack: ' : 'Precio unitario: ') +
      Quote.formatoMoneda(r.precioUnitarioAplicado) + ' c/u · Subtotal: ' + Quote.formatoMoneda(r.importe) +
      (yaEnCarrito ? ' · Ya hay ' + yaEnCarrito.cantidad + ' en el presupuesto, se van a sumar.' : '');
    panel.style.display = 'flex';
  }

  function confirmarSeleccionRapida() {
    const sel = estadoApp.seleccionRapida;
    if (!sel) return;
    const cantidad = $('#rapido-cantidad').value;
    agregarProductoAlCarrito(sel.producto, cantidad);
    mostrarAviso(sel.producto.articulo + ' agregado al presupuesto.');
    cerrarSeleccionRapida();
  }

  function initSeleccionRapida() {
    $('#rapido-cantidad').addEventListener('input', renderSeleccionRapida);
    $('#rapido-cantidad').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); confirmarSeleccionRapida(); }
      if (e.key === 'Escape') { e.preventDefault(); cerrarSeleccionRapida(); }
    });
    $('#btn-rapido-agregar').addEventListener('click', confirmarSeleccionRapida);
    $('#btn-rapido-cancelar').addEventListener('click', cerrarSeleccionRapida);
  }

  function actualizarCantidad(articulo, nuevaCantidad) {
    const idx = estadoApp.carrito.findIndex(function (l) { return l.articulo === articulo; });
    if (idx === -1) return;
    const cantidad = Math.max(1, Math.floor(Number(nuevaCantidad) || 1));
    const lineaActual = estadoApp.carrito[idx];
    if (lineaActual.editadoManualmente) {
      // Si el precio fue fijado a mano, se mantiene ese precio unitario y solo se
      // recalcula el subtotal con la nueva cantidad (no vuelve a la lista de precios).
      estadoApp.carrito[idx] = Quote.recalcularImporteConPrecioActual(lineaActual, cantidad);
    } else {
      const producto = estadoApp.listaPrecios.items.find(function (p) { return p.articulo === articulo; });
      estadoApp.carrito[idx] = producto
        ? Quote.crearLineaCarrito(producto, cantidad)
        : Object.assign({}, lineaActual, { cantidad: cantidad });
    }
    renderCarrito();
  }

  function actualizarPrecioManual(articulo, nuevoPrecio) {
    const idx = estadoApp.carrito.findIndex(function (l) { return l.articulo === articulo; });
    if (idx === -1) return;
    estadoApp.carrito[idx] = Quote.marcarPrecioManual(estadoApp.carrito[idx], nuevoPrecio);
    renderCarrito();
  }

  function restablecerPrecioLinea(articulo) {
    const idx = estadoApp.carrito.findIndex(function (l) { return l.articulo === articulo; });
    if (idx === -1) return;
    estadoApp.carrito[idx] = Quote.recalcularLinea(estadoApp.carrito[idx], estadoApp.listaPrecios);
    renderCarrito();
  }

  function quitarDelCarrito(articulo) {
    estadoApp.carrito = estadoApp.carrito.filter(function (l) { return l.articulo !== articulo; });
    renderCarrito();
  }

  // ---------------------------------------------------------------------
  // Artículo manual (no está en la lista de precios)
  // ---------------------------------------------------------------------
  function initFormularioManual() {
    const btnToggle = $('#btn-toggle-manual');
    const form = $('#form-manual');

    btnToggle.addEventListener('click', function () {
      const visible = form.style.display !== 'none';
      form.style.display = visible ? 'none' : 'flex';
      if (!visible) $('#manual-nombre').focus();
    });

    $('#btn-agregar-manual').addEventListener('click', function () {
      const nombre = $('#manual-nombre').value.trim();
      if (!nombre) {
        mostrarAviso('Ingresá el nombre del artículo.', true);
        return;
      }
      const cantidad = $('#manual-cantidad').value;
      const precio = $('#manual-precio').value;
      estadoApp.carrito.push(Quote.crearLineaManual(nombre, cantidad, precio));
      $('#manual-nombre').value = '';
      $('#manual-cantidad').value = '1';
      $('#manual-precio').value = '0';
      form.style.display = 'none';
      renderCarrito();
      mostrarAviso('Artículo agregado al presupuesto.');
    });
  }

  // ---------------------------------------------------------------------
  // Render del carrito (una fila por artículo) y totales
  // ---------------------------------------------------------------------
  function renderCarrito() {
    const tbody = $('#tabla-carrito tbody');
    tbody.innerHTML = '';

    if (estadoApp.carrito.length === 0) {
      tbody.appendChild(
        crearElemento('tr', {}, [
          crearElemento('td', { colspan: '6', class: 'vacio' }, ['Todavía no agregaste productos. Usá el buscador de arriba.']),
        ])
      );
    }

    estadoApp.carrito.forEach(function (linea) {
      const precioEditado = !!linea.editadoManualmente;
      const esArticuloFueraDeLista = !!linea.esManual;
      const etiquetaTipo = linea.tipoPrecio === 'pack'
        ? ('Pack (≥' + linea.cantidadPack + 'u)')
        : (linea.tipoPrecio === 'manual'
          ? (esArticuloFueraDeLista ? 'Manual (fuera de lista)' : 'Manual')
          : 'Unitario');

      const celdaPrecio = crearElemento('td', { class: 'col-precio' }, [
        crearElemento('input', {
          type: 'number',
          min: '0',
          step: '0.01',
          value: String(linea.precioUnitarioAplicado),
          class: 'input-precio' + (precioEditado ? ' input-precio-manual' : ''),
          title: 'Editá este valor para fijar un precio distinto solo para este presupuesto.',
          onchange: function (e) { actualizarPrecioManual(linea.articulo, e.target.value); },
        }),
        // El botón de "restablecer" solo tiene sentido si el artículo existe
        // en la lista de precios; uno agregado a mano no tiene a qué volver.
        (precioEditado && !esArticuloFueraDeLista)
          ? crearElemento('button', {
              class: 'btn-icono btn-reset',
              title: 'Restablecer precio de la lista vigente',
              onclick: function () { restablecerPrecioLinea(linea.articulo); },
            }, ['↺'])
          : document.createTextNode(''),
      ]);

      const tr = crearElemento('tr', {}, [
        crearElemento('td', { class: 'col-producto' }, [linea.articulo]),
        crearElemento('td', { class: 'col-cantidad' }, [
          crearElemento('input', {
            type: 'number',
            min: '1',
            value: String(linea.cantidad),
            class: 'input-cantidad',
            onchange: function (e) { actualizarCantidad(linea.articulo, e.target.value); },
          }),
        ]),
        crearElemento('td', { class: 'col-tipo' }, [
          crearElemento('span', { class: 'badge badge-' + linea.tipoPrecio }, [etiquetaTipo]),
        ]),
        celdaPrecio,
        crearElemento('td', { class: 'col-subtotal' }, [Quote.formatoMoneda(linea.importe)]),
        crearElemento('td', { class: 'col-quitar' }, [
          crearElemento('button', { class: 'btn-icono', title: 'Quitar', onclick: function () { quitarDelCarrito(linea.articulo); } }, ['✕']),
        ]),
      ]);
      tbody.appendChild(tr);
    });

    renderTotales();
  }

  function renderTotales() {
    const descuentoPct = Number($('#input-descuento').value) || 0;
    const totales = Quote.calcularTotales(estadoApp.carrito, descuentoPct);
    $('#total-subtotal').textContent = Quote.formatoMoneda(totales.subtotal);
    $('#total-descuento').textContent = '- ' + Quote.formatoMoneda(totales.descuentoMonto);
    $('#total-final').textContent = Quote.formatoMoneda(totales.total);
    return totales;
  }

  // ---------------------------------------------------------------------
  // Guardar presupuesto + generar PDF
  // ---------------------------------------------------------------------
  // ---------------------------------------------------------------------
  // Selector de cliente: desplegable poblado desde Store.obtenerClientes(),
  // con una opción para dar de alta un cliente nuevo (se guarda en
  // Firestore para que las 3 PCs lo vean de inmediato).
  // ---------------------------------------------------------------------
  function renderOpcionesCliente(seleccionado) {
    const select = $('#input-cliente-nombre');
    const actual = seleccionado !== undefined ? seleccionado : select.value;
    select.innerHTML = '';
    select.appendChild(crearElemento('option', { value: '' }, ['— Seleccionar cliente —']));
    Store.obtenerClientes().forEach(function (nombre) {
      select.appendChild(crearElemento('option', { value: nombre }, [nombre]));
    });
    select.appendChild(crearElemento('option', { value: '__nuevo__' }, ['+ Agregar cliente nuevo']));
    // Si el cliente actual (por ejemplo al editar un presupuesto viejo) no
    // está en la lista, lo agregamos como opción temporal para que se vea
    // seleccionado, sin guardarlo en la base hasta que se use de nuevo.
    if (actual && actual !== '__nuevo__' && Store.obtenerClientes().indexOf(actual) === -1) {
      const opcionTemporal = crearElemento('option', { value: actual }, [actual]);
      select.insertBefore(opcionTemporal, select.lastChild);
    }
    select.value = actual || '';
  }

  function initSelectorCliente() {
    renderOpcionesCliente('');

    $('#input-cliente-nombre').addEventListener('change', function (e) {
      if (e.target.value === '__nuevo__') {
        $('#campo-cliente-nuevo').style.display = '';
        $('#input-cliente-nuevo').value = '';
        $('#input-cliente-nuevo').focus();
      } else {
        $('#campo-cliente-nuevo').style.display = 'none';
      }
    });

    function confirmarClienteNuevo() {
      const nombre = $('#input-cliente-nuevo').value.trim();
      if (!nombre) {
        mostrarAviso('Escribí el nombre del cliente nuevo.', true);
        return;
      }
      const nombreGuardado = Store.agregarCliente(nombre);
      renderOpcionesCliente(nombreGuardado);
      $('#campo-cliente-nuevo').style.display = 'none';
      mostrarAviso('Cliente "' + nombreGuardado + '" agregado.');
    }

    $('#btn-cliente-nuevo-confirmar').addEventListener('click', confirmarClienteNuevo);
    $('#input-cliente-nuevo').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); confirmarClienteNuevo(); }
    });
    $('#btn-cliente-nuevo-cancelar').addEventListener('click', function () {
      $('#campo-cliente-nuevo').style.display = 'none';
      $('#input-cliente-nombre').value = '';
    });
  }

  function initFormularioPresupuesto() {
    $('#input-descuento').addEventListener('input', renderTotales);
    $('#btn-cancelar-edicion').addEventListener('click', cancelarEdicion);

    // Nota: armarPresupuestoDesdeFormulario ahora devuelve una Promise en
    // vez del presupuesto directo. Es el único cambio real que trajo pasar
    // a Firestore: pedir el número de presupuesto tiene que esperar una
    // confirmación de la nube (para que dos PCs nunca se lleven el mismo
    // número si guardan al mismo tiempo). Todo lo demás sigue igual.
    $('#btn-guardar-presupuesto').addEventListener('click', function () {
      armarPresupuestoDesdeFormulario({}).then(function (presupuesto) {
        if (!presupuesto) return;
        Store.guardarPresupuesto(presupuesto);
        mostrarAviso('Presupuesto ' + presupuesto.numero + ' guardado en el historial.');
        limpiarFormularioNuevoPresupuesto();
      });
    });

    $('#btn-vista-previa').addEventListener('click', function () {
      armarPresupuestoDesdeFormulario({ soloPreview: true }).then(function (presupuesto) {
        if (!presupuesto) return;
        abrirVistaPreviaPDF(presupuesto);
      });
    });

    $('#btn-descargar-pdf').addEventListener('click', function () {
      armarPresupuestoDesdeFormulario({}).then(function (presupuesto) {
        if (!presupuesto) return;
        Store.guardarPresupuesto(presupuesto);
        descargarPDF(presupuesto);
        mostrarAviso('Presupuesto ' + presupuesto.numero + ' guardado y PDF descargado.');
        limpiarFormularioNuevoPresupuesto();
      });
    });
  }

  // ---------------------------------------------------------------------
  // Revisiones: al editar un presupuesto ya guardado, nunca se pisa el
  // original. Se guarda como PRES-0007-R1, PRES-0007-R2, etc. agrupadas
  // bajo el mismo "numeroBase" (el número del presupuesto original).
  // ---------------------------------------------------------------------
  function calcularNumeroBase(numero) {
    const m = String(numero).match(/^(.*)-R\d+$/);
    return m ? m[1] : String(numero);
  }

  function escaparRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function siguienteNumeroRevision(numeroBase) {
    const historial = Store.obtenerHistorial();
    const patron = new RegExp('^' + escaparRegExp(numeroBase) + '-R(\\d+)$');
    let max = 0;
    historial.forEach(function (p) {
      const coincide = String(p.numero).match(patron);
      if (coincide) max = Math.max(max, Number(coincide[1]));
    });
    return numeroBase + '-R' + (max + 1);
  }

  function armarPresupuestoDesdeFormulario(opts) {
    opts = opts || {};
    if (estadoApp.carrito.length === 0) {
      mostrarAviso('Agregá al menos un producto antes de generar el presupuesto.', true);
      return Promise.resolve(null);
    }
    const nombreCliente = $('#input-cliente-nombre').value.trim();
    if (!nombreCliente || nombreCliente === '__nuevo__') {
      mostrarAviso('Elegí un cliente (o agregá uno nuevo) antes de continuar.', true);
      return Promise.resolve(null);
    }
    const totales = renderTotales();

    function conNumero(numero) {
      return Object.assign(
        {
          numero: numero,
          numeroBase: estadoApp.edicion ? estadoApp.edicion.numeroBase : numero,
          revisionDe: estadoApp.edicion ? estadoApp.edicion.numeroOriginal : null,
          fecha: new Date().toISOString(),
          cliente: {
            nombre: nombreCliente,
            contacto: $('#input-cliente-contacto').value.trim(),
          },
          // Las líneas quedan ordenadas alfabéticamente por producto (A a Z)
          // al guardar. Esto es lo que después se ve en el historial y en el
          // PDF (cantidades y precios de cada línea no se tocan, solo el orden).
          lineas: JSON.parse(JSON.stringify(estadoApp.carrito)).sort(function (a, b) {
            return a.articulo.localeCompare(b.articulo, 'es', { sensitivity: 'base' });
          }),
        },
        totales,
        {
          condicionesPago: $('#input-condiciones').value.trim() || Store.obtenerConfig().condicionesPagoPorDefecto,
          validezDias: Number($('#input-validez').value) || Store.obtenerConfig().validezDiasPorDefecto,
          observaciones: $('#input-observaciones').value.trim(),
          listaPreciosFecha: estadoApp.listaPrecios.actualizado,
        }
      );
    }

    if (opts.soloPreview) {
      // Solo vista previa: no consume número real, muestra el que vendría.
      return Promise.resolve(conNumero('PREVIEW-' + Store.obtenerConfig().numeracion.siguienteNumero));
    } else if (estadoApp.edicion) {
      // Es una edición: no consume el correlativo general, crea una
      // revisión numerada del presupuesto original. Esto sigue leyendo del
      // cache local (instantáneo); en el caso muy poco común de que dos
      // PCs editen EL MISMO presupuesto en el mismo instante, podría
      // repetirse un número de revisión -- lo mismo que pasaba antes de
      // Firestore, así que no cambia el comportamiento previo.
      return Promise.resolve(conNumero(siguienteNumeroRevision(estadoApp.edicion.numeroBase)));
    } else {
      // Presupuesto nuevo: acá sí hace falta esperar la confirmación
      // atómica de Firestore para el número correlativo.
      return Store.tomarSiguienteNumero().then(conNumero);
    }
  }

  function limpiarFormularioNuevoPresupuesto() {
    estadoApp.carrito = [];
    estadoApp.edicion = null;
    ocultarBannerEdicion();
    $('#form-manual').style.display = 'none';
    $('#campo-cliente-nuevo').style.display = 'none';
    renderOpcionesCliente('');
    $('#input-cliente-contacto').value = '';
    $('#input-observaciones').value = '';
    const config = Store.obtenerConfig();
    $('#input-descuento').value = '0';
    $('#input-condiciones').value = config.condicionesPagoPorDefecto;
    $('#input-validez').value = String(config.validezDiasPorDefecto);
    renderCarrito();
  }

  // ---------------------------------------------------------------------
  // Editar un presupuesto existente: lo carga en el carrito activo para
  // corregirlo. Al guardar, se crea como revisión nueva (nunca se pisa el
  // presupuesto original, por si ya se lo mandaste al cliente).
  // ---------------------------------------------------------------------
  function editarPresupuesto(numero) {
    const presupuesto = Store.buscarPresupuesto(numero);
    if (!presupuesto) return;

    const numeroBase = presupuesto.numeroBase || calcularNumeroBase(presupuesto.numero);
    estadoApp.edicion = { numeroOriginal: presupuesto.numero, numeroBase: numeroBase };
    estadoApp.carrito = JSON.parse(JSON.stringify(presupuesto.lineas));

    renderOpcionesCliente(presupuesto.cliente.nombre || '');
    $('#input-cliente-contacto').value = presupuesto.cliente.contacto || '';
    $('#input-descuento').value = String(presupuesto.descuentoPct || 0);
    $('#input-validez').value = String(presupuesto.validezDias || Store.obtenerConfig().validezDiasPorDefecto);
    $('#input-condiciones').value = presupuesto.condicionesPago || '';
    $('#input-observaciones').value = presupuesto.observaciones || '';

    renderCarrito();
    mostrarBannerEdicion();
    $('#detalle-historial').classList.remove('visible');
    cambiarPestana('nuevo');
    mostrarAviso('Editando ' + presupuesto.numero + '. Al guardar se crea una revisión nueva, sin pisar el original.');
  }

  function mostrarBannerEdicion() {
    if (!estadoApp.edicion) { ocultarBannerEdicion(); return; }
    $('#banner-edicion-texto').textContent =
      'Editando ' + estadoApp.edicion.numeroOriginal + ' — al guardar se creará ' +
      siguienteNumeroRevision(estadoApp.edicion.numeroBase) + '.';
    $('#banner-edicion').style.display = 'flex';
  }

  function ocultarBannerEdicion() {
    $('#banner-edicion').style.display = 'none';
  }

  function cancelarEdicion() {
    limpiarFormularioNuevoPresupuesto();
    mostrarAviso('Edición cancelada.');
  }

  // ---------------------------------------------------------------------
  // PDF
  // ---------------------------------------------------------------------
  function abrirVistaPreviaPDF(presupuesto) {
    const doc = PdfGen.construirPDF(presupuesto, Store.obtenerConfig());
    const blobUrl = doc.output('bloburl');
    window.open(blobUrl, '_blank');
  }

  function descargarPDF(presupuesto) {
    const doc = PdfGen.construirPDF(presupuesto, Store.obtenerConfig());
    doc.save(PdfGen.nombreArchivoPDF(presupuesto));
  }

  // ---------------------------------------------------------------------
  // Historial
  // ---------------------------------------------------------------------
  function renderHistorial() {
    const tbody = $('#tabla-historial tbody');
    const historial = estadoApp.verPapelera ? Store.obtenerPapelera() : Store.obtenerHistorial();
    tbody.innerHTML = '';

    const btnPapelera = $('#btn-toggle-papelera');
    if (btnPapelera) {
      const cantidadPapelera = Store.obtenerPapelera().length;
      btnPapelera.textContent = estadoApp.verPapelera
        ? 'Volver al historial'
        : 'Papelera (' + cantidadPapelera + ')';
    }
    $('#historial-titulo').textContent = estadoApp.verPapelera ? 'Papelera' : 'Historial de presupuestos';

    if (historial.length === 0) {
      tbody.appendChild(
        crearElemento('tr', {}, [crearElemento('td', {
          colspan: '6', class: 'vacio',
        }, [estadoApp.verPapelera ? 'La papelera está vacía.' : 'Todavía no generaste presupuestos.'])])
      );
      return;
    }

    historial.forEach(function (p) {
      const acciones = estadoApp.verPapelera
        ? [
            crearElemento('button', { class: 'btn-mini', onclick: function () { verDetalleHistorial(p.numero); } }, ['Ver']),
            crearElemento('button', {
              class: 'btn-mini',
              onclick: function () { restaurarPresupuesto(p.numero); },
            }, ['Restaurar']),
            crearElemento('button', {
              class: 'btn-mini btn-mini-peligro',
              onclick: function () { eliminarPresupuestoDefinitivo(p.numero); },
            }, ['Eliminar para siempre']),
          ]
        : [
            crearElemento('button', { class: 'btn-mini', onclick: function () { verDetalleHistorial(p.numero); } }, ['Ver']),
            crearElemento('button', { class: 'btn-mini', onclick: function () { editarPresupuesto(p.numero); } }, ['Editar']),
            crearElemento('button', { class: 'btn-mini', onclick: function () { recalcularPresupuestoDirecto(p.numero); } }, ['Recalcular']),
            crearElemento('button', { class: 'btn-mini', onclick: function () { descargarPDF(p); } }, ['PDF']),
            crearElemento('button', {
              class: 'btn-mini btn-mini-peligro',
              onclick: function () { moverPresupuestoAPapelera(p.numero); },
            }, ['Eliminar']),
          ];

      const tr = crearElemento('tr', {}, [
        crearElemento('td', {}, [p.numero]),
        crearElemento('td', {}, [Quote.formatoFecha(p.fecha)]),
        crearElemento('td', {}, [p.cliente.nombre]),
        crearElemento('td', {}, [String(p.lineas.length)]),
        crearElemento('td', { class: 'col-precio' }, [Quote.formatoMoneda(p.total)]),
        crearElemento('td', { class: 'col-acciones' }, acciones),
      ]);
      tbody.appendChild(tr);
    });
  }

  /**
   * Borrado suave: el presupuesto pasa a la papelera. No se pierde (se
   * puede restaurar), pero deja de contar en el historial visible y en los
   * informes. Se pide confirmación porque, aunque no es irreversible, no
   * queremos que se mueva un presupuesto por error sin darse cuenta.
   */
  function moverPresupuestoAPapelera(numero) {
    const confirmar = window.confirm(
      'El presupuesto ' + numero + ' va a pasar a la papelera. Vas a poder restaurarlo ' +
      'desde ahí si fue un error.\n\n¿Confirmás?'
    );
    if (!confirmar) return;
    Store.moverAPapelera(numero);
    mostrarAviso('Presupuesto ' + numero + ' movido a la papelera.');
    $('#detalle-historial').classList.remove('visible');
    renderHistorial();
  }

  function restaurarPresupuesto(numero) {
    Store.restaurarDePapelera(numero);
    mostrarAviso('Presupuesto ' + numero + ' restaurado.');
    renderHistorial();
  }

  function eliminarPresupuestoDefinitivo(numero) {
    const confirmar = window.confirm(
      'Esto borra el presupuesto ' + numero + ' para siempre, no se puede deshacer.\n\n¿Confirmás?'
    );
    if (!confirmar) return;
    Store.eliminarDefinitivo(numero);
    mostrarAviso('Presupuesto ' + numero + ' eliminado definitivamente.');
    $('#detalle-historial').classList.remove('visible');
    renderHistorial();
  }

  function initTogglePapelera() {
    const btn = $('#btn-toggle-papelera');
    if (!btn) return;
    btn.addEventListener('click', function () {
      estadoApp.verPapelera = !estadoApp.verPapelera;
      $('#detalle-historial').classList.remove('visible');
      renderHistorial();
    });
  }

  function verDetalleHistorial(numero) {
    const presupuesto = Store.buscarPresupuesto(numero);
    if (!presupuesto) return;
    estadoApp.presupuestoAbiertoNumero = numero;

    const detalle = $('#detalle-historial');
    detalle.classList.add('visible');
    $('#detalle-numero').textContent = presupuesto.numero;
    $('#detalle-fecha').textContent = Quote.formatoFecha(presupuesto.fecha);
    $('#detalle-cliente').textContent = presupuesto.cliente.nombre;
    $('#detalle-lista-fecha').textContent = presupuesto.listaPreciosFecha ? Quote.formatoFecha(presupuesto.listaPreciosFecha) : '—';

    const tbody = $('#detalle-tabla tbody');
    tbody.innerHTML = '';
    presupuesto.lineas.forEach(function (l) {
      tbody.appendChild(
        crearElemento('tr', { class: l.noEncontradoEnListaVigente ? 'fila-alerta' : '' }, [
          crearElemento('td', {}, [l.articulo]),
          crearElemento('td', {}, [String(l.cantidad)]),
          crearElemento('td', {}, [l.tipoPrecio === 'pack' ? 'Pack' : (l.tipoPrecio === 'manual' ? 'Manual' : 'Unitario')]),
          crearElemento('td', {}, [Quote.formatoMoneda(l.precioUnitarioAplicado)]),
          crearElemento('td', {}, [Quote.formatoMoneda(l.importe)]),
        ])
      );
    });
    $('#detalle-total').textContent = Quote.formatoMoneda(presupuesto.total);

    $('#btn-recalcular').onclick = function () { recalcularPresupuestoDirecto(presupuesto.numero); };
    $('#btn-detalle-editar').onclick = function () { editarPresupuesto(presupuesto.numero); };
    $('#btn-detalle-pdf').onclick = function () { descargarPDF(presupuesto); };
    $('#btn-detalle-eliminar').onclick = function () { moverPresupuestoAPapelera(presupuesto.numero); };
    $('#btn-detalle-cerrar').onclick = function () { detalle.classList.remove('visible'); };
  }

  /** Recalcula un presupuesto del historial con la lista de precios vigente,
   * sin necesidad de tenerlo abierto en el detalle primero (se puede llamar
   * directo desde la fila de la tabla). */
  function recalcularPresupuestoDirecto(numero) {
    const presupuesto = Store.buscarPresupuesto(numero);
    if (!presupuesto) return;
    const nuevasLineas = presupuesto.lineas.map(function (l) { return Quote.recalcularLinea(l, estadoApp.listaPrecios); });
    const totales = Quote.calcularTotales(nuevasLineas, presupuesto.descuentoPct);
    const actualizado = Object.assign({}, presupuesto, totales, {
      lineas: nuevasLineas,
      listaPreciosFecha: estadoApp.listaPrecios.actualizado,
      recalculadoEl: new Date().toISOString(),
    });
    Store.actualizarPresupuesto(presupuesto.numero, actualizado);
    mostrarAviso('Presupuesto ' + presupuesto.numero + ' recalculado con la lista de precios vigente.');
    renderHistorial();
    if (estadoApp.presupuestoAbiertoNumero === presupuesto.numero) verDetalleHistorial(presupuesto.numero);
  }

  // ---------------------------------------------------------------------
  // Exportar / importar historial (para juntar presupuestos de varios
  // dispositivos, ej. PC + celular, sin necesidad de nube).
  // ---------------------------------------------------------------------
  function exportarHistorial() {
    const historial = Store.obtenerHistorial();
    if (historial.length === 0) {
      mostrarAviso('Todavía no hay presupuestos para exportar.', true);
      return;
    }
    const payload = {
      exportadoEl: new Date().toISOString(),
      cantidad: historial.length,
      presupuestos: historial,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const fechaCorta = new Date().toISOString().slice(0, 10);
    const a = crearElemento('a', { href: url, download: 'historial-presupuestos-' + fechaCorta + '.json' }, []);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    mostrarAviso('Se exportaron ' + historial.length + ' presupuestos. Mandate ese archivo al otro dispositivo para importarlo.');
  }

  function importarHistorialDesdeArchivo(file) {
    const lector = new FileReader();
    lector.onload = function (e) {
      try {
        const data = JSON.parse(e.target.result);
        const entrantes = Array.isArray(data)
          ? data
          : (data && Array.isArray(data.presupuestos) ? data.presupuestos : null);
        if (!entrantes) {
          throw new Error('El archivo no tiene el formato esperado (tiene que ser un historial exportado desde esta misma app).');
        }
        const existentes = Store.obtenerHistorial();
        const numerosExistentes = {};
        existentes.forEach(function (p) { numerosExistentes[p.numero] = true; });
        const nuevos = entrantes.filter(function (p) { return p && p.numero && !numerosExistentes[p.numero]; });
        const combinado = existentes.concat(nuevos).sort(function (a, b) {
          return new Date(b.fecha) - new Date(a.fecha);
        });
        Store.guardarHistorialCompleto(combinado);
        renderHistorial();
        const yaExistian = entrantes.length - nuevos.length;
        mostrarAviso(
          'Se importaron ' + nuevos.length + ' presupuestos nuevos' +
          (yaExistian > 0 ? ' (' + yaExistian + ' ya estaban y se omitieron).' : '.')
        );
      } catch (err) {
        console.error(err);
        mostrarAviso('No se pudo importar el archivo: ' + err.message, true);
      }
    };
    lector.onerror = function () { mostrarAviso('No se pudo leer el archivo.', true); };
    lector.readAsText(file);
  }

  function initHistorialHerramientas() {
    $('#btn-exportar-historial').addEventListener('click', exportarHistorial);
    $('#btn-importar-historial').addEventListener('click', function () { $('#input-importar-historial').click(); });
    $('#input-importar-historial').addEventListener('change', function (e) {
      const file = e.target.files[0];
      if (file) importarHistorialDesdeArchivo(file);
      e.target.value = '';
    });
  }

  // ---------------------------------------------------------------------
  // Copia de seguridad completa (historial + configuración + lista de
  // precios en un solo archivo). Sirve como red de seguridad: por ejemplo,
  // si movés/renombrás la carpeta de la app, Chrome puede tratarla como un
  // sitio distinto y no ver el localStorage viejo; con esto podés restaurar
  // todo en la ubicación nueva sin perder nada.
  // ---------------------------------------------------------------------
  function exportarTodo() {
    const payload = {
      exportadoEl: new Date().toISOString(),
      tipo: 'backup-completo-presupuestos',
      config: Store.obtenerConfig(),
      historial: Store.obtenerHistorial(),
      listaPrecios: Store.obtenerListaPrecios(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const fecha = new Date().toISOString().slice(0, 10);
    const a = crearElemento('a', { href: url, download: 'backup-presupuestos-' + fecha + '.json' }, []);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    mostrarAviso('Copia de seguridad completa exportada.');
  }

  function importarTodoDesdeArchivo(file) {
    const lector = new FileReader();
    lector.onload = function (e) {
      try {
        const data = JSON.parse(e.target.result);
        if (!data || (!data.historial && !data.config && !data.listaPrecios)) {
          throw new Error('El archivo no parece ser una copia de seguridad de esta app.');
        }
        if (Array.isArray(data.historial)) {
          const existentes = Store.obtenerHistorial();
          const numerosExistentes = {};
          existentes.forEach(function (p) { numerosExistentes[p.numero] = true; });
          const nuevos = data.historial.filter(function (p) { return p && p.numero && !numerosExistentes[p.numero]; });
          const combinado = existentes.concat(nuevos).sort(function (a, b) { return new Date(b.fecha) - new Date(a.fecha); });
          Store.guardarHistorialCompleto(combinado);
        }
        if (data.config) {
          Store.guardarConfig(Object.assign(Store.obtenerConfig(), data.config));
        }
        if (data.listaPrecios && Array.isArray(data.listaPrecios.items)) {
          Store.guardarListaPrecios(data.listaPrecios);
        }
        estadoApp.config = Store.obtenerConfig();
        estadoApp.listaPrecios = Store.obtenerListaPrecios() || estadoApp.listaPrecios;
        renderHistorial();
        renderConfiguracion();
        renderListaPreciosInfo();
        mostrarAviso('Copia de seguridad restaurada correctamente.');
      } catch (err) {
        console.error(err);
        mostrarAviso('No se pudo importar la copia: ' + err.message, true);
      }
    };
    lector.onerror = function () { mostrarAviso('No se pudo leer el archivo.', true); };
    lector.readAsText(file);
  }

  function initBackupCompleto() {
    $('#btn-exportar-todo').addEventListener('click', exportarTodo);
    $('#btn-importar-todo').addEventListener('click', function () { $('#input-importar-todo').click(); });
    $('#input-importar-todo').addEventListener('change', function (e) {
      const file = e.target.files[0];
      if (file) importarTodoDesdeArchivo(file);
      e.target.value = '';
    });
  }

  // ---------------------------------------------------------------------
  // Configuración
  // ---------------------------------------------------------------------
  function renderConfiguracion() {
    const config = Store.obtenerConfig();
    $('#cfg-nombre').value = config.empresa.nombre;
    $('#cfg-direccion').value = config.empresa.direccion;
    $('#cfg-telefono').value = config.empresa.telefono;
    $('#cfg-email').value = config.empresa.email;
    $('#cfg-cuit').value = config.empresa.cuit;
    $('#cfg-condiciones').value = config.condicionesPagoPorDefecto;
    $('#cfg-validez').value = config.validezDiasPorDefecto;
    $('#cfg-prefijo').value = config.numeracion.prefijo;
    $('#cfg-siguiente-numero').value = config.numeracion.siguienteNumero;
    $('#cfg-logo-preview').src = config.empresa.logoBase64 || '';
    $('#cfg-logo-preview').style.display = config.empresa.logoBase64 ? 'block' : 'none';
  }

  function initConfiguracion() {
    $('#cfg-logo').addEventListener('change', function (e) {
      const file = e.target.files[0];
      if (!file) return;
      const lector = new FileReader();
      lector.onload = function (ev) {
        $('#cfg-logo-preview').src = ev.target.result;
        $('#cfg-logo-preview').style.display = 'block';
        $('#cfg-logo-preview').dataset.pendiente = ev.target.result;
      };
      lector.readAsDataURL(file);
    });

    $('#btn-guardar-configuracion').addEventListener('click', function () {
      const config = Store.obtenerConfig();
      config.empresa.nombre = $('#cfg-nombre').value.trim();
      config.empresa.direccion = $('#cfg-direccion').value.trim();
      config.empresa.telefono = $('#cfg-telefono').value.trim();
      config.empresa.email = $('#cfg-email').value.trim();
      config.empresa.cuit = $('#cfg-cuit').value.trim();
      config.condicionesPagoPorDefecto = $('#cfg-condiciones').value.trim();
      config.validezDiasPorDefecto = Number($('#cfg-validez').value) || 15;
      config.numeracion.prefijo = $('#cfg-prefijo').value.trim() || 'PRES-';
      config.numeracion.siguienteNumero = Number($('#cfg-siguiente-numero').value) || 1;
      const logoPendiente = $('#cfg-logo-preview').dataset.pendiente;
      if (logoPendiente) config.empresa.logoBase64 = logoPendiente;
      Store.guardarConfig(config);
      mostrarAviso('Configuración guardada.');
    });
  }

  // ---------------------------------------------------------------------
  // Lista de precios
  // ---------------------------------------------------------------------
  function renderListaPreciosInfo() {
    const lista = estadoApp.listaPrecios;
    $('#lp-origen').textContent = (lista && lista.origenArchivo) || '—';
    $('#lp-fecha').textContent = (lista && lista.actualizado) ? Quote.formatoFecha(lista.actualizado) : '—';
    $('#lp-cantidad').textContent = lista ? String(lista.items.length) : '0';

    const costos = Store.obtenerHistorialCostos();
    const infoCostos = $('#lp-costos-info');
    if (infoCostos) {
      if (costos.length === 0) {
        infoCostos.textContent = 'Historial de costos (para Informes): sin datos todavía. Se completa solo cuando el Excel que subís tiene la hoja de costos.';
      } else {
        const ultimo = costos[costos.length - 1];
        infoCostos.textContent =
          'Historial de costos (para Informes): ' + costos.length + ' mes(es) guardados. Último: ' +
          ultimo.mes + ' (' + ultimo.items.length + ' artículos).';
      }
    }
  }

  function initActualizarLista() {
    const input = $('#lp-archivo');
    const zona = $('#lp-dropzone');

    function procesarArchivo(file) {
      if (!file) return;
      $('#lp-estado').textContent = 'Procesando archivo…';
      Pricelist.actualizarListaDesdeArchivo(file)
        .then(function (resultado) {
          estadoApp.listaPrecios = resultado.lista;
          renderListaPreciosInfo();
          $('#lp-estado').textContent =
            'Lista actualizada: ' + resultado.lista.items.length + ' artículos cargados' +
            (resultado.filasIgnoradas ? ' (' + resultado.filasIgnoradas + ' filas ignoradas por datos incompletos).' : '.') +
            (resultado.snapshotCostos
              ? ' También se guardó el costo de ' + resultado.snapshotCostos.items.length + ' artículos para Informes.'
              : ' (No se encontró/validó una hoja de costos en este archivo; los informes de ganancia no se actualizaron.)');
          mostrarAviso('Lista de precios actualizada correctamente.');
        })
        .catch(function (err) {
          if (err.cancelado) {
            $('#lp-estado').textContent = err.message;
            mostrarAviso(err.message);
            return;
          }
          console.error(err);
          $('#lp-estado').textContent = 'Error: ' + err.message;
          mostrarAviso(err.message, true);
        });
    }

    input.addEventListener('change', function (e) { procesarArchivo(e.target.files[0]); });

    $('#btn-elegir-archivo-lista').addEventListener('click', function (e) {
      e.stopPropagation();
      input.click();
    });

    ['dragover', 'dragenter'].forEach(function (ev) {
      zona.addEventListener(ev, function (e) { e.preventDefault(); zona.classList.add('arrastrando'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      zona.addEventListener(ev, function (e) { e.preventDefault(); zona.classList.remove('arrastrando'); });
    });
    zona.addEventListener('drop', function (e) {
      const file = e.dataTransfer.files[0];
      if (file) procesarArchivo(file);
    });
    zona.addEventListener('click', function () { input.click(); });
  }

  // ---------------------------------------------------------------------
  // Avisos
  // ---------------------------------------------------------------------
  let avisoTimeout = null;
  function mostrarAviso(mensaje, esError) {
    const toast = $('#toast');
    toast.textContent = mensaje;
    toast.classList.toggle('toast-error', !!esError);
    toast.classList.add('visible');
    clearTimeout(avisoTimeout);
    avisoTimeout = setTimeout(function () { toast.classList.remove('visible'); }, 4000);
  }

  // ---------------------------------------------------------------------
  // Arranque
  // ---------------------------------------------------------------------
  function iniciar() {
    Store.migrarSiNecesario();
    estadoApp.config = Store.obtenerConfig();

    Pricelist.cargarListaVigente()
      .then(function (lista) {
        estadoApp.listaPrecios = lista;
      })
      .catch(function (err) {
        console.error(err);
        mostrarAviso('No se pudo cargar la lista de precios inicial. Cargá un Excel en la pestaña "Lista de precios".', true);
        estadoApp.listaPrecios = { actualizado: null, origenArchivo: null, items: [] };
      })
      .then(function () {
        initNavegacion();
        initBuscador();
        initSeleccionRapida();
        initFormularioManual();
        initSelectorCliente();
        initFormularioPresupuesto();
        initConfiguracion();
        initActualizarLista();
        initHistorialHerramientas();
        initTogglePapelera();
        initBackupCompleto();
        limpiarFormularioNuevoPresupuesto();
        renderListaPreciosInfo();
      });
  }

  // Antes: la app arrancaba apenas cargaba el HTML. Ahora primero hay que
  // esperar el login (Auth, ver firebase-init.js) y a que Store haya
  // recibido la primera respuesta de Firestore (historial, config, lista
  // de precios) -- si no, la pantalla arrancaría mostrando todo vacío por
  // un instante. Si por algún motivo Auth/Store no están cargados (por
  // ejemplo, abriendo el HTML suelto sin firebase-init.js), arranca igual
  // que antes, directo.
  document.addEventListener('DOMContentLoaded', function () {
    if (window.Auth && window.Store && typeof Store.inicializar === 'function') {
      window.Auth.onReady(function () {
        Store.inicializar().then(iniciar); // migrarSiNecesario() se llama dentro de iniciar()
      });
    } else {
      iniciar();
    }
  });
})();
