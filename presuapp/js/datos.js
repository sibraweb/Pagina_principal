/* ───────────────────────────────────────────────────────────────
   ORIGEN DE DATOS — la única puerta por la que la pantalla pide
   tareas, insumos y números.

   DOS MODOS, LA MISMA INTERFAZ:

     local    el catálogo está en data/catalogo.js y calcula el Motor.
              Es el modo de desarrollo y el de trabajar sin internet.

     remoto   el catálogo NO baja: vive en Supabase detrás de funciones.
              Se piden búsquedas acotadas y el cálculo lo hace el
              servidor, que es el único que ve los precios.

   POR QUÉ EL CÁLCULO VA DEL LADO DEL SERVIDOR EN MODO REMOTO:
   para recalcular en el navegador harían falta los precios unitarios
   de cada insumo, y entregarlos es entregar la base — da igual si van
   como precio o como incidencia, de una se deduce la otra. Entonces el
   navegador manda el cómputo y los precios PROPIOS del visitante, y
   recibe los totales. Lo que sí baja es el RENDIMIENTO (0,25 bolsas por
   m²): ese es el know-how que conviene mostrar.

   Todo devuelve promesas en los dos modos, así la pantalla no se entera
   de quién contestó.
   ─────────────────────────────────────────────────────────────── */
