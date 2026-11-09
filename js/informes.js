/**
 * informes.js
 * -----------------------------------------------------------------------
 * Dashboard de informes. Toma los presupuestos guardados como "ventas
 * concretadas" y los cruza con el historial de costos (guardado por
 * pricelist.js al importar cada Excel mensual) para estimar ganancia.
 *
 * Nunca toca la lista de precios vigente ni el historial de presupuestos:
 * es una vista de solo lectura sobre esos datos.
 * -----------------------------------------------------------------------
 */

(function () {
  const Store = window.Store;
  const Quote = window.Quote;
  const $ = function (sel, ctx) { return (ctx || document).querySelector(sel); };

  const estado = {
    historial: [],   // ya filtrado: sin papelera, solo última revisión de cada uno
    costos: [],       // historial de snapshots mensuales de costos
    filtroMes: '',
    filtroCliente: '',
    lista: null,      // lista de precios vigente
    articulos: {},    // índice de TODOS los artículos conocidos (ver construirIndiceArticulos)
  };

  /** Nombre del artículo en la lista de precios (una línea renombrada a mano conserva el original). */
  function nombreLista(linea) {
    return linea.articuloLista || linea.articulo;
  }

  /** Clave que ignora mayúsculas, tildes, espacios y símbolos: "CABO  MADERA 1,30" = "cabo madera 1.30". */
  function clave(nombre) {
    return String(nombre || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  }

  // Colores del resto de la app, para que los gráficos combinen.
  const COLOR_TEAL = '#0f6b5c';
  const COLOR_TEAL_TENUE = '#e3f0ed';
  const COLOR_ROJO = '#b3392c';

  // Un Chart.js queda "enganchado" a su <canvas> -- si se vuelve a crear
  // sin destruir el anterior (por ejemplo, al cambiar un filtro y volver a
  // renderizar), quedan pegoteados varios gráficos fantasma. Este objeto
  // guarda la instancia activa de cada canvas para poder destruirla antes
  // de dibujar la nueva.
  const instanciasChart = {};
  function crearOActualizarChart(idCanvas, config) {
    const canvas = $('#' + idCanvas);
    if (!canvas) return null;
    const wrap = canvas.closest('.chart-wrap');
    if (typeof window.Chart === 'undefined') {
      // Sin internet la primera vez (o señal muy débil justo en ese
      // momento): Chart.js todavía no se pudo descargar y cachear. No
      // rompe el resto del informe, pero avisamos por qué está en
      // blanco en vez de dejarlo así sin explicación -- se soluciona
      // solo la próxima vez que haya buena conexión.
      if (wrap && !wrap.querySelector('.chart-sin-datos')) {
        canvas.style.display = 'none';
        wrap.appendChild(crearElemento('p', { class: 'chart-sin-datos' }, [
          'No se pudo cargar el gráfico (sin conexión la primera vez). Se soluciona solo abriendo la app con internet.',
        ]));
      }
      return null;
    }
    if (wrap) {
      const aviso = wrap.querySelector('.chart-sin-datos');
      if (aviso) aviso.remove();
      canvas.style.display = '';
    }
    if (instanciasChart[idCanvas]) instanciasChart[idCanvas].destroy();
    instanciasChart[idCanvas] = new window.Chart(canvas, config);
    return instanciasChart[idCanvas];
  }

  function mesDeFecha(iso) {
    return iso ? String(iso).slice(0, 7) : '';
  }

  function etiquetaMes(mesISO) {
    if (!mesISO) return mesISO;
    const partes = mesISO.split('-');
    const d = new Date(Number(partes[0]), Number(partes[1]) - 1, 1);
    return new Intl.DateTimeFormat('es-AR', { month: 'short', year: 'numeric' }).format(d);
  }

  function crearElemento(tag, attrs, hijos) {
    attrs = attrs || {};
    hijos = hijos || [];
    const el = document.createElement(tag);
    Object.keys(attrs).forEach(function (k) {
      const v = attrs[k];
      if (k === 'class') el.className = v;
      else if (k.indexOf('on') === 0 && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    });
    hijos.forEach(function (h) { el.appendChild(typeof h === 'string' ? document.createTextNode(h) : h); });
    return el;
  }

  // -----------------------------------------------------------------------
  // Carga inicial y filtros
  // -----------------------------------------------------------------------
  function cargarDatos() {
    estado.historial = Store.obtenerHistorialParaInformes();
    estado.costos = Store.obtenerHistorialCostos();
    estado.lista = Store.obtenerListaPrecios();
    construirIndiceArticulos();
  }

  /**
   * Índice de todos los artículos que alguna vez aparecieron: en la lista
   * vigente, en cualquier carga de Excel (costos históricos) o vendidos en un
   * presupuesto (incluidos los renombrados y los cargados a mano). Antes el
   * desplegable solo tomaba los de las cargas de costos, por eso faltaban.
   */
  function construirIndiceArticulos() {
    const idx = {};
    function agregar(nombre, fuente) {
      const k = clave(nombre);
      if (!k) return;
      if (!idx[k]) idx[k] = { clave: k, nombre: String(nombre).trim(), enLista: false, enCargas: false, vendido: false, manual: false };
      idx[k][fuente] = true;
      // El nombre que se muestra: el de la lista vigente tiene prioridad.
      if (fuente === 'enLista') idx[k].nombre = String(nombre).trim();
    }
    ((estado.lista && estado.lista.items) || []).forEach(function (it) { agregar(it.articulo, 'enLista'); });
    estado.costos.forEach(function (snap) { (snap.items || []).forEach(function (it) { agregar(it.articulo, 'enCargas'); }); });
    estado.historial.forEach(function (p) {
      (p.lineas || []).forEach(function (l) {
        agregar(nombreLista(l), 'vendido');
        if (l.esManual) idx[clave(nombreLista(l))].manual = true;
      });
    });
    estado.articulos = idx;
  }

  function poblarFiltros() {
    const meses = Array.from(new Set(estado.historial.map(function (p) { return mesDeFecha(p.fecha); })))
      .filter(Boolean)
      .sort()
      .reverse();
    const selectMes = $('#filtro-mes');
    selectMes.innerHTML = '<option value="">Todos</option>';
    meses.forEach(function (m) {
      selectMes.appendChild(crearElemento('option', { value: m }, [etiquetaMes(m)]));
    });

    const clientes = Array.from(new Set(estado.historial.map(function (p) { return p.cliente.nombre; })))
      .filter(Boolean)
      .sort(function (a, b) { return a.localeCompare(b, 'es'); });
    const selectCliente = $('#filtro-cliente');
    selectCliente.innerHTML = '<option value="">Todos</option>';
    clientes.forEach(function (c) {
      selectCliente.appendChild(crearElemento('option', { value: c }, [c]));
    });
  }

  function historialFiltrado() {
    return estado.historial.filter(function (p) {
      if (estado.filtroMes && mesDeFecha(p.fecha) !== estado.filtroMes) return false;
      if (estado.filtroCliente && p.cliente.nombre !== estado.filtroCliente) return false;
      return true;
    });
  }

  // -----------------------------------------------------------------------
  // Costos: índice por artículo (por clave, no por nombre exacto) de cada carga
  // -----------------------------------------------------------------------
  const cacheIndiceCostos = {};
  function indiceDeSnapshot(snap) {
    if (!cacheIndiceCostos[snap.fecha]) {
      const idx = {};
      (snap.items || []).forEach(function (it) { idx[clave(it.articulo)] = it; });
      cacheIndiceCostos[snap.fecha] = idx;
    }
    return cacheIndiceCostos[snap.fecha];
  }

  /**
   * Costo unitario de un artículo vigente en una fecha: el de la carga más
   * cercana (la más nueva con fecha <= la buscada). Un costo vacío o en cero NO
   * es un costo: se sigue con las cargas anteriores y, si no, con las nuevas.
   */
  function costoDeArticulo(nombre, fechaIso) {
    const snaps = estado.costos;
    if (snaps.length === 0) return null;
    const k = clave(nombre);
    let desde = -1;
    snaps.forEach(function (s, i) { if (!fechaIso || s.fecha <= fechaIso) desde = i; });
    if (desde === -1) desde = snaps.length - 1;
    function costoEn(i) {
      const it = indiceDeSnapshot(snaps[i])[k];
      return it && it.costoUnitario > 0 ? it.costoUnitario : null;
    }
    for (let i = desde; i >= 0; i--) { const c = costoEn(i); if (c !== null) return c; }
    for (let i = desde + 1; i < snaps.length; i++) { const c = costoEn(i); if (c !== null) return c; }
    return null;
  }

  /** Costo de una línea vendida: el cargado a mano (si es manual) o el de las cargas de Excel. */
  function costoLinea(linea, fechaIso) {
    if (linea.esManual) return linea.costoManual > 0 ? linea.costoManual : null;
    return costoDeArticulo(nombreLista(linea), fechaIso);
  }

  /** % de ganancia OBJETIVO de un artículo (el que viene del Excel), no el logrado en la venta. */
  function pctEsperadoDeArticulo(articulo, fechaIso) {
    const snap = Store.obtenerSnapshotCostosMasCercano(fechaIso);
    if (!snap) return null;
    const it = indiceDeSnapshot(snap)[clave(articulo)];
    if (!it) return null;
    const pct = it.pctGananciaEsperadoUnitario;
    return pct === undefined || pct === null ? null : pct;
  }

  // -----------------------------------------------------------------------
  // KPIs
  // -----------------------------------------------------------------------
  function renderKPIs(lista) {
    $('#kpi-cantidad').textContent = String(lista.length);
    const totalVentas = lista.reduce(function (acc, p) { return acc + (p.total || 0); }, 0);
    $('#kpi-total').textContent = Quote.formatoMoneda(totalVentas);

    let ventaConCosto = 0;
    let costoTotal = 0;
    let montoSinCosto = 0;

    lista.forEach(function (p) {
      p.lineas.forEach(function (l) {
        const costo = costoLinea(l, p.fecha);
        if (costo === null) { montoSinCosto += l.importe; return; }
        ventaConCosto += l.importe;
        costoTotal += costo * l.cantidad;
      });
    });

    const ganancia = ventaConCosto - costoTotal;
    $('#kpi-ganancia').textContent = Quote.formatoMoneda(ganancia);
    $('#kpi-margen').textContent = ventaConCosto > 0 ? (Math.round((ganancia / ventaConCosto) * 1000) / 10) + '%' : '—';

    const nota = $('#ganancia-nota');
    if (estado.costos.length === 0) {
      nota.textContent = 'Todavía no hay historial de costos guardado: la ganancia se va a poder calcular a partir del próximo Excel mensual que subas (si tiene la hoja de costos).';
    } else if (montoSinCosto > 0) {
      nota.textContent = 'Ganancia calculada sobre ' + Quote.formatoMoneda(ventaConCosto) + ' en ventas con costo conocido. ' +
        Quote.formatoMoneda(montoSinCosto) + ' corresponden a artículos manuales o sin costo cargado para ese mes, y no se incluyen en el cálculo.';
    } else {
      nota.textContent = 'Ganancia calculada sobre el total de las ventas del período.';
    }
  }

  // -----------------------------------------------------------------------
  // Ventas por mes (respeta el filtro de cliente, ignora el de mes para
  // poder ver la evolución completa)
  // -----------------------------------------------------------------------
  function renderVentasPorMes() {
    const porCliente = estado.historial.filter(function (p) {
      return !estado.filtroCliente || p.cliente.nombre === estado.filtroCliente;
    });
    const porMes = {};
    porCliente.forEach(function (p) {
      const m = mesDeFecha(p.fecha);
      porMes[m] = (porMes[m] || 0) + (p.total || 0);
    });
    const meses = Object.keys(porMes).sort();

    crearOActualizarChart('chart-ventas-mes', {
      type: 'bar',
      data: {
        labels: meses.map(etiquetaMes),
        datasets: [{
          label: 'Ventas',
          data: meses.map(function (m) { return porMes[m]; }),
          backgroundColor: COLOR_TEAL,
          borderRadius: 4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: function (ctx) { return Quote.formatoMoneda(ctx.parsed.y); } } },
        },
        scales: {
          y: { ticks: { callback: function (v) { return Quote.formatoMoneda(v); } } },
        },
      },
    });
  }

  // -----------------------------------------------------------------------
  // Top artículos y ranking de clientes (sobre el filtrado actual)
  // -----------------------------------------------------------------------
  function renderTopArticulos(lista) {
    const porArticulo = {};
    lista.forEach(function (p) {
      p.lineas.forEach(function (l) {
        const k = nombreLista(l);
        if (!porArticulo[k]) porArticulo[k] = { cantidad: 0, total: 0 };
        porArticulo[k].cantidad += l.cantidad;
        porArticulo[k].total += l.importe;
      });
    });
    const filas = Object.keys(porArticulo)
      .map(function (a) { return Object.assign({ articulo: a }, porArticulo[a]); })
      .sort(function (a, b) { return b.total - a.total; })
      .slice(0, 10);

    crearOActualizarChart('chart-top-articulos', {
      type: 'bar',
      data: {
        labels: filas.map(function (f) { return f.articulo; }),
        datasets: [{
          label: 'Total vendido',
          data: filas.map(function (f) { return f.total; }),
          backgroundColor: COLOR_TEAL,
          borderRadius: 4,
        }],
      },
      options: {
        indexAxis: 'y', // barras horizontales: se leen mejor los nombres largos de producto
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: function (ctx) { return Quote.formatoMoneda(ctx.parsed.x); } } },
        },
        scales: {
          x: { ticks: { callback: function (v) { return Quote.formatoMoneda(v); } } },
        },
      },
    });

    const tbody = $('#tabla-top-articulos tbody');
    tbody.innerHTML = '';
    if (filas.length === 0) {
      tbody.appendChild(crearElemento('tr', {}, [crearElemento('td', { colspan: '3', class: 'vacio' }, ['Sin datos.'])]));
      return;
    }
    filas.forEach(function (f) {
      tbody.appendChild(crearElemento('tr', {}, [
        crearElemento('td', {}, [f.articulo]),
        crearElemento('td', {}, [String(f.cantidad)]),
        crearElemento('td', { class: 'col-precio' }, [Quote.formatoMoneda(f.total)]),
      ]));
    });
  }

  function renderRankingClientes(lista) {
    const porCliente = {};
    lista.forEach(function (p) {
      const nombre = p.cliente.nombre || '(sin nombre)';
      if (!porCliente[nombre]) porCliente[nombre] = { cantidad: 0, total: 0 };
      porCliente[nombre].cantidad += 1;
      porCliente[nombre].total += p.total || 0;
    });
    const filas = Object.keys(porCliente)
      .map(function (c) { return Object.assign({ cliente: c }, porCliente[c]); })
      .sort(function (a, b) { return b.total - a.total; });

    crearOActualizarChart('chart-ranking-clientes', {
      type: 'bar',
      data: {
        labels: filas.slice(0, 10).map(function (f) { return f.cliente; }),
        datasets: [{
          label: 'Total comprado',
          data: filas.slice(0, 10).map(function (f) { return f.total; }),
          backgroundColor: COLOR_TEAL,
          borderRadius: 4,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: function (ctx) { return Quote.formatoMoneda(ctx.parsed.x); } } },
        },
        scales: {
          x: { ticks: { callback: function (v) { return Quote.formatoMoneda(v); } } },
        },
      },
    });

    const tbody = $('#tabla-ranking-clientes tbody');
    tbody.innerHTML = '';
    if (filas.length === 0) {
      tbody.appendChild(crearElemento('tr', {}, [crearElemento('td', { colspan: '3', class: 'vacio' }, ['Sin datos.'])]));
      return;
    }
    filas.forEach(function (f) {
      tbody.appendChild(crearElemento('tr', {}, [
        crearElemento('td', {}, [f.cliente]),
        crearElemento('td', {}, [String(f.cantidad)]),
        crearElemento('td', { class: 'col-precio' }, [Quote.formatoMoneda(f.total)]),
      ]));
    });
  }

  // -----------------------------------------------------------------------
  // Ganancia por artículo
  // -----------------------------------------------------------------------
  function renderGananciaArticulos(lista) {
    const porArticulo = {};
    lista.forEach(function (p) {
      p.lineas.forEach(function (l) {
        const key = nombreLista(l);
        if (!porArticulo[key]) porArticulo[key] = { cantidad: 0, venta: 0, costo: 0, sinCosto: false };
        porArticulo[key].cantidad += l.cantidad;
        porArticulo[key].venta += l.importe;
        const costo = costoLinea(l, p.fecha);
        if (costo === null) { porArticulo[key].sinCosto = true; return; }
        porArticulo[key].costo += costo * l.cantidad;
      });
    });

    const filas = Object.keys(porArticulo)
      .map(function (a) { return Object.assign({ articulo: a }, porArticulo[a]); })
      .sort(function (a, b) { return b.venta - a.venta; });

    const tbody = $('#tabla-ganancia-articulos tbody');
    tbody.innerHTML = '';
    if (filas.length === 0) {
      tbody.appendChild(crearElemento('tr', {}, [crearElemento('td', { colspan: '6', class: 'vacio' }, ['Sin datos.'])]));
      return;
    }
    filas.forEach(function (f) {
      if (f.sinCosto && f.costo === 0) {
        tbody.appendChild(crearElemento('tr', {}, [
          crearElemento('td', {}, [f.articulo]),
          crearElemento('td', {}, [String(f.cantidad)]),
          crearElemento('td', { class: 'col-precio' }, [Quote.formatoMoneda(f.venta)]),
          crearElemento('td', {}, ['sin datos']),
          crearElemento('td', {}, ['—']),
          crearElemento('td', {}, ['—']),
        ]));
        return;
      }
      const ganancia = f.venta - f.costo;
      const margen = f.venta > 0 ? Math.round((ganancia / f.venta) * 1000) / 10 : 0;
      tbody.appendChild(crearElemento('tr', {}, [
        crearElemento('td', {}, [f.articulo]),
        crearElemento('td', {}, [String(f.cantidad)]),
        crearElemento('td', { class: 'col-precio' }, [Quote.formatoMoneda(f.venta)]),
        crearElemento('td', { class: 'col-precio' }, [Quote.formatoMoneda(f.costo)]),
        crearElemento('td', { class: 'col-precio' }, [Quote.formatoMoneda(ganancia)]),
        crearElemento('td', {}, [margen + '%']),
      ]));
    });
  }

  // -----------------------------------------------------------------------
  // Margen real vs. el % de ganancia esperado (el que viene del Excel)
  // -----------------------------------------------------------------------
  function renderMargenVsEsperado(lista) {
    const porArticulo = {};
    lista.forEach(function (p) {
      p.lineas.forEach(function (l) {
        if (l.esManual) return; // sin precio objetivo en la lista, no se puede comparar
        const costo = costoLinea(l, p.fecha);
        if (costo === null) return;
        const key = nombreLista(l);
        if (!porArticulo[key]) porArticulo[key] = { cantidad: 0, venta: 0, costo: 0 };
        porArticulo[key].cantidad += l.cantidad;
        porArticulo[key].venta += l.importe;
        porArticulo[key].costo += costo * l.cantidad;
      });
    });

    // El objetivo (% esperado) se compara contra el más reciente disponible
    // -- es la política de precios ACTUAL del negocio, no la que regía en
    // el momento de cada venta vieja.
    const hoyIso = new Date().toISOString();

    const filas = Object.keys(porArticulo)
      .map(function (a) {
        const f = porArticulo[a];
        const margenReal = f.venta > 0 ? ((f.venta - f.costo) / f.venta) * 100 : 0;
        const pctEsperadoCrudo = pctEsperadoDeArticulo(a, hoyIso);
        const margenEsperado = pctEsperadoCrudo === null ? null : pctEsperadoCrudo * 100;
        return {
          articulo: a,
          cantidad: f.cantidad,
          margenReal: margenReal,
          margenEsperado: margenEsperado,
          diferencia: margenEsperado === null ? null : margenReal - margenEsperado,
        };
      })
      .filter(function (f) { return f.margenEsperado !== null; })
      .sort(function (a, b) { return a.diferencia - b.diferencia; }); // peor primero

    const tbody = $('#tabla-margen-esperado tbody');
    tbody.innerHTML = '';
    if (filas.length === 0) {
      tbody.appendChild(crearElemento('tr', {}, [
        crearElemento('td', { colspan: '5', class: 'vacio' }, ['Sin datos (necesita el % de ganancia esperado cargado en el Excel).']),
      ]));
      return;
    }

    // Más de 1 punto porcentual por debajo del objetivo = alerta. Ese
    // margen de tolerancia evita marcar en rojo diferencias de centavos
    // por redondeo que no significan nada en la práctica.
    filas.forEach(function (f) {
      const bajoObjetivo = f.diferencia < -1;
      tbody.appendChild(crearElemento('tr', { class: bajoObjetivo ? 'fila-alerta' : '' }, [
        crearElemento('td', {}, [f.articulo]),
        crearElemento('td', {}, [String(f.cantidad)]),
        crearElemento('td', {}, [f.margenReal.toFixed(1) + '%']),
        crearElemento('td', {}, [f.margenEsperado.toFixed(1) + '%']),
        crearElemento('td', {}, [(f.diferencia >= 0 ? '+' : '') + f.diferencia.toFixed(1) + ' pts' + (bajoObjetivo ? ' ⚠' : '')]),
      ]));
    });
  }

  // -----------------------------------------------------------------------
  // Buscador de artículo: ventas (precio y costo) + historial de cada carga
  // -----------------------------------------------------------------------
  function formatoFechaCorta(iso) {
    return iso ? new Intl.DateTimeFormat('es-AR', { dateStyle: 'short' }).format(new Date(iso)) : '—';
  }

  function celda(texto, clase) {
    return crearElemento('td', clase ? { class: clase } : {}, [texto]);
  }

  function datoResumen(valor, etiqueta) {
    return crearElemento('div', { class: 'informe-dato' }, [crearElemento('strong', {}, [valor]), etiqueta]);
  }

  function renderArticulo(k) {
    const cont = $('#articulo-detalle');
    const info = estado.articulos[k];
    if (!info) { cont.style.display = 'none'; return; }
    cont.style.display = 'block';
    $('#articulo-titulo').textContent = info.nombre;

    // ---- Ventas: líneas de presupuestos de este artículo (por nombre de lista o por el nombre impreso) ----
    const ventas = [];
    estado.historial.forEach(function (p) {
      (p.lineas || []).forEach(function (l) {
        if (clave(nombreLista(l)) !== k && clave(l.articulo) !== k) return;
        ventas.push({ p: p, l: l, costo: costoLinea(l, p.fecha) });
      });
    });
    ventas.sort(function (a, b) { return a.p.fecha < b.p.fecha ? 1 : -1; });

    let unidades = 0, importe = 0, costoTotal = 0, importeConCosto = 0;
    ventas.forEach(function (v) {
      unidades += v.l.cantidad;
      importe += v.l.importe;
      if (v.costo !== null) { costoTotal += v.costo * v.l.cantidad; importeConCosto += v.l.importe; }
    });
    const resumen = $('#articulo-resumen');
    resumen.innerHTML = '';
    const ultima = ventas[0];
    resumen.appendChild(datoResumen(String(ventas.length), 'presupuestos con este artículo'));
    resumen.appendChild(datoResumen(String(unidades), 'unidades vendidas'));
    resumen.appendChild(datoResumen(unidades > 0 ? Quote.formatoMoneda(importe / unidades) : '—', 'precio promedio vendido (por unidad)'));
    resumen.appendChild(datoResumen(ultima ? Quote.formatoMoneda(ultima.l.precioUnitarioAplicado) : '—', 'último precio vendido' + (ultima ? ' (' + formatoFechaCorta(ultima.p.fecha) + ')' : '')));
    resumen.appendChild(datoResumen(ultima && ultima.costo !== null ? Quote.formatoMoneda(ultima.costo) : '—', 'costo en la última venta'));
    resumen.appendChild(datoResumen(importeConCosto > 0 ? (Math.round(((importeConCosto - costoTotal) / importeConCosto) * 1000) / 10) + '%' : '—', 'margen real de lo vendido'));

    const tb = $('#tabla-articulo-ventas tbody');
    tb.innerHTML = '';
    if (ventas.length === 0) {
      tb.appendChild(crearElemento('tr', {}, [crearElemento('td', { colspan: '9', class: 'vacio' }, ['Este artículo no se vendió en ningún presupuesto (todavía).'])]));
    }
    ventas.forEach(function (v) {
      const l = v.l;
      const tipo = l.tipoPrecio === 'pack' ? ' (pack)' : l.tipoPrecio === 'manual' ? ' (manual)' : '';
      const ganancia = v.costo !== null ? l.importe - v.costo * l.cantidad : null;
      const margen = ganancia !== null && l.importe > 0 ? (Math.round((ganancia / l.importe) * 1000) / 10) + '%' : '—';
      tb.appendChild(crearElemento('tr', {}, [
        celda(formatoFechaCorta(v.p.fecha)),
        celda(v.p.numero),
        celda((v.p.cliente && v.p.cliente.nombre) || '—'),
        celda(String(l.cantidad)),
        celda(Quote.formatoMoneda(l.precioUnitarioAplicado) + tipo, 'col-precio'),
        celda(Quote.formatoMoneda(l.importe), 'col-precio'),
        celda(v.costo !== null ? Quote.formatoMoneda(v.costo) : 'sin costo', 'col-precio'),
        celda(ganancia !== null ? Quote.formatoMoneda(ganancia) : '—', 'col-precio'),
        celda(margen),
      ]));
    });

    // ---- Historial: lista y costo en cada carga de Excel ----
    const filas = [];
    estado.costos.forEach(function (snap) {
      const it = indiceDeSnapshot(snap)[k];
      if (!it) return;
      filas.push({ fecha: snap.fecha, unit: it.precioUnitario, pack: it.precioPack, costo: it.costoUnitario > 0 ? it.costoUnitario : null });
    });
    const tbe = $('#tabla-evolucion tbody');
    tbe.innerHTML = '';
    if (filas.length === 0) {
      tbe.appendChild(crearElemento('tr', {}, [crearElemento('td', { colspan: '5', class: 'vacio' }, ['Este artículo no figura en ninguna carga de Excel guardada.'])]));
    }
    filas.forEach(function (f) {
      const margen = f.costo !== null && f.unit > 0 ? (Math.round(((f.unit - f.costo) / f.unit) * 1000) / 10) + '%' : '—';
      tbe.appendChild(crearElemento('tr', {}, [
        celda(formatoFechaCorta(f.fecha)),
        celda(f.unit > 0 ? Quote.formatoMoneda(f.unit) : '—', 'col-precio'),
        celda(f.pack > 0 ? Quote.formatoMoneda(f.pack) : '—', 'col-precio'),
        celda(f.costo !== null ? Quote.formatoMoneda(f.costo) : '—', 'col-precio'),
        celda(margen),
      ]));
    });

    crearOActualizarChart('chart-evolucion', {
      type: 'line',
      data: {
        labels: filas.map(function (f) { return formatoFechaCorta(f.fecha); }),
        datasets: [
          { label: 'Precio unidad (lista)', data: filas.map(function (f) { return f.unit > 0 ? f.unit : null; }), borderColor: COLOR_TEAL, backgroundColor: COLOR_TEAL, tension: 0.2, spanGaps: true },
          { label: 'Costo unitario', data: filas.map(function (f) { return f.costo; }), borderColor: COLOR_ROJO, backgroundColor: COLOR_ROJO, tension: 0.2, spanGaps: true },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          tooltip: { callbacks: { label: function (ctx) { return ctx.dataset.label + ': ' + (ctx.parsed.y !== null ? Quote.formatoMoneda(ctx.parsed.y) : '—'); } } },
        },
        scales: { y: { ticks: { callback: function (v) { return Quote.formatoMoneda(v); } } } },
      },
    });
  }

  function initBuscadorArticulo() {
    const input = $('#buscar-articulo');
    const lista = $('#resultados-articulo');

    function elegir(k) {
      lista.classList.remove('visible');
      input.value = estado.articulos[k].nombre;
      renderArticulo(k);
    }

    function actualizar() {
      const q = clave(input.value);
      lista.innerHTML = '';
      if (!q) { lista.classList.remove('visible'); return; }
      const palabras = q.split(' ');
      const coincidencias = Object.keys(estado.articulos)
        .filter(function (k) { return palabras.every(function (w) { return k.indexOf(w) !== -1; }); })
        .sort(function (a, b) {
          // Los que empiezan igual primero; después por nombre.
          const pa = a.indexOf(q) === 0 ? 0 : 1;
          const pb = b.indexOf(q) === 0 ? 0 : 1;
          return pa !== pb ? pa - pb : a.localeCompare(b, 'es');
        })
        .slice(0, 30);
      if (coincidencias.length === 0) {
        lista.appendChild(crearElemento('li', { class: 'resultado-vacio' }, ['Ningún artículo coincide.']));
      }
      coincidencias.forEach(function (k) {
        const a = estado.articulos[k];
        const etiqueta = a.manual ? 'manual' : (!a.enLista ? 'fuera de la lista actual' : '');
        lista.appendChild(crearElemento('li', {
          class: 'resultado-item', tabindex: '0',
          onclick: function () { elegir(k); },
          onkeydown: function (e) { if (e.key === 'Enter') elegir(k); },
        }, [
          crearElemento('span', { class: 'resultado-nombre' }, [a.nombre]),
          crearElemento('span', { class: 'resultado-precio' }, [etiqueta]),
        ]));
      });
      lista.classList.add('visible');
    }

    input.addEventListener('input', actualizar);
    input.addEventListener('focus', actualizar);
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.buscador-wrap')) lista.classList.remove('visible');
    });
  }

  // -----------------------------------------------------------------------
  // Revisar: vendidos que no se pueden cruzar con la lista o con un costo
  // -----------------------------------------------------------------------
  function similitud(a, b) {
    const ta = {}; clave(a).split(' ').forEach(function (w) { ta[w] = true; });
    const tb = {}; clave(b).split(' ').forEach(function (w) { tb[w] = true; });
    let comunes = 0;
    Object.keys(ta).forEach(function (w) { if (tb[w]) comunes++; });
    const union = Object.keys(ta).length + Object.keys(tb).length - comunes;
    return union > 0 ? comunes / union : 0;
  }

  function renderRevisar() {
    const porArticulo = {};
    estado.historial.forEach(function (p) {
      (p.lineas || []).forEach(function (l) {
        const k = clave(nombreLista(l));
        if (!porArticulo[k]) porArticulo[k] = { nombre: nombreLista(l), cantidad: 0, venta: 0, manual: !!l.esManual, conCosto: false };
        porArticulo[k].cantidad += l.cantidad;
        porArticulo[k].venta += l.importe;
        if (costoLinea(l, p.fecha) !== null) porArticulo[k].conCosto = true;
      });
    });
    const itemsLista = (estado.lista && estado.lista.items) || [];
    const claveLista = {};
    itemsLista.forEach(function (it) { claveLista[clave(it.articulo)] = it; });

    const filas = [];
    Object.keys(porArticulo).forEach(function (k) {
      const a = porArticulo[k];
      if (a.manual) {
        if (!a.conCosto) filas.push({ a: a, motivo: 'Cargado a mano, sin costo', sugerencia: null });
        return;
      }
      if (!claveLista[k]) {
        let mejor = null, puntaje = 0;
        itemsLista.forEach(function (it) {
          const sc = similitud(a.nombre, it.articulo);
          if (sc > puntaje) { puntaje = sc; mejor = it.articulo; }
        });
        filas.push({ a: a, motivo: 'No está en la lista vigente', sugerencia: puntaje >= 0.6 ? mejor : null });
        return;
      }
      if (!a.conCosto) filas.push({ a: a, motivo: 'Está en la lista pero sin costo en ninguna carga', sugerencia: null });
    });
    filas.sort(function (x, y) { return y.a.venta - x.a.venta; });

    $('#revisar-ayuda').textContent = filas.length === 0
      ? 'Todo lo vendido se pudo cruzar con la lista y con un costo.'
      : filas.length + ' artículo(s) vendidos no se pueden cruzar del todo. Si cambiaron de nombre en el Excel, la sugerencia te dice con cuál podrían corresponder; ' +
        'los precios y costos de estos artículos no entran en el cálculo de ganancia.';
    const tbody = $('#tabla-revisar tbody');
    tbody.innerHTML = '';
    if (filas.length === 0) {
      tbody.appendChild(crearElemento('tr', {}, [crearElemento('td', { colspan: '5', class: 'vacio' }, ['Nada para revisar.'])]));
      return;
    }
    filas.forEach(function (f) {
      tbody.appendChild(crearElemento('tr', {}, [
        celda(f.a.nombre), celda(f.motivo), celda(String(f.a.cantidad)),
        celda(Quote.formatoMoneda(f.a.venta), 'col-precio'), celda(f.sugerencia || '—'),
      ]));
    });
  }

  // -----------------------------------------------------------------------
  // Render general y wiring de filtros
  // -----------------------------------------------------------------------
  function renderTodo() {
    const lista = historialFiltrado();
    renderKPIs(lista);
    renderVentasPorMes();
    renderTopArticulos(lista);
    renderRankingClientes(lista);
    renderGananciaArticulos(lista);
    renderMargenVsEsperado(lista);
    renderRevisar();
  }

  function iniciar() {
    cargarDatos();
    poblarFiltros();
    renderTodo();

    $('#filtro-mes').addEventListener('change', function (e) {
      estado.filtroMes = e.target.value;
      renderTodo();
    });
    $('#filtro-cliente').addEventListener('change', function (e) {
      estado.filtroCliente = e.target.value;
      renderTodo();
    });
    initBuscadorArticulo();
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (window.Auth && window.Store && typeof Store.inicializar === 'function') {
      window.Auth.onReady(function () {
        Store.inicializar().then(iniciar);
      });
    } else {
      iniciar();
    }
  });
})();
