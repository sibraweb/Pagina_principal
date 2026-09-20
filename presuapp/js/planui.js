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
      out[it.id] = {
        predecesoras: (n.predecesoras || []).slice(),
        cliente: base === 'cliente' ? { rendimiento: rend, cuadrillas: r.cuadrillas } : (n.cliente || {}),
        empresa: base === 'empresa' ? { rendimiento: rend, cuadrillas: r.cuadrillas } : (n.empresa || {}),
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
      programacion = P.programar(items, planEfectivo(), {
        calendario: cal(), fechaInicio: p.fechaInicio, baseline: p.baseline
      });
      reparto = P.repartirPorFechas(programacion, { calendario: cal() });
    }

    var curvas = P.curvas(c, reparto, c.k || 1);
    ultimo = { calculo: c, programacion: programacion, reparto: reparto, curvas: curvas };
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
      pintarCorte();
      pintarSeguimiento();
      pintarCurvas();
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
    $('plan-avisos').innerHTML = avisos.length
      ? '<div class="aviso-fila"><div class="aviso-marca"></div><div>' +
        avisos.map(esc).join('<br>') + '</div></div>'
      : '';

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
                       'no llega al FIN">sin sucesora</span>' : '') + '</td>' +
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

  /* ── como viene la obra ───────────────────────────────────────
     El plan dice cuando TENDRIA que terminar. Esto dice cuando va a
     terminar al ritmo que se viene trabajando, que casi nunca es el
     mismo. La cuenta es la de siempre en obra:

        rendimiento real = avance certificado / dias trabajados
        dias que faltan  = lo que falta / rendimiento real

     Todo en dias HABILES, que son los que se trabaja. Si la obra
     arranco tarde, el atraso ya esta contado: se mide desde el
     arranque real, no desde el que decia el plan.                   */
  function seguimiento() {
    var p = plan();
    if (!ultimo) return null;

    var c = ultimo.curvas, meses = c.meses, calen = cal();
    var finPrevisto = ultimo.programacion ? ultimo.programacion.fin
                    : (meses.length ? meses[meses.length - 1].fin : '');

    // el ultimo mes con certificado cargado
    var iUlt = -1, avance = 0;
    meses.forEach(function (m, i) {
      var v = p.certificado[m.numero];
      if (v === undefined || v === null || v === '') return;
      iUlt = i; avance = M.safeNum(v);
    });

    var arranque = P.aFecha(p.realInicio) ||
                   P.aFecha(ultimo.programacion ? ultimo.programacion.primerDia : p.fechaInicio);
    var res = {
      arranque: P.iso(arranque),
      finPrevisto: finPrevisto,
      finReal: p.realFin || '',
      avance: iUlt >= 0 ? avance : null,
      mesUltimo: iUlt >= 0 ? meses[iUlt] : null,
      finEstimado: '', desvioDias: null, ritmo: null, diasTrabajados: 0, diasQueFaltan: 0
    };

    if (p.realFin) {                       // ya termino: no hay nada que estimar
      res.finEstimado = p.realFin;
      res.desvioDias = calen.habiles(P.aFecha(finPrevisto), P.aFecha(p.realFin)) - 1;
      if (P.aFecha(p.realFin) < P.aFecha(finPrevisto)) {
        res.desvioDias = -(calen.habiles(P.aFecha(p.realFin), P.aFecha(finPrevisto)) - 1);
      }
      res.cerrada = true;
      return res;
    }

    if (iUlt < 0 || avance <= 0) return res;   // sin certificado no se estima nada

    /* Se mide hasta la FECHA DE CORTE. Antes se usaba el fin del ultimo
       mes con certificado, que es una suposicion: si el certificado
       cierra el 20, contar hasta el 30 regala diez dias de obra. */
    var corte = P.aFecha(fechaCorte());
    if (!corte || corte < arranque) corte = P.aFecha(meses[iUlt].fin);
    res.corte = P.iso(corte);
    res.diasTrabajados = calen.habiles(arranque, corte);
    if (res.diasTrabajados <= 0) return res;

    res.ritmo = avance / res.diasTrabajados;           // % por dia habil
    if (avance >= 100) { res.finEstimado = P.iso(corte); res.diasQueFaltan = 0; }
    else {
      res.diasQueFaltan = Math.ceil((100 - avance) / res.ritmo);
      res.finEstimado = P.iso(calen.finTrasHabiles(calen.proximoHabil(new Date(corte.getTime() + 86400000)),
                                                   res.diasQueFaltan));
    }
    var fp = P.aFecha(finPrevisto), fe = P.aFecha(res.finEstimado);
    res.desvioDias = fe >= fp ? (calen.habiles(fp, fe) - 1) : -(calen.habiles(fe, fp) - 1);
    return res;
  }

  function pintarCorte() {
    var p = plan();
    $('corte-fecha').value = fechaCorte();
    var sg = seguimiento();
    $('corte-resumen').textContent = sg && sg.diasTrabajados
      ? sg.diasTrabajados + ' días hábiles desde el arranque'
      : 'sin medir';
    $('dias-trabajados').textContent = sg && sg.diasTrabajados ? sg.diasTrabajados + ' d' : '—';
    // el avance a la fecha de corte: el del ultimo mes certificado
    if (sg && sg.avance !== null && $('corte-avance').value === '') {
      $('corte-avance').value = sg.avance;
    }
  }

  function pintarSeguimiento() {
    var p = plan(), sg = seguimiento();
    $('real-inicio').value = p.realInicio || '';
    $('real-fin').value = p.realFin || '';
    if (!sg) {
      $('fin-previsto').textContent = $('fin-estimado').textContent = $('desvio-plazo').textContent = '—';
      $('obra-estado').textContent = 'sin datos';
      $('obra-explicacion').innerHTML = '';
      return;
    }
    $('fin-previsto').textContent = sg.finPrevisto || '—';
    $('fin-estimado').textContent = sg.finEstimado || '—';

    if (sg.desvioDias === null) {
      $('desvio-plazo').innerHTML = '<span class="text-muted">falta el certificado</span>';
      $('obra-estado').textContent = 'sin certificar';
      $('obra-explicacion').innerHTML = '';
      return;
    }
    var d = sg.desvioDias;
    var clase = d > 0 ? 'c-mal' : 'c-ok';
    var texto = d === 0 ? 'en fecha' : (d > 0 ? Math.abs(d) + ' días de atraso' : Math.abs(d) + ' días de adelanto');
    $('desvio-plazo').innerHTML = '<span class="' + clase + '">' + texto + '</span>';
    $('obra-estado').textContent = sg.cerrada ? 'obra terminada'
      : (sg.avance !== null ? num(sg.avance) + '% certificado' : 'sin certificar');

    $('obra-explicacion').innerHTML = sg.cerrada
      ? '<div class="explicacion">La obra terminó el <strong>' + esc(sg.finReal) + '</strong>. ' +
        'El plan decía ' + esc(sg.finPrevisto) + '.</div>'
      : (sg.ritmo
        ? '<div class="explicacion">Desde el <strong>' + esc(sg.arranque) + '</strong> se trabajaron ' +
          '<strong>' + sg.diasTrabajados + ' días hábiles</strong> y se certificó <strong>' +
          num(sg.avance) + '%</strong>: son <strong>' + num(sg.ritmo) + '% por día</strong>. ' +
          'A ese ritmo, el ' + num(100 - sg.avance) + '% que falta lleva <strong>' + sg.diasQueFaltan +
          ' días</strong> más.</div>'
        : '');
  }

  /* ── las curvas ────────────────────────────────────────────────
     Tres lecturas del mismo plan. La real se dibuja CONTINUA hasta el
     ultimo mes con certificado cargado y PUNTEADA de ahi en adelante:
     lo que ya paso es un hecho, lo que viene es una proyeccion, y la
     linea tiene que decir cual es cual sin que haya que preguntar.   */
  function pintarCurvas() {
    var cont = $('plan-curvas');
    if (!ultimo) { cont.innerHTML = '<div class="empty-state">Sin plan todavía</div>'; return; }

    var c = ultimo.curvas, p = plan();
    var meses = c.meses;
    var W = 900, H = 320, ml = 62, mr = 16, mt = 16, mb = 46;
    var ancho = W - ml - mr, alto = H - mt - mb;
    var x = function (i) { return ml + (meses.length < 2 ? ancho / 2 : (i / (meses.length - 1)) * ancho); };
    var y = function (pct) { return mt + alto - (Math.max(0, Math.min(110, pct)) / 110) * alto; };

    // certificado: acumulado que carga la persona
    var cert = [], ultimoCert = -1;
    meses.forEach(function (m, i) {
      var v = p.certificado[m.numero];
      if (v === undefined || v === null || v === '') { cert.push(null); return; }
      cert.push(M.safeNum(v));
      ultimoCert = i;
    });

    function camino(puntos) {
      return puntos.map(function (pt, i) { return (i ? 'L' : 'M') + pt[0].toFixed(1) + ' ' + pt[1].toFixed(1); }).join(' ');
    }
    var ptsCliente = meses.map(function (m, i) { return [x(i), y(m.avanceAcumPct)]; });

    /* La real: lo certificado, y desde ahi la proyeccion AL RITMO REAL,
       no al del plan. Si se viene avanzando 3 puntos por mes, la
       punteada avanza 3 puntos por mes — no repite la curva del plan
       corrida hacia abajo, que haria terminar en fecha a una obra que
       no va a terminar en fecha. */
    var ptsReal = [], ptsProy = [];
    var sg = seguimiento();
    if (ultimoCert >= 0) {
      for (var i = 0; i <= ultimoCert; i++) if (cert[i] !== null) ptsReal.push([x(i), y(cert[i])]);
      ptsProy.push([x(ultimoCert), y(cert[ultimoCert])]);

      // cuanto se avanza por mes al ritmo real
      var porMes = null;
      if (sg && sg.ritmo) {
        var habilesPorMes = ultimo.reparto.meses.map(function (m) {
          return cal().habiles(P.aFecha(m.inicio), P.aFecha(m.fin));
        });
        porMes = habilesPorMes;
      }
      var acum = cert[ultimoCert];
      for (var j = ultimoCert + 1; j < meses.length && acum < 100; j++) {
        acum += (sg && sg.ritmo && porMes) ? sg.ritmo * porMes[j]
                                           : (meses[j].avanceAcumPct - meses[j - 1].avanceAcumPct);
        ptsProy.push([x(j), y(Math.min(100, acum))]);
      }
      // si al ritmo real no llega al 100% dentro del plan, la punteada
      // muere en el borde y el fin estimado lo dice en numeros arriba
    }

    var grilla = '';
    [0, 25, 50, 75, 100].forEach(function (v) {
      grilla += '<line x1="' + ml + '" y1="' + y(v) + '" x2="' + (W - mr) + '" y2="' + y(v) +
        '" class="c-grilla"/><text x="' + (ml - 8) + '" y="' + (y(v) + 4) + '" class="c-eje der">' + v + '%</text>';
    });
    var ejeX = meses.map(function (m, i) {
      return '<text x="' + x(i) + '" y="' + (H - mb + 18) + '" class="c-eje medio">' + esc(m.label) + '</text>' +
             '<text x="' + x(i) + '" y="' + (H - mb + 32) + '" class="c-eje medio tenue">' + fmtCorto(m.clienteAcum) + '</text>';
    }).join('');

    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="curvas" role="img" ' +
      'aria-label="Curvas de inversión del plan">' + grilla + ejeX +
      '<path d="' + camino(ptsCliente) + '" class="c-plan"/>' +
      ptsCliente.map(function (pt) { return '<circle cx="' + pt[0].toFixed(1) + '" cy="' + pt[1].toFixed(1) + '" r="3" class="c-plan-pt"/>'; }).join('') +
      (ptsReal.length > 1 ? '<path d="' + camino(ptsReal) + '" class="c-real"/>' : '') +
      (ptsReal.length ? ptsReal.map(function (pt) { return '<circle cx="' + pt[0].toFixed(1) + '" cy="' + pt[1].toFixed(1) + '" r="3.5" class="c-real-pt"/>'; }).join('') : '') +
      (ptsProy.length > 1 ? '<path d="' + camino(ptsProy) + '" class="c-proy"/>' : '') +
      '</svg>';

    var leyenda = '<div class="c-leyenda">' +
      '<span><i class="c-m-plan"></i> Plan (avance previsto)</span>' +
      '<span><i class="c-m-real"></i> Certificado — línea llena</span>' +
      '<span><i class="c-m-proy"></i> Proyectado — punteada</span>' +
      (ultimoCert >= 0
        ? '<span class="' + (cert[ultimoCert] >= meses[ultimoCert].avanceAcumPct ? 'c-ok' : 'c-mal') + '">' +
          (cert[ultimoCert] >= meses[ultimoCert].avanceAcumPct ? 'adelantado ' : 'atrasado ') +
          num(Math.abs(cert[ultimoCert] - meses[ultimoCert].avanceAcumPct)) + ' puntos</span>'
        : '<span class="text-muted">cargá el certificado de cada mes para ver la curva real</span>') +
      '</div>';

    cont.innerHTML = svg + leyenda;
    pintarTablaCurvas(cert);
  }

  function pintarTablaCurvas(cert) {
    var c = ultimo.curvas;
    var filas = c.meses.map(function (m, i) {
      var v = cert[i];
      return '<tr><td>' + esc(m.label) + '</td>' +
        '<td class="der">' + num(m.avancePct) + '%</td>' +
        '<td class="der"><strong>' + num(m.avanceAcumPct) + '%</strong></td>' +
        '<td class="der">' + num(m.empresa) + '</td>' +
        '<td class="der">' + num(m.cliente) + '</td>' +
        '<td class="der">' + num(m.clienteAcum) + '</td>' +
        '<td class="der"><input class="mini" type="number" step="any" min="0" max="120" ' +
          'data-cert="' + m.numero + '" value="' + (v === null || v === undefined ? '' : v) +
          '" placeholder="—"></td>' +
        '<td class="der">' + (v === null || v === undefined ? '<span class="text-muted">·</span>'
          : '<span class="' + (v >= m.avanceAcumPct ? 'c-ok' : 'c-mal') + '">' +
            (v >= m.avanceAcumPct ? '+' : '') + num(v - m.avanceAcumPct) + '</span>') + '</td>' +
        '</tr>';
    }).join('');

    $('plan-curvas-tabla').innerHTML =
      '<div class="tabla-scroll" style="margin-top:14px"><table class="grilla"><thead><tr>' +
      '<th>Mes</th><th class="der">Avance</th><th class="der">Acumulado</th>' +
      '<th class="der">Costo empresa</th><th class="der">Certifica cliente</th><th class="der">Acum. cliente</th>' +
      '<th class="der">Certificado real %</th><th class="der">Desvío</th>' +
      '</tr></thead><tbody>' + filas + '</tbody>' +
      '<tfoot><tr><td colspan="3" class="der"><strong>TOTAL</strong></td>' +
      '<td class="der"><strong>' + num(c.totalEmpresa) + '</strong></td>' +
      '<td class="der"><strong>' + num(c.totalCliente) + '</strong></td>' +
      '<td colspan="3"></td></tr></tfoot></table></div>';
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

    // la fecha de corte
    $('corte-fecha').onchange = function () { plan().corte = this.value; render(); };
    $('corte-avance').onchange = function () {
      // el avance a la fecha de corte se guarda contra el mes en que cae
      var p = plan(), c = fechaCorte();
      if (!ultimo) return;
      var m = ultimo.reparto.meses.filter(function (x) { return c >= x.inicio && c <= x.fin; })[0]
           || ultimo.reparto.meses[ultimo.reparto.meses.length - 1];
      if (!m) return;
      if (this.value === '') delete p.certificado[m.numero];
      else p.certificado[m.numero] = M.safeNum(this.value);
      render();
    };

    // como viene la obra
    $('real-inicio').onchange = function () { plan().realInicio = this.value; render(); };
    $('real-fin').onchange = function () { plan().realFin = this.value; render(); };

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

    // el certificado de cada mes
    $('plan-curvas-tabla').addEventListener('input', function (e) {
      var mes = e.target.getAttribute && e.target.getAttribute('data-cert');
      if (!mes) return;
      var p = plan();
      if (e.target.value === '') delete p.certificado[mes];
      else p.certificado[mes] = M.safeNum(e.target.value);
      conRespiro(function () { pintarCurvas(); A.guardar(); }, 400)();
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
    estado: function () { return ultimo; }
  };

  conectar();
})();
