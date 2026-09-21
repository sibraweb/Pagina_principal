/* ───────────────────────────────────────────────────────────────
   PANTALLA DEL PLAN DE TRABAJO

   Los numeros los hace `plan.js`; aca solo se dibuja y se escucha.
   La division es la misma que en el resto de la app: si esta pantalla
   calculara por su cuenta, el gantt y el Excel podrian decir cosas
   distintas y no habria forma de saber cual miente.

   DOS CAMINOS AL MISMO PLAN:

     calculado  se declaran predecesoras y un rendimiento diario, y
                las fechas salen del CPM. Es el que da ruta critica
                y holguras.

     rapido     no se declara nada: se escribe a mano cuanto avanza
                cada tarea en cada mes. No hay fechas ni holgura,
                pero hay curva y materiales por mes, que es lo que
                se necesita para pedir la plata y comprar.

   El plan se guarda con el presupuesto: si se pierde, hay que volver
   a cargar rendimientos y predecesoras a mano, que es el trabajo caro.
   ─────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var M = window.Motor, P = window.Plan, D = window.Datos, A = window.App;
  if (!P || !A) return;

  var $ = function (id) { return document.getElementById(id); };
  var esc = A.esc, num = A.num, fmt = A.fmt, fmtCorto = A.fmtCorto, toast = A.toast;

  /* Lo que el usuario carga. Vive dentro del estado de la app para que
     se guarde, se exporte y se recupere junto con todo lo demas. */
  function plan() {
    var e = A.estado();
    if (!e.plan) {
      e.plan = {
        modo: 'calculado',
        fechaInicio: new Date().toISOString().slice(0, 10),
        baseline: 'cliente',
        meses: 6,
        sabado: false, domingo: false,   // el sabado NO es laborable
        jornada: 8, frente: 2,           // con esto la duracion sale sola
        factorEmpresa: 1.2,              // el ritmo empresa, sobre el del cliente
        feriadosOff: {},                 // los nacionales que en ESTA obra se trabajan
        feriadosPropios: [],             // provinciales, del pueblo, del gremio
        corte: '',                       // el dia hasta el cual esta medida la obra
        tareas: {},                      // id -> {predecesoras, cliente:{...}, empresa:{...}}
        avances: {},                     // id -> {1: 40, 2: 60}  (gantt rapido)
        certificado: {},                 // numero de mes -> % acumulado certificado
        realInicio: '', realFin: ''      // cuando arranco y cuando termino DE VERDAD
      };
    }
    return e.plan;
  }

  var ultimo = null;        // {programacion, reparto, curvas}
  var recetas = {};         // codigo de tarea -> rendimientos
  var soloCriticas = false;

  /* ── helpers ──────────────────────────────────────────────── */
  /* El calendario con los feriados puestos. Hasta ahora `calendario()`
     los aceptaba y nadie se los pasaba: el plan contaba el 25 de mayo
     como dia trabajado. */
  function cal() {
    var p = plan();
    return P.calendario({
      sabado: !!p.sabado, domingo: !!p.domingo,
      feriados: feriadosActivos().map(function (f) { return f.fecha; })
    });
  }

  /* ── los feriados que se estan usando ─────────────────────────
     Los nacionales se calculan para los años que toca la obra. Los que
     en esta obra si se trabajan se destildan, y los propios se agregan:
     el feriado provincial, la fiesta del pueblo, la semana que para el
     gremio. Todo se guarda con el proyecto.                          */
  function periodoObra() {
    var p = plan();
    var desde = p.fechaInicio || new Date().toISOString().slice(0, 10);
    var hasta = (ultimo && ultimo.programacion && ultimo.programacion.fin)
      || (ultimo && ultimo.reparto.meses.length && ultimo.reparto.meses[ultimo.reparto.meses.length - 1].fin)
      || (desde.slice(0, 4) + '-12-31');
    // siempre al menos un año, para que la lista no salga vacia al empezar
    var min = P.iso(new Date(new Date(desde).getTime() + 365 * 86400000));
    return { desde: desde, hasta: hasta > min ? hasta : min };
  }

  function feriadosDelPeriodo() {
    var p = plan(), per = periodoObra();
    var nac = P.feriadosEntre(per.desde, per.hasta).map(function (f) {
      return { fecha: f.fecha, nombre: f.nombre, tipo: f.tipo, propio: false,
               activo: !p.feriadosOff[f.fecha + '|' + f.nombre] };
    });
    var mios = (p.feriadosPropios || []).filter(function (f) {
      return f.fecha >= per.desde && f.fecha <= per.hasta;
    }).map(function (f) {
      return { fecha: f.fecha, nombre: f.nombre, tipo: 'propio', propio: true, activo: true };
    });
    return nac.concat(mios).sort(function (a, b) { return a.fecha < b.fecha ? -1 : 1; });
  }
  function feriadosActivos() {
    return feriadosDelPeriodo().filter(function (f) { return f.activo; });
  }

  function pintarFeriados() {
    var todos = feriadosDelPeriodo(), activos = todos.filter(function (f) { return f.activo; });
    $('feriados-cuenta').textContent = activos.length + ' día(s) no laborables';
    $('feriados-resumen').innerHTML = activos.length
      ? '<div class="feriados-chips">' + activos.slice(0, 14).map(function (f) {
          return '<span class="feriado-chip' + (f.propio ? ' propio' : '') + '">' +
            esc(f.fecha.slice(8) + '/' + f.fecha.slice(5, 7)) + ' <b>' + esc(f.nombre) + '</b></span>';
        }).join('') +
        (activos.length > 14 ? '<span class="text-muted">y ' + (activos.length - 14) + ' más</span>' : '') +
        '</div>'
      : '<div class="text-muted">Ninguno: se trabaja todos los días hábiles.</div>';

    var lista = $('feriados-lista');
    if (!lista) return;
    lista.innerHTML = todos.map(function (f) {
      return '<label class="pred-op">' +
        '<input type="checkbox" data-feriado="' + esc(f.fecha + '|' + f.nombre) + '"' +
          (f.activo ? ' checked' : '') + (f.propio ? ' disabled' : '') + '>' +
        '<span class="cod">' + esc(f.fecha) + '</span>' +
        '<span class="pred-desc">' + esc(f.nombre) + '</span>' +
        (f.propio
          ? '<button class="icon-btn peligro" data-borrar-feriado="' + esc(f.fecha + '|' + f.nombre) + '">quitar</button>'
          : '<span class="text-muted">' + esc(f.tipo) + '</span>') +
        '</label>';
    }).join('');
  }

  /* ── la fecha de corte ────────────────────────────────────────
     Sin decir a que dia esta medida la obra, un 60% certificado no
     dice nada: contra el calendario puede ser un mes de adelanto o un
     mes de atraso. Por defecto es hoy, pero se fija a mano porque el
     certificado casi nunca cierra el ultimo dia del mes.             */
  function fechaCorte() {
    var p = plan();
    if (p.corte) return p.corte;
    return new Date().toISOString().slice(0, 10);
  }
  function nodo(id) {
    var p = plan();
    if (!p.tareas[id]) p.tareas[id] = { predecesoras: [], cliente: {}, empresa: {} };
    var n = p.tareas[id];
    if (!n.cliente) n.cliente = {};
    if (!n.empresa) n.empresa = {};
    if (!n.predecesoras) n.predecesoras = [];
    return n;
  }
  function ritmo(id) { return nodo(id)[plan().baseline] || {}; }

  /* ── LA DURACION NO HAY QUE CARGARLA ──────────────────────────
     Las horas de mano de obra ya estan en el analisis unitario. Lo que
     NO se puede hacer es sumarlas: el ayudante no levanta la pared.

     El azotado lleva 0,30 h de oficial y 0,10 de ayudante por m2. Si se
     suman da 0,40 Hh/m2 y con dos personas saldrian 40 m2 por dia. Pero
     los dos oficiales de la cuadrilla ponen 16 horas y 16/0,30 son
     53 m2: el ayudante termina a media mañana. Sumando, el rendimiento
     se sobrestimaba hasta un 54% (piso ceramico, pintura).

     LA REGLA: manda el OFICIAL. Ayudantes siempre hay de mas, asi que
     nunca son el cuello de botella; el oficial si. La cuadrilla son dos
     oficiales y un ayudante, y el ritmo lo marcan los dos oficiales.

        rendimiento = (oficiales x jornada) / horas de OFICIAL por unidad
        dias        = computo / (rendimiento x cuadrillas)

     Es un valor PROPUESTO. El que conoce su obra lo pisa y el numero
     escrito manda.                                                     */
  function horasDeOficial(code) {
    var receta = recetas[String(code || '').trim()] || [];
    var ofi = 0, total = 0;
    receta.forEach(function (d) {
      if (M.normalizarCategoria(d.category) !== 'Mano de obra') return;
      // los O05A* son mano de obra por unidad de trabajo (subcontrato)
      // y el sereno viene por mes: no son horas de cuadrilla
      if (!/^h/i.test(String(d.unit || ''))) return;
      var q = M.safeNum(d.qty);
      total += q;
      if (/OFICIAL/i.test(String(d.desc || ''))) ofi += q;
    });
    // sin oficial -una excavacion a mano es todo peon- manda el peon
    return ofi > 0 ? ofi : total;
  }
  function horasPorUnidad(code) { return horasDeOficial(code); }

  /* El plan con los rendimientos completados, que es el que se programa.
     No se toca `plan().tareas`: lo que la persona no escribio tiene que
     seguir sin escribir, para que el dia que cambie el analisis la
     duracion se mueva sola. */
  function planEfectivo() {
    var p = plan(), base = p.baseline;
    var jornada = M.safeNum(p.jornada) || 8;
    var oficiales = M.safeNum(p.frente) || 2;
    var out = {};
    A.estado().items.forEach(function (it) {
      var n = p.tareas[it.id] || {};
      var r = n[base] || {};
      var rend = M.safeNum(r.rendimiento);
      var auto = false;
      if (!rend) {
        var hOfi = horasDeOficial(it.code);
        if (hOfi > 0) { rend = (jornada * oficiales) / hOfi; auto = true; }
      }
      /* Los DOS ritmos se completan siempre: el control de obra compara el
         avance real contra el plan del cliente y contra el de la empresa.
         Si la persona no fijo el de la empresa, se propone el del cliente
         por un factor -en el Excel de gantt es x1,2: la empresa se arma el
         plan un 20% mas rapido para tener colchon-. */
      var fac = M.safeNum(p.factorEmpresa) || 1.2;
      var rc = M.safeNum((n.cliente || {}).rendimiento), re = M.safeNum((n.empresa || {}).rendimiento);
      var hOf = horasDeOficial(it.code);
      var rAuto = hOf > 0 ? (jornada * oficiales) / hOf : 0;
      var rendC = rc || (base === 'cliente' ? rend : rAuto);
      var rendE = re || (base === 'empresa' ? rend : (rendC ? rendC * fac : 0));
      out[it.id] = {
        predecesoras: (n.predecesoras || []).slice(),
        cliente: { rendimiento: rendC, cuadrillas: (n.cliente || {}).cuadrillas },
        empresa: { rendimiento: rendE, cuadrillas: (n.empresa || {}).cuadrillas || (n.cliente || {}).cuadrillas },
        _auto: auto
      };
    });
    return out;
  }
  function esAutomatico(id) {
    var r = ritmo(id);
    return !M.safeNum(r.rendimiento);
  }

  /* Las predecesoras se escriben por CODIGO, que es lo que la persona
     tiene en la cabeza, y se guardan por id, que es lo que no se repite
     cuando la misma tarea esta en dos sectores. */
  function codigosAIds(texto, propioId) {
    var items = A.estado().items;
    var out = [], noEncontrados = [];
    String(texto || '').split(/[,;]+/).forEach(function (t) {
      var c = t.trim();
      if (!c) return;
      var halladas = items.filter(function (it) {
        return String(it.code).toLowerCase() === c.toLowerCase() && it.id !== propioId;
      });
      if (!halladas.length) { noEncontrados.push(c); return; }
      halladas.forEach(function (it) { if (out.indexOf(it.id) < 0) out.push(it.id); });
    });
    return { ids: out, noEncontrados: noEncontrados };
  }
  function idsACodigos(ids) {
    var items = A.estado().items, vistos = [];
    (ids || []).forEach(function (id) {
      var it = items.filter(function (x) { return x.id === id; })[0];
      if (it && vistos.indexOf(it.code) < 0) vistos.push(it.code);
    });
    return vistos.join(', ');
  }

  /* ══════════════════ EL CALCULO ══════════════════ */
  function recalcular() {
    var p = plan();
    var c = A.calcular();
    var items = c.items || [];
    if (!items.length) { ultimo = null; return Promise.resolve(null); }

    // las recetas se piden PRIMERO: de ahi salen las horas con las que
    // se calcula la duracion de cada tarea
    return D.analisisDeVarias(items.map(function (it) { return it.code; }))
      .catch(function () { return recetas; })
      .then(function (mapa) {
        if (mapa) recetas = mapa;
        return programarYRepartir(p, c, items);
      });
  }

  function programarYRepartir(p, c, items) {
    var reparto, programacion = null;
    if (p.modo === 'rapido') {
      reparto = P.repartirAMano(items, {
        meses: p.meses, fechaInicio: p.fechaInicio, valores: p.avances
      });
    } else {
      var efectivo = planEfectivo();
      programacion = P.programar(items, efectivo, {
        calendario: cal(), fechaInicio: p.fechaInicio, baseline: p.baseline
      });
      reparto = P.repartirPorFechas(programacion, { calendario: cal() });
      // los dos ritmos, para el control de obra
      var progCliente = p.baseline === 'cliente' ? programacion
        : P.programar(items, efectivo, { calendario: cal(), fechaInicio: p.fechaInicio, baseline: 'cliente' });
      var progEmpresa = p.baseline === 'empresa' ? programacion
        : P.programar(items, efectivo, { calendario: cal(), fechaInicio: p.fechaInicio, baseline: 'empresa' });
    }

    var curvas = P.curvas(c, reparto, c.k || 1);
    ultimo = { calculo: c, programacion: programacion, reparto: reparto, curvas: curvas,
               cliente: progCliente || null, empresa: progEmpresa || null };
    return ultimo;
  }

  /* ══════════════════ RENDER ══════════════════ */
  function render() {
    return recalcular().then(function () {
      pintarConfig();
      pintarTabla();
      pintarGantt();
      pintarLookAhead();
      pintarFeriados();
      // el control de obra (hoja REAL) vive en control.js
      if (window.ControlUI) window.ControlUI.render();
      pintarMateriales();
      A.guardar();
    });
  }

  function pintarConfig() {
    var p = plan();
    $('plan-modo').value = p.modo;
    $('plan-inicio').value = p.fechaInicio;
    $('plan-baseline').value = p.baseline;
    $('plan-meses').value = p.meses;
    $('plan-jornada').value = p.jornada;
    $('plan-frente').value = p.frente;
    $('plan-sabado').checked = !!p.sabado;
    $('plan-domingo').checked = !!p.domingo;
    $('plan-campo-meses').hidden = p.modo !== 'rapido';
    $('plan-ayuda-modo').textContent = p.modo === 'rapido'
      ? 'escribí el % de avance de cada tarea en cada mes'
      : 'la cuadrilla es ' + p.frente + ' oficiales y 1 ayudante · el ritmo lo marca el oficial';

    var avisos = [];
    if (ultimo && ultimo.programacion) avisos = ultimo.programacion.avisos || [];
    if (ultimo && ultimo.reparto.incompletas && ultimo.reparto.incompletas.length) {
      avisos = avisos.concat(ultimo.reparto.incompletas.slice(0, 6).map(function (x) {
        return x.code + ': cargado ' + num(x.cargado) + '% (' +
          (x.cargado > 100 ? 'sobra ' + num(x.cargado - 100) : 'falta ' + num(100 - x.cargado)) + '%)';
      }));
      if (ultimo.reparto.incompletas.length > 6) {
        avisos.push('…y ' + (ultimo.reparto.incompletas.length - 6) + ' tareas más sin completar el 100%');
      }
    }
    /* Lo que la malla no puede saber -si hay dos plantas, si el revoque
       esta duplicado- se dice, no se inventa. */
    var deLaMalla = '';
    if (ultimaPropuesta) {
      deLaMalla = (ultimaPropuesta.avisos || []).map(function (a) {
        return '<div class="aviso-fila' + (a.grave ? ' grave' : '') + '">' +
          '<div class="aviso-marca"></div><div>' + esc(a.texto) + '</div></div>';
      }).join('');
      if (ultimaPropuesta.sinNodo.length) {
        deLaMalla += '<div class="aviso-fila"><div class="aviso-marca"></div><div>' +
          '<strong>' + ultimaPropuesta.sinNodo.length + ' tarea(s) sin ubicar en la malla:</strong> ' +
          esc(ultimaPropuesta.sinNodo.slice(0, 8).map(function (x) { return x.code; }).join(', ')) +
          (ultimaPropuesta.sinNodo.length > 8 ? '…' : '') +
          '. Arrancan con la obra; atalas a mano si van después de algo.</div></div>';
      }
    }
    $('plan-avisos').innerHTML = deLaMalla + (avisos.length
      ? '<div class="aviso-fila"><div class="aviso-marca"></div><div>' +
        avisos.map(esc).join('<br>') + '</div></div>'
      : '');

    if (!ultimo) { $('plan-resumen').textContent = '—'; return; }
    if (ultimo.programacion) {
      var pr = ultimo.programacion;
      var criticas = pr.tareas.filter(function (t) { return t.critica; }).length;
      $('plan-resumen').textContent = pr.duracionObra + ' días hábiles · ' +
        ultimo.reparto.meses.length + ' meses · ' + criticas + ' en ruta crítica';
    } else {
      $('plan-resumen').textContent = ultimo.reparto.meses.length + ' meses';
    }
  }

  /* ── la grilla de tareas ───────────────────────────────────── */
  function pintarTabla() {
    var cont = $('plan-tabla');
    if (!ultimo) {
      cont.innerHTML = '<div class="empty-state">Cargá el cómputo primero: el plan se arma sobre esas tareas</div>';
      return;
    }
    var p = plan();
    cont.innerHTML = p.modo === 'rapido' ? tablaRapida() : tablaCalculada();
  }

  /* La tabla arranca en el hito INICIO y termina en el hito FIN.
     Antes esos dos eran invisibles y "va despues de" mostraba un guion:
     cuatro tareas arrancando el mismo dia se veian igual que un plan
     bien armado, y no habia forma de distinguir la decision del olvido.

     La regla: toda tarea tiene predecesora y sucesora. La unica que
     puede colgar del INICIO es la primera, y la unica que puede no
     tener sucesora es la que cierra la obra. Todo lo demas suelto se
     marca en la fila y se cuenta arriba.                             */
  function tablaCalculada() {
    var pr = ultimo.programacion;
    var sueltas = 0;

    var filas = pr.tareas.map(function (t) {
      var r = ritmo(t.id);
      var colgadaDeMas = t.desdeInicio && pr.desdeInicio.length > 1;
      var sinSalida = t.hastaFin && pr.hastaFin.length > 1;
      if (colgadaDeMas || sinSalida) sueltas++;

      var celdaPred = t.predecesoras.length
        ? '<span class="pred-chips">' + idsACodigos(t.predecesoras).split(', ').map(function (c) {
            return '<span class="pred-chip">' + esc(c) + '</span>';
          }).join('') + '</span>'
        : '<span class="pred-inicio' + (colgadaDeMas ? ' suelta' : '') + '">INICIO</span>';

      return '<tr data-plan="' + t.id + '"' + (t.critica ? ' class="critica"' : '') + '>' +
        '<td class="cod">' + esc(t.code) + '</td>' +
        '<td>' + esc(t.desc || '—') +
          (sinSalida ? ' <span class="tag suelta" title="No es predecesora de ninguna otra: ' +
                       'no llega al FIN">sin sucesora</span>' : '') +
          (window.Malla && Malla.nodoDe(t.code)
            ? '<span class="nodo-tag">' + esc(Malla.nodoDe(t.code).nombre) + '</span>' : '') + '</td>' +
        '<td class="der">' + num(t.qty) + ' <span class="text-muted">' + esc(t.unit) + '</span></td>' +
        '<td class="der"><input class="mini' + (esAutomatico(t.id) ? ' auto' : '') + '" type="number" ' +
          'step="any" data-campo="rendimiento" value="' + (r.rendimiento || '') + '" ' +
          'placeholder="' + (t.rendimiento ? num(t.rendimiento) : '—') + '" ' +
          'title="' + (esAutomatico(t.id)
            ? 'el análisis pide ' + esc(num(horasDeOficial(t.code))) + ' h de oficial por ' + esc(t.unit) +
              '; con ' + plan().frente + ' oficiales de ' + plan().jornada + ' h salen ' + esc(num(t.rendimiento)) +
              ' por día. Escribí si en tu obra rinde otra cosa.'
            : 'lo estás fijando a mano') + '"></td>' +
        '<td class="der"><input class="mini" type="number" step="1" min="1" data-campo="cuadrillas" ' +
          'value="' + (r.cuadrillas || '') + '" placeholder="1"></td>' +
        '<td class="der"><strong>' + t.duracion + '</strong> <span class="text-muted">d</span></td>' +
        '<td><button class="pred-btn" data-pred="' + t.id + '" ' +
          'title="Elegir de qué tareas depende">' + celdaPred + '</button></td>' +
        '<td class="fecha">' + esc(t.inicio) + '</td>' +
        '<td class="fecha">' + esc(t.fin) + '</td>' +
        '<td class="der">' + (t.critica
          ? '<span class="tag critica">crítica</span>'
          : '<span class="text-muted">' + t.holgura + ' d</span>') + '</td>' +
        '</tr>';
    }).join('');

    var hitoInicio = '<tr class="hito"><td class="cod">—</td>' +
      '<td><strong>INICIO DE OBRA</strong> <span class="text-muted">hito</span></td>' +
      '<td colspan="4"></td>' +
      '<td class="text-muted">' + pr.desdeInicio.length + ' tarea(s) arrancan acá</td>' +
      '<td class="fecha">' + esc(pr.primerDia || pr.inicio) + '</td><td colspan="2"></td></tr>';

    var hitoFin = '<tr class="hito"><td class="cod">—</td>' +
      '<td><strong>FIN DE OBRA</strong> <span class="text-muted">hito</span></td>' +
      '<td colspan="4"></td>' +
      '<td class="text-muted">va después de ' + esc(idsACodigos(pr.hastaFin) || '—') + '</td>' +
      '<td class="fecha"></td><td class="fecha">' + esc(pr.fin) + '</td>' +
      '<td class="der"><strong>' + pr.duracionObra + ' d</strong></td></tr>';

    var nota = sueltas
      ? '<div class="aviso-fila"><div class="aviso-marca"></div><div>' +
        '<strong>' + sueltas + ' tarea(s) sueltas.</strong> Cada tarea tiene que ir después de alguna y ' +
        'antes de alguna: sólo la primera cuelga del INICIO y sólo la última llega al FIN. ' +
        'Las sueltas arrancan todas el primer día y el plazo de obra queda más corto de lo que es.</div></div>'
      : '';

    return nota + '<div class="tabla-scroll"><table class="grilla plan-grilla"><thead><tr>' +
      '<th>Código</th><th>Tarea</th><th class="der">Cómputo</th>' +
      '<th class="der" title="Cuánto hace una cuadrilla por día">Rend. diario</th>' +
      '<th class="der">Cuadr.</th><th class="der">Duración</th>' +
      '<th>Va después de</th><th>Inicio</th><th>Fin</th><th class="der">Holgura</th>' +
      '</tr></thead><tbody>' + hitoInicio + filas + hitoFin + '</tbody></table></div>';
  }

  /* ── el selector de predecesoras ──────────────────────────────
     Antes habia que escribir el codigo de memoria en un campo de texto.
     Con 40 tareas eso es imposible: ahora se filtra y se marca.

     Las que crearian un circulo quedan deshabilitadas, no ocultas: si
     una tarea no se puede elegir conviene que se vea por que.        */
  var predAbierta = null;

  function esAlcanzable(desde, hasta, visto) {
    // ¿`hasta` depende, directa o indirectamente, de `desde`?
    if (desde === hasta) return true;
    visto = visto || {};
    if (visto[hasta]) return false;
    visto[hasta] = true;
    var pr = ultimo && ultimo.programacion;
    if (!pr) return false;
    var t = pr.tareas.filter(function (x) { return x.id === hasta; })[0];
    if (!t) return false;
    return t.predecesoras.some(function (p) { return esAlcanzable(desde, p, visto); });
  }

  function abrirPredecesoras(id) {
    predAbierta = id;
    var it = A.estado().items.filter(function (x) { return x.id === id; })[0];
    $('pred-titulo').textContent = '¿Después de qué va ' + (it ? it.code : '') + '?';
    $('pred-buscar').value = '';
    pintarListaPred();
    A.abrirModal('modal-pred');
    $('pred-buscar').focus();
  }

  function pintarListaPred() {
    var id = predAbierta;
    if (id === null) return;
    var q = $('pred-buscar').value.trim().toLowerCase();
    var elegidas = nodo(id).predecesoras || [];
    var filas = A.estado().items.filter(function (it) {
      if (it.id === id) return false;
      if (!q) return true;
      return String(it.code).toLowerCase().indexOf(q) > -1 ||
             String(it.desc || '').toLowerCase().indexOf(q) > -1;
    });

    $('pred-lista').innerHTML = filas.length ? filas.map(function (it) {
      var marcada = elegidas.indexOf(it.id) > -1;
      // elegirla haria que esta tarea dependa de si misma
      var circulo = !marcada && esAlcanzable(id, it.id);
      return '<label class="pred-op' + (circulo ? ' no' : '') + '">' +
        '<input type="checkbox" data-pred-id="' + it.id + '"' +
          (marcada ? ' checked' : '') + (circulo ? ' disabled' : '') + '>' +
        '<span class="cod">' + esc(it.code) + '</span>' +
        '<span class="pred-desc">' + esc(it.desc || '') +
          (it.sector ? ' <span class="text-muted">· ' + esc(it.sector) + '</span>' : '') + '</span>' +
        (circulo ? '<span class="text-muted">ya depende de ésta</span>' : '') +
        '</label>';
    }).join('') : '<div class="empty-state">Nada con ese texto</div>';

    $('pred-cuenta').textContent = elegidas.length
      ? elegidas.length + ' elegida(s)'
      : 'ninguna: arranca con la obra';
  }

  function tablaRapida() {
    var meses = ultimo.reparto.meses;
    var p = plan();
    var filas = ultimo.calculo.items.map(function (it) {
      var fila = p.avances[it.id] || {};
      var suma = meses.reduce(function (s, m) { return s + M.safeNum(fila[m.numero]); }, 0);
      var estado = Math.abs(suma - 100) < 0.5
        ? '<span class="tag ok">100%</span>'
        : '<span class="tag aviso">' + num(suma) + '%</span>';
      return '<tr data-plan="' + it.id + '">' +
        '<td class="cod">' + esc(it.code) + '</td>' +
        '<td>' + esc(it.desc || '—') + '</td>' +
        meses.map(function (m) {
          return '<td class="der"><input class="mini" type="number" step="any" min="0" max="100" ' +
            'data-avance="' + m.numero + '" value="' + (fila[m.numero] !== undefined ? fila[m.numero] : '') +
            '" placeholder="—"></td>';
        }).join('') +
        '<td class="der">' + estado + '</td></tr>';
    }).join('');

    return '<div class="tabla-scroll"><table class="grilla plan-grilla"><thead><tr>' +
      '<th>Código</th><th>Tarea</th>' +
      meses.map(function (m) { return '<th class="der">' + esc(m.label) + '</th>'; }).join('') +
      '<th class="der">Cargado</th></tr></thead><tbody>' + filas + '</tbody></table></div>';
  }

  /* ── el gantt ──────────────────────────────────────────────── */
  function pintarGantt() {
    var cont = $('plan-gantt');
    if (!ultimo) { cont.innerHTML = '<div class="empty-state">Sin plan todavía</div>'; return; }

    var meses = ultimo.reparto.meses;
    var filas = ultimo.calculo.items.filter(function (it) {
      if (!soloCriticas || !ultimo.programacion) return true;
      var t = ultimo.programacion.tareas.filter(function (x) { return x.id === it.id; })[0];
      return t && t.critica;
    });
    if (!filas.length) {
      cont.innerHTML = '<div class="empty-state">Nada para mostrar con ese filtro</div>';
      return;
    }

    var html = '<div class="tabla-scroll"><table class="gantt"><thead><tr>' +
      '<th class="g-tarea">Tarea</th>' +
      meses.map(function (m) { return '<th class="g-mes">' + esc(m.label) + '</th>'; }).join('') +
      '</tr></thead><tbody>';

    filas.forEach(function (it) {
      var fr = ultimo.reparto.fraccion[it.id] || [];
      var t = ultimo.programacion
        ? ultimo.programacion.tareas.filter(function (x) { return x.id === it.id; })[0]
        : null;
      var titulo = (t && t.critica) ? ' class="critica"' : '';
      html += '<tr' + titulo + '><td class="g-tarea" title="' + esc(it.desc) + '">' +
        '<span class="cod">' + esc(it.code) + '</span> ' + esc((it.desc || '').slice(0, 34)) +
        (t ? '<span class="g-fechas">' + esc(t.inicio) + ' → ' + esc(t.fin) + '</span>' : '') +
        '</td>';
      meses.forEach(function (m, i) {
        var f = fr[i] || 0;
        if (f <= 0.0001) { html += '<td class="g-mes"></td>'; return; }
        // el ancho de la barra ES la parte de la tarea que cae en el mes
        html += '<td class="g-mes"><div class="g-barra' + (t && t.critica ? ' critica' : '') + '" ' +
          'style="width:' + Math.max(8, f * 100).toFixed(1) + '%" ' +
          'title="' + num(f * 100) + '% de la tarea en ' + esc(m.label) + '">' +
          (f > 0.28 ? num(f * 100) + '%' : '') + '</div></td>';
      });
      html += '</tr>';
    });

    // la fila de abajo: cuanto de la obra cae en cada mes
    var c = ultimo.curvas;
    html += '</tbody><tfoot><tr><td class="g-tarea"><strong>AVANCE DEL MES</strong></td>' +
      c.meses.map(function (m) {
        return '<td class="g-mes"><div class="g-avance" style="height:' +
          Math.min(100, m.avancePct * 2.2).toFixed(1) + '%" title="' + num(m.avancePct) + '% de la obra"></div>' +
          '<span class="g-pct">' + num(m.avancePct) + '%</span></td>';
      }).join('') + '</tr></tfoot></table></div>';

    cont.innerHTML = html;
  }

  /* ── look ahead semanal ────────────────────────────────────── */
  function pintarLookAhead() {
    var cont = $('plan-lookahead');
    if (!ultimo || !ultimo.programacion) {
      cont.innerHTML = '<div class="empty-state">El look ahead necesita fechas: es el plan calculado, ' +
        'no el gantt rápido</div>';
      return;
    }
    var desde = P.aFecha($('plan-la-desde').value) || P.aFecha(ultimo.programacion.inicio);
    var n = Math.max(2, Math.min(12, parseInt($('plan-la-semanas').value, 10) || 4));
    var c = cal();

    // las semanas arrancan el lunes
    var lunes = new Date(desde.getTime());
    while (lunes.getUTCDay() !== 1) lunes = new Date(lunes.getTime() - 86400000);

    var semanas = [];
    for (var i = 0; i < n; i++) {
      var a = new Date(lunes.getTime() + i * 7 * 86400000);
      var b = new Date(a.getTime() + 6 * 86400000);
      semanas.push({
        inicio: a, fin: b,
        label: 'sem ' + (i + 1),
        rango: a.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' }) + ' al ' +
               b.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' })
      });
    }

    var filas = ultimo.programacion.tareas.filter(function (t) {
      var fi = P.aFecha(t.inicio), ff = P.aFecha(t.fin);
      return ff >= semanas[0].inicio && fi <= semanas[n - 1].fin;
    });
    if (!filas.length) {
      cont.innerHTML = '<div class="empty-state">No hay tareas en esas semanas</div>';
      return;
    }

    var html = '<div class="tabla-scroll"><table class="gantt lookahead"><thead><tr><th class="g-tarea">Tarea</th>' +
      semanas.map(function (s) {
        return '<th class="g-mes">' + s.label + '<span class="g-rango">' + s.rango + '</span></th>';
      }).join('') + '</tr></thead><tbody>';

    filas.forEach(function (t) {
      var fi = P.aFecha(t.inicio), ff = P.aFecha(t.fin);
      var totalHabiles = c.habiles(fi, ff) || 1;
      html += '<tr' + (t.critica ? ' class="critica"' : '') + '><td class="g-tarea">' +
        '<span class="cod">' + esc(t.code) + '</span> ' + esc((t.desc || '').slice(0, 30)) + '</td>';
      semanas.forEach(function (s) {
        var a = fi > s.inicio ? fi : s.inicio;
        var b = ff < s.fin ? ff : s.fin;
        if (b < a) { html += '<td class="g-mes"></td>'; return; }
        var d = c.habiles(a, b);
        if (d <= 0) { html += '<td class="g-mes"></td>'; return; }
        html += '<td class="g-mes"><div class="g-barra' + (t.critica ? ' critica' : '') + '" ' +
          'style="width:' + Math.min(100, (d / 5) * 100).toFixed(0) + '%" ' +
          'title="' + d + ' día(s) hábil(es), ' + num(d / totalHabiles * 100) + '% de la tarea">' +
          d + 'd</div></td>';
      });
      html += '</tr>';
    });
    cont.innerHTML = html + '</tbody></table></div>';
  }

  /* ── materiales por mes ────────────────────────────────────── */
  function pintarMateriales() {
    var cont = $('plan-materiales');
    if (!ultimo) { cont.innerHTML = '<div class="empty-state">Sin plan todavía</div>'; return; }
    var cat = $('plan-mat-categoria').value;
    var filas = P.materialesPorMesDesde(ultimo.calculo.items, recetas, ultimo.reparto, cat || null);
    if (!filas.length) {
      cont.innerHTML = '<div class="empty-state">No hay insumos de esa categoría en el cómputo</div>';
      return;
    }
    var meses = ultimo.reparto.meses;
    cont.innerHTML = '<div class="tabla-scroll"><table class="grilla"><thead><tr>' +
      '<th>Código</th><th>Insumo</th><th>Un. compra</th>' +
      meses.map(function (m) { return '<th class="der">' + esc(m.label) + '</th>'; }).join('') +
      '<th class="der">Total</th></tr></thead><tbody>' +
      filas.slice(0, 60).map(function (r) {
        return '<tr><td class="cod">' + esc(r.code) + '</td>' +
          '<td>' + esc(r.desc) + '</td>' +
          '<td>' + esc(r.unidadCompra) + (r.factor > 1 ? ' <span class="text-muted">×' + num(r.factor) + '</span>' : '') + '</td>' +
          r.compraMes.map(function (q) {
            return '<td class="der">' + (q ? '<strong>' + num(q) + '</strong>' : '<span class="text-muted">·</span>') + '</td>';
          }).join('') +
          '<td class="der">' + num(r.compraTotal) + '</td></tr>';
      }).join('') +
      '</tbody></table></div>' +
      (filas.length > 60 ? '<div class="text-muted" style="padding:8px">Mostrando 60 de ' + filas.length + ' insumos · exportá el plan para verlos todos</div>' : '');
  }

  /* ── armar el plan solo ───────────────────────────────────────
     La malla sabe el orden en que se construye una obra: primero se
     excava, despues se funda, despues se levanta, y la pintura va al
     final. Cada tarea cae en un nodo por su codigo y sale un plan
     completo, que despues se corrige donde haga falta.

     PISA lo que haya, y por eso pregunta antes: si alguien paso media
     hora atando dependencias a mano, no se las borramos de callado.   */
  function proponerPlan() {
    if (!window.Malla) { toast('No se pudo cargar la malla de obra', 'error'); return; }
    var items = A.estado().items;
    if (!items.length) { toast('Cargá el cómputo primero', 'error'); return; }

    var p = plan();
    var yaHay = Object.keys(p.tareas).filter(function (id) {
      return (p.tareas[id].predecesoras || []).length;
    }).length;
    if (yaHay && !confirm('Ya hay ' + yaHay + ' tarea(s) con dependencias cargadas.\n\n' +
        '¿Reemplazarlas por el plan que propone la malla?')) return;

    var r = Malla.proponer(items);
    items.forEach(function (it) {
      nodo(it.id).predecesoras = (r.predecesoras[it.id] || []).slice();
    });
    ultimaPropuesta = r;

    render().then(function () {
      var atadas = items.length - r.sinNodo.length;
      toast(atadas + ' de ' + items.length + ' tareas ordenadas en ' + r.nodos.length + ' rubros' +
        (r.sinNodo.length ? ' · ' + r.sinNodo.length + ' sin ubicar' : ''),
        r.sinNodo.length ? 'aviso' : 'ok');
    });
  }
  var ultimaPropuesta = null;

  /* ══════════════════ EXPORTAR ══════════════════ */
  function exportar() {
    if (!ultimo) { toast('No hay plan para exportar', 'error'); return; }
    if (A.pedirEmailAntes('plan', exportar)) return;

    var meses = ultimo.reparto.meses, c = ultimo.curvas, p = plan();
    var hojas = [];

    var cro = [['Código', 'Tarea', 'Cómputo', 'Unidad', 'Rend. diario', 'Cuadrillas', 'Duración (d)',
                'Va después de', 'Inicio', 'Fin', 'Holgura (d)', 'Crítica']];
    if (ultimo.programacion) {
      ultimo.programacion.tareas.forEach(function (t) {
        var r = ritmo(t.id);
        cro.push([t.code, t.desc, t.qty, t.unit, r.rendimiento || '', r.cuadrillas || 1, t.duracion,
          idsACodigos(t.predecesoras), t.inicio, t.fin, t.holgura, t.critica ? 'SÍ' : '']);
      });
    }
    hojas.push({ nombre: 'Cronograma', filas: cro });

    var cur = [['Mes', 'Desde', 'Hasta', 'Avance %', 'Acumulado %', 'Costo empresa', 'Certifica cliente',
                'Acum. cliente', 'Certificado real %']];
    c.meses.forEach(function (m) {
      cur.push([m.label, m.inicio, m.fin, m.avancePct, m.avanceAcumPct, m.empresa, m.cliente, m.clienteAcum,
        p.certificado[m.numero] === undefined ? '' : p.certificado[m.numero]]);
    });
    cur.push([]);
    cur.push(['TOTAL', '', '', '', '', c.totalEmpresa, c.totalCliente, '', '']);
    hojas.push({ nombre: 'Curvas', filas: cur });

    var mats = P.materialesPorMesDesde(ultimo.calculo.items, recetas, ultimo.reparto, null);
    var hm = [['Código', 'Insumo', 'Tipo', 'Un. obra', 'Un. compra', 'Contenido']
      .concat(meses.map(function (m) { return m.label; })).concat(['Total a pedir'])];
    mats.forEach(function (r) {
      hm.push([r.code, r.desc, r.category, r.unit, r.unidadCompra, r.factor > 1 ? r.factor : '']
        .concat(r.compraMes).concat([r.compraTotal]));
    });
    hojas.push({ nombre: 'Materiales por mes', filas: hm });

    var nombre = (A.estado().obra.nombre || 'Plan de trabajo').replace(/[\\/:*?"<>|]/g, '-');
    window.Importar.exportarLibro(hojas, nombre + ' - plan.xlsx');
    toast('Plan exportado: cronograma, curvas y materiales por mes', 'ok');
  }

  /* ══════════════════ EVENTOS ══════════════════ */
  function conRespiro(fn, ms) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms || 400);
    };
  }
  var renderConRespiro = conRespiro(render, 450);

  function conectar() {
    ['plan-modo', 'plan-inicio', 'plan-baseline', 'plan-meses',
     'plan-jornada', 'plan-frente'].forEach(function (id) {
      $(id).onchange = function () {
        var p = plan();
        if (id === 'plan-modo') p.modo = this.value;
        else if (id === 'plan-inicio') p.fechaInicio = this.value;
        else if (id === 'plan-baseline') p.baseline = this.value;
        else if (id === 'plan-jornada') p.jornada = Math.max(1, Math.min(12, M.safeNum(this.value) || 8));
        else if (id === 'plan-frente') p.frente = Math.max(1, Math.min(20, parseInt(this.value, 10) || 2));
        else p.meses = Math.max(1, Math.min(60, parseInt(this.value, 10) || 6));
        render();
      };
    });
    $('plan-sabado').onchange = function () { plan().sabado = this.checked; render(); };
    $('plan-domingo').onchange = function () { plan().domingo = this.checked; render(); };
    $('plan-solo-criticas').onchange = function () { soloCriticas = this.checked; pintarGantt(); };
    $('plan-la-desde').onchange = pintarLookAhead;
    $('plan-la-semanas').oninput = conRespiro(pintarLookAhead, 300);
    $('plan-mat-categoria').onchange = pintarMateriales;
    $('plan-export').onclick = exportar;
    $('plan-proponer').onclick = proponerPlan;

    // el calendario
    $('feriados-ver').onclick = function () { pintarFeriados(); A.abrirModal('modal-feriados'); };
    $('feriados-lista').addEventListener('change', function (e) {
      var clave = e.target.getAttribute && e.target.getAttribute('data-feriado');
      if (!clave) return;
      var p = plan();
      if (e.target.checked) delete p.feriadosOff[clave];
      else p.feriadosOff[clave] = true;
      render().then(pintarFeriados);
    });
    $('feriados-lista').addEventListener('click', function (e) {
      var clave = e.target.getAttribute && e.target.getAttribute('data-borrar-feriado');
      if (!clave) return;
      var p = plan();
      p.feriadosPropios = p.feriadosPropios.filter(function (f) {
        return (f.fecha + '|' + f.nombre) !== clave;
      });
      render().then(pintarFeriados);
    });
    $('feriado-agregar').onclick = function () {
      var f = $('feriado-fecha').value, n = $('feriado-nombre').value.trim();
      if (!f) { toast('Poné la fecha', 'error'); return; }
      plan().feriadosPropios.push({ fecha: f, nombre: n || 'No se trabaja' });
      $('feriado-fecha').value = ''; $('feriado-nombre').value = '';
      render().then(pintarFeriados);
    };

    /* Bajar y volver a subir: el mes que viene se carga el avance nuevo
       y se sigue. Sin esto habria que volver a cargar rendimientos y
       predecesoras de cero, que es el trabajo caro de todo esto. */
    $('plan-guardar').onclick = function () { A.guardarProyecto(); };
    $('plan-abrir').onchange = function (e) {
      if (e.target.files[0]) A.abrirProyecto(e.target.files[0]);
      e.target.value = '';
    };

    // el selector de predecesoras
    $('plan-tabla').addEventListener('click', function (e) {
      var b = e.target.closest('[data-pred]');
      if (!b) return;
      abrirPredecesoras(parseInt(b.getAttribute('data-pred'), 10));
    });
    $('pred-buscar').oninput = pintarListaPred;
    $('pred-lista').addEventListener('change', function (e) {
      var quien = e.target.getAttribute && e.target.getAttribute('data-pred-id');
      if (quien === null || quien === undefined) return;
      var otra = parseInt(quien, 10);
      var n = nodo(predAbierta);
      var i = n.predecesoras.indexOf(otra);
      if (e.target.checked) { if (i < 0) n.predecesoras.push(otra); }
      else if (i >= 0) n.predecesoras.splice(i, 1);
      render().then(pintarListaPred);
    });
    $('pred-ninguna').onclick = function () {
      nodo(predAbierta).predecesoras = [];
      render().then(pintarListaPred);
    };

    // la grilla de tareas
    $('plan-tabla').addEventListener('input', function (e) {
      var tr = e.target.closest('tr');
      if (!tr || !tr.getAttribute('data-plan')) return;
      var id = parseInt(tr.getAttribute('data-plan'), 10);
      var campo = e.target.getAttribute('data-campo');
      var mesAvance = e.target.getAttribute('data-avance');

      if (mesAvance) {
        var p = plan();
        if (!p.avances[id]) p.avances[id] = {};
        if (e.target.value === '') delete p.avances[id][mesAvance];
        else p.avances[id][mesAvance] = M.safeNum(e.target.value);
        renderConRespiro();
        return;
      }
      if (!campo) return;

      var n = ritmo(id);
      if (e.target.value === '') delete n[campo];
      else n[campo] = M.safeNum(e.target.value);
      nodo(id)[plan().baseline] = n;
      renderConRespiro();
    });


  }

  /* La pantalla se dibuja cuando se entra, no antes: armar el gantt de
     una obra que todavia no tiene computo no le sirve a nadie, y pedir
     las recetas de entrada serian llamadas al pedo. */
  window.PlanUI = {
    mostrar: function () {
      var p = plan();
      if (!$('plan-la-desde').value) $('plan-la-desde').value = p.fechaInicio;
      return render();
    },
    render: render,
    recalcular: recalcular,
    estado: function () { return ultimo; },
    plan: plan,
    calendario: cal,
    feriadosActivos: feriadosActivos
  };

  conectar();
})();
