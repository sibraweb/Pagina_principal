/* ───────────────────────────────────────────────────────────────
   PANTALLA — estado, render y eventos.
   Los numeros NO se calculan aca: se los pide al Motor. Por eso la
   planilla, la barra de totales y el Excel exportado no pueden dar
   distinto: los tres leen el mismo resultado.
   ─────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var M = window.Motor, I = window.Importar, D = window.Datos;
  var CLAVE = 'presupuestapp_v2';
  var COLORES = ['#E10600', '#1a7a3a', '#0066cc', '#e67e00', '#7b36ff', '#c13584', '#0099aa', '#8e97a8'];

  var estado = {
    obra: { nombre: '', cliente: '', ubicacion: '', fecha: '' },
    items: [],
    overrides: [],
    params: { ggPct: 12, beneficioPct: 10, iibbPct: 0, financiacionPct: 0, modoK: 'aditivo', ivaPct: 21 },
    verPrecioVenta: false
  };
  var proximoId = 1;
  var ultimoCalculo = null;
  var paginaInsumos = 0;
  var mapeoPendiente = null;
  var ultimaBusqueda = {};    // codigo -> fila, para agregar sin volver a preguntar
  var PUNTO = '<span class="text-muted">·</span>';

  /* ── helpers ──────────────────────────────────────────────── */
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmt(n) { return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 }).format(n || 0); }
  function fmtCorto(n) {
    n = n || 0;
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + (n / 1e3).toFixed(2) + 'k';
    return fmt(n);
  }
  /* Todo a DOS decimales, con su símbolo: la plata con $, los
     porcentajes con %. Un solo criterio en toda la pantalla. */
  function num(n) {
    return new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
  }
  function pct(n) { return num(n) + '%'; }
  /* El RENDIMIENTO va con cuatro decimales: es un coeficiente, y con dos
     los chicos se pierden — 0,0055 m3 de arena por m2 se vería "0,01" y
     0,0008 desaparecería en "0,00". Todo lo demás (plata, porcentajes y
     cantidades de obra) va con dos. */
  function rend(n) {
    return new Intl.NumberFormat('es-AR', { minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(n || 0);
  }

  function color(i) { return COLORES[i % COLORES.length]; }
  function tagCategoria(cat) {
    var c = cat === 'Mano de obra' ? 'mo' : cat === 'Equipos' ? 'eq' : 'mat';
    var t = cat === 'Mano de obra' ? 'M. obra' : cat === 'Equipos' ? 'Equipo' : 'Material';
    return '<span class="tag ' + c + '">' + t + '</span>';
  }
  function tagOrigen(origen) {
    if (origen === 'propio') return '<span class="tag propio" title="Precio tuyo">tuyo</span>';
    if (origen === 'sin-precio') return '<span class="tag sin-precio" title="No hay precio para este insumo">sin precio</span>';
    return '';
  }
  function toast(msg, tipo) {
    var d = document.createElement('div');
    d.className = 'toast-msg ' + (tipo || '');
    d.textContent = msg;
    $('toast-zona').appendChild(d);
    setTimeout(function () { d.style.opacity = '0'; d.style.transition = 'opacity .3s'; setTimeout(function () { d.remove(); }, 320); }, 3600);
  }
  function abrir(id) { $(id).classList.add('open'); }
  function cerrar(id) { $(id).classList.remove('open'); }

  /* ── persistencia ─────────────────────────────────────────── */
  function guardar() {
    try { localStorage.setItem(CLAVE, JSON.stringify(estado)); } catch (e) { /* modo incognito */ }
  }
  function recuperar() {
    try {
      var s = JSON.parse(localStorage.getItem(CLAVE) || 'null');
      if (!s) return false;
      estado = Object.assign(estado, s);
      estado.params = Object.assign({ ggPct: 12, beneficioPct: 10, iibbPct: 0, financiacionPct: 0, modoK: 'aditivo', ivaPct: 21 }, s.params || {});
      estado.items = (s.items || []).map(function (it) { return Object.assign({}, it, { id: it.id !== undefined ? it.id : proximoId++ }); });
      estado.items.forEach(function (it) { if (it.id >= proximoId) proximoId = it.id + 1; });
      return !!(estado.items.length || estado.overrides.length);
    } catch (e) { return false; }
  }

  /* ── calculo central ──────────────────────────────────────────
     UN SOLO resultado manda. Cuando el catalogo no baja al navegador
     el calculo lo hace el servidor, asi que pedirlo es asincrono: se
     pide una vez en `recalcular()` y TODAS las pantallas leen lo que
     quedo en `ultimoCalculo`. Ningun render vuelve a calcular por su
     cuenta; si lo hiciera, la planilla y el Excel podrian mostrar dos
     numeros distintos sin que nadie se entere.                      */
  var VACIO = {
    items: [], rubros: [], insumos: [], costo: 0, k: 1, modoK: 'aditivo',
    aperturaK: [], recargo: 0, precioSinIva: 0, ivaPct: 21, iva: 0, total: 0,
    incidencia: { materiales: 0, manoObra: 0, equipos: 0 }
  };
  function catalogo() { return D.catalogoLocal() || { insumos: [], analisis: [] }; }
  function calcular() { return ultimoCalculo || VACIO; }
  function remoto() { return D.modo() === 'remoto'; }

  var calculando = null;
  function recalcular() {
    var pedido = D.cotizar(estado.items, estado.overrides, estado.params)
      .then(function (r) {
        if (calculando !== pedido) return calcular();   // llego uno mas nuevo
        ultimoCalculo = r;
        return r;
      })
      .catch(function (e) {
        toast('No se pudo calcular: ' + e.message, 'error');
        return calcular();
      });
    calculando = pedido;
    return pedido;
  }

  /* Un respiro antes de salir a preguntar. Sin esto, escribir "1250" en
     una cantidad dispara cuatro cotizaciones al servidor y la ultima en
     llegar no es necesariamente la ultima que se pidio.              */
  function conRespiro(fn, ms) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms || 350);
    };
  }

  /* ══════════════════ CÓMPUTO ══════════════════ */
  function renderComputo() {
    var c = calcular();   // lee; no recalcula (ver "calculo central")
    $('computo-count').textContent = c.items.length + (c.items.length === 1 ? ' renglón' : ' renglones');
    var cont = $('computo-grilla');
    if (!c.items.length) {
      cont.innerHTML = '<div class="empty-state">Subí tu cómputo o agregá tareas del catálogo</div>';
      return;
    }
    var sinAnalisis = c.items.filter(function (f) { return f.sinAnalisis; }).length;
    var aviso = sinAnalisis
      ? '<div class="aviso-fila"><div class="aviso-marca"></div><div><strong>' + sinAnalisis + ' renglón(es) sin análisis en el catálogo.</strong> ' +
        'Quedan con el precio que les pongas a mano; si el código está mal escrito, corregilo y el precio vuelve solo.</div></div>'
      : '';

    var filas = c.items.map(function (f) {
      return '<tr data-id="' + f.id + '">' +
        '<td class="cod">' + esc(f.code) + (f.sinAnalisis ? ' <span class="tag sin-precio">?</span>' : '') + '</td>' +
        '<td>' + esc(f.desc || '—') + (f.sector ? '' : '') + '</td>' +
        '<td class="col-hide">' + esc(f.unit) + '</td>' +
        '<td class="col-hide"><input class="sector" data-campo="sector" value="' + esc(f.sector) + '" placeholder="—"></td>' +
        '<td class="der"><input class="cant" type="number" step="any" data-campo="qty" value="' + f.qty + '"></td>' +
        '<td class="der">' + (f.sinAnalisis
          ? '<input class="precio" type="number" step="any" data-campo="precioManual" value="' + (f.precioUnitario || '') + '">'
          : num(f.precioUnitario) + (f.precioManual ? ' <span class="tag manual">a mano</span>' : '')) + '</td>' +
        '<td class="der"><strong>' + num(f.costoTotal) + '</strong></td>' +
        '<td class="der" style="white-space:nowrap">' +
          (f.sinAnalisis ? '' : '<button class="icon-btn" data-ver="' + esc(f.code) + '" title="Ver el análisis unitario">ver</button>') +
          '<button class="icon-btn peligro" data-borrar="' + f.id + '" title="Quitar del cómputo">✕</button>' +
        '</td></tr>';
    }).join('');

    cont.innerHTML = aviso +
      '<div class="tabla-scroll"><table class="grilla"><thead><tr>' +
      '<th>Código</th><th>Descripción</th><th class="col-hide">Un.</th><th class="col-hide">Sector</th>' +
      '<th class="der">Cantidad</th><th class="der">P. unitario</th><th class="der">Costo</th><th></th>' +
      '</tr></thead><tbody>' + filas + '</tbody>' +
      '<tfoot><tr><td colspan="6" class="der"><strong>COSTO DE OBRA</strong></td>' +
      '<td class="der"><strong>' + num(c.costo) + '</strong></td><td></td></tr></tfoot></table></div>';
  }

  /* ══════════════════ PRESUPUESTO ══════════════════ */
  function renderPresupuesto() {
    var c = calcular();

    // K
    var k = M.calcularK(estado.params);
    $('k-valor').textContent = num(k.k);
    $('k-formula').textContent = k.modo === 'cascada'
      ? '= ' + k.componentes.filter(function (x) { return x.pct; }).map(function (x) { return '(1+' + pct(x.pct) + ')'; }).join(' × ') || ''
      : '= 1 + ' + k.componentes.filter(function (x) { return x.pct; }).map(function (x) { return pct(x.pct); }).join(' + ');
    $('rg-k-label').textContent = 'K ' + num(k.k);
    $('rg-iva-label').textContent = pct(estado.params.ivaPct);
    $('rg-costo').textContent = fmt(c.costo);
    $('rg-recargo').textContent = fmt(c.recargo);
    $('rg-sin-iva').textContent = fmt(c.precioSinIva);
    $('rg-iva').textContent = fmt(c.iva);
    $('rg-total').textContent = fmt(c.total);

    // rubros
    var cont = $('rubro-lista');
    if (!c.rubros.length) {
      cont.innerHTML = '<div class="empty-state" style="padding:20px 0">Sin ítems aún</div>';
      $('rubro-total-fila').style.display = 'none';
    } else {
      cont.innerHTML = c.rubros.map(function (r, i) {
        return '<div class="rubro-fila">' +
          '<div class="rubro-nombre"><span class="rubro-punto" style="background:' + color(i) + '"></span>' + esc(r.rubro) + '</div>' +
          '<div class="rubro-monto">' + fmtCorto(r.costo) + ' <span class="text-muted">' + pct(r.pct) + '</span></div>' +
          '<div class="rubro-barra"><span style="width:' + r.pct.toFixed(2) + '%;background:' + color(i) + '"></span></div>' +
          '</div>';
      }).join('');
      $('rubro-total-fila').style.display = 'flex';
      $('rubro-total').textContent = fmt(c.costo);
    }

    // incidencia
    var inc = c.incidencia, tot = inc.materiales + inc.manoObra + inc.equipos;
    if (tot > 0) {
      var p = function (v) { return (v / tot * 100); };
      $('incidencia-barra').innerHTML =
        '<div class="i-mat" style="width:' + p(inc.materiales).toFixed(2) + '%">' + (p(inc.materiales) > 8 ? 'Materiales ' + pct(p(inc.materiales)) : '') + '</div>' +
        '<div class="i-mo" style="width:' + p(inc.manoObra).toFixed(2) + '%">' + (p(inc.manoObra) > 8 ? 'Mano de obra ' + pct(p(inc.manoObra)) : '') + '</div>' +
        '<div class="i-eq" style="width:' + p(inc.equipos).toFixed(2) + '%">' + (p(inc.equipos) > 8 ? 'Equipos ' + pct(p(inc.equipos)) : '') + '</div>';
      $('inc-mat').textContent = fmtCorto(inc.materiales) + ' (' + pct(p(inc.materiales)) + ')';
      $('inc-mo').textContent = fmtCorto(inc.manoObra) + ' (' + pct(p(inc.manoObra)) + ')';
      $('inc-eq').textContent = fmtCorto(inc.equipos) + ' (' + pct(p(inc.equipos)) + ')';
    } else {
      $('incidencia-barra').innerHTML = '<div style="width:100%;color:#8e97a8;font-weight:400">sin datos</div>';
      $('inc-mat').textContent = $('inc-mo').textContent = $('inc-eq').textContent = '—';
    }

    // planilla
    var tabla = $('presupuesto-tabla');
    if (!c.items.length) {
      tabla.innerHTML = '<div class="empty-state">Sin ítems</div>';
      return;
    }
    var verVenta = estado.verPrecioVenta, kk = c.k;
    var html = '<div class="tabla-scroll"><table class="grilla"><thead><tr>' +
      '<th>Código</th><th>Descripción</th><th class="col-hide">Un.</th><th class="der">Cantidad</th>' +
      '<th class="der">' + (verVenta ? 'P. venta' : 'P. costo') + '</th><th class="der">Total</th>' +
      '</tr></thead><tbody>';
    c.rubros.forEach(function (r, i) {
      html += '<tr class="fila-rubro" style="--rubro:' + color(i) + '"><td colspan="5">' + esc(r.rubro) + '</td>' +
        '<td class="der">' + num(verVenta ? r.costo * kk : r.costo) + '</td></tr>';
      r.items.forEach(function (f) {
        html += '<tr><td class="cod">' + esc(f.code) + '</td><td>' + esc(f.desc || '—') +
          (f.sector ? ' <span class="text-muted">· ' + esc(f.sector) + '</span>' : '') + '</td>' +
          '<td class="col-hide">' + esc(f.unit) + '</td>' +
          '<td class="der">' + num(f.qty) + '</td>' +
          '<td class="der">' + num(verVenta ? f.precioUnitario * kk : f.precioUnitario) + '</td>' +
          '<td class="der">' + num(verVenta ? f.costoTotal * kk : f.costoTotal) + '</td></tr>';
      });
    });
    html += '</tbody><tfoot><tr><td colspan="5" class="der"><strong>' + (verVenta ? 'PRECIO SIN IVA' : 'COSTO DE OBRA') + '</strong></td>' +
      '<td class="der"><strong>' + num(verVenta ? c.precioSinIva : c.costo) + '</strong></td></tr></tfoot></table></div>';
    tabla.innerHTML = html;
  }

  /* ══════════════════ PRECIOS ══════════════════ */
  /* Las filas de la pestaña Precios. Un precio SIBRATECH en null -los
     insumos de la obra en remoto, que no traen el nuestro- se ve como un
     punto: se busca por nombre y aparece. */
  function pintarFilasInsumos(lista, encabezado) {
    var filas = lista.map(function (i) {
      // el precio propio esta en el estado: no hace falta el catalogo
      var mio = estado.overrides.filter(function (o) { return o.code === i.code; })[0];
      var p = { origen: mio ? 'propio' : (i.price > 0 ? 'catalogo' : (i.price === null ? '' : 'sin-precio')),
                precio: mio ? mio.price : i.price };
      return '<tr data-insumo="' + esc(i.code) + '">' +
        '<td class="cod">' + esc(i.code) + '</td>' +
        '<td>' + esc(i.desc) + '</td>' +
        '<td class="col-hide">' + tagCategoria(M.normalizarCategoria(i.category)) + '</td>' +
        '<td class="col-hide">' + esc(i.unit) + '</td>' +
        '<td class="der text-muted">' + (i.price === null || i.price === undefined ? PUNTO : num(i.price)) + '</td>' +
        '<td class="der"><input class="precio" type="number" step="any" data-precio-propio="' + esc(i.code) + '" ' +
          'value="' + (p.origen === 'propio' ? p.precio : '') + '" placeholder="—"></td>' +
        '<td>' + tagOrigen(p.origen) + '</td></tr>';
    }).join('');
    $('insumo-lista').innerHTML = (encabezado || '') + '<div class="tabla-scroll"><table class="grilla"><thead><tr>' +
      '<th>Código</th><th>Insumo</th><th class="col-hide">Tipo</th><th class="col-hide">Un.</th>' +
      '<th class="der">Precio SIBRATECH</th><th class="der">Mi precio</th><th></th>' +
      '</tr></thead><tbody>' + filas + '</tbody></table></div>';
  }

  function renderInsumos() {
    var q = $('buscar-insumo').value.trim();
    var cat = $('filtro-categoria').value;
    /* Con el buscador vacio NO se muestra "0 insumos": eso parece que la
       base no esta, y esta. Lo que pasa es que la base no se lista entera
       -es el candado, hacen falta 3 letras-. Mientras tanto se muestran
       los insumos de TU obra, que es justo donde vas a poner tus precios. */
    if (q.length < 3) {
      var deLaObra = insumosDeLaObra(cat).map(function (r) {
        return { code: r.code, desc: r.desc, unit: r.unit, category: r.category,
                 price: remoto() ? null : r.unitPrice };
      });
      var ayuda = '<div class="aviso-fila"><div class="aviso-marca"></div><div>' +
        '<strong>La base de SIBRATECH está en línea.</strong> Escribí al menos 3 letras ' +
        '(“cem”, “are”, “ofi”) para buscar cualquier insumo con su precio.' +
        (deLaObra.length ? ' Abajo, los ' + deLaObra.length + ' insumos que usa tu obra: ' +
          'cargá tu precio donde lo tengas más barato.' : '') + '</div></div>';
      $('insumo-count').textContent = deLaObra.length ? deLaObra.length + ' de tu obra' : 'escribí para buscar';
      $('insumo-mas').textContent = '';
      if (!deLaObra.length) { $('insumo-lista').innerHTML = ayuda; return; }
      pintarFilasInsumos(deLaObra, ayuda);
      $('override-count').textContent = estado.overrides.length + (estado.overrides.length === 1 ? ' precio propio' : ' precios propios');
      return;
    }
    D.buscarInsumos(q, cat, paginaInsumos * D.TOPE).then(function (res) {
      $('insumo-count').textContent = res.total + (res.total === 1 ? ' insumo' : ' insumos');
      if (!res.filas.length) {
        $('insumo-lista').innerHTML = '<div class="empty-state">Nada con “' + esc(q) + '” en la base</div>';
        $('insumo-mas').textContent = '';
        return;
      }
      pintarFilasInsumos(res.filas, '');

      var desde = res.offset + 1, hasta = Math.min(res.offset + res.tope, res.total);
      $('insumo-mas').innerHTML = res.total > res.tope
        ? '<button class="btn btn-secondary" id="pag-ant" ' + (paginaInsumos ? '' : 'disabled') + '>← anteriores</button> ' +
          '<span style="margin:0 12px">' + desde + '–' + hasta + ' de ' + res.total + '</span>' +
          '<button class="btn btn-secondary" id="pag-sig" ' + (hasta >= res.total ? 'disabled' : '') + '>siguientes →</button>'
        : '';
      if ($('pag-ant')) $('pag-ant').onclick = function () { paginaInsumos--; renderInsumos(); };
      if ($('pag-sig')) $('pag-sig').onclick = function () { paginaInsumos++; renderInsumos(); };
    }).catch(function (e) {
      /* Sin esto, una busqueda que falla se ve igual que una que no
         encontro nada: "0 insumos" y a otra cosa. Asi paso inadvertido
         que la funcion habia cambiado de parametro. */
      $('insumo-lista').innerHTML = '<div class="empty-state">No se pudo consultar el catálogo.<br>' +
        '<span class="text-muted">' + esc(e.message) + '</span></div>';
      $('insumo-count').textContent = '—';
    });
    $('override-count').textContent = estado.overrides.length + (estado.overrides.length === 1 ? ' precio propio' : ' precios propios');
  }

  /* ══════════════════ MATERIALES ══════════════════ */
  function renderMateriales() {
    var cat = $('mat-categoria').value;
    var q = $('buscar-material').value.trim().toLowerCase();
    var filas = insumosDeLaObra(cat, q);
    $('materiales-count').textContent = filas.length + (filas.length === 1 ? ' insumo' : ' insumos');
    var cont = $('materiales-tabla');
    if (!filas.length) {
      cont.innerHTML = '<div class="empty-state">Cargá el cómputo primero</div>';
      return;
    }
    /* Cuando el catalogo no baja, el precio de CADA insumo tampoco: la
       lista de compras dice cuanto hay que pedir, y la plata esta en el
       presupuesto. Donde el visitante puso su precio, ese si se muestra:
       es de el.                                                        */
    var total = filas.reduce(function (s, r) { return s + (r.total || 0); }, 0);
    var hayPlata = filas.some(function (r) { return r.total !== null && r.total !== undefined; });
    var plata = function (v) { return (v === null || v === undefined) ? '<span class="text-muted">·</span>' : num(v); };

    cont.innerHTML = '<div class="tabla-scroll"><table class="grilla"><thead><tr>' +
      '<th>Código</th><th>Insumo</th><th class="col-hide">Tipo</th><th class="der">Cantidad</th><th>Un.</th>' +
      '<th class="der">Pedir</th><th>Un. compra</th>' +
      '<th class="der">P. unitario</th><th class="der">Total</th><th class="col-hide">Rubros</th>' +
      '</tr></thead><tbody>' +
      filas.map(function (r) {
        return '<tr><td class="cod">' + esc(r.code) + '</td><td>' + esc(r.desc) + ' ' + tagOrigen(r.origenPrecio) + '</td>' +
          '<td class="col-hide">' + tagCategoria(r.category) + '</td>' +
          '<td class="der"><strong>' + num(r.cantidad) + '</strong></td><td>' + esc(r.unit) + '</td>' +
          '<td class="der">' + num(r.cantidadCompra) + '</td><td>' + esc(r.unidadCompra || r.unit) + '</td>' +
          '<td class="der">' + plata(r.unitPrice) + '</td><td class="der">' + plata(r.total) + '</td>' +
          '<td class="col-hide text-muted" style="font-size:11px">' + esc((r.rubros || []).join(', ')) + '</td></tr>';
      }).join('') +
      '</tbody><tfoot><tr><td colspan="8" class="der"><strong>' +
      (hayPlata ? 'TOTAL (sólo lo que tiene tu precio)' : 'TOTAL') + '</strong></td>' +
      '<td class="der"><strong>' + num(total) + '</strong></td><td></td></tr></tfoot></table></div>';
  }

  /* La lista de compras sale del calculo que ya esta hecho, y se filtra
     aca: pedirsela de nuevo al servidor por un cambio de categoria seria
     una vuelta al pedo.                                               */
  function insumosDeLaObra(categoria, texto) {
    var filas = (calcular().insumos || []).slice();
    if (categoria) filas = filas.filter(function (r) { return r.category === categoria; });
    if (texto) {
      var t = String(texto).toLowerCase();
      filas = filas.filter(function (r) {
        return r.code.toLowerCase().indexOf(t) > -1 || (r.desc || '').toLowerCase().indexOf(t) > -1;
      });
    }
    return filas;
  }

  /* ══════════════════ CONTROL ══════════════════ */
  function renderControl() {
    if (remoto()) {
      $('control-resumen').innerHTML = '<div class="text-muted">La auditoría del catálogo corre sobre la base, ' +
        'no sobre la app publicada.</div>';
      $('control-desalineados').innerHTML = $('control-tareas').innerHTML = '';
      return;
    }
    if (!D.hayCatalogo()) { $('control-resumen').innerHTML = '<div class="text-muted">Sin catálogo cargado.</div>'; return; }
    var a = M.auditarCatalogo(catalogo());
    $('control-resumen').innerHTML = [
      kpi(a.totalInsumos, 'insumos', ''),
      kpi(a.totalAnalisis, 'análisis', ''),
      kpi(a.desalineados.length, 'insumos desalineados', a.desalineados.length ? 'alerta' : 'ok'),
      kpi(a.tareasQueCambian.length, 'tareas que cambian', a.tareasQueCambian.length ? 'alerta' : 'ok'),
      kpi(a.huerfanos.length, 'insumos huérfanos', a.huerfanos.length ? 'alerta' : 'ok')
    ].join('');

    $('control-desalineados').innerHTML = a.desalineados.length
      ? '<table class="grilla"><thead><tr><th>Código</th><th>Insumo</th><th class="der">En la lista</th>' +
        '<th class="der">En los análisis</th><th class="der">Relación</th><th class="der">Tareas</th></tr></thead><tbody>' +
        a.desalineados.map(function (d) {
          var grave = d.ratio > 10 || d.ratio < 0.1;
          return '<tr><td class="cod">' + esc(d.code) + '</td><td>' + esc(d.desc) + '</td>' +
            '<td class="der">' + num(d.precioLista) + '</td><td class="der">' + num(d.precioAnalisis) + '</td>' +
            '<td class="der"><span class="ratio ' + (grave ? 'grave' : 'leve') + '">×' + num(d.ratio) + '</span></td>' +
            '<td class="der">' + d.tareas.length + '</td></tr>';
        }).join('') + '</tbody></table>'
      : '<div class="text-muted">Todo alineado: la lista de precios y los análisis dicen lo mismo.</div>';

    $('control-tareas').innerHTML = a.tareasQueCambian.length
      ? '<table class="grilla"><thead><tr><th>Código</th><th>Tarea</th><th class="der">Precio del Excel</th>' +
        '<th class="der">Recalculado</th><th class="der">Variación</th></tr></thead><tbody>' +
        a.tareasQueCambian.map(function (t) {
          var grave = Math.abs(t.variacionPct) > 50;
          return '<tr><td class="cod">' + esc(t.code) + '</td><td>' + esc(t.desc) + '</td>' +
            '<td class="der">' + num(t.precioExcel) + '</td><td class="der">' + num(t.precioRecalculado) + '</td>' +
            '<td class="der"><span class="ratio ' + (grave ? 'grave' : 'leve') + '">' +
            (t.variacionPct > 0 ? '+' : '') + pct(t.variacionPct) + '</span></td></tr>';
        }).join('') + '</tbody></table>'
      : '<div class="text-muted">Ninguna tarea cambia de precio al recalcular.</div>';
  }
  function kpi(v, l, cls) {
    return '<div class="control-kpi ' + (cls || '') + '"><div class="v">' + v + '</div><div class="l">' + l + '</div></div>';
  }

  /* ── render general ───────────────────────────────────────── */
  function renderTodo() {
    return recalcular().then(function () {
      renderComputo();
      renderPresupuesto();
      renderMateriales();
      renderInsumos();
      // el plan cuelga del computo: si cambio una cantidad, el gantt y
      // las curvas que estan en pantalla ya no son de esta obra
      if (window.PlanUI && $('tab-plan').classList.contains('active')) window.PlanUI.render();
      guardar();
    });
  }

  /* ══════════════════ IMPORTACIÓN ══════════════════ */
  function pedirMapeo(archivo, campos, alConfirmar) {
    I.leerArchivo(archivo).then(function (libro) {
      var hoja = libro.hojas[0];
      var filaEnc = I.detectarEncabezado(hoja.filas);
      var encabezados = (hoja.filas[filaEnc] || []).map(function (h, i) {
        return String(h === null || h === undefined ? '' : h).trim() || ('columna ' + (i + 1));
      });
      var mapeo = I.sugerirMapeo(encabezados, campos);
      mapeoPendiente = { libro: libro, hoja: hoja, filaEnc: filaEnc, encabezados: encabezados, mapeo: mapeo, campos: campos, alConfirmar: alConfirmar };

      $('mapeo-info').innerHTML = esc(libro.nombre) + ' · hoja <strong>' + esc(hoja.nombre) + '</strong> · ' +
        'encabezado en la fila ' + (filaEnc + 1) + ' · ' + (hoja.filas.length - filaEnc - 1) + ' filas de datos';

      var selHojas = libro.hojas.length > 1
        ? '<div class="mapeo-campo"><label>Hoja</label><select id="mapeo-hoja">' +
          libro.hojas.map(function (h, i) { return '<option value="' + i + '">' + esc(h.nombre) + '</option>'; }).join('') +
          '</select></div>'
        : '';
      $('mapeo-campos').innerHTML = selHojas + campos.map(function (c) {
        return '<div class="mapeo-campo"><label>' + esc(c.label) + (c.requerido ? ' *' : '') + '</label>' +
          '<select data-campo-mapeo="' + c.clave + '"><option value="-1">— no está —</option>' +
          encabezados.map(function (h, i) {
            return '<option value="' + i + '"' + (mapeo[c.clave] === i ? ' selected' : '') + '>' + esc(h) + '</option>';
          }).join('') + '</select></div>';
      }).join('');

      if ($('mapeo-hoja')) $('mapeo-hoja').onchange = function () {
        var h = libro.hojas[parseInt(this.value, 10)];
        mapeoPendiente.hoja = h;
        mapeoPendiente.filaEnc = I.detectarEncabezado(h.filas);
        pedirMapeoRefrescar();
      };
      document.querySelectorAll('[data-campo-mapeo]').forEach(function (s) { s.onchange = leerMapeoDeLaPantalla; });
      previsualizar();
      abrir('modal-mapeo');
    }).catch(function (e) { toast('No se pudo leer: ' + e.message, 'error'); });
  }

  function pedirMapeoRefrescar() {
    var p = mapeoPendiente;
    p.encabezados = (p.hoja.filas[p.filaEnc] || []).map(function (h, i) {
      return String(h === null || h === undefined ? '' : h).trim() || ('columna ' + (i + 1));
    });
    p.mapeo = I.sugerirMapeo(p.encabezados, p.campos);
    document.querySelectorAll('[data-campo-mapeo]').forEach(function (s) {
      var clave = s.getAttribute('data-campo-mapeo');
      s.innerHTML = '<option value="-1">— no está —</option>' + p.encabezados.map(function (h, i) {
        return '<option value="' + i + '"' + (p.mapeo[clave] === i ? ' selected' : '') + '>' + esc(h) + '</option>';
      }).join('');
    });
    previsualizar();
  }

  function leerMapeoDeLaPantalla() {
    document.querySelectorAll('[data-campo-mapeo]').forEach(function (s) {
      mapeoPendiente.mapeo[s.getAttribute('data-campo-mapeo')] = parseInt(s.value, 10);
    });
    previsualizar();
  }

  function previsualizar() {
    var p = mapeoPendiente;
    var filas = p.hoja.filas.slice(p.filaEnc + 1, p.filaEnc + 7);
    var cols = p.campos.filter(function (c) { return p.mapeo[c.clave] >= 0; });
    $('mapeo-preview').innerHTML = '<table><thead><tr>' +
      cols.map(function (c) { return '<th>' + esc(c.label) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      filas.map(function (f) {
        return '<tr>' + cols.map(function (c) {
          var v = f[p.mapeo[c.clave]];
          return '<td>' + esc(v === null || v === undefined ? '' : v) + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table>';
  }

  function confirmarMapeo() {
    var p = mapeoPendiente;
    if (!p) return;
    var faltan = p.campos.filter(function (c) { return c.requerido && !(p.mapeo[c.clave] >= 0); });
    if (faltan.length) { toast('Falta indicar: ' + faltan.map(function (c) { return c.label; }).join(', '), 'error'); return; }
    p.alConfirmar(p);
    cerrar('modal-mapeo');
    mapeoPendiente = null;
  }

  function importarComputo(p) {
    var res = I.filasAComputo(p.hoja.filas, p.mapeo, p.filaEnc);
    if (!res.items.length) { toast('No se encontró ninguna fila con código y cantidad', 'error'); return; }
    var nuevos = res.items.map(function (it) { return Object.assign({ id: proximoId++ }, it); });
    nuevos.forEach(function (it) { estado.items.push(it); });

    /* Cuantos codigos reconocio el catalogo no se pregunta aparte: sale
       del mismo calculo que va a mostrar la pantalla, asi el numero del
       aviso y el de la grilla no pueden diferir.                       */
    renderTodo().then(function () {
      var ids = {};
      nuevos.forEach(function (it) { ids[it.id] = true; });
      var mios = calcular().items.filter(function (f) { return ids[f.id]; });
      var sinReconocer = mios.filter(function (f) { return f.sinAnalisis; }).length;
      var reconocidas = mios.length - sinReconocer;
      toast(res.items.length + ' renglones importados · ' + reconocidas + ' con análisis' +
        (sinReconocer ? ' · ' + sinReconocer + ' sin análisis' : '') +
        (res.descartadas ? ' · ' + res.descartadas + ' filas salteadas' : ''), sinReconocer ? 'aviso' : 'ok');
    });
    mostrarTab('computo');
  }

  function importarPrecios(p) {
    var res = I.filasAPrecios(p.hoja.filas, p.mapeo, p.filaEnc);
    if (!res.items.length) { toast('No se encontró ninguna fila con código y precio', 'error'); return; }
    res.items.forEach(function (n) {
      var i = estado.overrides.findIndex(function (o) { return o.code === n.code; });
      if (i >= 0) estado.overrides[i] = n; else estado.overrides.push(n);
    });

    /* Que un precio "cruce" se ve donde importa: en los insumos que la
       obra pide. Un codigo que no esta en ninguna tarea del computo no
       cruza aunque exista en el catalogo, y decir lo contrario seria
       prometer un descuento que no va a aparecer en ningun total.     */
    renderTodo().then(function () {
      var usados = {};
      (calcular().insumos || []).forEach(function (r) { usados[r.code] = true; });
      var cruzan = res.items.filter(function (n) { return usados[String(n.code).trim()]; }).length;
      var afuera = res.items.length - cruzan;
      toast(res.items.length + ' precios propios cargados · ' + cruzan + ' los usa tu obra' +
        (afuera ? ' · ' + afuera + ' no aparecen en el cómputo' : ''), cruzan ? 'ok' : 'aviso');
    });
  }

  /* ══════════════════ EXPORTAR ══════════════════ */
  /* Arma las hojas a partir del MISMO calculo que muestra la
     pantalla. La version vieja recalculaba aparte y se olvidaba el
     beneficio: el Excel que se mandaba al cliente salia 8% mas
     barato que lo que decia el monitor.                            */
  function armarLibro() {
    var c = calcular();
    var o = estado.obra;
    var enc = [
      ['PRESUPUESTO'], [o.nombre || ''], ['Comitente', o.cliente || ''], ['Ubicación', o.ubicacion || ''],
      ['Fecha', o.fecha || new Date().toLocaleDateString('es-AR')], []
    ];
    var pres = enc.concat([['Código', 'Descripción', 'Sector', 'Unidad', 'Cantidad', 'P. unitario', 'Costo', 'P. venta (×K)', 'Total venta']]);
    c.rubros.forEach(function (r) {
      pres.push([r.rubro]);
      r.items.forEach(function (f) {
        pres.push([f.code, f.desc, f.sector, f.unit, f.qty, f.precioUnitario, f.costoTotal, f.precioUnitario * c.k, f.costoTotal * c.k]);
      });
      pres.push(['', 'Subtotal ' + r.rubro, '', '', '', '', r.costo, '', r.costo * c.k]);
      pres.push([]);
    });
    pres.push([]);
    pres.push(['', 'COSTO DE OBRA', '', '', '', '', c.costo]);
    c.aperturaK.forEach(function (comp) {
      if (comp.pct) pres.push(['', comp.label + ' ' + comp.pct + '%', '', '', '', '', comp.monto]);
    });
    pres.push(['', 'COEFICIENTE K (' + c.modoK + ')', '', '', '', '', c.k]);
    pres.push(['', 'PRECIO SIN IVA', '', '', '', '', c.precioSinIva]);
    pres.push(['', 'IVA ' + c.ivaPct + '%', '', '', '', '', c.iva]);
    pres.push(['', 'TOTAL', '', '', '', '', c.total]);

    var mats = [['Código', 'Insumo', 'Tipo', 'Cantidad', 'Unidad', 'Pedir', 'Un. compra',
                 'P. unitario', 'Total', 'Origen del precio', 'Rubros']];
    (c.insumos || []).forEach(function (r) {
      mats.push([r.code, r.desc, r.category, r.cantidad, r.unit, r.cantidadCompra, r.unidadCompra || r.unit,
        r.unitPrice === null || r.unitPrice === undefined ? '' : r.unitPrice,
        r.total === null || r.total === undefined ? '' : r.total,
        r.origenPrecio === 'propio' ? 'tuyo' : 'SIBRATECH', (r.rubros || []).join(', ')]);
    });

    var comp = [['Código', 'Descripción', 'Unidad', 'Sector', 'Cantidad']];
    c.items.forEach(function (f) { comp.push([f.code, f.desc, f.unit, f.sector, f.qty]); });

    return {
      calculo: c,
      archivo: (o.nombre || 'Presupuesto').replace(/[\\/:*?"<>|]/g, '-') + '.xlsx',
      hojas: [
        { nombre: 'Presupuesto', filas: pres },
        { nombre: 'Cómputo', filas: comp },
        { nombre: 'Insumos', filas: mats }
      ]
    };
  }

  function exportarExcel() {
    if (!estado.items.length) { toast('No hay nada para exportar', 'error'); return; }
    // se recalcula antes de escribir: el Excel sale del numero de ahora
    pedirEmail('presupuesto', function () {
      return recalcular().then(function () {
        var libro = armarLibro();
        I.exportarLibro(libro.hojas, libro.archivo);
        toast('Excel exportado — los totales son los mismos de la pantalla', 'ok');
      });
    });
  }

  /* ── el email, al bajar ───────────────────────────────────────
     Acceso libre: no hay login. El email se pide una sola vez, recien
     cuando se lleva algo, y el archivo se descarga IGUAL si el registro
     falla — el que vino a presupuestar no tiene por que pagar un error
     nuestro de red.                                                   */
  var emailPendiente = null;
  /* true = hay que frenar y pedir el email; la funcion se reintenta sola */
  function pedirEmailAntes(origen, reintentar) {
    if (!remoto() || emailGuardado()) return false;
    pedirEmail(origen, reintentar);
    return true;
  }
  var CLAVE_EMAIL = 'presupuestapp_email';
  function emailGuardado() {
    try { return localStorage.getItem(CLAVE_EMAIL) || ''; } catch (e) { return ''; }
  }
  function pedirEmail(origen, bajar) {
    if (!remoto() || emailGuardado()) { bajar(); return; }
    $('email-origen').textContent = origen === 'presupuesto' ? 'el presupuesto en Excel'
      : origen === 'formato' ? 'el formato para pedir precios' : 'la lista de insumos';
    $('email-valor').value = '';
    $('email-obra').value = estado.obra.nombre || '';
    abrir('modal-email');
    $('email-valor').focus();
    emailPendiente = { origen: origen, bajar: bajar };
  }
  function confirmarEmail() {
    var e = $('email-valor').value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { toast('Ese email no parece válido', 'error'); return; }
    try { localStorage.setItem(CLAVE_EMAIL, e); } catch (x) { /* modo incognito */ }
    var p = emailPendiente;
    cerrar('modal-email');
    emailPendiente = null;
    D.registrarDescarga(e, $('email-nombre').value.trim(), $('email-obra').value.trim(), p.origen)
      .catch(function () { /* el archivo se baja igual */ });
    p.bajar();
  }

  /* El formato para pedir precios, pero SÓLO con los insumos que la obra
     necesita. El visitante se lo manda al corralón, se lo completan, y lo
     sube de vuelta por "Mi lista": no tiene que cotizar 631 insumos para
     presupuestar una obra que usa 27.                                    */
  function bajarFormatoPrecios() {
    var filas = insumosDeLaObra($('mat-categoria').value || null);
    if (!filas.length) { toast('Cargá el cómputo primero: el formato sale de los insumos de la obra', 'error'); return; }
    if (pedirEmailAntes('formato', bajarFormatoPrecios)) return;
    var hoja = [['CODIGO', 'INSUMO', 'UNIDAD DE OBRA', 'UNIDAD DE COMPRA', 'CONTENIDO',
                 'PRECIO (por unidad de compra)', 'CANTIDAD QUE NECESITO', 'PROVEEDOR', 'FECHA']];
    filas.forEach(function (r) {
      hoja.push([r.code, r.desc, r.unit, r.unidadCompra || r.unit, r.factor > 1 ? r.factor : '',
        '', r.cantidadCompra, '', '']);
    });
    hoja.push([]);
    hoja.push(['', 'Completá la columna PRECIO y subí este mismo archivo en la pestaña Precios.']);
    hoja.push(['', 'El precio va por unidad de compra y sin IVA. CONTENIDO es cuántas unidades de obra trae una de compra.']);
    I.exportarHoja(hoja, 'Pedido de precios',
      'precios_a_cotizar_' + (estado.obra.nombre || 'obra').replace(/[\\/:*?"<>|]/g, '-') + '.xlsx');
    toast(filas.length + ' insumos para cotizar — completá el precio y volvé a subirlo', 'ok');
  }

  function exportarMateriales() {
    var filas = insumosDeLaObra($('mat-categoria').value || null, $('buscar-material').value.trim());
    if (!filas.length) { toast('No hay insumos para exportar', 'error'); return; }
    if (pedirEmailAntes('insumos', exportarMateriales)) return;
    var hoja = [['Código', 'Insumo', 'Tipo', 'Cantidad', 'Unidad', 'Pedir', 'Un. compra', 'P. unitario', 'Total']];
    filas.forEach(function (r) {
      hoja.push([r.code, r.desc, r.category, r.cantidad, r.unit, r.cantidadCompra, r.unidadCompra || r.unit,
        r.unitPrice === null || r.unitPrice === undefined ? '' : r.unitPrice,
        r.total === null || r.total === undefined ? '' : r.total]);
    });
    I.exportarHoja(hoja, 'Insumos', 'insumos_' + (estado.obra.nombre || 'obra').replace(/[\\/:*?"<>|]/g, '-') + '.xlsx');
    toast('Lista de insumos exportada', 'ok');
  }

  function guardarProyecto() {
    var blob = new Blob([JSON.stringify(estado, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (estado.obra.nombre || 'presupuesto').replace(/[\\/:*?"<>|]/g, '-') + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Proyecto guardado', 'ok');
  }

  function abrirProyecto(file) {
    var r = new FileReader();
    r.onload = function (e) {
      try {
        var s = JSON.parse(e.target.result);
        if (!s || !Array.isArray(s.items)) throw new Error('formato desconocido');
        estado = Object.assign(estado, s);
        proximoId = 1;
        estado.items.forEach(function (it) { if (it.id === undefined) it.id = proximoId++; else if (it.id >= proximoId) proximoId = it.id + 1; });
        pintarFormularios();
        renderTodo();
        toast('Proyecto abierto: ' + estado.items.length + ' renglones', 'ok');
      } catch (err) { toast('No se pudo abrir: ' + err.message, 'error'); }
    };
    r.readAsText(file);
  }

  /* ══════════════════ TAREAS (buscador) ══════════════════ */
  /* ── el buscador de tareas ────────────────────────────────────
     Con el buscador vacio antes decia "escribi al menos 3 letras" y
     nada mas: parecia que la base no estaba. Ahora muestra el INDICE,
     por capitulo y rubro, para recorrerla. Tocando un rubro aparecen sus
     tareas con su precio; escribiendo, se busca como siempre.

     El indice son solo nombres de rubros y cuantas tareas tiene cada
     uno. Las tareas se piden de a un rubro, por la misma puerta con
     tope que el buscador.                                            */
  var CAPITULOS = {
    E02: 'Movimiento de suelos', E04: 'Fundaciones', E05: 'Estructuras',
    E06: 'Contrapisos', E07: 'Mamposterías y cercos', E08: 'Revoques y cielorrasos',
    E09: 'Cubiertas', E10: 'Aislaciones', E11: 'Pisos y carpetas', E12: 'Revestimientos',
    E15: 'Herrería', E20: 'Instalación sanitaria', E27: 'Pinturas', E28: 'Parquización',
    E44: 'Construcción en seco', E45: 'Construcción en seco'
  };
  function capituloDe(codigo) {
    var c = String(codigo || '').toUpperCase();
    if (CAPITULOS[c.slice(0, 3)]) return CAPITULOS[c.slice(0, 3)];
    if (c.charAt(0) === 'A') return 'Mezclas, hormigones e instalaciones';
    return 'Otros';
  }
  var rubroAbierto = null;

  function buscarTareas() {
    var q = $('buscar-tarea').value.trim();
    if (q.length < 3) { pintarIndiceRubros(); return; }
    rubroAbierto = null;
    D.buscarTareas(q).then(function (res) {
      if (!res.filas.length) {
        $('tarea-resultados').innerHTML = '<div class="empty-state">Nada con “' + esc(q) + '”. ' +
          'Borrá el texto para recorrer los rubros.</div>';
        return;
      }
      pintarTareas(res, '');
    }).catch(errorCatalogo);
  }

  function errorCatalogo(e) {
    $('tarea-resultados').innerHTML = '<div class="empty-state">No se pudo consultar el catálogo.<br>' +
      '<span class="text-muted">' + esc(e.message) + '</span></div>';
  }

  function pintarIndiceRubros() {
    D.rubros().then(function (lista) {
      var total = lista.reduce(function (s, r) { return s + r.tareas; }, 0);
      var grupos = [], porCap = {};
      lista.forEach(function (r) {
        var cap = capituloDe(r.primerCodigo);
        if (!porCap[cap]) { porCap[cap] = []; grupos.push(cap); }
        porCap[cap].push(r);
      });
      // lo que no es obra propiamente dicha va al final
      var alFinal = ['Mezclas, hormigones e instalaciones', 'Otros'];
      grupos.sort(function (a, b) { return (alFinal.indexOf(a) > -1) - (alFinal.indexOf(b) > -1); });
      $('tarea-resultados').innerHTML =
        '<p class="text-muted mb8"><strong>' + total + ' tareas</strong> con su análisis, en ' +
        lista.length + ' rubros. Tocá un rubro para ver sus tareas, o escribí para buscar.</p>' +
        grupos.map(function (cap) {
          return '<div class="indice-cap"><div class="indice-titulo">' + esc(cap) + '</div>' +
            '<div class="indice-rubros">' + porCap[cap].map(function (r) {
              return '<button class="indice-rubro' + (rubroAbierto === r.rubro ? ' abierto' : '') + '" ' +
                'data-rubro="' + esc(r.rubro) + '">' + esc(r.rubro) +
                ' <span>' + r.tareas + '</span></button>';
            }).join('') + '</div>' +
            (porCap[cap].some(function (r) { return r.rubro === rubroAbierto; })
              ? '<div id="indice-tareas"></div>' : '') +
            '</div>';
        }).join('');
      if (rubroAbierto) abrirRubro(rubroAbierto);
    }).catch(errorCatalogo);
  }

  function abrirRubro(rubro) {
    rubroAbierto = rubro;
    var cont = $('indice-tareas');
    if (!cont) { pintarIndiceRubros(); return; }
    cont.innerHTML = '<div class="text-muted" style="padding:8px">Buscando las tareas…</div>';
    D.tareasDeRubro(rubro).then(function (res) {
      pintarTareas(res, '', cont);
    }).catch(errorCatalogo);
  }

  function pintarTareas(res, encabezado, destino) {
    // en remoto el precio ya viene con la fila; en local hay que sacarlo
    var idx = remoto() ? null : M.indexar(catalogo(), estado.overrides);
    res.filas.forEach(function (a) { ultimaBusqueda[a.code] = a; });
    (destino || $('tarea-resultados')).innerHTML = (encabezado || '') +
      '<table class="grilla"><thead><tr><th>Código</th><th>Tarea</th><th>Rubro</th>' +
      '<th class="der">P. unitario</th><th class="der">Cantidad</th><th></th></tr></thead><tbody>' +
      res.filas.map(function (a) {
        var c = idx ? M.calcularAnalisis(a, idx) : { price: a.price };
        return '<tr><td class="cod">' + esc(a.code) + '</td><td>' + esc(a.desc) + '</td>' +
          '<td class="text-muted" style="font-size:11.5px">' + esc(a.rubro) + '</td>' +
          '<td class="der">' + num(c.price) + ' <span class="text-muted">/' + esc(a.unit) + '</span></td>' +
          '<td class="der"><input class="cant" type="number" step="any" value="1" data-qty="' + esc(a.code) + '"></td>' +
          '<td><button class="btn btn-primary" data-agregar="' + esc(a.code) + '">＋</button></td></tr>';
      }).join('') + '</tbody></table>' +
      (res.total > res.filas.length ? '<div class="text-muted" style="padding:8px">Mostrando ' +
        res.filas.length + ' de ' + res.total + ' · afiná la búsqueda</div>' : '');
  }

  /* El analisis se pide al origen de datos. Cuando el catalogo no baja
     vienen los RENDIMIENTOS sin el precio de cada insumo: la receta se
     muestra igual — es lo que hay que mostrar — y la plata queda en el
     costo de la tarea, que ya esta en la planilla.                    */
  function verAnalisis(code) {
    var fila = calcular().items.filter(function (f) { return f.code === code; })[0] || {};
    var b = ultimaBusqueda[code] || {};
    var titulo = fila.desc || b.desc || '';
    var unidad = fila.unit || b.unit || '';
    var rubro = fila.rubro || b.rubro || '';

    $('analisis-titulo').textContent = code + (titulo ? ' · ' + titulo : '');
    $('analisis-cuerpo').innerHTML = '<div class="text-muted" style="padding:14px">Buscando el análisis…</div>';
    abrir('modal-analisis');

    D.analisis(code).then(function (det) {
      if (!det.length) {
        $('analisis-cuerpo').innerHTML = '<div class="empty-state">Esta tarea no tiene análisis en el catálogo</div>';
        return;
      }
      var idx = remoto() ? null : M.indexar(catalogo(), estado.overrides);
      var conPlata = !!idx;
      var totales = { 'Materiales': 0, 'Mano de obra': 0, 'Equipos': 0 };

      var cuerpo = det.map(function (d) {
        var cat = M.normalizarCategoria(d.category);
        var pu = null, sub = null;
        if (conPlata) {
          var pi = M.precioInsumo(d.code, idx);
          pu = pi.precio;
          sub = pu * M.safeNum(d.qty);
          totales[cat] = (totales[cat] || 0) + sub;
        } else {
          // el precio propio del visitante SI se puede mostrar: es suyo
          var mio = estado.overrides.filter(function (o) { return o.code === d.code; })[0];
          if (mio) {
            pu = M.safeNum(mio.price) / (M.safeNum(mio.factor) || M.safeNum(d.factor) || 1);
            sub = pu * M.safeNum(d.qty);
          }
        }
        var celdas = conPlata
          ? '<td class="der">' + num(pu) + '</td><td class="der">' + num(sub) + '</td>'
          : '<td class="der">' + (pu === null ? PUNTO : num(pu)) + '</td>' +
            '<td class="der">' + (sub === null ? PUNTO : num(sub)) + '</td>';
        return '<tr><td>' + tagCategoria(cat) + '</td><td class="cod">' + esc(d.code) + '</td>' +
          '<td>' + esc(d.desc) + '</td>' +
          '<td class="der"><strong>' + rend(d.qty) + '</strong></td><td>' + esc(d.unit) + '</td>' +
          celdas + '</tr>';
      }).join('');

      var costoUnit = fila.precioUnitario || b.price || 0;
      var pie = conPlata
        ? '<tr><td colspan="6" class="der">Materiales</td><td class="der">' + num(totales['Materiales']) + '</td></tr>' +
          '<tr><td colspan="6" class="der">Mano de obra</td><td class="der">' + num(totales['Mano de obra']) + '</td></tr>' +
          '<tr><td colspan="6" class="der">Equipos</td><td class="der">' + num(totales['Equipos']) + '</td></tr>' +
          '<tr><td colspan="6" class="der"><strong>COSTO POR ' + esc(String(unidad).toUpperCase()) + '</strong></td>' +
          '<td class="der"><strong>' + num(costoUnit) + '</strong></td></tr>'
        : '<tr><td colspan="6" class="der"><strong>COSTO POR ' + esc(String(unidad).toUpperCase()) + '</strong></td>' +
          '<td class="der"><strong>' + num(costoUnit) + '</strong></td></tr>';

      var nota = conPlata ? '' : ' · <span class="text-muted">rendimientos</span>';
      $('analisis-cuerpo').innerHTML =
        '<p class="text-muted mb8">' + esc(rubro) + ' · precio por <strong>' + esc(unidad) + '</strong>' + nota + '</p>' +
        '<table class="grilla"><thead><tr><th>Tipo</th><th>Código</th><th>Insumo</th><th class="der">Rendimiento</th>' +
        '<th>Un.</th><th class="der">P. unitario</th><th class="der">Subtotal</th></tr></thead><tbody>' +
        cuerpo + '</tbody><tfoot>' + pie + '</tfoot></table>';
    }).catch(function (e) {
      $('analisis-cuerpo').innerHTML = '<div class="empty-state">No se pudo traer el análisis: ' + esc(e.message) + '</div>';
    });
  }

  /* Los numeros de abajo, despues de un respiro. El sector y la cantidad
     se escriben letra por letra: salir a cotizar en cada tecla seria una
     llamada por digito, y la respuesta de "12" puede llegar despues de la
     de "125" y dejar el total viejo en pantalla.                        */
  var actualizarNumeros = conRespiro(function (id, tr) {
    recalcular().then(function (c) {
      var celdaTotal = tr.querySelector('td:nth-last-child(2) strong');
      if (celdaTotal) {
        var fila = c.items.filter(function (f) { return f.id === id; })[0];
        if (fila) celdaTotal.textContent = num(fila.costoTotal);
      }
      var pie = $('computo-grilla').querySelector('tfoot strong:last-child');
      if (pie) pie.textContent = num(c.costo);
      renderPresupuesto();
      renderMateriales();
      guardar();
    });
  }, 400);

  /* ══════════════════ EVENTOS ══════════════════ */
  function mostrarTab(nombre) {
    document.querySelectorAll('.section').forEach(function (s) { s.classList.remove('active'); });
    document.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('active', t.getAttribute('data-tab') === nombre); });
    $('tab-' + nombre).classList.add('active');
    if (nombre === 'control') renderControl();
    if (nombre === 'plan' && window.PlanUI) window.PlanUI.mostrar();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function pintarFormularios() {
    $('obra-nombre').value = estado.obra.nombre || '';
    $('obra-cliente').value = estado.obra.cliente || '';
    $('obra-ubicacion').value = estado.obra.ubicacion || '';
    $('obra-fecha').value = estado.obra.fecha || new Date().toISOString().slice(0, 10);
    $('k-gg').value = estado.params.ggPct;
    $('k-beneficio').value = estado.params.beneficioPct;
    $('k-iibb').value = estado.params.iibbPct;
    $('k-financiacion').value = estado.params.financiacionPct;
    $('k-modo').value = estado.params.modoK;
    $('k-iva').value = estado.params.ivaPct;
    $('chk-precio-venta').checked = !!estado.verPrecioVenta;
  }

  function conectar() {
    document.querySelectorAll('.tab').forEach(function (t) {
      t.onclick = function () { mostrarTab(t.getAttribute('data-tab')); };
    });
    document.querySelectorAll('[data-cerrar]').forEach(function (b) {
      b.onclick = function () { cerrar(b.getAttribute('data-cerrar')); };
    });
    document.querySelectorAll('.modal-overlay').forEach(function (o) {
      o.onclick = function (e) { if (e.target === o) o.classList.remove('open'); };
    });

    // cómputo
    $('file-computo').onchange = function (e) {
      if (e.target.files[0]) pedirMapeo(e.target.files[0], I.CAMPOS_COMPUTO, importarComputo);
      e.target.value = '';
    };
    $('btn-plantilla').onclick = function () { I.bajarPlantillaComputo(catalogo()); };
    $('btn-buscar-tarea').onclick = function () { abrir('modal-buscar'); $('buscar-tarea').value = ''; buscarTareas(); $('buscar-tarea').focus(); };
    $('btn-limpiar-computo').onclick = function () {
      if (!estado.items.length) return;
      if (!confirm('¿Borrar los ' + estado.items.length + ' renglones del cómputo?')) return;
      estado.items = []; renderTodo(); toast('Cómputo vacío', 'ok');
    };
    $('buscar-tarea').oninput = buscarTareas;

    $('modal-buscar').addEventListener('click', function (e) {
      var rb = e.target.closest && e.target.closest('[data-rubro]');
      if (rb) {
        var r = rb.getAttribute('data-rubro');
        if (rubroAbierto === r) { rubroAbierto = null; pintarIndiceRubros(); }
        else { rubroAbierto = r; pintarIndiceRubros(); }
        return;
      }
      var code = e.target.getAttribute && e.target.getAttribute('data-agregar');
      if (!code) return;
      var input = document.querySelector('[data-qty="' + code + '"]');
      var qty = M.safeNum(input ? input.value : 1) || 1;
      var a = ultimaBusqueda[code];
      estado.items.push({ id: proximoId++, code: code, desc: a ? a.desc : '', unit: a ? a.unit : '', rubro: a ? a.rubro : '', sector: '', qty: qty });
      renderTodo();
      toast((a ? a.desc.slice(0, 40) : code) + ' · ' + num(qty) + ' ' + (a ? a.unit : ''), 'ok');
    });

    $('computo-grilla').addEventListener('input', function (e) {
      var tr = e.target.closest('tr');
      var campo = e.target.getAttribute('data-campo');
      if (!tr || !campo) return;
      var id = parseInt(tr.getAttribute('data-id'), 10);
      var it = estado.items.filter(function (x) { return x.id === id; })[0];
      if (!it) return;
      if (campo === 'qty') it.qty = M.safeNum(e.target.value);
      else if (campo === 'precioManual') it.precioManual = e.target.value === '' ? undefined : M.safeNum(e.target.value);
      else it[campo] = e.target.value;
      // No se vuelve a dibujar la grilla: se actualizan los numeros de
      // abajo, para no arrancarle el foco al que esta tecleando.
      actualizarNumeros(id, tr);
    });

    $('computo-grilla').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (b.getAttribute('data-borrar')) {
        var id = parseInt(b.getAttribute('data-borrar'), 10);
        estado.items = estado.items.filter(function (x) { return x.id !== id; });
        renderTodo();
      } else if (b.getAttribute('data-ver')) {
        verAnalisis(b.getAttribute('data-ver'));
      }
    });

    // obra + K
    ['nombre', 'cliente', 'ubicacion', 'fecha'].forEach(function (c) {
      $('obra-' + c).oninput = function () { estado.obra[c] = this.value; guardar(); };
    });
    var mapaK = { 'k-gg': 'ggPct', 'k-beneficio': 'beneficioPct', 'k-iibb': 'iibbPct', 'k-financiacion': 'financiacionPct', 'k-iva': 'ivaPct' };
    Object.keys(mapaK).forEach(function (id) {
      $(id).oninput = function () { estado.params[mapaK[id]] = M.safeNum(this.value); renderPresupuesto(); guardar(); };
    });
    $('k-modo').onchange = function () { estado.params.modoK = this.value; renderPresupuesto(); guardar(); };
    $('chk-precio-venta').onchange = function () { estado.verPrecioVenta = this.checked; renderPresupuesto(); guardar(); };

    $('btn-export-excel').onclick = exportarExcel;
    $('btn-guardar-json').onclick = guardarProyecto;
    $('file-proyecto').onchange = function (e) { if (e.target.files[0]) abrirProyecto(e.target.files[0]); e.target.value = ''; };

    // precios
    $('file-precios').onchange = function (e) {
      if (e.target.files[0]) pedirMapeo(e.target.files[0], I.CAMPOS_PRECIOS, importarPrecios);
      e.target.value = '';
    };
    $('btn-plantilla-precios').onclick = function () { I.bajarPlantillaPrecios(catalogo()); };
    $('btn-limpiar-overrides').onclick = function () {
      if (!estado.overrides.length) return;
      if (!confirm('¿Volver a los precios de SIBRATECH? Se borran tus ' + estado.overrides.length + ' precios propios.')) return;
      estado.overrides = []; renderTodo(); toast('Precios de SIBRATECH restaurados', 'ok');
    };
    $('buscar-insumo').oninput = function () { paginaInsumos = 0; renderInsumos(); };
    $('filtro-categoria').onchange = function () { paginaInsumos = 0; renderInsumos(); };
    $('insumo-lista').addEventListener('change', function (e) {
      var code = e.target.getAttribute && e.target.getAttribute('data-precio-propio');
      if (!code) return;
      var v = e.target.value.trim();
      var i = estado.overrides.findIndex(function (o) { return o.code === code; });
      if (v === '') { if (i >= 0) estado.overrides.splice(i, 1); }
      else {
        var precio = M.precioDeTexto(v);
        if (i >= 0) estado.overrides[i].price = precio;
        else {
          // la descripcion esta en la fila que se esta editando
          var tr = e.target.closest('tr');
          var celdas = tr ? tr.querySelectorAll('td') : [];
          estado.overrides.push({
            code: code,
            desc: celdas[1] ? celdas[1].textContent.trim() : '',
            unit: celdas[3] ? celdas[3].textContent.trim() : '',
            price: precio
          });
        }
      }
      renderTodo();
    });

    // materiales
    $('mat-categoria').onchange = renderMateriales;
    $('buscar-material').oninput = renderMateriales;
    $('btn-export-materiales').onclick = exportarMateriales;
    $('btn-formato-precios').onclick = bajarFormatoPrecios;

    // email al bajar
    $('btn-email-confirmar').onclick = confirmarEmail;
    $('email-valor').onkeydown = function (e) { if (e.key === 'Enter') confirmarEmail(); };

    // mapeo
    $('btn-mapeo-confirmar').onclick = confirmarMapeo;
  }

  /* ══════════════════ ARRANQUE ══════════════════ */
  D.iniciar().then(function (cat) {
    var chip = $('vigencia-chip');
    if (!D.hayCatalogo()) {
      chip.className = 'chip error mt8';
      chip.textContent = 'No se pudo conectar con el catálogo' + (cat.error ? ' (' + cat.error + ')' : '');
    } else if (remoto()) {
      chip.className = 'chip ok mt8';
      chip.textContent = 'Análisis y precios de SIBRATECH, en línea';
    } else {
      chip.className = 'chip ok mt8';
      chip.textContent = ''+ cat.insumos.length + ' insumos · ' + cat.analisis.length + ' análisis' +
        (cat.fuente ? ' · ' + cat.fuente : '');
    }
    // la auditoria del catalogo es herramienta de casa
    if (remoto()) {
      var tabControl = document.querySelector('.tab[data-tab="control"]');
      if (tabControl) tabControl.style.display = 'none';
    }
    var habia = recuperar();
    pintarFormularios();
    conectar();
    renderTodo();
    if (habia) toast('Recuperado lo último que estabas armando', 'ok');
  });

  /* Puerta para los tests y para mirar el estado desde la consola. */
  /* La puerta para los tests, para la consola y para la pantalla del
     plan, que vive en su propio archivo pero comparte el estado y los
     formateadores: dos criterios de redondeo en la misma app seria un
     numero distinto en cada pestaña. */
  window.App = {
    estado: function () { return estado; },
    calcular: calcular,
    recalcular: recalcular,
    armarLibro: armarLibro,
    renderTodo: renderTodo,
    importarComputo: importarComputo,
    importarPrecios: importarPrecios,
    guardar: guardar,
    remoto: remoto,
    pedirEmailAntes: pedirEmailAntes,
    abrirModal: abrir, cerrarModal: cerrar,
    guardarProyecto: guardarProyecto, abrirProyecto: abrirProyecto,
    esc: esc, num: num, pct: pct, rend: rend, fmt: fmt, fmtCorto: fmtCorto,
    toast: toast
  };
})();
