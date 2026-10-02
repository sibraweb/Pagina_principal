/* ───────────────────────────────────────────────────────────────
   OBRAS — varias obras por persona, guardadas en su navegador, y
   mandadas por mail para no perderlas.

   Sin cuenta ni contraseña:
     · Cada obra tiene NOMBRE (obligatorio) y vive en este navegador.
       Arriba de las pestañas está el selector y «Obra nueva».
     · «Guardar obra» se la MANDA POR MAIL (adjunto .presuapp). La primera
       vez pide nombre, apellido, teléfono y email (js/contacto.js). Recién
       después se ofrece «¿Querés también bajarla a tu disco?».
     · «Abrir obra» sube ese archivo, en cualquier compu, y sigue con todo.

   Lo que se guarda por obra (localStorage):
     presuapp_obras          [{id, nombre, cliente, modificado, enviado}]
     presuapp_obra_<id>      el estado entero (cómputo, precios, K, plan,
                             vínculos del gantt, avances, control, historial)
     presuapp_obra_actual    el id de la obra abierta

   El archivo .presuapp:
     {formato:'presuapp', version:1, id, guardado, estado}
   (también abre los .json de «Guardar proyecto» de antes: el estado suelto).
   ─────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var A = window.App, K = window.Contacto;
  if (!A || !K) return;
  var $ = function (id) { return document.getElementById(id); };
  var esc = A.esc, toast = A.toast;

  var CLAVE_LISTA = 'presuapp_obras', CLAVE_ACTUAL = 'presuapp_obra_actual';
  var PREFIJO = 'presuapp_obra_';
  var obras = [];
  var actual = null;         // id de la obra abierta
  var cargando = false;

  function leer(k, def) { try { var v = JSON.parse(localStorage.getItem(k) || 'null'); return v === null ? def : v; } catch (e) { return def; } }
  function escribir(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (e) {
      toast('El navegador se quedó sin lugar. Mandate por mail las obras viejas y borralas de «Mis obras».', 'error');
      return false;
    }
  }
  function nuevoId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function nombreDe(e) { return (e.obra && e.obra.nombre || '').trim(); }
  function fecha(iso) {
    return iso ? new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
  }
  function obraActual() { return obras.filter(function (o) { return o.id === actual; })[0] || null; }
  function guardarLista() { escribir(CLAVE_LISTA, obras); }

  /* ══════════════════ GUARDADO EN EL NAVEGADOR ══════════════════
     Cada cambio de la pantalla pasa por App.guardar(): acá se copia a la
     obra abierta. Si no hay ninguna (primera vez), se crea sola con lo
     que haya — así nadie pierde lo que venía armando.                */
  A.ganchos.guardar = function (estado) {
    if (cargando) return;
    if (!actual) {
      if (!estado.items.length && !nombreDe(estado)) return;
      crearLocal(estado);
    }
    var o = obraActual();
    if (!o) return;
    escribir(PREFIJO + o.id, estado);
    var nombre = nombreDe(estado) || 'Obra sin nombre';
    if (o.nombre !== nombre || o.cliente !== (estado.obra.cliente || '')) {
      o.nombre = nombre; o.cliente = estado.obra.cliente || '';
      pintarBarra();
    }
    o.modificado = new Date().toISOString();
    guardarLista();
    if (estado.items.length >= 3) sugerirMail();
  };

  function crearLocal(estado, id) {
    var o = { id: id || nuevoId(), nombre: nombreDe(estado) || 'Obra sin nombre',
              cliente: estado.obra && estado.obra.cliente || '', modificado: new Date().toISOString(), enviado: null };
    obras.unshift(o);
    actual = o.id;
    escribir(PREFIJO + o.id, estado);
    escribir(CLAVE_ACTUAL, actual);
    guardarLista();
    return o;
  }

  function abrirObra(id) {
    var e = leer(PREFIJO + id, null);
    if (!e) { toast('No encuentro esa obra en este navegador', 'error'); return Promise.resolve(); }
    cargando = true;
    actual = id;
    escribir(CLAVE_ACTUAL, actual);
    return A.cargarEstado(e).then(function () {
      cargando = false;
      pintarBarra();
      K.anotar('abrir_obra', obraActual() && obraActual().nombre);
    }, function (err) { cargando = false; toast('No se pudo abrir: ' + err.message, 'error'); });
  }

  /* ══════════════════ LA BARRA ══════════════════ */
  function pintarBarra() {
    var o = obraActual();
    $('obra-selector').innerHTML = (o ? '' : '<option value="">— Sin obra —</option>') +
      obras.map(function (x) {
        return '<option value="' + esc(x.id) + '"' + (x.id === actual ? ' selected' : '') + '>' +
          esc(x.nombre) + (x.cliente ? ' · ' + esc(x.cliente) : '') + '</option>';
      }).join('');
    var chip = $('obra-estado');
    if (!o) { chip.className = 'chip'; chip.textContent = 'Lo que cargues queda en este navegador'; }
    else if (o.enviado) { chip.className = 'chip ok'; chip.textContent = 'Mandada por mail el ' + fecha(o.enviado); }
    else { chip.className = 'chip'; chip.textContent = 'Sólo en este navegador: mandátela por mail para no perderla'; }
    var c = K.usuario();
    $('obra-mis-datos').hidden = !c;
    if (c) $('obra-mis-datos').textContent = [c.nombre, c.apellido].join(' ');
  }

  /* ══════════════════ OBRA NUEVA ══════════════════ */
  function abrirObraNueva() {
    $('nueva-nombre').value = '';
    $('nueva-cliente').value = '';
    $('nueva-ubicacion').value = '';
    A.abrirModal('modal-obra-nueva');
    $('nueva-nombre').focus();
  }
  function crearObra() {
    var nombre = $('nueva-nombre').value.trim();
    if (!nombre) { toast('La obra necesita un nombre', 'error'); $('nueva-nombre').focus(); return; }
    if (obras.some(function (o) { return o.nombre.toLowerCase() === nombre.toLowerCase(); }) &&
        !confirm('Ya tenés una obra que se llama "' + nombre + '". ¿Crear otra igual?')) return;
    var e = A.estadoVacio();
    e.obra = { nombre: nombre, cliente: $('nueva-cliente').value.trim(),
               ubicacion: $('nueva-ubicacion').value.trim(), fecha: new Date().toISOString().slice(0, 10) };
    A.cerrarModal('modal-obra-nueva');
    var o = crearLocal(e);
    abrirObra(o.id).then(function () {
      K.anotar('obra_nueva', nombre);
      toast('Obra creada: ' + nombre, 'ok');
    });
  }

  /* ══════════════════ MIS OBRAS ══════════════════ */
  function abrirMisObras() { pintarMisObras(); A.abrirModal('modal-obras'); }
  function pintarMisObras() {
    if (!obras.length) {
      $('obras-lista').innerHTML = '<div class="empty-state">Todavía no tenés obras en este navegador.</div>';
      return;
    }
    $('obras-lista').innerHTML = '<table class="obras-tabla"><thead><tr><th>Obra</th><th>Comitente</th><th>Último cambio</th><th>Por mail</th><th></th></tr></thead><tbody>' +
      obras.map(function (o) {
        var es = o.id === actual;
        return '<tr' + (es ? ' class="actual"' : '') + '><td><strong>' + esc(o.nombre) + '</strong>' +
          (es ? ' <span class="tag propio">abierta</span>' : '') + '</td><td>' + esc(o.cliente || '') + '</td>' +
          '<td>' + esc(fecha(o.modificado)) + '</td><td>' + (o.enviado ? esc(fecha(o.enviado)) : '<span class="text-muted">nunca</span>') + '</td>' +
          '<td class="obras-acciones">' +
          (es ? '' : '<button class="btn btn-primary btn-chico" data-abrir-obra="' + esc(o.id) + '">Abrir</button>') +
          '<button class="btn btn-danger btn-chico" data-borrar-obra="' + esc(o.id) + '">Borrar</button></td></tr>';
      }).join('') + '</tbody></table>';
  }
  function borrarObra(id) {
    var o = obras.filter(function (x) { return x.id === id; })[0];
    if (!o) return;
    if (!confirm('¿Borrar "' + o.nombre + '" de este navegador?' +
        (o.enviado ? '\n\nLa última versión está en tu mail del ' + fecha(o.enviado) + '.' : '\n\n⚠ Nunca la mandaste por mail: se pierde.'))) return;
    try { localStorage.removeItem(PREFIJO + id); } catch (e) { /* incógnito */ }
    obras = obras.filter(function (x) { return x.id !== id; });
    guardarLista();
    if (id === actual) {
      actual = null;
      try { localStorage.removeItem(CLAVE_ACTUAL); } catch (e) { /* incógnito */ }
      if (obras.length) abrirObra(obras[0].id);
      else { cargando = true; A.cargarEstado(A.estadoVacio()).then(function () { cargando = false; pintarBarra(); }); }
    }
    pintarMisObras(); pintarBarra();
  }

  /* ══════════════════ EL ARCHIVO .presuapp ══════════════════ */
  function archivoDeLaObra() {
    var o = obraActual();
    return JSON.stringify({ formato: 'presuapp', version: 1, app: 'PresupuestApp · SIBRATECH',
                            id: o ? o.id : nuevoId(), guardado: new Date().toISOString(), estado: A.estado() });
  }
  function nombreArchivo() {
    return (nombreDe(A.estado()) || 'obra').replace(/[\\/:*?"<>|]/g, '-') + '.presuapp';
  }
  function bajarAlDisco() {
    var blob = new Blob([archivoDeLaObra()], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nombreArchivo();
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    K.anotar('bajar_obra', nombreDe(A.estado()));
  }

  function abrirArchivo(file) {
    var r = new FileReader();
    r.onload = function (ev) {
      var j;
      try { j = JSON.parse(ev.target.result); } catch (e) { toast('Ese archivo no es una obra de PresupuestApp', 'error'); return; }
      // .presuapp, o el .json suelto del «Guardar proyecto» de antes
      var estado = j && j.formato === 'presuapp' ? j.estado : j;
      if (!estado || !Array.isArray(estado.items)) { toast('Ese archivo no es una obra de PresupuestApp', 'error'); return; }
      var id = j.formato === 'presuapp' && j.id ? String(j.id) : null;
      var ya = id && obras.filter(function (o) { return o.id === id; })[0];
      if (ya) {
        var reemplazar = confirm('"' + ya.nombre + '" ya está en este navegador (último cambio ' + fecha(ya.modificado) + ').\n' +
          'El archivo es del ' + fecha(j.guardado) + '.\n\n' +
          'Aceptar: reemplazar la de este navegador por la del archivo.\nCancelar: abrirla como una copia aparte.');
        if (reemplazar) { escribir(PREFIJO + id, estado); abrirObra(id); toast('Obra abierta: ' + ya.nombre, 'ok'); return; }
        id = null;
        estado.obra = Object.assign({}, estado.obra, { nombre: (nombreDe(estado) || 'Obra') + ' (copia)' });
      }
      var o = crearLocal(estado, id);
      abrirObra(o.id).then(function () { toast('Obra abierta: ' + o.nombre, 'ok'); });
    };
    r.readAsText(file);
  }

  /* ══════════════════ LOS DATOS (una sola vez) ══════════════════
     El mismo formulario sirve para tres cosas:
       · mandar la obra por mail  → pide además el nombre de la obra
       · bajar un Excel / PDF     → sólo los datos
       · corregir sus datos                                             */
  var alConfirmar = null;
  function abrirDatos(modo, motivo, despues) {
    var c = K.usuario();
    alConfirmar = { modo: modo, despues: despues };
    $('datos-titulo').textContent = modo === 'mail' ? 'Te mandamos la obra a tu mail'
      : modo === 'editar' ? 'Tus datos' : 'Antes de bajar ' + motivo;
    $('datos-texto').textContent = modo === 'mail'
      ? 'Te llega la obra adjunta. Para seguir otro día, en cualquier compu, la abrís con «Abrir obra».'
      : modo === 'editar' ? 'Los usamos para mandarte tus obras.'
      : 'Dejanos tus datos una sola vez. La app es libre; los usamos para avisarte cuando actualicemos los precios.';
    $('datos-obra-fila').hidden = modo !== 'mail';
    $('datos-obra').value = nombreDe(A.estado()) === 'Obra sin nombre' ? '' : nombreDe(A.estado());
    $('datos-campos').hidden = !!c && modo === 'mail';
    $('datos-ya').hidden = !(c && modo === 'mail');
    if (c) $('datos-ya-email').textContent = c.email;
    $('datos-nombre').value = c ? c.nombre : '';
    $('datos-apellido').value = c ? c.apellido : '';
    $('datos-telefono').value = c ? c.telefono : '';
    $('datos-email').value = c ? c.email : '';
    $('btn-datos-confirmar').textContent = modo === 'mail' ? 'Mandármela por mail' : modo === 'editar' ? 'Guardar' : 'Bajar el archivo';
    A.abrirModal('modal-datos');
    var primero = modo === 'mail' && !$('datos-obra').value ? 'datos-obra' : c ? null : 'datos-nombre';
    if (primero) $(primero).focus();
  }

  function confirmarDatos() {
    var p = alConfirmar; if (!p) return;
    var c = K.usuario(), b = $('btn-datos-confirmar');
    var obra = $('datos-obra').value.trim();
    if (p.modo === 'mail' && !obra) { toast('La obra necesita un nombre', 'error'); $('datos-obra').focus(); return; }
    var registro = (c && p.modo === 'mail') ? Promise.resolve(c)
      : K.registrar($('datos-email').value.trim(), $('datos-nombre').value.trim(),
                    $('datos-apellido').value.trim(), $('datos-telefono').value.trim());
    b.disabled = true;
    registro.then(function () {
      if (p.modo !== 'mail') { A.cerrarModal('modal-datos'); pintarBarra(); if (p.despues) p.despues(); return; }
      // el nombre de la obra es el del presupuesto: se escribe en los dos lados
      if (obra !== nombreDe(A.estado())) {
        A.estado().obra.nombre = obra;
        $('obra-nombre').value = obra;
        A.guardar();
      }
      return K.enviarObra(obra, archivoDeLaObra()).then(function (r) {
        var o = obraActual();
        if (o) { o.enviado = new Date().toISOString(); guardarLista(); }
        A.cerrarModal('modal-datos');
        pintarBarra();
        $('enviado-obra').textContent = obra;
        $('enviado-email').textContent = r.email;
        A.abrirModal('modal-enviado');
      });
    }).catch(function (e) {
      toast(e.message, 'error');
      // si no se pudo mandar, que se la pueda llevar igual
      if (p.modo === 'mail' && K.usuario()) $('datos-bajar-igual').hidden = false;
    }).then(function () { b.disabled = false; });
  }

  function guardarObra() {
    if (!A.estado().items.length && !confirm('La obra está vacía. ¿Mandarla igual?')) return;
    $('datos-bajar-igual').hidden = true;
    abrirDatos('mail', '', null);
  }

  /* La pantalla le pide los datos antes de bajar un Excel / PDF (app.js). */
  function pedirDatos(motivo, bajar) {
    $('datos-bajar-igual').hidden = true;
    abrirDatos('descarga', motivo, bajar);
  }

  /* ══════════════════ LA SUGERENCIA ══════════════════
     Una vez, cuando ya tiene algo que perder (3 renglones), y nunca más
     si dice que no.                                                    */
  var CLAVE_NO = 'presuapp_mail_no';
  var sugerido = false;
  function sugerirMail() {
    if (sugerido) return;
    var o = obraActual();
    if (o && o.enviado) return;
    try { if (localStorage.getItem(CLAVE_NO)) return; } catch (e) { return; }
    sugerido = true;
    $('aviso-mail').hidden = false;
  }

  /* ══════════════════ HISTORIAL DE PRECIOS ══════════════════ */
  var verTareas = false;
  function filasHistorial() {
    var h = A.estado().historial || { insumos: {}, tareas: {} };
    var lugar = verTareas ? h.tareas : h.insumos;
    return Object.keys(lugar || {}).sort().map(function (code) {
      var e = lugar[code], p = e.p || [];
      var pri = p[0], ult = p[p.length - 1];
      return { code: code, desc: e.d, unit: e.u, p: p, pri: pri, ult: ult,
               variacion: pri && ult && pri[1] ? (ult[1] / pri[1] - 1) * 100 : null };
    }).filter(function (f) { return f.p.length; });
  }
  function origen(o) { return o === 'propio' ? 'tuyo' : o === 'manual' ? 'a mano' : o === 'analisis' ? 'análisis' : 'SIBRATECH'; }
  function pintarHistorial() {
    var filas = filasHistorial();
    $('hist-ver-insumos').className = 'btn btn-chico ' + (verTareas ? 'btn-secondary' : 'btn-primary');
    $('hist-ver-tareas').className = 'btn btn-chico ' + (verTareas ? 'btn-primary' : 'btn-secondary');
    if (!filas.length) {
      $('hist-tabla').innerHTML = '<div class="empty-state">Todavía no hay precios anotados en esta obra. Se anotan solos cada vez que se calcula.</div>';
      return;
    }
    $('hist-tabla').innerHTML = '<div class="tabla-scroll"><table class="detail-table hist"><thead><tr>' +
      '<th>Código</th><th>' + (verTareas ? 'Tarea' : 'Insumo') + '</th><th>Un.</th><th>Primera vez</th><th class="n">Precio</th>' +
      '<th>Última</th><th class="n">Precio</th><th class="n">Variación</th><th class="n">Cambios</th></tr></thead><tbody>' +
      filas.map(function (f) {
        var v = f.variacion;
        return '<tr title="' + esc(f.p.map(function (x) { return x[0] + ': $ ' + A.num(x[1]) + ' (' + origen(x[2]) + ')'; }).join('\n')) + '">' +
          '<td class="cod">' + esc(f.code) + '</td><td>' + esc(f.desc) + '</td><td>' + esc(f.unit) + '</td>' +
          '<td>' + esc(f.pri[0]) + '</td><td class="n">$ ' + A.num(f.pri[1]) + '</td>' +
          '<td>' + esc(f.ult[0]) + '</td><td class="n">$ ' + A.num(f.ult[1]) + '</td>' +
          '<td class="n' + (v > 0.005 ? ' sube' : v < -0.005 ? ' baja' : '') + '">' + (v === null ? '' : A.pct(v)) + '</td>' +
          '<td class="n">' + (f.p.length - 1) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  function hojasHistorial() {
    var guardo = verTareas, hojas = [];
    [false, true].forEach(function (t) {
      verTareas = t;
      var filas = [['Código', t ? 'Tarea' : 'Insumo', 'Unidad', 'Fecha en que se usó', 'Precio', 'Origen', 'Fecha del precio']];
      filasHistorial().forEach(function (f) {
        f.p.forEach(function (x) { filas.push([f.code, f.desc, f.unit, x[0], x[1], origen(x[2]), x[3] || '']); });
      });
      hojas.push({ nombre: t ? 'Precios de tareas' : 'Precios de insumos', filas: filas });
    });
    verTareas = guardo;
    return hojas;
  }

  /* ══════════════════ EVENTOS ══════════════════ */
  function conectar() {
    $('obra-selector').onchange = function () { if (this.value && this.value !== actual) abrirObra(this.value); };
    $('obra-nueva').onclick = abrirObraNueva;
    $('obra-mis-obras').onclick = abrirMisObras;
    $('obra-guardar').onclick = guardarObra;
    $('obra-abrir-archivo').onchange = function (e) { if (e.target.files[0]) abrirArchivo(e.target.files[0]); e.target.value = ''; };
    $('obra-mis-datos').onclick = function () { $('datos-bajar-igual').hidden = true; abrirDatos('editar', '', null); };
    $('btn-nueva-crear').onclick = crearObra;
    $('nueva-nombre').onkeydown = function (e) { if (e.key === 'Enter') crearObra(); };
    $('obras-lista').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.getAttribute('data-abrir-obra')) { A.cerrarModal('modal-obras'); abrirObra(b.getAttribute('data-abrir-obra')); }
      if (b.getAttribute('data-borrar-obra')) borrarObra(b.getAttribute('data-borrar-obra'));
    });
    $('obras-nueva').onclick = function () { A.cerrarModal('modal-obras'); abrirObraNueva(); };

    $('btn-datos-confirmar').onclick = confirmarDatos;
    $('datos-bajar-igual').onclick = function () { A.cerrarModal('modal-datos'); bajarAlDisco(); };
    $('datos-cambiar').onclick = function () { $('datos-campos').hidden = false; $('datos-ya').hidden = true; K.olvidar(); };
    $('enviado-bajar').onclick = function () { A.cerrarModal('modal-enviado'); bajarAlDisco(); };

    $('aviso-mail-si').onclick = function () { $('aviso-mail').hidden = true; guardarObra(); };
    $('aviso-mail-no').onclick = function () {
      $('aviso-mail').hidden = true;
      try { localStorage.setItem(CLAVE_NO, new Date().toISOString()); } catch (e) { /* incógnito */ }
      toast('Listo. Cuando quieras, está «Guardar obra» arriba.', 'ok');
    };

    $('btn-historial').onclick = function () { pintarHistorial(); A.abrirModal('modal-historial'); };
    $('hist-ver-insumos').onclick = function () { verTareas = false; pintarHistorial(); };
    $('hist-ver-tareas').onclick = function () { verTareas = true; pintarHistorial(); };
    $('hist-excel').onclick = function () {
      A.exportarLibro(hojasHistorial(), 'historial_precios_' + (nombreDe(A.estado()) || 'obra').replace(/[\\/:*?"<>|]/g, '-') + '.xlsx');
    };
    $('hist-pdf').onclick = function () { A.imprimirLibro(hojasHistorial(), 'Historial de precios'); };
  }

  /* ══════════════════ ARRANQUE ══════════════════ */
  conectar();
  A.listo().then(function () {
    // los botones de siempre del Presupuesto pasan a ser los de la obra
    $('btn-guardar-json').onclick = guardarObra;
    $('file-proyecto').onchange = function (e) { if (e.target.files[0]) abrirArchivo(e.target.files[0]); e.target.value = ''; };

    obras = leer(CLAVE_LISTA, []);
    actual = leer(CLAVE_ACTUAL, null);
    var guardada = actual && leer(PREFIJO + actual, null);
    if (!guardada) {
      actual = null;
      // primera vez con esta versión: lo que venía armando pasa a ser su primera obra
      var e = A.estado();
      if (e.items.length || nombreDe(e)) crearLocal(e);
    }
    pintarBarra();
    return K.iniciar();
  }).then(pintarBarra);

  window.Obras = { pedirDatos: pedirDatos, abrirObra: abrirObra, actual: obraActual, bajarAlDisco: bajarAlDisco };
})();