(function (global) {
  'use strict';

  var TOPE = 50;
  var modo = 'local';
  var catalogo = { insumos: [], analisis: [], fuente: '', vigencia: '' };

  // Publishable key: es pública por diseño y no lee una sola fila por sí
  // sola — las tablas tienen RLS sin políticas. Ver supabase/funciones.sql.
  var API = {
    url: 'https://mkbeddulfbqgyutrzyvr.supabase.co',
    key: 'sb_publishable_ewknnbpVirEVndioUqqDrw_5_N5oyZf'
  };

  function rpc(funcion, args) {
    return fetch(API.url + '/rest/v1/rpc/' + funcion, {
      method: 'POST',
      headers: { apikey: API.key, 'Content-Type': 'application/json' },
      body: JSON.stringify(args || {})
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(funcion + ': ' + (t || r.status)); });
      return r.json();
    });
  }

  function iniciar(opciones) {
    opciones = opciones || {};
    if (opciones.remoto || global.PRESUAPP_REMOTO) {
      modo = 'remoto';
      catalogo = { insumos: [], analisis: [], fuente: 'SIBRATECH (en línea)', vigencia: '' };
      // un ping barato para saber si contesta
      return rpc('presuapp_buscar_tarea', { q: 'zzz', limite: 1 })
        .then(function () { return catalogo; })
        .catch(function (e) { catalogo.error = e.message; return catalogo; });
    }
    if (global.CATALOGO_LOCAL) {
      modo = 'local';
      catalogo = {
        insumos: global.CATALOGO_LOCAL.insumos || [],
        analisis: global.CATALOGO_LOCAL.analisis || [],
        fuente: global.CATALOGO_LOCAL.fuente || '',
        vigencia: global.CATALOGO_LOCAL.vigencia || ''
      };
    }
    return Promise.resolve(catalogo);
  }

  function normalizar(t) {
    return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  /* ── buscar ───────────────────────────────────────────────────
     En remoto la búsqueda EXIGE 3 caracteres: no existe "dame todo".
     En local se respeta el mismo mínimo, para que la pantalla se
     comporte igual en los dos modos y no aparezcan sorpresas al
     publicar.                                                      */
  function buscarTareas(q, offset, tope) {
    var lim = Math.min(tope || TOPE, TOPE);
    if (String(q || '').trim().length < 3) {
      return Promise.resolve({ total: 0, filas: [], offset: 0, tope: lim, minimo: 3 });
    }
    if (modo === 'remoto') {
      return rpc('presuapp_buscar_tarea', { q: q, limite: lim }).then(function (filas) {
        return {
          total: filas.length, offset: 0, tope: lim,
          filas: filas.map(function (f) {
            return {
              code: f.codigo, rubro: f.rubro, desc: f.descripcion, unit: f.unidad,
              price: f.precio, edadDias: f.edad_dias, edadMaxima: f.edad_maxima_dias,
              pctConFecha: f.pct_con_fecha, insumosSinFecha: f.insumos_sin_fecha
            };
          })
        };
      });
    }
    var n = normalizar(q), off = offset || 0;
    var todos = catalogo.analisis.filter(function (a) {
      return normalizar(a.code).indexOf(n) > -1 || normalizar(a.desc).indexOf(n) > -1
          || normalizar(a.rubro).indexOf(n) > -1;
    });
    return Promise.resolve({ total: todos.length, filas: todos.slice(off, off + lim), offset: off, tope: lim });
  }

  function buscarInsumos(q, categoria, offset, tope) {
    var lim = Math.min(tope || TOPE, TOPE);
    if (modo === 'remoto') {
      if (String(q || '').trim().length < 3) {
        return Promise.resolve({ total: 0, filas: [], offset: 0, tope: lim, minimo: 3 });
      }
      // el parametro se llama p_categoria: `categoria` chocaba con la columna
      return rpc('presuapp_buscar_insumo', { q: q, p_categoria: categoria || null, limite: lim })
        .then(function (filas) {
          return {
            total: filas.length, offset: 0, tope: lim,
            filas: filas.map(function (f) {
              return {
                code: f.codigo, desc: f.descripcion, unit: f.unidad_obra,
                unidadCompra: f.unidad_compra, factor: f.contenido,
                category: f.categoria_out, price: f.precio, precioFecha: f.precio_fecha
              };
            })
          };
        });
    }
    var n = normalizar(q), off = offset || 0;
    var todos = catalogo.insumos.filter(function (i) {
      if (categoria && Motor.normalizarCategoria(i.category) !== categoria) return false;
      if (!n) return true;
      return normalizar(i.code).indexOf(n) > -1 || normalizar(i.desc).indexOf(n) > -1;
    });
    return Promise.resolve({ total: todos.length, filas: todos.slice(off, off + lim), offset: off, tope: lim });
  }

  /* ── el análisis, en rendimientos ─────────────────────────────
     Sin el precio de cada insumo: eso es lo que permite mostrar la
     receta sin entregar la lista de precios.                       */
  function analisis(codigo) {
    if (modo === 'remoto') {
      return rpc('presuapp_analisis', { p_codigo: codigo }).then(function (filas) {
        return filas.map(function (f) {
          return {
            code: f.item_codigo, desc: f.descripcion, unit: f.unidad,
            qty: f.cantidad, category: f.categoria,
            unidadCompra: f.unidad_compra, factor: f.contenido,
            precioFecha: f.precio_fecha, edadDias: f.edad_dias
          };
        });
      });
    }
    var a = (catalogo.analisis || []).filter(function (x) { return x.code === codigo; })[0];
    return Promise.resolve(a ? a.details.slice() : []);
  }

  /* ── cotizar ──────────────────────────────────────────────────
     El cómputo del visitante y SUS precios entran; salen los totales
     y la lista de compras. En local lo resuelve el Motor con el mismo
     resultado, para que la pantalla no distinga.                   */
  function cotizar(items, overrides, params) {
    if (modo !== 'remoto') {
      var local = Motor.calcularPresupuesto(items, catalogo, overrides, params);
      // la lista de compras viaja SIEMPRE dentro del calculo, en los dos
      // modos: asi la pantalla nunca tiene que preguntar quien contesto
      local.insumos = Motor.consolidarInsumos(items, catalogo, overrides);
      return Promise.resolve(local);
    }
    var envio = (items || []).map(function (it) {
      return { id: String(it.id), codigo: it.code, cantidad: Motor.safeNum(it.qty) };
    });
    var mios = (overrides || []).map(function (o) {
      return { codigo: o.code, precio: Motor.safeNum(o.price), contenido: o.factor || null };
    });
    return rpc('presuapp_cotizar', { p_items: envio, p_overrides: mios }).then(function (r) {
      var porId = {};
      (r.items || []).forEach(function (f) { porId[String(f.id)] = f; });

      /* El servidor no sabe del SECTOR ni del precio a mano: esas dos son
         del visitante y nunca salieron del navegador. Se pegan aca. */
      var filas = (items || []).map(function (it, i) {
        var f = porId[String(it.id)] || {};
        var aMano = it.precioManual !== undefined && it.precioManual !== null && it.precioManual !== '';
        var qty = Motor.safeNum(it.qty);
        var pu = aMano ? Motor.safeNum(it.precioManual) : Motor.safeNum(f.precio_unitario);
        return {
          id: it.id !== undefined ? it.id : i,
          code: it.code,
          desc: f.descripcion || it.desc || '',
          unit: f.unidad || it.unit || 'gl',
          rubro: f.rubro || it.rubro || 'Sin rubro',
          sector: it.sector || '',
          qty: qty,
          precioUnitario: pu,
          precioManual: aMano,
          costoTotal: qty * pu,
          // el reparto por categoria viene sumado del servidor, no por fila
          materiales: 0, manoObra: 0, equipos: 0,
          analisis: null,
          sinAnalisis: !!f.sin_analisis
        };
      });

      var inc = r.incidencia || {};
      var cerrado = Motor.cerrarPresupuesto(filas, params, {
        materiales: Motor.safeNum(inc.materiales),
        manoObra: Motor.safeNum(inc.manoObra),
        equipos: Motor.safeNum(inc.equipos)
      });
      cerrado.remoto = true;

      /* La lista de compras, con la misma forma que devuelve el Motor.
         El precio unitario viene SOLO donde lo puso el visitante: el
         nuestro no viaja de a listas enteras.                          */
      cerrado.insumos = (r.insumos || []).map(function (x) {
        return {
          code: x.codigo, desc: x.descripcion, unit: x.unidad_obra,
          category: Motor.normalizarCategoria(x.categoria),
          unidadCompra: x.unidad_compra, factor: Motor.safeNum(x.contenido) || 1,
          cantidad: Motor.safeNum(x.cantidad),
          cantidadCompra: Motor.safeNum(x.cantidad_compra),
          unitPrice: x.precio === null || x.precio === undefined ? null : Motor.safeNum(x.precio),
          total: x.total === null || x.total === undefined ? null : Motor.safeNum(x.total),
          origenPrecio: x.origen_precio,
          rubros: []
        };
      });
      return cerrado;
    });
  }

  /* ── el email, al bajar el Excel ──────────────────────────────── */
  function registrarDescarga(email, nombre, obra, origen) {
    if (modo !== 'remoto') return Promise.resolve(true);
    return rpc('presuapp_registrar_descarga', {
      p_email: email, p_nombre: nombre || null, p_obra: obra || null, p_origen: origen || null
    });
  }

  function catalogoLocal() { return modo === 'local' ? catalogo : null; }
  function hayCatalogo() { return modo === 'remoto' ? !catalogo.error : !!(catalogo.insumos.length && catalogo.analisis.length); }

  global.Datos = {
    TOPE: TOPE,
    modo: function () { return modo; },
    iniciar: iniciar,
    buscarTareas: buscarTareas,
    buscarInsumos: buscarInsumos,
    analisis: analisis,
    cotizar: cotizar,
    registrarDescarga: registrarDescarga,
    catalogoLocal: catalogoLocal,
    hayCatalogo: hayCatalogo
  };
})(typeof window !== 'undefined' ? window : globalThis);
