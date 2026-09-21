/* ───────────────────────────────────────────────────────────────
   CONTROL DE OBRA — la hoja REAL, tarea por tarea

   Lo que se guarda (dentro del plan, y por eso viaja en el proyecto):

     real      { idTarea: { inicio, fin } }      uno solo por tarea:
                                                 cuando arrancó y cuándo
                                                 terminó DE VERDAD
     cortes    [ { fecha, avances: { idTarea: % } } ]
                                                 el historial: el avance
                                                 de cada tarea en cada
                                                 fecha de corte
     tolerancia { adelanto, atraso }             en puntos de avance

   Los números los hace `Plan.controlar`. Acá se dibuja y se escucha.

   Un corte viejo se calcula con lo que se sabía ESE día: una tarea que
   terminó después del corte, en ese corte todavía no estaba terminada.
   Si no, la curva real del pasado cambiaría cada vez que se carga un
   fin, y la historia dejaría de ser historia.
   ─────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var M = window.Motor, P = window.Plan, A = window.App;
  if (!P || !A) return;
  var $ = function (id) { return document.getElementById(id); };
  var esc = A.esc, num = A.num, toast = A.toast;
  var hoy = function () { return new Date().toISOString().slice(0, 10); };

  function ctl() {
    var p = window.PlanUI.plan();
    if (!p.control) p.control = {};
    var c = p.control;
    if (!c.real) c.real = {};
    if (!c.cortes) c.cortes = [];
    if (!c.tolerancia) c.tolerancia = { adelanto: 5, atraso: 5 };
    return c;
  }
  function ordenar(c) { c.cortes.sort(function (a, b) { return a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0; }); }
  function corteActual() {
    var c = ctl();
    if (!c.cortes.length) c.cortes.push({ fecha: hoy(), avances: {} });
    ordenar(c);
    var sel = c.cortes.filter(function (x) { return x.fecha === c.corteSel; })[0];
    if (!sel) { sel = c.cortes[c.cortes.length - 1]; c.corteSel = sel.fecha; }
    return sel;
  }

  /* Lo real que se sabía a una fecha: inicios y fines posteriores no cuentan. */
  function realAl(fecha) {
    var c = ctl(), out = {};
    Object.keys(c.real).forEach(function (id) {
      var r = c.real[id] || {};
      out[id] = {
        inicio: r.inicio && r.inicio <= fecha ? r.inicio : '',
        fin: r.fin && r.fin <= fecha ? r.fin : ''
      };
    });
    return out;
  }

  function calcularCorte(corte) {
    var u = window.PlanUI.estado();
    if (!u || !u.cliente) return null;
    return P.controlar({
      calendario: window.PlanUI.calendario(),
      corte: corte.fecha,
      real: realAl(corte.fecha),
      avances: corte.avances,
      tolerancia: ctl().tolerancia,
      items: u.calculo.items,
      cliente: u.cliente,
      empresa: u.empresa
    });
  }

  var ultimo = null;

  /* ══════════════════ RENDER ══════════════════ */
  function render() {
    var u = window.PlanUI.estado();
    if (!u || !u.cliente) {
      $('ctl-tabla').innerHTML = '<div class="empty-state">El control se mide contra el plan calculado: ' +
        'armalo en Plan de trabajo (con “Armar el plan solo” sale en un click).</div>';
      $('ctl-curvas').innerHTML = $('ctl-historial').innerHTML = '';
      return;
    }
    var corte = corteActual();
    ultimo = calcularCorte(corte);
    pintarCortes(corte);
    pintarResumen(ultimo);
    pintarTabla(ultimo, corte);
    pintarCurvas(ultimo, corte);
    pintarHistorial();
  }

  function pintarCortes(corte) {
    var c = ctl();
    $('ctl-corte').innerHTML = c.cortes.map(function (x) {
      return '<option value="' + esc(x.fecha) + '"' + (x.fecha === corte.fecha ? ' selected' : '') + '>' +
        esc(fechaAR(x.fecha)) + '</option>';
    }).join('');
    $('ctl-cortes-cuenta').textContent = c.cortes.length + (c.cortes.length === 1 ? ' corte' : ' cortes');
    if (!$('ctl-nuevo-fecha').value) $('ctl-nuevo-fecha').value = hoy();
    $('ctl-tol-adel').value = c.tolerancia.adelanto;
    $('ctl-tol-atr').value = c.tolerancia.atraso;
  }

  function fechaAR(iso) {
    if (!iso) return '—';
    return iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
  }

  function pintarResumen(r) {
    $('ctl-ini-real').textContent = fechaAR(r.inicioReal);
    $('ctl-fin-cliente').textContent = fechaAR(r.finCliente);
    $('ctl-fin-empresa').textContent = fechaAR(r.finEmpresa);
    $('ctl-fin-esperado').textContent = fechaAR(r.finEsperado);
    var d = r.desvioDias;
    $('ctl-desvio').textContent = d === null ? '—'
      : d === 0 ? 'en fecha' : (d > 0 ? d + ' días de atraso' : (-d) + ' días de adelanto');
    $('ctl-desvio').style.color = d > 0 ? '' : '#5fd48a';
    $('ctl-cuenta').textContent = r.cuentan.finalizadas + ' terminadas · ' + r.cuentan.enEjecucion +
      ' en ejecución · ' + r.cuentan.noIniciadas + ' sin empezar · avance de obra ' + num(r.avanceObra * 100) +
      '% (plan cliente ' + num(r.esperadoCliente * 100) + '%)';
  }

  function tagSituacion(s) {
    var cls = s === 'atrasada' ? 'mal' : s === 'adelantada' ? 'bien' : s === 'en fecha' ? 'ok' : 'nada';
    return '<span class="sit ' + cls + '">' + esc(s) + '</span>';
  }
  function tagEstado(e) {
    var cls = e === 'finalizada' ? 'fin' : e === 'en ejecucion' ? 'eje' : 'no';
    return '<span class="est ' + cls + '">' + esc(e === 'en ejecucion' ? 'en ejecución' : e) + '</span>';
  }

  function pintarTabla(r, corte) {
    var c = ctl();
    var filas = r.filas.map(function (f) {
      var real = c.real[f.id] || {};
      var terminada = !!(real.fin && real.fin <= corte.fecha);
      var av = terminada ? 100 : corte.avances[f.id];
      var finDespues = real.fin && real.fin > corte.fecha;
      return '<tr data-ctl="' + f.id + '"' + (f.critica ? ' class="critica"' : '') + '>' +
        '<td class="cod">' + esc(f.code) + '</td>' +
        '<td>' + esc(f.desc || '—') + '</td>' +
        '<td class="fecha">' + fechaAR(f.inicioPlan) + '<br><span class="text-muted">' + fechaAR(f.finPlan) + '</span></td>' +
        '<td><input type="date" data-campo="inicio" value="' + esc(real.inicio || '') + '"></td>' +
        '<td class="der"><input class="mini" type="number" min="0" max="100" step="1" data-campo="avance" ' +
          'value="' + (av === undefined || av === null ? '' : av) + '" placeholder="%"' +
          (terminada ? ' disabled title="Terminó: el avance es 100%"' : '') + '></td>' +
        '<td class="fecha"><strong>' + fechaAR(f.finEsperado) + '</strong>' +
          (f.duracionEstimada ? '<br><span class="text-muted">' + f.duracionEstimada + ' d al ritmo real</span>' : '') + '</td>' +
        '<td><input type="date" data-campo="fin" value="' + esc(real.fin || '') + '"' +
          (finDespues ? ' title="Terminó después de este corte: en este corte todavía no contaba"' : '') + '></td>' +
        '<td>' + tagEstado(f.estado) + '</td>' +
        '<td class="der">' + num(f.esperadoCliente * 100) + '%<br>' + tagSituacion(f.situacionCliente) + '</td>' +
        '<td class="der">' + num(f.esperadoEmpresa * 100) + '%<br>' + tagSituacion(f.situacionEmpresa) + '</td>' +
        '</tr>';
    }).join('');
    $('ctl-tabla').innerHTML = '<div class="tabla-scroll"><table class="grilla ctl-grilla"><thead><tr>' +
      '<th>Código</th><th>Tarea</th><th>Plan<br>inicio / fin</th><th>Inicio real</th>' +
      '<th class="der">Avance<br>al corte</th><th>Fin esperado</th><th>Fin real</th><th>Estado</th>' +
      '<th class="der">Esperado<br>cliente</th><th class="der">Esperado<br>empresa</th>' +
      '</tr></thead><tbody>' + filas + '</tbody>' +
      '<tfoot><tr><td colspan="4" class="der"><strong>OBRA</strong></td>' +
      '<td class="der"><strong>' + num(r.avanceObra * 100) + '%</strong></td>' +
      '<td class="fecha"><strong>' + fechaAR(r.finEsperado) + '</strong></td><td colspan="2"></td>' +
      '<td class="der">' + num(r.esperadoCliente * 100) + '%</td>' +
      '<td class="der">' + num(r.esperadoEmpresa * 100) + '%</td></tr></tfoot></table></div>';
  }

  /* ── las curvas, en el tiempo ─────────────────────────────────── */
  function pintarCurvas(r, corte) {
    var u = window.PlanUI.estado();
    var c = ctl();
    var desde = [u.cliente.inicio, r.inicioReal].filter(Boolean).sort()[0];
    var hasta = [r.finCliente, r.finEmpresa, r.finEsperado, corte.fecha].filter(Boolean).sort().pop();
    var t0 = P.aFecha(desde).getTime(), t1 = P.aFecha(hasta).getTime();
    if (t1 <= t0) t1 = t0 + 30 * 86400000;

    // puntos: cada fin de mes y cada corte
    var fechas = [];
    var m = P.aFecha(desde);
    m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), 1, 12));
    while (m.getTime() <= t1 + 31 * 86400000) {
      var fm = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 0, 12));
      fechas.push(P.iso(fm));
      m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1, 12));
    }
    fechas = fechas.filter(function (f) { return P.aFecha(f).getTime() <= t1; });
    fechas.unshift(desde); fechas.push(hasta);

    /* EN PLATA, como se miran (Juan, 21-09-2026):
         CLIENTE  a PRECIO (costo x K, sin IVA): lo que se le certifica.
         EMPRESA  a COSTO: lo que sale hacer la obra, a su ritmo interno.
         REAL y PROYECTADA a COSTO: se comparan contra el plan de la
           empresa. A precio iban por arriba de la curva de la empresa aun
           sin avance, que era mentira.
       La del cliente termina mas arriba, en el precio. */
    var precio = u.calculo.precioSinIva || 0, costoObra = u.calculo.costo || 0;
    var tope = Math.max(precio, costoObra) || 1;
    var W = 900, H = 320, ml = 62, mr = 16, mt = 14, mb = 44;
    var X = function (f) { return ml + (P.aFecha(f).getTime() - t0) / (t1 - t0) * (W - ml - mr); };
    var Y = function (v) { return mt + (1 - Math.max(0, Math.min(1, v / tope))) * (H - mt - mb); };
    var plata = function (v) { return A.fmtCorto(v); };
    function camino(pts) {
      return pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    }

    // cada curva termina cuando llega a su total: sin cola horizontal
    function cortarEn(fin) {
      return fechas.filter(function (f) { return f < fin; }).concat(fin ? [fin] : []);
    }
    var ptsC = cortarEn(r.finCliente).map(function (f) { return [X(f), Y(r.planClienteAl(f) * precio)]; });
    var ptsE = cortarEn(r.finEmpresa).map(function (f) { return [X(f), Y(r.planEmpresaAl(f) * costoObra)]; });

    // la real: el avance de obra de cada corte hasta el que se mira
    var ptsR = [[X(desde), Y(0)]];
    c.cortes.filter(function (x) { return x.fecha <= corte.fecha; }).forEach(function (x) {
      var rx = x === corte ? r : calcularCorte(x);
      if (rx) ptsR.push([X(x.fecha), Y(rx.avanceObra * costoObra)]);
    });
    // la proyectada: desde el corte hasta el fin esperado
    var ptsP = [[X(corte.fecha), Y(r.avanceObra * costoObra)]];
    fechas.filter(function (f) { return f > corte.fecha && f <= r.finEsperado; })
      .concat(r.finEsperado > corte.fecha ? [r.finEsperado] : [])
      .forEach(function (f) { ptsP.push([X(f), Y(r.proyectadoAl(f) * costoObra)]); });

    var grilla = [0, 0.25, 0.5, 0.75, 1].map(function (q) {
      var v = q * tope;
      return '<line x1="' + ml + '" y1="' + Y(v) + '" x2="' + (W - mr) + '" y2="' + Y(v) + '" class="c-grilla"/>' +
        '<text x="' + (ml - 8) + '" y="' + (Y(v) + 4) + '" class="c-eje der">' + plata(v) + '</text>';
    }).join('');
    var meses = fechas.slice(1, -1).map(function (f) {
      var d = P.aFecha(f);
      return '<text x="' + X(f) + '" y="' + (H - mb + 16) + '" class="c-eje medio">' +
        d.toLocaleDateString('es-AR', { month: 'short', year: '2-digit', timeZone: 'UTC' }) + '</text>';
    }).join('');
    var lineaCorte = '<line x1="' + X(corte.fecha) + '" y1="' + mt + '" x2="' + X(corte.fecha) + '" y2="' + (H - mb) +
      '" class="c-corte"/><text x="' + (X(corte.fecha) + 4) + '" y="' + (mt + 10) + '" class="c-eje">corte ' +
      fechaAR(corte.fecha) + '</text>';

    $('ctl-curvas').innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="curvas" role="img" ' +
      'aria-label="Curvas de avance: cliente, empresa, real y proyección">' + grilla + meses + lineaCorte +
      '<path d="' + camino(ptsC) + '" class="c-cliente"/>' +
      '<path d="' + camino(ptsE) + '" class="c-empresa"/>' +
      (ptsR.length > 1 ? '<path d="' + camino(ptsR) + '" class="c-real"/>' : '') +
      ptsR.slice(1).map(function (p) { return '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3.5" class="c-real-pt"/>'; }).join('') +
      (ptsP.length > 1 ? '<path d="' + camino(ptsP) + '" class="c-proy"/>' : '') +
      '</svg>' +
      '<div class="c-leyenda">' +
      '<span><i class="c-m-cliente"></i> Cliente, a precio con K · ' + plata(precio) + ' · fin ' + fechaAR(r.finCliente) + '</span>' +
      '<span><i class="c-m-empresa"></i> Empresa, a costo · ' + plata(costoObra) + ' · fin ' + fechaAR(r.finEmpresa) + '</span>' +
      '<span><i class="c-m-real"></i> Real, a costo · ' + plata(r.avanceObra * costoObra) + ' (' + num(r.avanceObra * 100) + '%)</span>' +
      '<span><i class="c-m-proy"></i> Proyectada, a costo · fin ' + fechaAR(r.finEsperado) + '</span>' +
      '</div>';
  }

  function pintarHistorial() {
    var c = ctl(), u = window.PlanUI.estado();
    if (!c.cortes.length) { $('ctl-historial').innerHTML = ''; return; }
    var obra = c.cortes.map(function (x) { var rx = calcularCorte(x); return rx ? rx.avanceObra : 0; });
    $('ctl-historial').innerHTML = '<div class="tabla-scroll"><table class="grilla"><thead><tr>' +
      '<th>Código</th><th>Tarea</th>' +
      c.cortes.map(function (x) { return '<th class="der">' + esc(fechaAR(x.fecha)) + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      u.calculo.items.map(function (it) {
        return '<tr><td class="cod">' + esc(it.code) + '</td><td>' + esc(it.desc || '') + '</td>' +
          c.cortes.map(function (x) {
            var real = c.real[it.id] || {};
            var v = real.fin && real.fin <= x.fecha ? 100 : x.avances[it.id];
            return '<td class="der">' + (v === undefined || v === '' ? '<span class="text-muted">·</span>' : num(v) + '%') + '</td>';
          }).join('') + '</tr>';
      }).join('') + '</tbody><tfoot><tr><td colspan="2" class="der"><strong>OBRA</strong></td>' +
      obra.map(function (v) { return '<td class="der"><strong>' + num(v * 100) + '%</strong></td>'; }).join('') +
      '</tr></tfoot></table></div>';
  }

  /* ══════════════════ EVENTOS ══════════════════ */
  var t = null;
  function guardarYRender(demora) {
    clearTimeout(t);
    t = setTimeout(function () { A.guardar(); render(); }, demora || 0);
  }

  function conectar() {
    $('ctl-corte').onchange = function () { ctl().corteSel = this.value; guardarYRender(); };
    $('ctl-nuevo').onclick = function () {
      var f = $('ctl-nuevo-fecha').value;
      if (!f) { toast('Poné la fecha del corte', 'error'); return; }
      var c = ctl();
      if (c.cortes.some(function (x) { return x.fecha === f; })) {
        c.corteSel = f; guardarYRender(); toast('Ese corte ya existe: lo abrí', 'aviso'); return;
      }
      ordenar(c);
      // arranca con los avances del corte anterior: sólo se cambia lo que se movió
      var previo = c.cortes.filter(function (x) { return x.fecha < f; }).pop();
      c.cortes.push({ fecha: f, avances: previo ? JSON.parse(JSON.stringify(previo.avances)) : {} });
      c.corteSel = f;
      guardarYRender();
      toast('Corte al ' + fechaAR(f) + ' creado' + (previo ? ', con los avances del ' + fechaAR(previo.fecha) : ''), 'ok');
    };
    $('ctl-borrar-corte').onclick = function () {
      var c = ctl();
      if (c.cortes.length <= 1) { toast('Es el único corte: no se borra', 'aviso'); return; }
      if (!confirm('¿Borrar el corte al ' + fechaAR(c.corteSel) + ' y sus avances?')) return;
      c.cortes = c.cortes.filter(function (x) { return x.fecha !== c.corteSel; });
      c.corteSel = null;
      guardarYRender();
    };
    $('ctl-tol-adel').onchange = function () { ctl().tolerancia.adelanto = M.safeNum(this.value); guardarYRender(); };
    $('ctl-tol-atr').onchange = function () { ctl().tolerancia.atraso = M.safeNum(this.value); guardarYRender(); };

    $('ctl-tabla').addEventListener('change', function (e) {
      var tr = e.target.closest('tr');
      var campo = e.target.getAttribute('data-campo');
      if (!tr || !campo) return;
      var id = tr.getAttribute('data-ctl');
      var c = ctl(), corte = corteActual();
      if (campo === 'avance') {
        if (e.target.value === '') delete corte.avances[id];
        else corte.avances[id] = Math.max(0, Math.min(100, M.safeNum(e.target.value)));
      } else {
        if (!c.real[id]) c.real[id] = {};
        c.real[id][campo] = e.target.value;
        if (campo === 'fin' && e.target.value && !c.real[id].inicio) {
          toast('Tiene fecha de fin pero no de inicio: cargá cuándo arrancó', 'aviso');
        }
      }
      guardarYRender(150);
    });
  }

  window.ControlUI = { render: render, estado: function () { return ultimo; }, ctl: ctl, calcularCorte: calcularCorte };
  conectar();
})();
