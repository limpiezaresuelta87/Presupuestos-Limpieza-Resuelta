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
  };

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
    if (typeof window.Chart === 'undefined') return null; // sin internet la primera vez, no rompe el resto del informe
    const canvas = $('#' + idCanvas);
    if (!canvas) return null;
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

    // Artículos con historial de costos, para el selector de evolución.
    const articulos = new Set();
    estado.costos.forEach(function (snap) { snap.items.forEach(function (it) { articulos.add(it.articulo); }); });
    const selectArticulo = $('#filtro-articulo-evolucion');
    selectArticulo.innerHTML = '<option value="">— Seleccionar —</option>';
    Array.from(articulos).sort(function (a, b) { return a.localeCompare(b, 'es'); }).forEach(function (a) {
      selectArticulo.appendChild(crearElemento('option', { value: a }, [a]));
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
  // Costos: índice por artículo para el snapshot más cercano a una fecha
  // -----------------------------------------------------------------------
  const cacheIndiceCostos = {};
  function indiceDeSnapshot(fechaIso) {
    const snap = Store.obtenerSnapshotCostosMasCercano(fechaIso);
    if (!snap) return null;
    const clave = snap.fecha;
    if (!cacheIndiceCostos[clave]) {
      const idx = {};
      snap.items.forEach(function (it) { idx[it.articulo] = it; });
      cacheIndiceCostos[clave] = idx;
    }
    return cacheIndiceCostos[clave];
  }

  function costoDeArticulo(articulo, fechaIso) {
    const idx = indiceDeSnapshot(fechaIso);
    if (!idx || !idx[articulo]) return null;
    const costo = idx[articulo].costoUnitario;
    return costo === undefined || costo === null ? null : costo;
  }

  /** % de ganancia OBJETIVO de un artículo (el que viene del Excel), no el logrado en la venta. */
  function pctEsperadoDeArticulo(articulo, fechaIso) {
    const idx = indiceDeSnapshot(fechaIso);
    if (!idx || !idx[articulo]) return null;
    const pct = idx[articulo].pctGananciaEsperadoUnitario;
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
        if (l.esManual) { montoSinCosto += l.importe; return; }
        const costo = costoDeArticulo(l.articulo, p.fecha);
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
        if (!porArticulo[l.articulo]) porArticulo[l.articulo] = { cantidad: 0, total: 0 };
        porArticulo[l.articulo].cantidad += l.cantidad;
        porArticulo[l.articulo].total += l.importe;
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
        const key = l.articulo;
        if (!porArticulo[key]) porArticulo[key] = { cantidad: 0, venta: 0, costo: 0, sinCosto: false };
        porArticulo[key].cantidad += l.cantidad;
        porArticulo[key].venta += l.importe;
        if (l.esManual) { porArticulo[key].sinCosto = true; return; }
        const costo = costoDeArticulo(l.articulo, p.fecha);
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
        if (l.esManual) return; // sin costo asociado, no se puede comparar
        const costo = costoDeArticulo(l.articulo, p.fecha);
        if (costo === null) return;
        const key = l.articulo;
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
  // Evolución de costo/precio de un artículo elegido
  // -----------------------------------------------------------------------
  function renderEvolucion(articulo) {
    const tbody = $('#tabla-evolucion tbody');
    tbody.innerHTML = '';
    if (!articulo) {
      crearOActualizarChart('chart-evolucion', { type: 'line', data: { labels: [], datasets: [] } });
      return;
    }

    // Precio de venta promedio por mes: sale del historial de presupuestos
    // real (precio efectivamente aplicado), no de la lista vigente -- así
    // refleja lo que pasó cada mes, no el precio de hoy.
    const ventaPorMes = {};
    estado.historial.forEach(function (p) {
      const m = mesDeFecha(p.fecha);
      p.lineas.forEach(function (l) {
        if (l.articulo !== articulo) return;
        if (!ventaPorMes[m]) ventaPorMes[m] = { sumaPrecio: 0, n: 0 };
        ventaPorMes[m].sumaPrecio += l.precioUnitarioAplicado;
        ventaPorMes[m].n += 1;
      });
    });

    const meses = Array.from(new Set(
      estado.costos.map(function (s) { return s.mes; }).concat(Object.keys(ventaPorMes))
    )).sort();

    if (meses.length === 0) {
      tbody.appendChild(crearElemento('tr', {}, [crearElemento('td', { colspan: '4', class: 'vacio' }, ['Sin datos para este artículo.'])]));
      crearOActualizarChart('chart-evolucion', { type: 'line', data: { labels: [], datasets: [] } });
      return;
    }

    const costosPorMes = [];
    const preciosPorMes = [];

    meses.forEach(function (m) {
      const snap = estado.costos.find(function (s) { return s.mes === m; });
      const itemCosto = snap && snap.items.find(function (it) { return it.articulo === articulo; });
      const costo = itemCosto ? itemCosto.costoUnitario : null;
      const ventaInfo = ventaPorMes[m];
      const precioProm = ventaInfo ? ventaInfo.sumaPrecio / ventaInfo.n : null;
      const margen = (costo !== null && precioProm !== null && precioProm > 0)
        ? Math.round(((precioProm - costo) / precioProm) * 1000) / 10 + '%'
        : '—';
      costosPorMes.push(costo);
      preciosPorMes.push(precioProm);
      tbody.appendChild(crearElemento('tr', {}, [
        crearElemento('td', {}, [etiquetaMes(m)]),
        crearElemento('td', {}, [costo !== null ? Quote.formatoMoneda(costo) : '—']),
        crearElemento('td', {}, [precioProm !== null ? Quote.formatoMoneda(precioProm) : '—']),
        crearElemento('td', {}, [margen]),
      ]));
    });

    crearOActualizarChart('chart-evolucion', {
      type: 'line',
      data: {
        labels: meses.map(etiquetaMes),
        datasets: [
          { label: 'Precio de venta promedio', data: preciosPorMes, borderColor: COLOR_TEAL, backgroundColor: COLOR_TEAL, tension: 0.2, spanGaps: true },
          { label: 'Costo unitario', data: costosPorMes, borderColor: COLOR_ROJO, backgroundColor: COLOR_ROJO, tension: 0.2, spanGaps: true },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          tooltip: { callbacks: { label: function (ctx) { return ctx.dataset.label + ': ' + (ctx.parsed.y !== null ? Quote.formatoMoneda(ctx.parsed.y) : '—'); } } },
        },
        scales: {
          y: { ticks: { callback: function (v) { return Quote.formatoMoneda(v); } } },
        },
      },
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
    $('#filtro-articulo-evolucion').addEventListener('change', function (e) {
      renderEvolucion(e.target.value);
    });
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
