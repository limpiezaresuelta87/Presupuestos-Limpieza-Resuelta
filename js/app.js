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
    seleccionParaCompra: new Set(), // números tildados en Historial para la lista de compras combinada
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
    // Texto tipeado en el buscador de Historial (filtra por cliente o número).
    filtroHistorial: '',
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
    if (tabId === 'clientes') renderClientes();
  }

  // ---------------------------------------------------------------------
  // Buscador de productos
  // ---------------------------------------------------------------------
  // ---------------------------------------------------------------------
  // Búsqueda por voz (Web Speech API del navegador). Dicta el texto en el
  // buscador y dispara la misma búsqueda que al tipear. Si el navegador no
  // lo soporta (ej. Firefox), el botón del micrófono directamente no se
  // muestra. En Chrome/Edge/Safari el reconocimiento usa el servicio del
  // navegador, así que requiere conexión a internet.
  // ---------------------------------------------------------------------
  function initBusquedaPorVoz(input) {
    const boton = $('#btn-voz-buscador');
    const Reconocimiento = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!boton || !Reconocimiento) return;
    boton.style.display = '';

    let reconocedor = null;

    function detener() {
      if (reconocedor) { try { reconocedor.stop(); } catch (e) { /* ya detenido */ } }
    }

    boton.addEventListener('click', function () {
      if (reconocedor) { detener(); return; }

      reconocedor = new Reconocimiento();
      reconocedor.lang = 'es-AR';
      reconocedor.interimResults = true;
      reconocedor.continuous = false;
      reconocedor.maxAlternatives = 1;

      reconocedor.onstart = function () {
        boton.classList.add('escuchando');
        input.placeholder = 'Escuchando… decí el nombre del artículo';
      };
      reconocedor.onresult = function (ev) {
        let texto = '';
        for (let i = 0; i < ev.results.length; i++) texto += ev.results[i][0].transcript;
        // Sin punto final ni espacios sobrantes que estorben la búsqueda
        input.value = texto.replace(/[.,;!?¿¡]+/g, ' ').replace(/\s+/g, ' ').trim();
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      reconocedor.onerror = function (ev) {
        if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
          mostrarAviso('No hay permiso para usar el micrófono. Habilitalo en el navegador para este sitio.', true);
        } else if (ev.error === 'network') {
          mostrarAviso('La búsqueda por voz necesita conexión a internet.', true);
        } else if (ev.error === 'no-speech') {
          mostrarAviso('No se escuchó nada. Probá de nuevo.', true);
        } else if (ev.error !== 'aborted') {
          mostrarAviso('No se pudo usar la voz (' + ev.error + ').', true);
        }
      };
      reconocedor.onend = function () {
        boton.classList.remove('escuchando');
        input.placeholder = 'Escribí para buscar un artículo…';
        reconocedor = null;
        input.focus();
      };

      try { reconocedor.start(); } catch (e) { reconocedor = null; }
    });
  }

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

    initBusquedaPorVoz(input);

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
    const idxExistente = estadoApp.carrito.findIndex(function (l) { return !l.esManual && Quote.nombreEnLista(l) === producto.articulo; });
    if (idxExistente !== -1) {
      actualizarCantidad(idxExistente, estadoApp.carrito[idxExistente].cantidad + cantidad);
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
    const inputCantidad = $('#rapido-cantidad');
    inputCantidad.value = ''; // arranca vacío: no hay que borrar nada antes de escribir
    renderSeleccionRapida();
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
    const yaEnCarrito = estadoApp.carrito.find(function (l) { return !l.esManual && Quote.nombreEnLista(l) === sel.producto.articulo; });

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
    if (!(Number(cantidad) >= 1)) {
      mostrarAviso('Ingresá la cantidad.', true);
      $('#rapido-cantidad').focus();
      return;
    }
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

  function actualizarCantidad(idx, nuevaCantidad) {
    if (idx < 0 || idx >= estadoApp.carrito.length) return;
    const cantidad = Math.max(1, Math.floor(Number(nuevaCantidad) || 1));
    const lineaActual = estadoApp.carrito[idx];
    if (Quote.esManualConPacks(lineaActual)) {
      // Artículo manual con precio de unidad y de pack: elige solo según la cantidad.
      estadoApp.carrito[idx] = Quote.recalcularLineaManualConPacks(lineaActual, cantidad);
    } else if (lineaActual.editadoManualmente) {
      // Si el precio fue fijado a mano, se mantiene ese precio unitario y solo se
      // recalcula el subtotal con la nueva cantidad (no vuelve a la lista de precios).
      estadoApp.carrito[idx] = Quote.recalcularImporteConPrecioActual(lineaActual, cantidad);
    } else {
      const nombreLista = Quote.nombreEnLista(lineaActual);
      const producto = estadoApp.listaPrecios.items.find(function (p) { return p.articulo === nombreLista; });
      if (producto) {
        const nueva = Quote.crearLineaCarrito(producto, cantidad);
        // Conserva el nombre editado a mano, si lo hubiera.
        if (lineaActual.articuloLista) { nueva.articulo = lineaActual.articulo; nueva.articuloLista = lineaActual.articuloLista; }
        estadoApp.carrito[idx] = nueva;
      } else {
        estadoApp.carrito[idx] = Object.assign({}, lineaActual, { cantidad: cantidad });
      }
    }
    renderCarrito();
  }

  function actualizarPrecioManual(idx, nuevoPrecio) {
    if (idx < 0 || idx >= estadoApp.carrito.length) return;
    estadoApp.carrito[idx] = Quote.marcarPrecioManual(estadoApp.carrito[idx], nuevoPrecio);
    renderCarrito();
  }

  function restablecerPrecioLinea(idx) {
    if (idx < 0 || idx >= estadoApp.carrito.length) return;
    estadoApp.carrito[idx] = Quote.recalcularLinea(estadoApp.carrito[idx], estadoApp.listaPrecios);
    renderCarrito();
  }

  function quitarDelCarrito(idx) {
    estadoApp.carrito = estadoApp.carrito.filter(function (l, i) { return i !== idx; });
    renderCarrito();
  }

  /** Cambia el nombre de un artículo del presupuesto (sirve para cualquier línea, de la lista o manual). */
  function renombrarArticulo(idx, nuevoNombre) {
    if (idx < 0 || idx >= estadoApp.carrito.length) return;
    if (!String(nuevoNombre || '').trim()) {
      mostrarAviso('El nombre del artículo no puede quedar vacío.', true);
      renderCarrito();
      return;
    }
    // Mayúsculas, igual que el resto de los nombres de artículos de la app.
    estadoApp.carrito[idx] = Quote.renombrarLinea(estadoApp.carrito[idx], String(nuevoNombre).toLocaleUpperCase('es'));
    renderCarrito();
  }

  /** Cambia el proveedor de un artículo fuera de la lista. */
  function actualizarProveedorLinea(idx, proveedor) {
    if (idx < 0 || idx >= estadoApp.carrito.length) return;
    estadoApp.carrito[idx] = Object.assign({}, estadoApp.carrito[idx], { proveedor: String(proveedor || '').trim() });
    // No hace falta redibujar toda la tabla: el valor ya está en el input.
  }

  const OPCION_OTRO_PROVEEDOR = '__otro__';

  /** Proveedores conocidos: los del Excel, los ya usados en presupuestos y los del carrito actual. */
  function obtenerProveedoresConocidos() {
    const nombres = {};
    Object.values(Store.obtenerMapaProveedores()).forEach(function (p) { if (p) nombres[p] = true; });
    Store.obtenerHistorial().forEach(function (pres) {
      (pres.lineas || []).forEach(function (l) { if (l.proveedor) nombres[l.proveedor] = true; });
    });
    estadoApp.carrito.forEach(function (l) { if (l.proveedor) nombres[l.proveedor] = true; });
    return Object.keys(nombres).sort(function (x, y) { return x.localeCompare(y, 'es'); });
  }

  /**
   * Llena un <select> de proveedores: "Otros proveedores" (si no se sabe), los conocidos (se
   * elige de la lista para evitar errores de tipeo) y "+ Otro proveedor…"
   * para uno que todavía no existe. Devuelve el select.
   */
  function llenarSelectorProveedor(select, valorActual) {
    select.innerHTML = '';
    select.appendChild(crearElemento('option', { value: '' }, ['— No sé / Otros proveedores —']));
    const conocidos = obtenerProveedoresConocidos();
    if (valorActual && conocidos.indexOf(valorActual) === -1) conocidos.push(valorActual);
    conocidos.forEach(function (n) { select.appendChild(crearElemento('option', { value: n }, [n])); });
    select.appendChild(crearElemento('option', { value: OPCION_OTRO_PROVEEDOR }, ['+ Otro proveedor…']));
    select.value = valorActual || '';
    return select;
  }

  /** Proveedores "oficiales": los que vienen del Excel (hojas de proveedores). */
  function obtenerProveedoresOficiales() {
    const mapa = Store.obtenerMapaProveedores();
    return Array.from(new Set(Object.keys(mapa).map(function (k) { return mapa[k]; }).filter(Boolean)))
      .sort(function (x, y) { return x.localeCompare(y, 'es'); });
  }

  /** Si `texto` es igual o parecido a un proveedor oficial/conocido, devuelve ese; si no, el texto tal cual. */
  function unificarProveedor(texto) {
    const limpio = String(texto || '').trim();
    if (!limpio) return '';
    const oficiales = obtenerProveedoresOficiales();
    const candidatos = oficiales.concat(obtenerProveedoresConocidos().filter(function (n) { return oficiales.indexOf(n) === -1; }));
    const hallado = Quote.buscarProveedorParecido(limpio, candidatos);
    return hallado ? hallado.nombre : limpio;
  }

  /**
   * Ventana para elegir "otro proveedor": primero muestra los que ya
   * tenemos (un toque y listo); si es uno que no está, se escribe.
   * - Si lo escrito es igual a uno existente (sin importar mayúsculas,
   *   espacios o tildes), se usa el existente, sin preguntar.
   * - Si es parecido ("Mundo vazar"), pregunta con dos botones grandes:
   *   "Sí, es MundoBazar" / "No, es uno nuevo".
   * Llama a alTerminar con el nombre, o con null si cancelaron.
   */
  function pedirProveedorNuevo(alTerminar) {
    const modal = $('#modal-proveedor');
    const input = $('#prov-nuevo-nombre');
    const conocidos = obtenerProveedoresConocidos();
    const oficiales = obtenerProveedoresOficiales();
    const candidatos = oficiales.concat(conocidos.filter(function (n) { return oficiales.indexOf(n) === -1; }));

    // Botones con los proveedores existentes (un toque para elegirlo)
    let chips = $('#prov-chips');
    if (!chips) {
      chips = crearElemento('div', { id: 'prov-chips', class: 'prov-chips' }, []);
      input.parentNode.insertBefore(chips, input);
    }
    chips.innerHTML = '';
    candidatos.forEach(function (n) {
      chips.appendChild(crearElemento('button', { type: 'button', class: 'btn-mini prov-chip', onclick: function () { cerrar(n); } }, [n]));
    });

    function mostrarEntrada() {
      $('#prov-entrada').style.display = 'block';
      $('#prov-pregunta').style.display = 'none';
    }

    input.value = '';
    mostrarEntrada();
    modal.style.display = 'flex';
    input.focus();

    function cerrar(resultado) {
      modal.style.display = 'none';
      ['#btn-prov-usar', '#btn-prov-cancelar', '#btn-prov-si', '#btn-prov-no', '#btn-prov-atras'].forEach(function (sel) { $(sel).onclick = null; });
      input.onkeydown = null;
      alTerminar(resultado);
    }

    function usarEscrito() {
      const escrito = input.value.trim();
      if (!escrito) { mostrarAviso('Elegí un proveedor o escribí el nombre.', true); return; }
      const hallado = Quote.buscarProveedorParecido(escrito, candidatos);
      if (!hallado) { cerrar(escrito); return; }
      if (hallado.tipo === 'exacto') { cerrar(hallado.nombre); return; }

      // Parecido: preguntar con botones grandes (no con un cuadro del navegador)
      $('#prov-entrada').style.display = 'none';
      $('#prov-pregunta').style.display = 'block';
      $('#prov-pregunta-texto').textContent = 'Escribiste "' + escrito + '". ¿Es el proveedor "' + hallado.nombre + '"?';
      $('#btn-prov-si').textContent = 'Sí, es ' + hallado.nombre;
      $('#btn-prov-no').textContent = 'No, crear "' + escrito + '"';
      $('#btn-prov-si').onclick = function () { cerrar(hallado.nombre); };
      $('#btn-prov-no').onclick = function () { cerrar(escrito); };
      $('#btn-prov-atras').onclick = function () { mostrarEntrada(); input.focus(); };
    }

    $('#btn-prov-usar').onclick = usarEscrito;
    $('#btn-prov-cancelar').onclick = function () { cerrar(null); };
    input.onkeydown = function (e) {
      if (e.key === 'Enter') { e.preventDefault(); usarEscrito(); }
      if (e.key === 'Escape') { e.preventDefault(); cerrar(null); }
    };
  }

  /**
   * Maneja el cambio de un desplegable de proveedor. Si eligieron "Otro
   * proveedor…" abre la ventana de arriba; si no, usa el valor elegido.
   */
  function manejarCambioSelectorProveedor(select, valorAnterior, alConfirmar) {
    if (select.value !== OPCION_OTRO_PROVEEDOR) { alConfirmar(select.value); return; }
    pedirProveedorNuevo(function (nombre) {
      if (nombre === null) { llenarSelectorProveedor(select, valorAnterior || ''); return; }
      llenarSelectorProveedor(select, nombre);
      alConfirmar(nombre);
    });
  }

  // ---------------------------------------------------------------------
  // Revisión ortográfica antes de guardar (corrector propio, ver
  // js/corrector.js). Revisa lo que se escribe a mano: nombres de
  // artículos manuales o renombrados, observaciones y condiciones de pago.
  // No revisa los nombres que vienen del Excel, ni clientes ni proveedores.
  // ---------------------------------------------------------------------
  function construirPalabrasAIgnorar() {
    const ignorar = new Set();
    function agregar(texto) {
      (String(texto || '').match(/[\p{L}\p{N}]+/gu) || []).forEach(function (p) { ignorar.add(Corrector.clave(p)); });
    }
    if (estadoApp.listaPrecios && estadoApp.listaPrecios.items) {
      estadoApp.listaPrecios.items.forEach(function (i) { agregar(i.articulo); });
    }
    Store.obtenerClientes().forEach(agregar);
    obtenerProveedoresConocidos().forEach(agregar);
    (Store.obtenerConfig().palabrasPropias || []).forEach(function (p) { ignorar.add(Corrector.clave(p)); });
    return ignorar;
  }

  function recolectarTextosParaRevisar() {
    const fuentes = [];
    estadoApp.carrito.forEach(function (linea, idx) {
      if (!linea.esManual && !linea.articuloLista) return; // los del Excel no se revisan
      fuentes.push({
        donde: 'Artículo',
        leer: function () { return estadoApp.carrito[idx].articulo; },
        escribir: function (v) { estadoApp.carrito[idx] = Quote.renombrarLinea(estadoApp.carrito[idx], String(v).toLocaleUpperCase('es')); },
      });
    });
    fuentes.push({
      donde: 'Observaciones',
      leer: function () { return $('#input-observaciones').value; },
      escribir: function (v) { $('#input-observaciones').value = v; },
    });
    fuentes.push({
      donde: 'Condiciones de pago',
      leer: function () { return $('#input-condiciones').value; },
      escribir: function (v) { $('#input-condiciones').value = v; },
    });
    return fuentes;
  }

  /** Muestra la ventana con las palabras dudosas. Resuelve true (seguir) o false (volver a editar). */
  function mostrarVentanaOrtografia(items) {
    return new Promise(function (resolve) {
      const modal = $('#modal-ortografia');
      const lista = $('#lista-ortografia');
      lista.innerHTML = '';
      const selectores = [];
      const manuales = [];

      items.forEach(function (item) {
        const select = crearElemento('select', {}, []);
        if (item.sugerencias.length) {
          select.appendChild(crearElemento('option', { value: '' }, ['Corregir a…']));
          item.sugerencias.forEach(function (s) { select.appendChild(crearElemento('option', { value: 'sug:' + s }, [s])); });
        }
        select.appendChild(crearElemento('option', { value: 'manual' }, ['Escribir la corrección yo…']));
        select.appendChild(crearElemento('option', { value: 'dejar' }, ['Está bien así']));
        select.appendChild(crearElemento('option', { value: 'agregar' }, ['Está bien, agregar al diccionario']));
        select.value = item.sugerencias.length ? '' : 'dejar';
        selectores.push(select);
        // Cuadro para escribir la corrección a mano (aparece al elegir esa opción)
        const manual = crearElemento('input', { type: 'text', class: 'orto-manual', value: item.palabra, placeholder: 'Escribí la palabra correcta', autocomplete: 'off' });
        manual.style.display = 'none';
        manuales.push(manual);
        select.addEventListener('change', function () {
          manual.style.display = select.value === 'manual' ? 'block' : 'none';
          if (select.value === 'manual') { manual.focus(); manual.select(); }
        });
        lista.appendChild(crearElemento('li', {}, [
          crearElemento('span', { class: 'orto-palabra' }, [item.palabra, crearElemento('span', { class: 'orto-donde' }, [item.fuente.donde])]),
          select,
          manual,
        ]));
      });

      function cerrar(resultado) {
        modal.style.display = 'none';
        $('#btn-orto-corregir').onclick = null;
        $('#btn-orto-ignorar').onclick = null;
        $('#btn-orto-volver').onclick = null;
        resolve(resultado);
      }

      $('#btn-orto-corregir').onclick = function () {
        const nuevas = [];
        items.forEach(function (item, i) {
          const v = selectores[i].value;
          if (v.indexOf('sug:') === 0) {
            item.fuente.escribir(Corrector.reemplazarPalabra(item.fuente.leer(), item.palabra, v.slice(4)));
          } else if (v === 'manual') {
            const escrita = manuales[i].value.trim();
            if (escrita && escrita !== item.palabra) {
              item.fuente.escribir(Corrector.reemplazarPalabra(item.fuente.leer(), item.palabra, escrita));
            }
          } else if (v === 'agregar') {
            nuevas.push(item.palabra.toLowerCase());
          }
        });
        if (nuevas.length) {
          const config = Store.obtenerConfig();
          const actuales = config.palabrasPropias || [];
          config.palabrasPropias = Array.from(new Set(actuales.concat(nuevas)));
          Store.guardarConfig(config);
        }
        renderCarrito();
        cerrar(true);
      };
      $('#btn-orto-ignorar').onclick = function () { cerrar(true); };
      $('#btn-orto-volver').onclick = function () { cerrar(false); };
      modal.style.display = 'flex';
    });
  }

  /** Devuelve una promesa: true si se puede seguir guardando, false si prefiere volver a editar. */
  function revisarOrtografia() {
    return Corrector.cargar().then(function () {
      const ignorar = construirPalabrasAIgnorar();
      const items = [];
      recolectarTextosParaRevisar().forEach(function (fuente) {
        Corrector.revisarTexto(fuente.leer(), ignorar).forEach(function (e) {
          items.push({ fuente: fuente, palabra: e.palabra, sugerencias: e.sugerencias });
        });
      });
      return items.length ? mostrarVentanaOrtografia(items) : true;
    }).catch(function (err) {
      // Si el diccionario no se pudo cargar, no se bloquea el guardado.
      console.warn('[corrector] No se pudo revisar la ortografía:', err);
      return true;
    });
  }

  function revisarYConfirmarGuardado() {
    return revisarOrtografia().then(function (seguir) {
      return seguir && window.confirm('¿Desea guardar el presupuesto?');
    });
  }

  /** Dibuja los proveedores como botones (se ven todos, un toque para elegir). El elegido queda marcado. */
  function renderBotonesProveedorManual() {
    const sel = $('#manual-proveedor');
    const cont = $('#manual-proveedor-chips');
    if (!sel || !cont) return;
    const elegido = sel.value || '';
    cont.innerHTML = '';
    function boton(texto, valor, claseExtra) {
      const activo = valor === elegido;
      return crearElemento('button', {
        type: 'button',
        class: 'btn-mini prov-chip' + (activo ? ' prov-chip-activo' : '') + (claseExtra ? ' ' + claseExtra : ''),
        onclick: function () {
          if (valor === OPCION_OTRO_PROVEEDOR) {
            pedirProveedorNuevo(function (nombre) {
              if (nombre !== null) llenarSelectorProveedor(sel, nombre);
              renderBotonesProveedorManual();
            });
            return;
          }
          llenarSelectorProveedor(sel, valor);
          renderBotonesProveedorManual();
        },
      }, [texto]);
    }
    cont.appendChild(boton('No sé / Otros', ''));
    obtenerProveedoresConocidos().forEach(function (n) { cont.appendChild(boton(n, n)); });
    if (elegido && obtenerProveedoresConocidos().indexOf(elegido) === -1) cont.appendChild(boton(elegido, elegido));
    cont.appendChild(boton('+ Otro proveedor', OPCION_OTRO_PROVEEDOR, 'prov-chip-otro'));
  }

  function actualizarSugerenciasProveedor() {
    const sel = $('#manual-proveedor');
    if (sel) llenarSelectorProveedor(sel, '');
    renderBotonesProveedorManual();
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
      if (!visible) { actualizarSugerenciasProveedor(); $('#manual-nombre').focus(); }
    });

    // Cálculo en vivo: con costo y % de ganancia, el precio de venta se completa solo
    // (aunque el artículo sea eventual y no se guarde en Pendientes). Si Caro escribe
    // un precio a mano, se respeta y deja de pisarse.
    const campoPrecio = $('#manual-precio');
    const avisoCalculo = $('#manual-calculo');
    campoPrecio.addEventListener('input', function () { campoPrecio.dataset.auto = ''; recalcularPrecioManual(); });
    function recalcularPrecioManual() {
      const costo = Number($('#manual-costo').value);
      const mu = Number($('#manual-margen-unit').value);
      const mp = Number($('#manual-margen-pack').value);
      const cp = Math.floor(Number($('#manual-cantidad-pack').value));
      const pUnit = Quote.precioSegunMargen(costo, mu);
      const pPack = (cp > 0) ? Quote.precioSegunMargen(costo, mp) : 0;
      if (pUnit > 0 && (campoPrecio.value === '' || campoPrecio.dataset.auto === '1')) {
        campoPrecio.value = String(pUnit); campoPrecio.dataset.auto = '1';
      } else if (!(pUnit > 0) && campoPrecio.dataset.auto === '1') {
        campoPrecio.value = ''; campoPrecio.dataset.auto = '';
      }
      const partes = [];
      if (pUnit > 0) partes.push('Precio de venta unitario calculado: ' + Quote.formatoMoneda(pUnit));
      if (pPack > 0) partes.push('Precio por unidad desde ' + cp + ' u. (pack): ' + Quote.formatoMoneda(pPack));
      avisoCalculo.textContent = partes.join('  ·  ');
      avisoCalculo.style.display = partes.length ? 'block' : 'none';
    }
    ['manual-costo', 'manual-margen-unit', 'manual-margen-pack', 'manual-cantidad-pack'].forEach(function (id) {
      $('#' + id).addEventListener('input', recalcularPrecioManual);
    });

    $('#btn-agregar-manual').addEventListener('click', function () {
      const nombre = $('#manual-nombre').value.trim().toUpperCase();
      if (!nombre) {
        mostrarAviso('Ingresá el nombre del artículo.', true);
        return;
      }
      const cantidad = $('#manual-cantidad').value;
      if (!(Number(cantidad) >= 1)) {
        mostrarAviso('Ingresá la cantidad.', true);
        return;
      }
      const precio = $('#manual-precio').value;
      const selProv = $('#manual-proveedor');
      const proveedor = selProv.value === OPCION_OTRO_PROVEEDOR ? '' : selProv.value;
      const extra = {
        hoja: $('#manual-hoja').value,
        costoUnitario: $('#manual-costo').value,
        cantidadPack: $('#manual-cantidad-pack').value,
        margenUnit: $('#manual-margen-unit').value,
        margenPack: $('#manual-margen-pack').value,
      };
      const linea = Quote.crearLineaManual(nombre, cantidad, precio, proveedor, extra);
      if (!(linea.precioUnitarioAplicado > 0) &&
          !window.confirm('Este artículo quedó con precio $ 0 (no cargaste precio de venta ni costo y % de ganancia). ¿Agregarlo igual?')) {
        return;
      }
      estadoApp.carrito.push(linea);

      // Pendiente de incorporar al Excel / catálogo (si no está ya en la lista).
      let avisoExtra = '';
      if ($('#manual-incorporar').checked) {
        const clave = Store.claveArticulo(nombre);
        const yaEnLista = estadoApp.listaPrecios && estadoApp.listaPrecios.items.some(function (it) {
          return Store.claveArticulo(it.articulo) === clave;
        });
        if (yaEnLista) {
          avisoExtra = ' (ya figura en la lista de precios, no se agregó a Pendientes)';
        } else {
          Store.agregarPendiente({
            articulo: nombre,
            hoja: linea.hoja,
            proveedor: unificarProveedor(proveedor),
            cantidadPack: linea.cantidadPack,
            costoUnitario: linea.costoManual,
            margenUnit: linea.margenUnitManual,
            margenPack: linea.margenPackManual,
            precioUnitario: linea.precioUnitarioOriginal != null ? linea.precioUnitarioOriginal : linea.precioUnitarioAplicado,
            precioPack: linea.precioPackOriginal != null ? linea.precioPackOriginal : null,
          });
          actualizarBadgePendientes();
          renderPendientes();
          avisoExtra = ' Quedó en Pendientes para incorporarlo al Excel.';
        }
      }

      $('#manual-nombre').value = '';
      llenarSelectorProveedor($('#manual-proveedor'), '');
      renderBotonesProveedorManual();
      $('#manual-cantidad').value = '';
      $('#manual-precio').value = '';
      ['manual-hoja', 'manual-costo', 'manual-cantidad-pack', 'manual-margen-unit', 'manual-margen-pack'].forEach(function (id) {
        $('#' + id).value = '';
      });
      $('#manual-incorporar').checked = true;
      campoPrecio.dataset.auto = ''; avisoCalculo.style.display = 'none';
      const detalles = $('.manual-mas');
      if (detalles) detalles.open = false;
      form.style.display = 'none';
      renderCarrito();
      mostrarAviso('Artículo agregado al presupuesto.' + avisoExtra);
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

    estadoApp.carrito.forEach(function (linea, idx) {
      const precioEditado = !!linea.editadoManualmente;
      const esArticuloFueraDeLista = !!linea.esManual;
      // La columna de tipo de precio solo se completa cuando el precio
      // aplicado es el de pack; para unitario o manual queda en blanco.
      const etiquetaTipo = linea.tipoPrecio === 'pack'
        ? ('Pack (≥' + linea.cantidadPack + 'u)')
        : '';

      const celdaPrecio = crearElemento('td', { class: 'col-precio' }, [
        crearElemento('input', {
          type: 'number',
          min: '0',
          step: '0.01',
          value: String(linea.precioUnitarioAplicado),
          class: 'input-precio' + (precioEditado ? ' input-precio-manual' : ''),
          title: 'Editá este valor para fijar un precio distinto solo para este presupuesto.',
          onchange: function (e) { actualizarPrecioManual(idx, e.target.value); },
        }),
        // El botón de "restablecer" solo tiene sentido si el artículo existe
        // en la lista de precios; uno agregado a mano no tiene a qué volver.
        (precioEditado && !esArticuloFueraDeLista)
          ? crearElemento('button', {
              class: 'btn-icono btn-reset',
              title: 'Restablecer precio de la lista vigente',
              onclick: function () { restablecerPrecioLinea(idx); },
            }, ['↺'])
          : document.createTextNode(''),
      ]);

      // Alerta: precio por debajo del costo (costo del Excel, o el cargado a mano).
      const costoRef = linea.esManual ? linea.costoManual : Store.obtenerCostoDeArticulo(Quote.nombreEnLista(linea));
      if (costoRef > 0 && linea.precioUnitarioAplicado > 0 && linea.precioUnitarioAplicado < costoRef) {
        celdaPrecio.appendChild(crearElemento('div', { class: 'alerta-margen' }, [
          '⚠ Por debajo del costo (' + Quote.formatoMoneda(costoRef) + ')',
        ]));
      }

      const tr = crearElemento('tr', {}, [
        crearElemento('td', { class: 'col-producto' }, [
          crearElemento('input', {
            type: 'text',
            value: linea.articulo,
            class: 'input-nombre',
            spellcheck: 'true',
            lang: 'es',
            title: 'Podés editar el nombre del artículo solo para este presupuesto.',
            onchange: function (e) { renombrarArticulo(idx, e.target.value); },
          }),
          // Artículos fuera de la lista: se puede indicar (y corregir) el proveedor.
          linea.esManual
            ? (function () {
                const sel = crearElemento('select', {
                  class: 'input-proveedor',
                  title: 'Proveedor de este artículo (se usa en la lista de compras).',
                });
                llenarSelectorProveedor(sel, linea.proveedor || '');
                sel.addEventListener('change', function () {
                  manejarCambioSelectorProveedor(sel, linea.proveedor || '', function (valor) {
                    actualizarProveedorLinea(idx, valor);
                  });
                });
                return sel;
              })()
            : document.createTextNode(''),
          (!linea.esManual && linea.articuloLista)
            ? crearElemento('div', { class: 'nombre-lista-original', title: 'Nombre en la lista de precios' }, ['Lista: ' + linea.articuloLista])
            : document.createTextNode(''),
        ]),
        crearElemento('td', { class: 'col-cantidad' }, [
          crearElemento('input', {
            type: 'number',
            min: '1',
            value: String(linea.cantidad),
            class: 'input-cantidad',
            onchange: function (e) { actualizarCantidad(idx, e.target.value); },
          }),
        ]),
        crearElemento('td', { class: 'col-tipo' }, [
          etiquetaTipo
            ? crearElemento('span', { class: 'badge badge-' + linea.tipoPrecio }, [etiquetaTipo])
            : document.createTextNode(''),
        ]),
        celdaPrecio,
        crearElemento('td', { class: 'col-subtotal' }, [Quote.formatoMoneda(linea.importe)]),
        crearElemento('td', { class: 'col-quitar' }, [
          crearElemento('button', { class: 'btn-icono', title: 'Quitar', onclick: function () { quitarDelCarrito(idx); } }, ['✕']),
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
  // Selector de cliente: buscador con autocompletado (igual que el de
  // productos) contra Store.obtenerClientes(). A medida que el negocio
  // crezca y haya muchos clientes, escribir y filtrar es mucho más rápido
  // que scrollear un desplegable. Si lo que se tipea no coincide con
  // ningún cliente existente, aparece la opción de darlo de alta -- así
  // siempre se termina eligiendo un nombre de la lista (mismo formato,
  // en mayúscula) en vez de texto libre, para que las estadísticas y los
  // informes agrupen bien por cliente.
  // ---------------------------------------------------------------------
  function normalizarNombreCliente(nombre) {
    return String(nombre || '').trim().toUpperCase().replace(/\s+/g, ' ');
  }

  function establecerCliente(nombre) {
    $('#input-cliente-nombre').value = nombre || '';
    $('#resultados-busqueda-cliente').classList.remove('visible');
    // Autocompleta el contacto guardado de este cliente, salvo que ya
    // haya algo tipeado en ese campo (por ejemplo, al editar un
    // presupuesto viejo, donde el contacto se pisa a propósito justo
    // después con el que tenía ese presupuesto en su momento).
    const campoContacto = $('#input-cliente-contacto');
    if (nombre && campoContacto && !campoContacto.value.trim()) {
      const contactoGuardado = Store.obtenerContactoCliente(nombre);
      if (contactoGuardado) campoContacto.value = contactoGuardado;
    }
  }

  function initSelectorCliente() {
    const input = $('#input-cliente-nombre');
    const resultados = $('#resultados-busqueda-cliente');

    function actualizarResultados() {
      const consulta = input.value.trim();
      resultados.innerHTML = '';
      if (!consulta) { resultados.classList.remove('visible'); return; }

      const consultaNorm = Pricelist.normalizar(consulta);
      const clientes = Store.obtenerClientes();
      const coincidencias = clientes.filter(function (c) { return Pricelist.normalizar(c).indexOf(consultaNorm) !== -1; });
      const normalizado = normalizarNombreCliente(consulta);
      const yaExiste = clientes.indexOf(normalizado) !== -1;

      coincidencias.forEach(function (nombre) {
        const li = crearElemento('li', {
          class: 'resultado-item', tabindex: '0',
          onclick: function () { establecerCliente(nombre); },
          onkeydown: function (e) { if (e.key === 'Enter') establecerCliente(nombre); },
        }, [crearElemento('span', { class: 'resultado-nombre' }, [nombre])]);
        resultados.appendChild(li);
      });

      if (!yaExiste) {
        const li = crearElemento('li', {
          class: 'resultado-item resultado-agregar', tabindex: '0',
          onclick: function () { agregarYSeleccionar(consulta); },
          onkeydown: function (e) { if (e.key === 'Enter') agregarYSeleccionar(consulta); },
        }, ['+ Agregar "' + normalizado + '" como cliente nuevo']);
        resultados.appendChild(li);
      } else if (coincidencias.length === 0) {
        resultados.appendChild(crearElemento('li', { class: 'resultado-vacio' }, ['Sin coincidencias.']));
      }

      resultados.classList.add('visible');
    }

    function agregarYSeleccionar(nombreTipeado) {
      const decision = confirmarAltaCliente(nombreTipeado);
      if (!decision) { resultados.classList.remove('visible'); return; } // canceló: no se crea nada
      if (decision.usar) {
        establecerCliente(decision.usar);
        mostrarAviso('Se usó el cliente existente "' + decision.usar + '".');
        return;
      }
      const nombreGuardado = Store.agregarCliente(decision.crear);
      if (!nombreGuardado) return;
      establecerCliente(nombreGuardado);
      mostrarAviso('Cliente "' + nombreGuardado + '" agregado.');
    }

    input.addEventListener('input', debounce(actualizarResultados, 120));
    input.addEventListener('focus', actualizarResultados);
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.buscador-wrap')) resultados.classList.remove('visible');
    });

    $('#btn-guardar-contacto-cliente').addEventListener('click', function () {
      const nombreCliente = normalizarNombreCliente(input.value);
      if (!nombreCliente || Store.obtenerClientes().indexOf(nombreCliente) === -1) {
        mostrarAviso('Elegí primero un cliente de la lista antes de guardarle un contacto.', true);
        return;
      }
      const contacto = $('#input-cliente-contacto').value.trim();
      Store.guardarContactoCliente(nombreCliente, contacto);
      mostrarAviso(
        contacto
          ? 'Guardado como contacto habitual de ' + nombreCliente + '.'
          : 'Se borró el contacto habitual de ' + nombreCliente + '.'
      );
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
      if (estadoApp.carrito.length === 0) {
        mostrarAviso('Agregá al menos un producto antes de generar el presupuesto.', true);
        return;
      }
      // Se pregunta ANTES de armar el presupuesto: así, si contesta que no,
      // no se gasta un número correlativo por nada.
      revisarYConfirmarGuardado().then(function (ok) {
        return ok ? armarPresupuestoDesdeFormulario({}) : null;
      }).then(function (presupuesto) {
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

    $('#btn-lista-compras').addEventListener('click', function () {
      armarPresupuestoDesdeFormulario({ soloPreview: true }).then(function (presupuesto) {
        if (!presupuesto) return;
        descargarListaCompras(presupuesto);
      });
    });

    $('#btn-descargar-pdf').addEventListener('click', function () {
      if (estadoApp.carrito.length === 0) {
        mostrarAviso('Agregá al menos un producto antes de generar el presupuesto.', true);
        return;
      }
      revisarYConfirmarGuardado().then(function (ok) {
        return ok ? armarPresupuestoDesdeFormulario({}) : null;
      }).then(function (presupuesto) {
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
    const nombreClienteTipeado = $('#input-cliente-nombre').value.trim();
    const nombreCliente = normalizarNombreCliente(nombreClienteTipeado);
    if (!nombreClienteTipeado || Store.obtenerClientes().indexOf(nombreCliente) === -1) {
      mostrarAviso('Elegí un cliente de la lista (o agregalo con la opción "+ Agregar…") antes de continuar.', true);
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
          lineas: JSON.parse(JSON.stringify(estadoApp.carrito)).map(function (l) {
            if (l.proveedor) l.proveedor = unificarProveedor(l.proveedor);
            return l;
          }).sort(function (a, b) {
            return a.articulo.localeCompare(b.articulo, 'es', { sensitivity: 'base' });
          }),
        },
        totales,
        {
          condicionesPago: $('#input-condiciones').value.trim().toUpperCase() || Store.obtenerConfig().condicionesPagoPorDefecto,
          validezDias: Number($('#input-validez').value) || Store.obtenerConfig().validezDiasPorDefecto,
          observaciones: $('#input-observaciones').value.trim().toUpperCase(),
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
    const campoClienteNuevo = $('#campo-cliente-nuevo'); // ya no existe en el HTML; se protege por si vuelve
    if (campoClienteNuevo) campoClienteNuevo.style.display = 'none';
    establecerCliente('');
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

    establecerCliente(presupuesto.cliente.nombre || '');
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

  /**
   * Duplica un presupuesto viejo como uno NUEVO (no una revisión): copia
   * cliente y productos/cantidades, pero recalcula los precios contra la
   * lista vigente -- a diferencia de "Editar", que arranca a propósito con
   * los precios congelados tal cual estaban. Los artículos manuales (fuera
   * de la lista) se copian con el mismo precio, porque no hay de dónde
   * recalcularlos.
   */
  function duplicarPresupuesto(numero) {
    const original = Store.buscarPresupuesto(numero);
    if (!original) return;

    estadoApp.edicion = null;
    estadoApp.carrito = JSON.parse(JSON.stringify(original.lineas)).map(function (l) {
      return Quote.recalcularLinea(l, estadoApp.listaPrecios);
    });

    establecerCliente(original.cliente.nombre || '');
    $('#input-cliente-contacto').value = original.cliente.contacto || '';
    $('#input-descuento').value = String(original.descuentoPct || 0);
    $('#input-condiciones').value = original.condicionesPago || Store.obtenerConfig().condicionesPagoPorDefecto;
    $('#input-validez').value = String(original.validezDias || Store.obtenerConfig().validezDiasPorDefecto);
    $('#input-observaciones').value = original.observaciones || '';

    renderCarrito();
    ocultarBannerEdicion();
    $('#detalle-historial').classList.remove('visible');
    cambiarPestana('nuevo');
    mostrarAviso('Presupuesto duplicado desde ' + numero + '. Los precios se recalcularon con la lista vigente — revisalos antes de guardar.');
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

  function descargarListaCompras(presupuesto) {
    if (!presupuesto.lineas || presupuesto.lineas.length === 0) {
      mostrarAviso('Agregá al menos un producto antes de generar la lista de compras.', true);
      return;
    }
    const mapaProveedores = Store.obtenerMapaProveedores();
    const obtenerCosto = function (articulo) { return Store.obtenerCostoDeArticulo(articulo, presupuesto.fecha); };
    const doc = PdfGen.construirPDFCompras(presupuesto, mapaProveedores, Pricelist.normalizar, obtenerCosto);
    doc.save(PdfGen.nombreArchivoListaCompras(presupuesto));
  }

  // ---------------------------------------------------------------------
  // Historial
  // ---------------------------------------------------------------------
  function renderHistorial() {
    const tbody = $('#tabla-historial tbody');
    let historial = estadoApp.verPapelera ? Store.obtenerPapelera() : Store.obtenerHistorial();

    const consulta = (estadoApp.filtroHistorial || '').trim();
    if (consulta) {
      const consultaNorm = Pricelist.normalizar(consulta);
      historial = historial.filter(function (p) {
        return Pricelist.normalizar(p.numero).indexOf(consultaNorm) !== -1 ||
          Pricelist.normalizar(p.cliente.nombre).indexOf(consultaNorm) !== -1;
      });
    }

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
          colspan: '7', class: 'vacio',
        }, [
          consulta
            ? 'Ningún presupuesto coincide con "' + consulta + '".'
            : (estadoApp.verPapelera ? 'La papelera está vacía.' : 'Todavía no generaste presupuestos.'),
        ])])
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
            crearElemento('button', { class: 'btn-mini', onclick: function () { duplicarPresupuesto(p.numero); } }, ['Duplicar']),
            crearElemento('button', { class: 'btn-mini', onclick: function () { recalcularPresupuestoDirecto(p.numero); } }, ['Recalcular']),
            crearElemento('button', { class: 'btn-mini', onclick: function () { descargarPDF(p); } }, ['PDF']),
            crearElemento('button', {
              class: 'btn-mini btn-mini-peligro',
              onclick: function () { moverPresupuestoAPapelera(p.numero); },
            }, ['Eliminar']),
          ];

      const celdaCheck = estadoApp.verPapelera
        ? crearElemento('td', {}, [])
        : (function () {
            const check = crearElemento('input', {
              type: 'checkbox',
              onchange: function (e) {
                if (e.target.checked) estadoApp.seleccionParaCompra.add(p.numero);
                else estadoApp.seleccionParaCompra.delete(p.numero);
                actualizarBotonListaCombinada();
              },
            });
            check.checked = estadoApp.seleccionParaCompra.has(p.numero);
            return crearElemento('td', {}, [check]);
          })();

      const tr = crearElemento('tr', {}, [
        celdaCheck,
        crearElemento('td', {}, [p.numero]),
        crearElemento('td', {}, [Quote.formatoFecha(p.fecha)]),
        crearElemento('td', {}, [p.cliente.nombre]),
        crearElemento('td', {}, [String(p.lineas.length)]),
        crearElemento('td', { class: 'col-precio' }, [Quote.formatoMoneda(p.total)]),
        crearElemento('td', { class: 'col-acciones' }, acciones),
      ]);
      tbody.appendChild(tr);
    });
    actualizarBotonListaCombinada();
  }

  /** Actualiza el texto/estado del botón de lista de compras combinada según cuántos hay tildados. */
  function actualizarBotonListaCombinada() {
    const btn = $('#btn-lista-compras-combinada');
    if (!btn) return;
    const cantidad = estadoApp.seleccionParaCompra.size;
    btn.disabled = cantidad === 0;
    btn.textContent = cantidad === 0
      ? 'Lista de compras combinada'
      : 'Lista de compras combinada (' + cantidad + ')';
  }

  /** Junta las líneas de varios presupuestos en una sola lista, sumando cantidades de un mismo artículo. */
  function combinarLineasParaCompra(presupuestos) {
    const acumulado = {};
    presupuestos.forEach(function (p) {
      p.lineas.forEach(function (l) {
        if (!acumulado[l.articulo]) acumulado[l.articulo] = { articulo: l.articulo, cantidad: 0 };
        acumulado[l.articulo].cantidad += l.cantidad;
      });
    });
    return Object.keys(acumulado)
      .sort(function (a, b) { return a.localeCompare(b, 'es', { sensitivity: 'base' }); })
      .map(function (k) { return acumulado[k]; });
  }

  function generarListaCompraCombinada() {
    const numeros = Array.from(estadoApp.seleccionParaCompra);
    if (numeros.length === 0) return;
    const presupuestos = numeros.map(function (n) { return Store.buscarPresupuesto(n); }).filter(Boolean);
    if (presupuestos.length === 0) {
      mostrarAviso('No se encontraron los presupuestos tildados.', true);
      return;
    }
    const clientesIncluidos = Array.from(new Set(presupuestos.map(function (p) { return p.cliente.nombre; })));
    const presupuestoCombinado = {
      // No es un presupuesto real (no se guarda en el historial) -- es solo
      // un objeto de paso para reusar el mismo generador de PDF. El costo
      // de cada línea se busca con la fecha de HOY (no la de cada pedido
      // original), porque lo que importa es qué comprar y a qué costo
      // vigente comprarlo, no el costo que regía cuando se armó cada uno.
      numero: presupuestos.map(function (p) { return p.numero; }).join(', '),
      cliente: { nombre: clientesIncluidos.join(', ') },
      fecha: new Date().toISOString(),
      lineas: combinarLineasParaCompra(presupuestos),
    };
    descargarListaCompras(presupuestoCombinado);
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
          crearElemento('td', {}, [l.tipoPrecio === 'pack' ? 'Pack' : '']),
          crearElemento('td', {}, [Quote.formatoMoneda(l.precioUnitarioAplicado)]),
          crearElemento('td', {}, [Quote.formatoMoneda(l.importe)]),
        ])
      );
    });
    $('#detalle-total').textContent = Quote.formatoMoneda(presupuesto.total);

    $('#btn-recalcular').onclick = function () { recalcularPresupuestoDirecto(presupuesto.numero); };
    $('#btn-detalle-editar').onclick = function () { editarPresupuesto(presupuesto.numero); };
    $('#btn-detalle-duplicar').onclick = function () { duplicarPresupuesto(presupuesto.numero); };
    $('#btn-detalle-pdf').onclick = function () { descargarPDF(presupuesto); };
    $('#btn-detalle-lista-compras').onclick = function () { descargarListaCompras(presupuesto); };
    $('#btn-detalle-eliminar').onclick = function () { moverPresupuestoAPapelera(presupuesto.numero); };
    $('#btn-detalle-cerrar').onclick = function () { detalle.classList.remove('visible'); };
  }

  /** Recalcula un presupuesto del historial con la lista de precios vigente,
   * sin necesidad de tenerlo abierto en el detalle primero (se puede llamar
   * directo desde la fila de la tabla). */
  /**
   * "Recalcular con lista vigente": ANTES pisaba el presupuesto original en
   * el mismo número, lo cual iba en contra de la regla de oro de la app
   * (nunca modificar un presupuesto que ya se le pudo haber entregado al
   * cliente). Ahora crea una REVISIÓN nueva, igual que cuando se edita a
   * mano: el original queda intacto, con sus precios tal cual estaban, y
   * se agrega un "-R" nuevo con los importes recalculados.
   */
  function recalcularPresupuestoDirecto(numero) {
    const original = Store.buscarPresupuesto(numero);
    if (!original) return;
    const numeroBase = original.numeroBase || numero.split('-R')[0];
    const nuevoNumero = siguienteNumeroRevision(numeroBase);
    const nuevasLineas = original.lineas.map(function (l) { return Quote.recalcularLinea(l, estadoApp.listaPrecios); });
    const totales = Quote.calcularTotales(nuevasLineas, original.descuentoPct);
    const revision = Object.assign({}, original, totales, {
      numero: nuevoNumero,
      numeroBase: numeroBase,
      revisionDe: numeroBase,
      fecha: new Date().toISOString(),
      lineas: nuevasLineas,
      listaPreciosFecha: estadoApp.listaPrecios.actualizado,
      recalculadoDe: numero,
    });
    Store.guardarPresupuesto(revision);
    mostrarAviso('Se creó ' + nuevoNumero + ' con los precios recalculados. El original (' + numero + ') no se modificó.');
    renderHistorial();
    if (estadoApp.presupuestoAbiertoNumero === numero) verDetalleHistorial(nuevoNumero);
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
        // Se incluye la papelera (true) para no perderla del cache local al
        // reescribir todo el historial de una (ver guardarHistorialCompleto).
        const existentes = Store.obtenerHistorial(true);
        const porNumero = {};
        existentes.forEach(function (p) { porNumero[p.numero] = p; });
        let actualizados = 0;
        let agregados = 0;
        entrantes.forEach(function (p) {
          if (!p || !p.numero) return;
          if (porNumero[p.numero]) actualizados++; else agregados++;
          // El que se importa PISA al que ya había con el mismo número --
          // así sirve tanto para traer presupuestos nuevos como para
          // corregir datos de uno ya importado antes (por ejemplo, si
          // se corrige un archivo reconstruido a mano desde un PDF viejo).
          porNumero[p.numero] = p;
        });
        const combinado = Object.keys(porNumero).map(function (k) { return porNumero[k]; })
          .sort(function (a, b) { return new Date(b.fecha) - new Date(a.fecha); });
        Store.guardarHistorialCompleto(combinado);
        renderHistorial();
        mostrarAviso(
          'Importación completa: ' + agregados + ' presupuesto(s) nuevo(s)' +
          (actualizados > 0 ? ', ' + actualizados + ' actualizado(s) (mismo número, datos reemplazados).' : '.')
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
    $('#btn-lista-compras-combinada').addEventListener('click', generarListaCompraCombinada);

    $('#buscador-historial').addEventListener('input', debounce(function (e) {
      estadoApp.filtroHistorial = e.target.value;
      renderHistorial();
    }, 150));
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
      historial: Store.obtenerHistorial(true), // incluye papelera, para que un backup sea realmente completo
      listaPrecios: Store.obtenerListaPrecios(),
      clientes: { nombres: Store.obtenerClientes(), contactos: Store.obtenerContactosClientes(), datos: Store.obtenerDatosClientes() },
      proveedores: Store.obtenerMapaProveedores(),
      costosHistoricos: Store.obtenerHistorialCostos(),
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
          const existentes = Store.obtenerHistorial(true);
          const porNumero = {};
          existentes.forEach(function (p) { porNumero[p.numero] = p; });
          data.historial.forEach(function (p) {
            if (p && p.numero) porNumero[p.numero] = p; // pisa si ya existía
          });
          const combinado = Object.keys(porNumero).map(function (k) { return porNumero[k]; })
            .sort(function (a, b) { return new Date(b.fecha) - new Date(a.fecha); });
          Store.guardarHistorialCompleto(combinado);
        }
        if (data.config) {
          Store.guardarConfig(Object.assign(Store.obtenerConfig(), data.config));
        }
        if (data.listaPrecios && Array.isArray(data.listaPrecios.items)) {
          Store.guardarListaPrecios(data.listaPrecios);
        }
        if (data.clientes) {
          Store.restaurarClientes(data.clientes);
        }
        if (data.proveedores) {
          Store.guardarMapaProveedores(data.proveedores);
        }
        if (Array.isArray(data.costosHistoricos)) {
          Store.restaurarCostosHistoricos(data.costosHistoricos);
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

    initUsuariosAutorizados();
  }

  // ---------------------------------------------------------------------
  // Usuarios autorizados (login)
  // ---------------------------------------------------------------------
  function renderUsuariosAutorizados() {
    const lista = $('#lista-usuarios-autorizados');
    if (!lista || !window.Auth) return;
    lista.innerHTML = '';
    window.Auth.obtenerUsuariosAutorizados().forEach(function (email) {
      lista.appendChild(crearElemento('li', {}, [
        crearElemento('span', {}, [email]),
        crearElemento('button', {
          class: 'btn-mini btn-mini-peligro', type: 'button',
          onclick: function () { quitarUsuario(email); },
        }, ['Quitar']),
      ]));
    });
  }

  function quitarUsuario(email) {
    const propio = window.Auth.currentUser() && window.Auth.currentUser().email === email;
    const mensaje = propio
      ? 'Ese es TU propio correo — si lo sacás, te vas a quedar sin acceso vos también. ¿Confirmás?'
      : 'Sacar el acceso de ' + email + '. ¿Confirmás?';
    if (!window.confirm(mensaje)) return;
    window.Auth.quitarUsuarioAutorizado(email).then(function () {
      renderUsuariosAutorizados();
      mostrarAviso('Se sacó el acceso de ' + email + '.');
    }).catch(function (err) {
      mostrarAviso(err.message || 'No se pudo sacar ese correo.', true);
    });
  }

  function initUsuariosAutorizados() {
    renderUsuariosAutorizados();

    $('#btn-agregar-usuario').addEventListener('click', function () {
      const input = $('#input-usuario-nuevo');
      const email = input.value.trim();
      if (!email || email.indexOf('@') === -1) {
        mostrarAviso('Ingresá un correo válido.', true);
        return;
      }
      window.Auth.agregarUsuarioAutorizado(email).then(function () {
        input.value = '';
        renderUsuariosAutorizados();
        mostrarAviso('Se agregó ' + email + '. Ya puede iniciar sesión.');
      }).catch(function (err) {
        mostrarAviso(err.message || 'No se pudo agregar ese correo.', true);
      });
    });

    $('#input-usuario-nuevo').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); $('#btn-agregar-usuario').click(); }
    });
  }

  // ---------------------------------------------------------------------
  // Lista de precios
  // ---------------------------------------------------------------------
  /** Cartel fijo arriba: qué lista se está usando y desde cuándo; rojo si es vieja o no hay. */
  function renderAvisoLista() {
    const el = $('#aviso-lista');
    if (!el) return;
    const lista = estadoApp.listaPrecios;
    if (!lista || !lista.items || lista.items.length === 0) {
      el.className = 'aviso-lista aviso-lista-mal';
      el.textContent = '⚠ NO HAY LISTA DE PRECIOS CARGADA. No se puede presupuestar: subí el Excel en la pestaña "Lista de precios".';
      return;
    }
    const dias = Math.floor((Date.now() - new Date(lista.actualizado).getTime()) / 86400000);
    const vieja = !(dias <= 35);
    el.className = 'aviso-lista ' + (vieja ? 'aviso-lista-mal' : 'aviso-lista-ok');
    el.textContent = (vieja ? '⚠ LISTA VIEJA (' + dias + ' días) — verificá que sea la correcta. ' : 'Lista vigente: ') +
      (lista.origenArchivo || '—') + ' · cargada el ' + Quote.formatoFecha(lista.actualizado);
  }

  function renderListaPreciosInfo() {
    renderAvisoLista();
    actualizarBadgePendientes();
    renderPendientes();
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
            (resultado.articulosConCosto > 0
              ? ' También se guardó el costo de ' + resultado.articulosConCosto + ' artículos (para Informes y Lista de compras)' +
                (resultado.costosDesdeHojaCostos ? '.' : ' — la hoja de costos no se pudo leer, así que se tomaron de las hojas de cada proveedor.')
              : ' ⚠ NO se pudo leer ningún costo de este archivo: la Lista de compras va a salir sin costos. Revisá que las hojas de proveedores tengan los costos cargados.') +
            (resultado.articulosConCosto > 0 && resultado.articulosSinCosto && resultado.articulosSinCosto.length > 0
              ? ' ⚠ ' + resultado.articulosSinCosto.length + ' artículo(s) sin costo cargado (ej.: ' +
                resultado.articulosSinCosto.slice(0, 5).join(', ') + (resultado.articulosSinCosto.length > 5 ? '…' : '') + ').'
              : '') +
            (resultado.mapaProveedoresActualizado === false
              ? ' ⚠ No se pudo detectar el proveedor de ningún artículo: se conservó el mapa de proveedores anterior.'
              : '') +
            (resultado.sinProveedor && resultado.sinProveedor.length > 0
              ? ' ⚠ ' + resultado.sinProveedor.length + ' artículo(s) sin proveedor detectado (nombre distinto entre hojas): ' +
                resultado.sinProveedor.slice(0, 8).join(', ') + (resultado.sinProveedor.length > 8 ? '…' : '') +
                '. Van a aparecer como "Sin proveedor asignado" en la lista de compras hasta que unifiques el nombre en el Excel.'
              : '');
          renderInformeCarga(resultado.informe, resultado);
          actualizarBadgePendientes();
          renderPendientes();
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
  // Clientes: alta, edición y baja desde la app
  // ---------------------------------------------------------------------
  /**
   * Antes de crear un cliente nuevo: avisa si ya hay uno parecido (error de
   * tipeo) y pide confirmar cómo quedó escrito. Devuelve null (cancelado),
   * { usar: nombreExistente } o { crear: nombreNormalizado }.
   */
  function confirmarAltaCliente(nombreTipeado) {
    const norm = normalizarNombreCliente(nombreTipeado);
    if (!norm) return null;
    const parecido = Quote.buscarProveedorParecido(norm, Store.obtenerClientes());
    if (parecido && parecido.nombre !== norm) {
      const esElMismo = window.confirm(
        'Ya existe un cliente parecido:\n\n"' + parecido.nombre + '"\n\n¿Es el mismo cliente?\n\n' +
        'Aceptar = usar ese cliente.\nCancelar = seguir para crear "' + norm + '" como cliente nuevo.'
      );
      if (esElMismo) return { usar: parecido.nombre };
    }
    if (!window.confirm('Vas a agregar un cliente nuevo:\n\n"' + norm + '"\n\n¿Está bien escrito?')) return null;
    return { crear: norm };
  }

  const estadoClientes = { filtro: '', editando: null };

  function renderClientes() {
    const tbody = $('#tabla-clientes tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    const todos = Store.obtenerClientes();
    const q = Pricelist.normalizar(estadoClientes.filtro);
    const filas = todos.filter(function (nombre) {
      if (!q) return true;
      const f = Store.obtenerDatosCliente(nombre);
      return Pricelist.normalizar(nombre + ' ' + f.cuit + ' ' + f.contacto).indexOf(q) !== -1;
    });
    $('#clientes-contador').textContent = q
      ? filas.length + ' de ' + todos.length + ' clientes'
      : todos.length + ' clientes';

    if (filas.length === 0) {
      tbody.appendChild(crearElemento('tr', {}, [
        crearElemento('td', { colspan: '5', class: 'vacio' }, [todos.length === 0 ? 'Todavía no hay clientes.' : 'Sin coincidencias.']),
      ]));
      return;
    }
    filas.forEach(function (nombre) {
      const ficha = Store.obtenerDatosCliente(nombre);
      const cant = Store.contarPresupuestosDeCliente(nombre);
      tbody.appendChild(crearElemento('tr', {}, [
        crearElemento('td', {}, [nombre]),
        crearElemento('td', {}, [ficha.cuit || '—']),
        crearElemento('td', {}, [ficha.contacto || '—']),
        crearElemento('td', {}, [String(cant.activos)]),
        crearElemento('td', {}, [
          crearElemento('div', { class: 'acciones-fila' }, [
            crearElemento('button', { type: 'button', class: 'btn-mini', onclick: function () { abrirModalCliente(nombre); } }, ['Editar']),
            crearElemento('button', { type: 'button', class: 'btn-mini-peligro', onclick: function () { eliminarClienteConfirmado(nombre); } }, ['Eliminar']),
          ]),
        ]),
      ]));
    });
  }

  function abrirModalCliente(nombreOriginal) {
    estadoClientes.editando = nombreOriginal || null;
    const ficha = nombreOriginal ? Store.obtenerDatosCliente(nombreOriginal) : { contacto: '', cuit: '', notas: '' };
    $('#cli-titulo').textContent = nombreOriginal ? 'Editar cliente' : 'Nuevo cliente';
    $('#cli-nombre').value = nombreOriginal || '';
    $('#cli-cuit').value = ficha.cuit;
    $('#cli-contacto').value = ficha.contacto;
    $('#cli-notas').value = ficha.notas;
    $('#cli-error').textContent = '';
    $('#modal-cliente').style.display = 'flex';
    $('#cli-nombre').focus();
  }

  function cerrarModalCliente() {
    $('#modal-cliente').style.display = 'none';
    estadoClientes.editando = null;
  }

  function guardarClienteDesdeModal() {
    const original = estadoClientes.editando;
    const ficha = {
      nombre: $('#cli-nombre').value,
      cuit: $('#cli-cuit').value,
      contacto: $('#cli-contacto').value,
      notas: $('#cli-notas').value,
    };
    const nuevo = normalizarNombreCliente(ficha.nombre);
    if (!nuevo) { $('#cli-error').textContent = 'Escribí el nombre del cliente.'; return; }

    if (!original) {
      // Cliente nuevo: se avisa si ya hay uno parecido y se pide confirmar.
      const decision = confirmarAltaCliente(ficha.nombre);
      if (!decision) return;
      if (decision.usar) {
        cerrarModalCliente();
        mostrarAviso('Ya existía "' + decision.usar + '": no se creó uno nuevo.');
        return;
      }
    } else if (nuevo !== normalizarNombreCliente(original)) {
      const cant = Store.contarPresupuestosDeCliente(original);
      const aviso = cant.activos + cant.enPapelera > 0
        ? '\n\nSus ' + cant.activos + ' presupuesto(s) del historial NO cambian: siguen con el nombre anterior.'
        : '';
      if (!window.confirm('Vas a cambiar el nombre:\n\n"' + original + '"  →  "' + nuevo + '"' + aviso + '\n\n¿Confirmás?')) return;
    }

    const res = Store.guardarCliente(original, ficha);
    if (!res.ok) { $('#cli-error').textContent = res.error; return; }
    cerrarModalCliente();
    renderClientes();
    mostrarAviso(original ? 'Cliente actualizado.' : 'Cliente "' + res.nombre + '" agregado.');
  }

  function eliminarClienteConfirmado(nombre) {
    const cant = Store.contarPresupuestosDeCliente(nombre);
    const aviso = cant.activos > 0
      ? '\n\nTiene ' + cant.activos + ' presupuesto(s) en el historial: NO se borran, siguen apareciendo con este nombre.'
      : '';
    if (!window.confirm('¿Eliminar al cliente "' + nombre + '" de la lista?' + aviso)) return;
    const res = Store.eliminarCliente(nombre);
    if (!res.ok) { mostrarAviso(res.error, true); return; }
    renderClientes();
    mostrarAviso('Cliente "' + nombre + '" eliminado de la lista.');
  }

  function initClientes() {
    $('#btn-nuevo-cliente').addEventListener('click', function () { abrirModalCliente(null); });
    $('#buscador-clientes').addEventListener('input', debounce(function (e) {
      estadoClientes.filtro = e.target.value;
      renderClientes();
    }, 120));
    $('#btn-cli-guardar').addEventListener('click', guardarClienteDesdeModal);
    $('#btn-cli-cancelar').addEventListener('click', cerrarModalCliente);
    $('#modal-cliente').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') guardarClienteDesdeModal();
      if (e.key === 'Escape') cerrarModalCliente();
    });
  }

  // ---------------------------------------------------------------------
  // Pendientes de incorporar al Excel (artículos cargados a mano)
  // ---------------------------------------------------------------------
  function actualizarBadgePendientes() {
    const badge = $('#badge-pendientes');
    if (!badge) return;
    const n = Store.obtenerPendientes().length;
    badge.textContent = String(n);
    badge.style.display = n > 0 ? 'inline-block' : 'none';
    badge.title = n + ' artículo(s) cargados a mano para incorporar al Excel';
  }

  function renderPendientes() {
    const tbody = $('#tabla-pendientes tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    const pendientes = Store.obtenerPendientes();
    $('#btn-pendientes-excel').disabled = pendientes.length === 0;
    if (pendientes.length === 0) {
      tbody.appendChild(crearElemento('tr', {}, [
        crearElemento('td', { colspan: '9', class: 'vacio' }, ['No hay artículos pendientes.']),
      ]));
      return;
    }
    const num = function (v) { return v === null || v === undefined || v === '' ? '—' : String(v); };
    const dinero = function (v) { return v > 0 ? Quote.formatoMoneda(v) : '—'; };
    pendientes.forEach(function (p) {
      tbody.appendChild(crearElemento('tr', {}, [
        crearElemento('td', {}, [p.articulo]),
        crearElemento('td', {}, [num(p.hoja)]),
        crearElemento('td', {}, [p.proveedor || '—']),
        crearElemento('td', {}, [num(p.cantidadPack)]),
        crearElemento('td', {}, [dinero(p.costoUnitario)]),
        crearElemento('td', {}, [p.margenUnit ? p.margenUnit + '%' : '—']),
        crearElemento('td', {}, [p.margenPack ? p.margenPack + '%' : '—']),
        crearElemento('td', {}, [dinero(p.precioUnitario)]),
        crearElemento('td', {}, [
          crearElemento('button', {
            type: 'button', class: 'btn-mini-peligro',
            onclick: function () {
              if (!window.confirm('¿Quitar "' + p.articulo + '" de Pendientes? (no afecta a ningún presupuesto)')) return;
              Store.eliminarPendiente(p.id);
              actualizarBadgePendientes();
              renderPendientes();
            },
          }, ['Quitar']),
        ]),
      ]));
    });
  }

  /** Planilla con las mismas columnas de la hoja Maestra, lista para pegar en el Excel. */
  function descargarPendientesExcel() {
    const pendientes = Store.obtenerPendientes();
    if (pendientes.length === 0) { mostrarAviso('No hay pendientes para descargar.', true); return; }
    const filas = pendientes.map(function (p) {
      return {
        'HOJA': p.hoja || '',
        'ARTÍCULO': p.articulo,
        'PROVEEDOR': p.proveedor || '',
        'CANT. PACK': p.cantidadPack || '',
        'COSTO UNIT.': p.costoUnitario || '',
        '% MARGEN UNIT.': p.margenUnit ? p.margenUnit / 100 : '',
        '% MARGEN PACK': p.margenPack ? p.margenPack / 100 : '',
        'PRECIO UNIT. (referencia)': p.precioUnitario || '',
        'PRECIO PACK x UNIDAD (referencia)': p.precioPack || '',
        'FECHA DE CARGA': String(p.fecha || '').slice(0, 10),
      };
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), 'Pendientes');
    XLSX.writeFile(wb, 'Pendientes_para_Excel_' + new Date().toISOString().slice(0, 10) + '.xlsx');
    mostrarAviso('Planilla descargada. Pegala en la hoja Maestra del Excel y subí el Excel actualizado.');
  }

  function initPendientes() {
    $('#btn-pendientes-excel').addEventListener('click', descargarPendientesExcel);
    actualizarBadgePendientes();
    renderPendientes();
  }

  // ---------------------------------------------------------------------
  // PDF de la lista de precios para clientes
  // ---------------------------------------------------------------------
  function generarPDFListaPrecios(descargar) {
    const lista = estadoApp.listaPrecios;
    if (!lista || !lista.items || lista.items.length === 0) {
      mostrarAviso('No hay lista de precios cargada.', true);
      return;
    }
    if (!lista.items.some(function (it) { return it.hoja !== null && it.hoja !== undefined; })) {
      mostrarAviso('Esta lista se cargó antes de guardar las hojas: el PDF sale de la A a la Z. Volvé a subir el Excel para ordenarlo por hoja.', true);
    }
    const doc = PdfGen.construirPDFListaPrecios(lista, Store.obtenerConfig());
    if (descargar) doc.save(PdfGen.nombreArchivoListaPrecios(lista));
    else window.open(doc.output('bloburl'), '_blank');
  }

  function initListaPreciosPdf() {
    $('#btn-lp-pdf-preview').addEventListener('click', function () { generarPDFListaPrecios(false); });
    $('#btn-lp-pdf-descargar').addEventListener('click', function () { generarPDFListaPrecios(true); });
  }

  // ---------------------------------------------------------------------
  // Informe de cambios al subir una lista nueva
  // ---------------------------------------------------------------------
  function pctTexto(p) {
    if (p === null || p === undefined) return '';
    const v = Math.round(p * 1000) / 10;
    return (v > 0 ? '+' : '') + v + '%';
  }

  function tablaSimple(encabezados, filas, limite) {
    const tabla = crearElemento('table', {}, []);
    tabla.appendChild(crearElemento('thead', {}, [crearElemento('tr', {}, encabezados.map(function (h) { return crearElemento('th', {}, [h]); }))]));
    const tb = crearElemento('tbody', {}, []);
    filas.slice(0, limite).forEach(function (celdas) {
      tb.appendChild(crearElemento('tr', {}, celdas.map(function (c) {
        return (typeof c === 'object' && c !== null && c.nodeType) ? crearElemento('td', {}, [c]) : crearElemento('td', {}, [String(c === null || c === undefined ? '—' : c)]);
      })));
    });
    tabla.appendChild(tb);
    const wrap = crearElemento('div', { class: 'tabla-wrap' }, [tabla]);
    if (filas.length > limite) {
      wrap.appendChild(crearElemento('p', { class: 'texto-ayuda' }, ['… y ' + (filas.length - limite) + ' más. El informe completo se descarga en Excel.']));
    }
    return wrap;
  }

  function bloqueDetalle(titulo, cantidad, contenido, abierto) {
    if (!cantidad) return document.createTextNode('');
    const d = crearElemento('details', { class: 'informe-bloque' }, [crearElemento('summary', {}, [titulo + ' (' + cantidad + ')']), contenido]);
    if (abierto) d.open = true;
    return d;
  }

  function renderInformeCarga(informe, resultado) {
    const card = $('#lp-informe-card');
    const cont = $('#lp-informe');
    if (!card || !cont || !informe) return;
    estadoApp.ultimoInforme = informe;
    cont.innerHTML = '';
    card.style.display = 'block';
    const r = informe.resumen;
    const a = informe.alertas;
    const dato = function (valor, etiqueta, esAlerta) {
      return crearElemento('div', { class: 'informe-dato' + (esAlerta && valor > 0 ? ' alerta' : '') }, [crearElemento('strong', {}, [String(valor)]), etiqueta]);
    };

    if (informe.hayListaAnterior) {
      cont.appendChild(crearElemento('div', { class: 'informe-resumen' }, [
        dato(r.total, 'artículos en la lista nueva'),
        dato(r.iguales, 'sin cambios'),
        dato(r.subieron, 'subieron de precio'),
        dato(r.bajaron, 'bajaron de precio'),
        dato(r.nuevos, 'nuevos'),
        dato(r.retirados, 'ya no están'),
      ]));
    } else {
      cont.appendChild(crearElemento('p', { class: 'texto-ayuda' }, ['Es la primera carga: no hay una lista anterior para comparar. Abajo van las alertas de la lista nueva.']));
    }

    cont.appendChild(crearElemento('div', { class: 'informe-resumen' }, [
      dato(a.margenBajo.length, 'con margen por debajo del objetivo', true),
      dato(a.sinCosto.length, 'sin costo cargado', true),
      dato(a.packMasCaro.length, 'con pack más caro que la unidad', true),
      dato(a.precioCero.length, 'con precio en cero', true),
    ]));

    if (resultado && resultado.pendientesIncorporados && resultado.pendientesIncorporados.length > 0) {
      cont.appendChild(crearElemento('p', { class: 'texto-ayuda' }, [
        '✔ Salieron de Pendientes porque ya están en la lista: ' + resultado.pendientesIncorporados.join(', ') + '.',
      ]));
    }

    cont.appendChild(bloqueDetalle('Alertas de margen', a.margenBajo.length, tablaSimple(
      ['Artículo', 'Costo', 'Margen unit. real / objetivo', 'Margen pack real / objetivo'],
      a.margenBajo.map(function (m) {
        const pct = function (v) { return v === null || v === undefined ? '—' : (Math.round(v * 1000) / 10) + '%'; };
        return [m.articulo + (m.bajoCosto ? ' ⚠ POR DEBAJO DEL COSTO' : ''), Quote.formatoMoneda(m.costo), pct(m.realUnit) + ' / ' + pct(m.esperadoUnit), pct(m.realPack) + ' / ' + pct(m.esperadoPack)];
      }), 30), true));
    cont.appendChild(bloqueDetalle('Artículos sin costo', a.sinCosto.length, tablaSimple(['Artículo'], a.sinCosto.map(function (x) { return [x]; }), 40), false));
    cont.appendChild(bloqueDetalle('Pack más caro que la unidad', a.packMasCaro.length, tablaSimple(
      ['Artículo', 'Precio unidad', 'Precio pack'],
      a.packMasCaro.map(function (x) { return [x.articulo, Quote.formatoMoneda(x.unit), Quote.formatoMoneda(x.pack)]; }), 30), true));
    cont.appendChild(bloqueDetalle('Precio en cero', a.precioCero.length, tablaSimple(['Artículo'], a.precioCero.map(function (x) { return [x]; }), 30), true));

    if (informe.hayListaAnterior) {
      cont.appendChild(bloqueDetalle('Precios que cambiaron (los de mayor variación primero)', informe.cambios.length, tablaSimple(
        ['Artículo', 'Hoja', 'Unidad: antes → ahora', 'Pack x unidad: antes → ahora', 'Cant. pack'],
        informe.cambios.map(function (c) {
          const clase = (c.pctUnit || 0) > 0 ? 'suba' : 'baja';
          return [
            c.articulo, c.hoja === null ? '—' : c.hoja,
            crearElemento('span', { class: clase }, [Quote.formatoMoneda(c.unitAntes) + ' → ' + Quote.formatoMoneda(c.unitAhora) + ' (' + pctTexto(c.pctUnit) + ')']),
            Quote.formatoMoneda(c.packAntes) + ' → ' + Quote.formatoMoneda(c.packAhora) + ' (' + pctTexto(c.pctPack) + ')',
            c.cantAntes === c.cantAhora ? c.cantAhora : (c.cantAntes + ' → ' + c.cantAhora),
          ];
        }), 30), false));
      cont.appendChild(bloqueDetalle('Artículos nuevos', informe.nuevos.length, tablaSimple(
        ['Artículo', 'Hoja', 'Precio unidad', 'Precio pack x unidad'],
        informe.nuevos.map(function (x) { return [x.articulo, x.hoja === null || x.hoja === undefined ? '—' : x.hoja, Quote.formatoMoneda(x.precioUnitario), Quote.formatoMoneda(x.precioPack)]; }), 30), false));
      cont.appendChild(bloqueDetalle('Artículos que ya no están en la lista', informe.retirados.length, tablaSimple(
        ['Artículo', 'Precio unidad que tenía'],
        informe.retirados.map(function (x) { return [x.articulo, Quote.formatoMoneda(x.precioUnitario)]; }), 30), false));
    }

    cont.appendChild(crearElemento('div', { class: 'acciones-presupuesto', style: 'justify-content:flex-start;' }, [
      crearElemento('button', { type: 'button', class: 'btn btn-secundario', onclick: descargarInformeCarga }, ['Descargar informe completo (Excel)']),
    ]));
  }

  function descargarInformeCarga() {
    const inf = estadoApp.ultimoInforme;
    if (!inf) return;
    const wb = XLSX.utils.book_new();
    const r = inf.resumen;
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Informe de carga de lista de precios', new Date().toLocaleString('es-AR')],
      ['Artículos en la lista nueva', r.total], ['Sin cambios', r.iguales], ['Cambiaron', r.cambiaron],
      ['Subieron', r.subieron], ['Bajaron', r.bajaron], ['Nuevos', r.nuevos], ['Retirados', r.retirados],
      ['Con margen bajo el objetivo', inf.alertas.margenBajo.length], ['Sin costo', inf.alertas.sinCosto.length],
      ['Pack más caro que la unidad', inf.alertas.packMasCaro.length], ['Precio en cero', inf.alertas.precioCero.length],
    ]), 'Resumen');
    const pc = function (v) { return v === null || v === undefined ? '' : v; };
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(inf.cambios.map(function (c) {
      return { 'HOJA': pc(c.hoja), 'ARTÍCULO': c.articulo, 'UNIDAD ANTES': c.unitAntes, 'UNIDAD AHORA': c.unitAhora, 'VAR. UNIDAD': pc(c.pctUnit),
        'PACK x U. ANTES': c.packAntes, 'PACK x U. AHORA': c.packAhora, 'VAR. PACK': pc(c.pctPack), 'CANT. PACK ANTES': c.cantAntes, 'CANT. PACK AHORA': c.cantAhora };
    })), 'Cambios de precio');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(inf.nuevos.map(function (x) {
      return { 'HOJA': pc(x.hoja), 'ARTÍCULO': x.articulo, 'PRECIO UNIDAD': x.precioUnitario, 'PRECIO PACK x U.': x.precioPack, 'CANT. PACK': x.cantidadPack };
    })), 'Nuevos');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(inf.retirados.map(function (x) {
      return { 'HOJA': pc(x.hoja), 'ARTÍCULO': x.articulo, 'PRECIO UNIDAD': x.precioUnitario, 'PRECIO PACK x U.': x.precioPack };
    })), 'Retirados');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(inf.alertas.margenBajo.map(function (m) {
      return { 'ARTÍCULO': m.articulo, 'COSTO': m.costo, 'MARGEN UNIT. REAL': m.realUnit, 'MARGEN UNIT. OBJETIVO': pc(m.esperadoUnit),
        'MARGEN PACK REAL': m.realPack, 'MARGEN PACK OBJETIVO': pc(m.esperadoPack), 'POR DEBAJO DEL COSTO': m.bajoCosto ? 'SÍ' : '' };
    })), 'Alertas de margen');
    const otras = [];
    inf.alertas.sinCosto.forEach(function (a) { otras.push({ 'ALERTA': 'Sin costo', 'ARTÍCULO': a }); });
    inf.alertas.packMasCaro.forEach(function (a) { otras.push({ 'ALERTA': 'Pack más caro que la unidad', 'ARTÍCULO': a.articulo }); });
    inf.alertas.precioCero.forEach(function (a) { otras.push({ 'ALERTA': 'Precio en cero', 'ARTÍCULO': a }); });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(otras), 'Otras alertas');
    XLSX.writeFile(wb, 'Informe_carga_lista_' + new Date().toISOString().slice(0, 10) + '.xlsx');
  }

  // ---------------------------------------------------------------------
  // Mayúsculas automáticas: todo el texto que termina en el presupuesto
  // (cliente, producto manual, condiciones, observaciones, datos de la
  // empresa) se escribe siempre en mayúsculas, como el resto de la lista
  // de precios. No se aplica a los buscadores (no guardan datos, y la
  // búsqueda ya ignora mayúsculas/minúsculas) ni a los campos de email.
  // ---------------------------------------------------------------------
  const CAMPOS_MAYUSCULAS = [
    'input-cliente-nombre',
    'input-cliente-contacto',
    'cli-nombre',
    'cli-cuit',
    'cli-contacto',
    'cli-notas',
    'manual-nombre',
    'input-condiciones',
    'input-observaciones',
    'cfg-nombre',
    'cfg-direccion',
    'cfg-telefono',
    'cfg-cuit',
    'cfg-condiciones',
    'cfg-prefijo',
  ];

  // Campos de texto libre donde queremos que el corrector ortográfico del
  // navegador pueda marcar errores. Si se pasaran a mayúscula mientras se
  // escribe, el navegador no los revisa (ignora palabras en mayúsculas).
  // Por eso: mientras se tipea se ven en mayúscula (solo visual, con CSS)
  // pero el texto real queda como se escribió, y se pasa a mayúscula al
  // salir del campo.
  const CAMPOS_CON_CORRECTOR = ['manual-nombre', 'input-condiciones', 'input-observaciones'];

  function initMayusculasAutomaticas() {
    CAMPOS_CON_CORRECTOR.forEach(function (id) {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.add('visual-mayusculas');
      el.addEventListener('blur', function () { el.value = el.value.toUpperCase(); });
    });
    CAMPOS_MAYUSCULAS.forEach(function (id) {
      if (CAMPOS_CON_CORRECTOR.indexOf(id) !== -1) return;
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', function () {
        const inicio = el.selectionStart;
        const fin = el.selectionEnd;
        el.value = el.value.toUpperCase();
        // Restaura la posición del cursor (toUpperCase no cambia el largo
        // del texto en español, así que la posición se mantiene exacta).
        if (inicio !== null && fin !== null) el.setSelectionRange(inicio, fin);
      });
    });
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
    // Muestra qué versión de la app se está usando (sirve para saber si el celu ya bajó la última).
    if (window.caches && caches.keys) {
      caches.keys().then(function (claves) {
        const c = claves.filter(function (k) { return k.indexOf('presupuestos-cache-') === 0; }).pop();
        const el = $('#version-app');
        if (c && el) el.textContent = 'Versión ' + c.replace('presupuestos-cache-', '').slice(0, 7);
      }).catch(function () { /* no es importante */ });
    }
    Store.reconciliarClientesConHistorial();
    Store.reconciliarNumeracionConHistorial();
    estadoApp.config = Store.obtenerConfig();

    Pricelist.cargarListaVigente()
      .then(function (lista) {
        estadoApp.listaPrecios = lista;
      })
      .catch(function (err) {
        console.error(err);
        mostrarAviso('No hay lista de precios cargada. Subí el Excel en la pestaña "Lista de precios".', true);
        estadoApp.listaPrecios = { actualizado: null, origenArchivo: null, items: [] };
      })
      .then(function () {
        initNavegacion();
        initBuscador();
        initSeleccionRapida();
        initFormularioManual();
        initSelectorCliente();
        initClientes();
        initPendientes();
        initListaPreciosPdf();
        initFormularioPresupuesto();
        initConfiguracion();
        initActualizarLista();
        initHistorialHerramientas();
        initTogglePapelera();
        initBackupCompleto();
        initMayusculasAutomaticas();
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
