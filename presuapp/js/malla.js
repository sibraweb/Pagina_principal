/* ───────────────────────────────────────────────────────────────
   LA MALLA: el orden en que se construye una obra

   Atar cuarenta tareas a mano no lo hace nadie. Pero el orden de una
   obra no es un misterio: primero se excava, después se funda, después
   se levanta, y la pintura va al final. Eso se puede escribir una vez.

   Cada tarea del cómputo cae en un NODO por su código, y los nodos
   están atados entre sí. De ahí sale un plan COMPLETO que después se
   corrige donde haga falta — que es muchísimo más rápido que armarlo
   de cero, y sobre todo no se olvida ninguna dependencia.

   DOS COSAS QUE NO SE PUEDEN ADIVINAR y por eso se avisan en vez de
   inventarse:

     · la SECTORIZACIÓN. Si la obra tiene dos plantas y el cómputo no
       lo dice, la malla toma la mampostería como un bloque y se pierde
       el solape entre niveles. El plazo sale más largo que el real.
     · el CRITERIO de la obra. Hay quien revoca antes de colocar los
       marcos y quien no. La malla propone lo habitual.

   Dentro de un nodo las tareas van EN PARALELO: tres tipos de
   mampostería se levantan a la vez, no una después de otra. El nodo
   siguiente espera a que terminen todas.
   ─────────────────────────────────────────────────────────────── */
