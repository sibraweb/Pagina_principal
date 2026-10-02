/* ───────────────────────────────────────────────────────────────
   CONTACTO — los datos de la persona, para mandarle su obra por mail.

   No hay cuenta ni contraseña. La primera vez que quiere guardar una
   obra (o bajar un Excel) deja nombre, apellido, teléfono y email; el
   servidor le da una SESIÓN (presuapp_registrar) que queda en este
   navegador para no volver a pedírselos. Con esa sesión:
     · se piden los envíos de obras por mail (presuapp_enviar_obra) —
       siempre a SU email, no se elige destino;
     · se anota cada uso (presuapp_registrar_uso): así sabemos cuántas
       veces vuelve.
   Ver supabase/usuarios.sql.
   ─────────────────────────────────────────────────────────────── */
(function (global) {
  'use strict';

  var CLAVE = 'presuapp_contacto';
  var contacto = null;   // {sesion, email, nombre, apellido, telefono}

  function D() { return global.Datos; }
  function leer() { try { return JSON.parse(localStorage.getItem(CLAVE) || 'null'); } catch (e) { return null; } }
  function escribir(v) {
    try { if (v) localStorage.setItem(CLAVE, JSON.stringify(v)); else localStorage.removeItem(CLAVE); } catch (e) { /* incógnito */ }
  }
  /* El mensaje de la función viene adentro del texto del error de PostgREST. */
  function mensaje(e) {
    var m = /"message":"((?:[^"\\]|\\.)*)"/.exec(e && e.message || '');
    if (!m) return e && e.message || 'Error desconocido';
    try { return JSON.parse('"' + m[1] + '"'); } catch (x) { return m[1]; }
  }

  function iniciar() {
    var g = leer();
    if (!g || !g.sesion) return Promise.resolve(null);
    contacto = g;
    return D().rpc('presuapp_retomar', { p_sesion: g.sesion }).then(function (r) {
      if (!r) { contacto = null; escribir(null); return null; }   // venció
      contacto = r; escribir(r);
      return r;
    }).catch(function () { return contacto; });   // sin red: se sigue con lo que había
  }

  function registrar(email, nombre, apellido, telefono) {
    return D().rpc('presuapp_registrar', {
      p_email: email, p_nombre: nombre, p_apellido: apellido, p_telefono: telefono
    }).then(function (r) { contacto = r; escribir(r); return r; })
      .catch(function (e) { throw new Error(mensaje(e)); });
  }

  /* Deja el pedido; el mail lo manda nuestra PC (servidor/enviar_obras.py). */
  function enviarObra(obra, contenido) {
    if (!contacto) return Promise.reject(new Error('Faltan tus datos'));
    return D().rpc('presuapp_enviar_obra', { p_sesion: contacto.sesion, p_obra: obra, p_contenido: contenido })
      .catch(function (e) {
        var m = mensaje(e);
        if (/vencieron/.test(m)) { contacto = null; escribir(null); }
        throw new Error(m);
      });
  }

  /* Cada cosa que hace. Nunca frena el trabajo: si falla, falla callado. */
  function anotar(evento, obra, detalle) {
    if (!contacto || !contacto.sesion) return;
    D().rpc('presuapp_registrar_uso', {
      p_sesion: contacto.sesion, p_evento: evento, p_obra: obra || null, p_detalle: detalle || null
    }).catch(function () { /* el uso no es más importante que la obra */ });
  }

  function olvidar() { contacto = null; escribir(null); }

  global.Contacto = {
    iniciar: iniciar,
    usuario: function () { return contacto; },
    registrar: registrar,
    enviarObra: enviarObra,
    anotar: anotar,
    olvidar: olvidar
  };
})(window);
