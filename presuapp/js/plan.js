/* ───────────────────────────────────────────────────────────────
   PLAN DE TRABAJO — sin DOM, como el motor.

   La lógica no es nueva: sale del Excel "Gant Tipo Obra Gruesa
   Camino Critico" y del módulo Gantt de obra. Acá va simplificada,
   pero con las mismas reglas.

   DOS PUERTAS, UNA SOLA TUBERÍA
     · con predecesoras → rendimiento y cuadrillas dan la duración,
       el CPM da las fechas, y el reparto por período sale de los
       días hábiles de la tarea que caen en cada mes:

           fracción = díasHábiles(tarea ∩ mes) / díasHábiles(tarea)

     · gantt rápido → no se cargan predecesoras: se escribe a mano
       el % de avance de cada tarea en cada mes. Eso ES la fracción.

   De la fracción para abajo, todo es común: curva S, curva empresa
   vs cliente, y los materiales mes por mes.

   UN PLAN FÍSICO, DOS CURVAS: el avance es el mismo; cambia por qué
   se multiplica — COSTO (lo que sale) o PRECIO = costo × K (lo que
   se certifica). El K va sin IVA.
   ─────────────────────────────────────────────────────────────── */
(function (global) {
  'use strict';

  var M = global.Motor;
  var DIA = 86400000;

  /* ── fechas: se leen flexible y se escriben SIEMPRE ISO ───────
     Todo se maneja en UTC a mediodía para que ningún huso corra un
     día la fecha.                                                  */
  function aFecha(v) {
    if (v instanceof Date) return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate(), 12));
    var s = String(v || '').trim();
    if (!s) return null;
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
    m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);   // dd/mm/aaaa
    if (m) {
      var anio = +m[3] < 100 ? 2000 + +m[3] : +m[3];
      return new Date(Date.UTC(anio, +m[2] - 1, +m[1], 12));
    }
    var d = new Date(s);
    return isNaN(d) ? null : new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12));
  }
  function iso(f) { return f ? f.toISOString().slice(0, 10) : ''; }
  function sumarDias(f, n) { return new Date(f.getTime() + n * DIA); }
  function claveMes(f) { return f.toISOString().slice(0, 7); }
  function primerDiaMes(f) { return new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), 1, 12)); }
  function ultimoDiaMes(f) { return new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + 1, 0, 12)); }
  function mesesEntre(a, b) {
    return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  }

  /* ── calendario laboral ───────────────────────────────────────
     Sábado opcional (en obra se trabaja más de lo que dice el
     almanaque) y feriados por fecha ISO.                           */
  function calendario(cfg) {
    cfg = cfg || {};
    var sabado = !!cfg.sabado, domingo = !!cfg.domingo;
    var feriados = {};
    (cfg.feriados || []).forEach(function (f) { var x = aFecha(f); if (x) feriados[iso(x)] = true; });

    function esHabil(f) {
      var d = f.getUTCDay();
      if (d === 0 && !domingo) return false;
      if (d === 6 && !sabado) return false;
      return !feriados[iso(f)];
    }
    /* Días hábiles entre dos fechas, ambas inclusive (NETWORKDAYS). */
    function habiles(desde, hasta) {
      if (!desde || !hasta || hasta < desde) return 0;
      var n = 0, f = new Date(desde.getTime());
      while (f <= hasta) { if (esHabil(f)) n++; f = sumarDias(f, 1); }
      return n;
    }
    /* Primer día hábil desde f (inclusive). */
    function proximoHabil(f) {
      var x = new Date(f.getTime()), guarda = 0;
      while (!esHabil(x) && guarda++ < 400) x = sumarDias(x, 1);
      return x;
    }
    /* La fecha en la que se completa el día hábil número n contando
       desde f inclusive: duración 1 termina el mismo día.           */
    function finTrasHabiles(f, n) {
      var x = proximoHabil(f), contados = 1, guarda = 0;
      while (contados < n && guarda++ < 4000) {
        x = proximoHabil(sumarDias(x, 1));
        contados++;
      }
      return x;
    }
    return {
      esHabil: esHabil, habiles: habiles, proximoHabil: proximoHabil,
      finTrasHabiles: finTrasHabiles, config: { sabado: sabado, domingo: domingo, feriados: Object.keys(feriados) }
    };
  }

  /* ── FERIADOS ─────────────────────────────────────────────────
     Un plan que cuenta el 25 de mayo como dia trabajado miente, y
     miente para el lado peor: promete una fecha que no se va a cumplir.

     Los nacionales se calculan. Pascua sale del algoritmo de Meeus, y
     de ahi Carnaval (48 y 47 dias antes) y Viernes Santo (2 antes).
     Los trasladables se mueven como manda la ley 27.399: martes o
     miercoles al lunes anterior, jueves o viernes al lunes siguiente.

     LO QUE ESTE CALCULO NO SABE, y por eso la lista se edita a mano:

       · los puentes turisticos, que salen por decreto cada año y
         cambian;
       · los feriados provinciales y municipales;
       · los de la obra: la semana que para el gremio, la fiesta del
         pueblo, el dia que no se hormigona.

     Por eso los feriados usados se muestran SIEMPRE en pantalla. Un
     calendario que no se puede mirar es un calendario en el que no se
     puede confiar.                                                   */
  function pascua(anio) {
    var a = anio % 19, b = Math.floor(anio / 100), c = anio % 100;
    var d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    var g = Math.floor((b - f + 1) / 3);
    var h = (19 * a + b - d - g + 15) % 30;
    var i = Math.floor(c / 4), k = c % 4;
    var l = (32 + 2 * e + 2 * i - h - k) % 7;
    var m = Math.floor((a + 11 * h + 22 * l) / 451);
    var n = h + l - 7 * m + 114;
    return new Date(Date.UTC(anio, Math.floor(n / 31) - 1, (n % 31) + 1, 12));
  }

  /* Ley 27.399: el feriado trasladable que cae martes o miercoles pasa
     al lunes anterior; el que cae jueves o viernes, al lunes siguiente.
     Si cae lunes, sabado o domingo, se queda donde esta. */
  function trasladar(f) {
    var d = f.getUTCDay();
    if (d === 2 || d === 3) return sumarDias(f, -(d - 1));
    if (d === 4 || d === 5) return sumarDias(f, 8 - d);
    return f;
  }

  function feriadosArgentina(anio) {
    var P = pascua(anio), out = [];
    function fijo(mes, dia, nombre) {
      out.push({ fecha: iso(new Date(Date.UTC(anio, mes - 1, dia, 12))), nombre: nombre, tipo: 'nacional' });
    }
    function movil(f, nombre) { out.push({ fecha: iso(f), nombre: nombre, tipo: 'nacional' }); }
    function trasl(mes, dia, nombre) {
      var f = trasladar(new Date(Date.UTC(anio, mes - 1, dia, 12)));
      out.push({ fecha: iso(f), nombre: nombre, tipo: 'trasladable' });
    }

    fijo(1, 1, 'Año Nuevo');
    movil(sumarDias(P, -48), 'Carnaval');
    movil(sumarDias(P, -47), 'Carnaval');
    fijo(3, 24, 'Día de la Memoria');
    fijo(4, 2, 'Malvinas');
    movil(sumarDias(P, -2), 'Viernes Santo');
    fijo(5, 1, 'Día del Trabajador');
    fijo(5, 25, 'Revolución de Mayo');
    trasl(6, 17, 'Paso a la Inmortalidad de Güemes');
    fijo(6, 20, 'Día de la Bandera');
    fijo(7, 9, 'Día de la Independencia');
    trasl(8, 17, 'Paso a la Inmortalidad de San Martín');
    trasl(10, 12, 'Diversidad Cultural');
    trasl(11, 20, 'Soberanía Nacional');
    fijo(12, 8, 'Inmaculada Concepción');
    fijo(12, 25, 'Navidad');

    return out.sort(function (a, b) { return a.fecha < b.fecha ? -1 : 1; });
  }

  /* Los del período de la obra, sin repetir. */
  function feriadosEntre(desde, hasta) {
    var a = aFecha(desde), b = aFecha(hasta);
    if (!a || !b) return [];
    var out = [];
    for (var y = a.getUTCFullYear(); y <= b.getUTCFullYear(); y++) {
      feriadosArgentina(y).forEach(function (f) {
        if (f.fecha >= iso(a) && f.fecha <= iso(b)) out.push(f);
      });
    }
    return out;
  }

  /* ── duración de una tarea ────────────────────────────────────
     cantidad / (rendimiento diario x cuadrillas), redondeado para
     arriba: media jornada es una jornada.                          */
  function duracionTarea(cantidad, rendimientoDiario, cuadrillas) {
    var cant = M.safeNum(cantidad), rend = M.safeNum(rendimientoDiario), cuad = M.safeNum(cuadrillas) || 1;
    if (!cant || !rend) return 1;
    return Math.max(1, Math.ceil(cant / (rend * cuad)));
  }

  /* ── programación (CPM forward + backward) ────────────────────
     items: [{id, code, qty, ...}]
     plan:  { [id]: { predecesoras:[id],
                      cliente: {rendimiento, cuadrillas, duracion?, adelantar, retrasar},
                      empresa: {...} } }
            También se acepta el formato plano (rendimiento/cuadrillas
            directo en el nodo), que vale para las dos baselines.

     DOS BASELINES, como en el plan de obra: el CLIENTE es el plazo que
     se firma y el EMPRESA es con el que se trabaja (suele ir más rápido
     para dejarse colchón). Son el mismo plan físico con otro ritmo:
     `opciones.baseline` elige cuál se programa.

     Devuelve fechas por tarea, fin de obra, holgura y ruta crítica.
     Una predecesora desconocida se ignora y se avisa; un ciclo no
     cuelga el cálculo: corta y lo informa.                         */
  function programar(items, plan, opciones) {
    opciones = opciones || {};
    var cal = opciones.calendario || calendario({});
    var inicioObra = aFecha(opciones.fechaInicio) || aFecha(new Date());
    var baseline = opciones.baseline === 'empresa' ? 'empresa' : 'cliente';
    plan = plan || {};

    /* El nodo de la baseline pedida, con el formato plano de respaldo. */
    function paso(p) {
      var b = p && p[baseline];
      if (b && typeof b === 'object') {
        return {
          rendimiento: b.rendimiento !== undefined ? b.rendimiento : p.rendimiento,
          cuadrillas: b.cuadrillas !== undefined ? b.cuadrillas : p.cuadrillas,
          duracion: b.duracion !== undefined ? b.duracion : p.duracion,
          adelantar: b.adelantar !== undefined ? b.adelantar : p.adelantar,
          retrasar: b.retrasar !== undefined ? b.retrasar : p.retrasar
        };
      }
      return p || {};
    }

    var porId = Object.create(null);
    items.forEach(function (it) { porId[it.id] = it; });

    var avisos = [];
    var datos = items.map(function (it) {
      var nodo = plan[it.id] || {};
      var p = paso(nodo);
      var preds = (nodo.predecesoras || []).filter(function (x) {
        if (porId[x] === undefined) { avisos.push('La tarea ' + it.id + ' apunta a una predecesora que no está: ' + x); return false; }
        return x !== it.id;
      });
      return {
        id: it.id, code: it.code, desc: it.desc, rubro: it.rubro || 'Sin rubro', unit: it.unit, qty: M.safeNum(it.qty),
        rendimiento: M.safeNum(p.rendimiento), cuadrillas: M.safeNum(p.cuadrillas) || 1,
        duracion: p.duracion ? Math.max(1, Math.round(M.safeNum(p.duracion))) : duracionTarea(it.qty, p.rendimiento, p.cuadrillas),
        predecesoras: preds,
        desfase: M.safeNum(p.retrasar) - M.safeNum(p.adelantar)
      };
    });
    var idx = Object.create(null);
    datos.forEach(function (d) { idx[d.id] = d; });

    // orden topológico
    var estado = Object.create(null), orden = [], hayCiclo = false;
    function visitar(id) {
      if (estado[id] === 2) return;
      if (estado[id] === 1) { hayCiclo = true; return; }
      estado[id] = 1;
      (idx[id].predecesoras || []).forEach(visitar);
      estado[id] = 2;
      orden.push(id);
    }
    datos.forEach(function (d) { visitar(d.id); });
    if (hayCiclo) avisos.push('Hay predecesoras en círculo: se programó lo que se pudo, revisá las dependencias.');

    // forward pass
    orden.forEach(function (id) {
      var d = idx[id];
      var arranque = inicioObra;
      d.predecesoras.forEach(function (p) {
        var pd = idx[p];
        if (!pd || !pd.ff) return;
        var siguiente = cal.proximoHabil(sumarDias(pd.ff, 1));
        if (siguiente > arranque) arranque = siguiente;
      });
      if (d.desfase) arranque = cal.proximoHabil(sumarDias(arranque, d.desfase));
      d.fi = cal.proximoHabil(arranque);
      d.ff = cal.finTrasHabiles(d.fi, d.duracion);
    });

    var fin = datos.reduce(function (f, d) { return (!f || (d.ff && d.ff > f)) ? d.ff : f; }, null);

    // backward pass: holgura total y ruta crítica
    var sucesoras = Object.create(null);
    datos.forEach(function (d) {
      d.predecesoras.forEach(function (p) { (sucesoras[p] = sucesoras[p] || []).push(d.id); });
    });
    orden.slice().reverse().forEach(function (id) {
      var d = idx[id];
      var sucs = sucesoras[id] || [];
      if (!sucs.length) { d.ffTardio = fin; }
      else {
        d.ffTardio = sucs.reduce(function (f, s) {
          var lim = idx[s].fiTardio ? new Date(idx[s].fiTardio.getTime() - DIA) : fin;
          return (!f || lim < f) ? lim : f;
        }, null) || fin;
      }
      d.fiTardio = retrocederHabiles(cal, d.ffTardio, d.duracion);
      d.holgura = cal.habiles(d.ff, d.ffTardio) - 1;
      if (d.holgura < 0) d.holgura = 0;
      d.critica = d.holgura === 0;
    });

    /* INICIO y FIN son dos hitos, no dos tareas. El calculo ya los trata
       asi -la que no tiene predecesora arranca en el inicio de obra, y la
       que no tiene sucesora define el fin-, pero hasta ahora eran
       invisibles: en la pantalla se veia un guion en "va despues de" y
       cuatro tareas arrancando todas el mismo dia sin que nada dijera
       que eso era un olvido y no una decision.

       La regla de la casa: TODA tarea tiene predecesora y sucesora,
       salvo la primera (cuelga del INICIO) y la ultima (es predecesora
       del FIN). Lo que sigue es lo que hace falta para poder decirlo. */
    var desdeInicio = datos.filter(function (d) { return !d.predecesoras.length; });
    var hastaFin = datos.filter(function (d) { return !(sucesoras[d.id] || []).length; });

    return {
      tareas: datos.map(function (d) {
        return {
          id: d.id, code: d.code, desc: d.desc, rubro: d.rubro, unit: d.unit, qty: d.qty,
          rendimiento: d.rendimiento, cuadrillas: d.cuadrillas, duracion: d.duracion,
          predecesoras: d.predecesoras,
          sucesoras: (sucesoras[d.id] || []).slice(),
          desdeInicio: !d.predecesoras.length,
          hastaFin: !(sucesoras[d.id] || []).length,
          inicio: iso(d.fi), fin: iso(d.ff), holgura: d.holgura, critica: d.critica
        };
      }),
      baseline: baseline,
      inicio: iso(inicioObra),
      // el primer dia que de verdad se trabaja: el inicio de obra puede
      // caer domingo y entonces no arranca nadie ese dia
      primerDia: iso(cal.proximoHabil(inicioObra)),
      fin: iso(fin),
      duracionObra: cal.habiles(inicioObra, fin),
      desdeInicio: desdeInicio.map(function (d) { return d.id; }),
      hastaFin: hastaFin.map(function (d) { return d.id; }),
      avisos: avisos
    };
  }

  function retrocederHabiles(cal, f, n) {
    var x = new Date(f.getTime()), contados = 1, guarda = 0;
    while (!cal.esHabil(x) && guarda++ < 400) x = sumarDias(x, -1);
    while (contados < n && guarda++ < 4000) {
      x = sumarDias(x, -1);
      while (!cal.esHabil(x) && guarda++ < 4000) x = sumarDias(x, -1);
      contados++;
    }
    return x;
  }

  /* ── los meses del plan ───────────────────────────────────────── */
  function armarMeses(desde, hasta) {
    var a = primerDiaMes(aFecha(desde)), b = primerDiaMes(aFecha(hasta));
    var n = Math.max(0, mesesEntre(a, b)) + 1, out = [];
    for (var i = 0; i < n; i++) {
      var f = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + i, 1, 12));
      out.push({
        clave: claveMes(f), numero: i + 1,
        inicio: iso(primerDiaMes(f)), fin: iso(ultimoDiaMes(f)),
        label: f.toLocaleDateString('es-AR', { month: 'short', year: '2-digit', timeZone: 'UTC' })
      });
    }
    return out;
  }

  /* ── reparto por fechas (la fórmula del Excel) ────────────────── */
  function repartirPorFechas(programacion, opciones) {
    var cal = (opciones || {}).calendario || calendario({});
    var meses = armarMeses(programacion.inicio, programacion.fin);
    var fraccion = Object.create(null);
    programacion.tareas.forEach(function (t) {
      var fi = aFecha(t.inicio), ff = aFecha(t.fin);
      var total = cal.habiles(fi, ff);
      fraccion[t.id] = meses.map(function (m) {
        if (!total) return 0;
        var desde = aFecha(m.inicio), hasta = aFecha(m.fin);
        var a = fi > desde ? fi : desde, b = ff < hasta ? ff : hasta;
        if (b < a) return 0;
        return cal.habiles(a, b) / total;
      });
    });
    return { origen: 'fechas', meses: meses, fraccion: fraccion };
  }

  /* ── reparto a mano: el gantt rápido ──────────────────────────
     valores: { [idTarea]: { 1: 40, 2: 60 } }  (porcentajes por mes)
     No hace falta que sumen 100: se informa lo que falta o sobra,
     pero no se toca lo que escribió la persona.                    */
  function repartirAMano(items, opciones) {
    opciones = opciones || {};
    var n = Math.max(1, parseInt(opciones.meses, 10) || 1);
    var inicio = primerDiaMes(aFecha(opciones.fechaInicio) || aFecha(new Date()));
    var meses = armarMeses(inicio, new Date(Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth() + n - 1, 1, 12)));
    var valores = opciones.valores || {};
    var fraccion = Object.create(null), incompletas = [];
    items.forEach(function (it) {
      var fila = valores[it.id] || {};
      var f = meses.map(function (m) { return M.safeNum(fila[m.numero]) / 100; });
      var suma = f.reduce(function (s, x) { return s + x; }, 0);
      if (Math.abs(suma - 1) > 0.005) incompletas.push({ id: it.id, code: it.code, desc: it.desc, cargado: suma * 100 });
      fraccion[it.id] = f;
    });
    return { origen: 'rapido', meses: meses, fraccion: fraccion, incompletas: incompletas };
  }

  /* ── curvas ───────────────────────────────────────────────────
     UN plan físico, dos lecturas en plata: empresa (costo) y
     cliente (costo x K, sin IVA).                                  */
  function curvas(calculo, reparto, k) {
    k = k || 1;
    var meses = reparto.meses;
    var costoTotal = calculo.costo || 0;
    var filas = meses.map(function (m, i) {
      var costo = 0, avance = 0;
      calculo.items.forEach(function (it) {
        var f = (reparto.fraccion[it.id] || [])[i] || 0;
        costo += it.costoTotal * f;
        avance += costoTotal ? (it.costoTotal / costoTotal) * f : 0;
      });
      return {
        clave: m.clave, numero: m.numero, label: m.label, inicio: m.inicio, fin: m.fin,
        avancePct: avance * 100,
        empresa: costo,
        cliente: costo * k
      };
    });
    var acumE = 0, acumC = 0, acumA = 0;
    filas.forEach(function (f) {
      acumE += f.empresa; acumC += f.cliente; acumA += f.avancePct;
      f.empresaAcum = acumE; f.clienteAcum = acumC; f.avanceAcumPct = acumA;
    });
    return {
      meses: filas,
      totalEmpresa: acumE, totalCliente: acumC,
      k: k, origen: reparto.origen
    };
  }

  /* ── por rubro, que es como se mira de verdad ─────────────────── */
  function porRubro(calculo, reparto) {
    var meses = reparto.meses;
    var mapa = Object.create(null), orden = [];
    calculo.items.forEach(function (it) {
      var r = it.rubro || 'Sin rubro';
      if (!mapa[r]) {
        mapa[r] = { rubro: r, costo: 0, meses: meses.map(function () { return 0; }) };
        orden.push(r);
      }
      mapa[r].costo += it.costoTotal;
      (reparto.fraccion[it.id] || []).forEach(function (f, i) {
        if (mapa[r].meses[i] !== undefined) mapa[r].meses[i] += it.costoTotal * f;
      });
    });
    return orden.map(function (r) { return mapa[r]; });
  }

  /* ── MATERIALES POR MES ───────────────────────────────────────
     Lo que pidió Juan: la lista de compras repartida en el tiempo.
       cantidad del insumo en el mes
          = rendimiento del insumo x cómputo de la tarea x fracción
     Es el mismo consolidado de la pestaña Materiales, abierto mes
     a mes: sirve para comprar cuando hace falta y no antes.        */
  function materialesPorMes(items, catalogo, overrides, reparto, filtroCategoria) {
    var idx = M.indexar(catalogo, overrides);
    var meses = reparto.meses;
    var acc = Object.create(null), orden = [];

    items.forEach(function (it) {
      var a = idx.analisis[String(it.code || '').trim()];
      if (!a) return;
      var calc = M.calcularAnalisis(a, idx);
      var qty = M.safeNum(it.qty);
      var fr = reparto.fraccion[it.id] || [];
      calc.details.forEach(function (d) {
        if (filtroCategoria && d.category !== filtroCategoria) return;
        if (!acc[d.code]) {
          acc[d.code] = {
            code: d.code, desc: d.desc, unit: d.unit, category: d.category,
            unitPrice: d.unitPrice, origenPrecio: d.origenPrecio,
            precioCompra: d.precioCompra, factor: d.factor, unidadCompra: d.unidadCompra,
            cantidad: 0, total: 0,
            cantidadMes: meses.map(function () { return 0; }),
            totalMes: meses.map(function () { return 0; })
          };
          orden.push(d.code);
        }
        var r = acc[d.code];
        var cantTotal = d.qty * qty;
        r.cantidad += cantTotal;
        r.total += cantTotal * d.unitPrice;
        fr.forEach(function (f, i) {
          if (r.cantidadMes[i] === undefined) return;
          r.cantidadMes[i] += cantTotal * f;
          r.totalMes[i] += cantTotal * f * d.unitPrice;
        });
      });
    });

    var filas = orden.map(function (k) { return acc[k]; })
      .sort(function (a, b) { return b.total - a.total; });

    /* El pedido del mes va en unidades ENTERAS de compra: no se piden
       345 kg de cemento, se piden 7 bolsas. Como cada mes redondea para
       arriba, el año entero puede pedir alguna unidad más que el total
       teórico — esa diferencia es real, no un error: son las bolsas que
       sobran de cada entrega.                                          */
    filas.forEach(function (f) {
      f.cantidadCompra = M.cantidadDeCompra(f.cantidad, f.factor, f.unidadCompra || f.unit);
      f.compraMes = f.cantidadMes.map(function (c) { return M.cantidadDeCompra(c, f.factor, f.unidadCompra || f.unit); });
      f.totalCompraMes = f.compraMes.map(function (c) { return c * M.safeNum(f.precioCompra); });
      f.compraTotalMeses = f.compraMes.reduce(function (s, c) { return s + c; }, 0);
      f.sobranteRedondeo = f.compraTotalMeses - f.cantidadCompra;
    });

    var totalMes = meses.map(function (_, i) {
      return filas.reduce(function (s, f) { return s + f.totalMes[i]; }, 0);
    });
    var compraMes = meses.map(function (_, i) {
      return filas.reduce(function (s, f) { return s + f.totalCompraMes[i]; }, 0);
    });
    return { meses: meses, filas: filas, totalMes: totalMes, totalCompraMes: compraMes };
  }

  /* ── materiales por mes, sin el catalogo a mano ───────────────
     La otra `materialesPorMes` necesita el catalogo entero para sacar
     los rendimientos. Esta recibe las RECETAS ya traidas
     ({codigoTarea: [{code, qty, unit, category, unidadCompra, factor}]}),
     que es lo unico que hace falta, y por eso anda igual cuando el
     catalogo no baja al navegador.

     cantidad del insumo en el mes
        = rendimiento en la tarea x computo de la tarea x fraccion del mes

     El PEDIDO se redondea mes a mes y no al final: si en marzo hacen
     falta 26 kg de cemento y en abril 30, son 2 bolsas y 2 bolsas, no
     las 3 que saldrian de redondear los 56 kg juntos. La bolsa se
     compra entera cada vez que se va al corralon.                   */
  function materialesPorMesDesde(items, recetas, reparto, filtroCategoria) {
    var meses = reparto.meses;
    var acc = Object.create(null), orden = [];

    (items || []).forEach(function (it) {
      var receta = recetas[String(it.code || '').trim()] || [];
      var fr = reparto.fraccion[it.id] || [];
      receta.forEach(function (d) {
        var cat = M.normalizarCategoria(d.category);
        if (filtroCategoria && cat !== filtroCategoria) return;
        var total = M.safeNum(d.qty) * M.safeNum(it.qty);
        if (!total) return;
        var k = d.code;
        if (!acc[k]) {
          acc[k] = {
            code: d.code, desc: d.desc, unit: d.unit, category: cat,
            unidadCompra: d.unidadCompra || d.unit, factor: M.safeNum(d.factor) || 1,
            total: 0, meses: meses.map(function () { return 0; })
          };
          orden.push(k);
        }
        acc[k].total += total;
        meses.forEach(function (m, i) { acc[k].meses[i] += total * (fr[i] || 0); });
      });
    });

    return orden.map(function (k) {
      var r = acc[k];
      r.compraMes = r.meses.map(function (c) {
        if (c <= 0) return 0;
        var q = M.cantidadDeCompra(c, r.factor, r.unidadCompra);
        // lo que se cuenta de a una ya vino entero; lo que se pide por
        // peso o volumen se corta en 2 decimales: nadie encarga
        // 1.486,8032786885246 kg de cemento
        return q % 1 === 0 ? q : M.redondear(q, 2);
      });
      r.compraTotal = r.compraMes.reduce(function (s, x) { return s + x; }, 0);
      return r;
    }).sort(function (a, b) { return b.total - a.total; });
  }

  global.Plan = {
    aFecha: aFecha, iso: iso, armarMeses: armarMeses,
    materialesPorMesDesde: materialesPorMesDesde,
    calendario: calendario,
    feriadosArgentina: feriadosArgentina,
    feriadosEntre: feriadosEntre,
    duracionTarea: duracionTarea,
    programar: programar,
    repartirPorFechas: repartirPorFechas,
    repartirAMano: repartirAMano,
    curvas: curvas,
    porRubro: porRubro,
    materialesPorMes: materialesPorMes
  };
})(typeof window !== 'undefined' ? window : globalThis);