(function (global) {
  'use strict';

  /* Los nodos, en el orden en que se construye. `pref` son los códigos
     que caen acá; `excl` los que no, cuando un prefijo largo pisa a uno
     corto (E07P son cercos, no mampostería de la casa). */
  var NODOS = [
    { id: 'suelos',     nombre: 'Movimiento de suelos',  pref: ['E02'] },
    { id: 'fundacion',  nombre: 'Fundaciones',           pref: ['E04'] },
    { id: 'columnas',   nombre: 'Columnas y pilares',    pref: ['E05HS', 'E05HT', 'E05HP'] },
    { id: 'contrapiso', nombre: 'Contrapisos',           pref: ['E06'] },
    { id: 'mamposteria',nombre: 'Mampostería',           pref: ['E07'], excl: ['E07P', 'E07W'] },
    { id: 'encadenado', nombre: 'Encadenado superior',   pref: ['E05HV'] },
    { id: 'losa',       nombre: 'Losas y entrepisos',    pref: ['E05HF', 'E05HL', 'E05HC', 'E05HD', 'E05HX'] },
    { id: 'estructura', nombre: 'Estructura de techo',   pref: ['E05AC', 'E05M', 'P21'] },
    { id: 'cubierta',   nombre: 'Cubierta',              pref: ['E09'] },
    { id: 'capa',       nombre: 'Capa aisladora',        pref: ['E10AC'] },
    { id: 'aislacion',  nombre: 'Impermeabilizaciones',  pref: ['E10'], excl: ['E10AC'] },
    { id: 'sanitaria',  nombre: 'Instalación sanitaria', pref: ['E20'] },
    { id: 'electrica',  nombre: 'Instalación eléctrica', pref: ['E17', 'E19', 'E21', 'E22', 'P41'] },
    { id: 'gas',        nombre: 'Instalación de gas',    pref: ['E24', 'A04'] },
    { id: 'carpinteria',nombre: 'Carpinterías',          pref: ['E13', 'E14'] },
    { id: 'seco',       nombre: 'Construcción en seco',  pref: ['E44', 'E45', 'P47'] },
    { id: 'azotado',    nombre: 'Azotado hidrófugo',     pref: ['E08PF005', 'E08PF010', 'E08PF015', 'E08PF140'] },
    { id: 'jaharro',    nombre: 'Jaharro',               pref: ['E08PF020', 'E08PF025', 'E08PF030'] },
    { id: 'enlucido',   nombre: 'Enlucido',              pref: ['E08PF035', 'E08PF036', 'E08PF037', 'E08PK', 'E08PV', 'E08PE'] },
    { id: 'revoque',    nombre: 'Revoque completo',      pref: ['E08PF100', 'E08PF110', 'E08PF111', 'E08PF112', 'E08PF130'] },
    { id: 'cielorraso', nombre: 'Cielorrasos',           pref: ['E08T', 'E08R', 'E08A'] },
    { id: 'carpeta',    nombre: 'Carpetas',              pref: ['E11C'] },
    { id: 'pisos',      nombre: 'Pisos',                 pref: ['E11'], excl: ['E11C'] },
    { id: 'revest',     nombre: 'Revestimientos',        pref: ['E12'] },
    { id: 'barandas',   nombre: 'Barandas y herrería',   pref: ['E15'] },
    { id: 'vidrios',    nombre: 'Vidriería',             pref: ['E16'] },
    { id: 'artefactos', nombre: 'Artefactos',            pref: ['E18'] },
    { id: 'pinturaext', nombre: 'Pintura exterior',      pref: ['E27G'] },
    { id: 'pinturaint', nombre: 'Pintura interior',      pref: ['E27'], excl: ['E27G'] },
    { id: 'exteriores', nombre: 'Cercos y parquización', pref: ['E07P', 'E07W', 'E28'] }
  ];

  /* Qué va después de qué. `lag` en días; 'PARTE' significa que arranca
     cuando la anterior lleva buena parte hecha, que es como se trabaja
     de verdad: el encadenado no espera a que esté TODA la mampostería. */
  var ARISTAS = {
    fundacion:  ['suelos'],
    columnas:   ['fundacion'],
    contrapiso: ['fundacion'],
    // la capa aisladora corta la humedad del cimiento: va sobre el
    // cimiento y antes de levantar la pared, no despues
    capa:       ['fundacion'],
    mamposteria:['columnas', 'contrapiso', 'capa'],
    encadenado: ['mamposteria'],
    losa:       ['encadenado'],
    estructura: ['encadenado'],
    cubierta:   ['estructura', 'losa'],
    // las impermeabilizaciones de terraza y muro van con el techo hecho
    aislacion:  ['cubierta'],
    sanitaria:  ['mamposteria'],
    electrica:  ['mamposteria'],
    gas:        ['mamposteria'],
    carpinteria:['mamposteria'],
    seco:       ['cubierta'],
    // los revoques esperan a que esté todo lo que va dentro de la pared
    azotado:    ['cubierta', 'sanitaria', 'electrica', 'gas', 'carpinteria', 'aislacion'],
    jaharro:    ['azotado'],
    enlucido:   ['jaharro'],
    revoque:    ['cubierta', 'sanitaria', 'electrica', 'gas', 'carpinteria', 'aislacion'],
    cielorraso: ['enlucido', 'revoque', 'seco'],
    carpeta:    ['enlucido', 'revoque'],
    pisos:      ['carpeta', 'cielorraso'],
    revest:     ['enlucido', 'revoque'],
    barandas:   ['pisos'],
    vidrios:    ['carpinteria', 'revest'],
    artefactos: ['pisos', 'revest'],
    pinturaext: ['revoque', 'enlucido', 'cubierta'],
    pinturaint: ['pisos', 'cielorraso', 'revest'],
    exteriores: ['pinturaext']
  };

  function normalizar(t) {
    return String(t || '').trim().toUpperCase();
  }

  /* El nodo de una tarea. Gana el prefijo MÁS LARGO que coincida: si no,
     E08PF005 caería en el nodo de E08 y el revoque no se separaría en
     capas. */
  function nodoDe(codigo) {
    var c = normalizar(codigo);
    var mejor = null, largo = -1;
    NODOS.forEach(function (n) {
      if (n.excl && n.excl.some(function (x) { return c.indexOf(normalizar(x)) === 0; })) return;
      n.pref.forEach(function (px) {
        var p = normalizar(px);
        if (c.indexOf(p) === 0 && p.length > largo) { largo = p.length; mejor = n; }
      });
    });
    return mejor;
  }

  /* ── la propuesta ─────────────────────────────────────────────
     Devuelve, para cada tarea, de qué otras tareas del cómputo depende.
     Si un nodo intermedio no está en el cómputo se saltea: sin losa, la
     cubierta cuelga del encadenado y no queda colgada de la nada.      */
  function proponer(items) {
    items = items || [];
    var porNodo = {}, sinNodo = [], deTarea = {};

    items.forEach(function (it) {
      /* El nodo viene resuelto del servidor (`it.nodo`) porque el codigo
         nuestro ya no viaja. En modo local, donde si esta el codigo, se
         clasifica como siempre. */
      var n = it.nodo ? NODOS.filter(function (x) { return x.id === it.nodo; })[0] : nodoDe(it.code);
      if (!n) { sinNodo.push(it); return; }
      (porNodo[n.id] = porNodo[n.id] || []).push(it.id);
      deTarea[it.id] = n.id;
    });

    /* Sube por la malla hasta encontrar nodos que SÍ estén en la obra. */
    function anteriores(idNodo, visto) {
      visto = visto || {};
      if (visto[idNodo]) return [];
      visto[idNodo] = true;
      var out = [];
      (ARISTAS[idNodo] || []).forEach(function (previo) {
        if (porNodo[previo]) out.push(previo);
        else anteriores(previo, visto).forEach(function (x) {
          if (out.indexOf(x) < 0) out.push(x);
        });
      });
      return out;
    }

    /* Se queda con las predecesoras DIRECTAS. Si la pintura va despues
       de los pisos, y los pisos despues del revoque, no hace falta decir
       que la pintura va despues del revoque: el calculo da igual, pero
       en pantalla son nueve dependencias en vez de dos y no se entiende
       nada. */
    function alcanza(desde, hasta, visto) {
      if (desde === hasta) return true;
      visto = visto || {};
      if (visto[hasta]) return false;
      visto[hasta] = true;
      return (ARISTAS[hasta] || []).some(function (p) {
        return porNodo[p] ? alcanza(desde, p, visto) : alcanza(desde, p, visto);
      });
    }

    var predecesoras = {};
    Object.keys(porNodo).forEach(function (idNodo) {
      var previos = anteriores(idNodo);
      // fuera los que ya se alcanzan pasando por otro
      var directos = previos.filter(function (p) {
        return !previos.some(function (otro) {
          return otro !== p && alcanza(p, otro);
        });
      });
      var ids = [];
      directos.forEach(function (p) {
        (porNodo[p] || []).forEach(function (x) { if (ids.indexOf(x) < 0) ids.push(x); });
      });
      porNodo[idNodo].forEach(function (idTarea) { predecesoras[idTarea] = ids.slice(); });
    });

    return {
      predecesoras: predecesoras,
      nodoDeTarea: deTarea,
      nodos: NODOS.filter(function (n) { return porNodo[n.id]; })
                  .map(function (n) { return { id: n.id, nombre: n.nombre, tareas: porNodo[n.id].length }; }),
      sinNodo: sinNodo,
      avisos: avisosDe(items, porNodo)
    };
  }

  /* Lo que la malla no puede saber, dicho en voz alta. */
  function avisosDe(items, porNodo) {
    var av = [];

    if (porNodo.revoque && (porNodo.azotado || porNodo.jaharro || porNodo.enlucido)) {
      av.push({ grave: true, texto: 'El cómputo mezcla revoque completo con las capas sueltas ' +
        '(azotado, jaharro, enlucido). Fijate que no haya partidas duplicadas: se estaría ' +
        'revocando dos veces la misma pared.' });
    }
    if (porNodo.azotado && porNodo.jaharro && porNodo.enlucido) {
      av.push({ texto: 'El revoque está desglosado en capas, así que van una después de otra y ' +
        'el plazo se alarga tres eslabones respecto de usar la partida de revoque completo.' });
    }
    if (!porNodo.cubierta && !porNodo.losa) {
      av.push({ texto: 'No hay cubierta ni losa en el cómputo. Los revoques quedaron colgando de ' +
        'lo que haya antes; si la obra tiene techo, falta cargarlo.' });
    }

    var dosPlantas = items.filter(function (it) {
      return /(PLANTA ALTA|ENTREPISO|1ER PISO|PRIMER PISO|\bP\.?A\.?\b)/i.test(it.desc || '') ||
             /(PLANTA ALTA|ENTREPISO|ALTA)/i.test(it.sector || '');
    });
    if (dosPlantas.length) {
      av.push({ grave: true, texto: 'Parece haber dos plantas, pero la malla toma la mampostería y ' +
        'el revoque como un bloque único: se pierde el solape entre niveles y el plazo sale más ' +
        'largo que el real. Para ganarlo hay que separar las tareas por planta, cargando el sector.' });
    }
    return av;
  }

  global.Malla = {
    NODOS: NODOS,
    ARISTAS: ARISTAS,
    nodoDe: nodoDe,
    proponer: proponer
  };
})(typeof window !== 'undefined' ? window : globalThis);
