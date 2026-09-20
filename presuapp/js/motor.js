/* ───────────────────────────────────────────────────────────────
   MOTOR DE CALCULO — sin DOM, sin dependencias.
   Corre igual en el navegador, en Node (tests) y mañana adentro de
   una Edge Function de Supabase: ahi esta la gracia de que no toque
   la pantalla. El catalogo entra como argumento, nunca como global.

   Vocabulario (el mismo que usamos en obra):
     insumo   = material, mano de obra o equipo con precio unitario
     analisis = receta de una tarea: insumos x cantidad por unidad
     item     = una tarea del presupuesto con su cantidad de computo
     K        = coeficiente que lleva del COSTO al PRECIO. VA SIN IVA.
                El IVA se calcula al final, sobre costo x K.
   ─────────────────────────────────────────────────────────────── */
(function (global) {
  'use strict';

  var CATEGORIAS = ['Materiales', 'Mano de obra', 'Equipos'];

  /* ── numeros ──────────────────────────────────────────────────
     Hay que aguantar lo que venga de un Excel argentino
     ("$ 1.234,56") y lo que venga de un CSV yanqui ("1234.56").
     La version vieja borraba TODOS los puntos y convertia 1234.56
     en 123456: x100 silencioso.

     Con los dos separadores presentes no hay ambiguedad: el que
     aparece ULTIMO es el decimal. La duda queda cuando hay UN SOLO
     punto y tres digitos atras: "1.000" son mil pesos o uno con
     tres decimales? Depende de si es un PRECIO o un RENDIMIENTO,
     asi que no se adivina: safeNum lee el punto como decimal
     (nunca infla un numero) y precioDeTexto, que solo se usa al
     importar listas de precios, lo lee como separador de miles.    */
  function safeNum(v) {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var s = String(v).replace(/[^0-9.,\-]/g, '').trim();
    if (!s) return 0;
    var iCom = s.lastIndexOf(','), iPun = s.lastIndexOf('.');
    if (iCom > -1 && iPun > -1) {
      // el ultimo que aparece es el decimal; el otro es de miles
      if (iCom > iPun) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (iCom > -1) {
      // una sola coma: decimal si deja 1 o 2 digitos, si no es de miles
      var dec = s.length - iCom - 1;
      s = (dec > 0 && dec <= 2) ? s.replace(',', '.') : s.replace(/,/g, '');
    }
    // un solo punto se deja como esta: es decimal (1234.56)
    var n = parseFloat(s);
    return isFinite(n) ? n : 0;
  }

  /* Precio escrito a mano o traido de una lista: aca "1.000" son mil.
     Se aplica la regla de miles solo si el punto es unico, deja
     exactamente 3 digitos atras y la parte entera no es 0 — para que
     "0.125" siga valiendo 0,125.                                    */
  function precioDeTexto(v) {
    if (typeof v === 'number' || v === null || v === undefined || v === '') return safeNum(v);
    var s = String(v).replace(/[^0-9.,\-]/g, '').trim();
    if (/^-?[1-9][0-9]{0,2}(\.[0-9]{3})+$/.test(s)) return safeNum(s.replace(/\./g, ''));
    return safeNum(v);
  }

  function redondear(n, dec) {
    var f = Math.pow(10, dec === undefined ? 2 : dec);
    return Math.round((safeNum(n) + Number.EPSILON) * f) / f;
  }

  /* ── categoria de un insumo ───────────────────────────────────
     La version vieja miraba si el codigo empezaba con "mo"/"eq" y
     mandaba a Mano de obra cualquier cosa que arrancara con esas
     letras. Aca se exige el separador (mo_ / mo.) y se respeta la
     categoria declarada en el catalogo cuando existe.              */
  function categoriaDe(insumo, codigo) {
    if (insumo && insumo.category) return normalizarCategoria(insumo.category);
    var c = String(codigo || '').toLowerCase();
    if (/^mo[_.\-]/.test(c)) return 'Mano de obra';
    if (/^eq[_.\-]/.test(c)) return 'Equipos';
    return 'Materiales';
  }

  function normalizarCategoria(cat) {
    var c = String(cat || '').toLowerCase();
    if (c.indexOf('mano') === 0 || c === 'mo') return 'Mano de obra';
    if (c.indexOf('equip') === 0 || c === 'eq') return 'Equipos';
    if (c.indexOf('material') === 0) return 'Materiales';
    return cat || 'Materiales';
  }

  /* ── catalogo indexado ────────────────────────────────────────
     Se arma una vez y se pasa a todo el resto. Los overrides son
     los precios PROPIOS del usuario: si el tiene el cemento mas
     barato, manda el de el.                                        */
  function indexar(catalogo, overrides) {
    var porInsumo = Object.create(null);
    (catalogo.insumos || []).forEach(function (i) {
      if (i && i.code) porInsumo[String(i.code).trim()] = i;
    });
    var porAnalisis = Object.create(null);
    (catalogo.analisis || []).forEach(function (a) {
      if (a && a.code) porAnalisis[String(a.code).trim()] = a;
    });
    var ov = Object.create(null);
    (overrides || []).forEach(function (o) {
      if (o && o.code) ov[String(o.code).trim()] = o;
    });
    return { insumos: porInsumo, analisis: porAnalisis, overrides: ov };
  }

  /* ── unidad de obra vs unidad de COMPRA ───────────────────────
     El precio viene siempre por unidad de compra, porque así lo pasa
     el corralón y así se arma el pedido: la bolsa, la tira, el balde.
     La receta, en cambio, consume en unidad de obra: kilos de cemento,
     metros de caño.

        factor = cuántas unidades de OBRA trae una unidad de COMPRA
                 (bolsa de cemento = 50 kg → factor 50)

        precio por unidad de obra = precio de compra ÷ factor
        cantidad a comprar        = cantidad de obra ÷ factor, PARA ARRIBA

     Lo de "para arriba" no es un detalle: 345 kg de cemento no se piden;
     se piden 7 bolsas. Sin factor (o con factor 1) todo queda como antes,
     que es el caso de los insumos que ya se compran por unidad.         */
  function factorDe(insumo) {
    if (!insumo) return 1;
    var f = safeNum(insumo.factor !== undefined ? insumo.factor : (insumo.compra && insumo.compra.factor));
    return f > 0 ? f : 1;
  }
  function unidadCompraDe(insumo) {
    if (!insumo) return '';
    return (insumo.unidadCompra || (insumo.compra && insumo.compra.unidad) || insumo.unit || '');
  }
  /* Unidades que se cuentan de a una: no existe media bolsa ni 0,3 de
     tira. Las que se miden (kg, metros, m3, litros, horas) sí admiten
     decimales — el hormigón elaborado se pide 12,5 m3 sin problema.   */
  var UNIDADES_DISCRETAS = /^(bolsa|bol|bols|ud|u|un|und|uni|c\/u|tacho|balde|bidon|bidón|tambor|lata|tira|rollo|ro|barra|placa|chapa|juego|ju|par|caja|pack|chapon|unidad|nº|n°)$/i;

  function esDiscreta(unidad) {
    return UNIDADES_DISCRETAS.test(String(unidad || '').trim());
  }

  /* Cantidad a pedir. Se redondea para arriba cuando la unidad de compra
     se cuenta de a una — sea porque hay factor (kg → bolsa) o porque el
     insumo ya viene en presentación (la bolsa misma). 60,46 bolsas son
     61 bolsas.                                                          */
  function cantidadDeCompra(cantidadObra, factor, unidadCompra) {
    var c = safeNum(cantidadObra), f = factor > 0 ? factor : 1;
    var enCompra = f === 1 ? c : c / f;
    return esDiscreta(unidadCompra) || f !== 1 ? Math.ceil(enCompra - 1e-9) : enCompra;
  }

  /* Precio vigente de un insumo, y de donde sale.
     Devuelve siempre {precio, precioObra, factor, origen, insumo} —
     origen 'propio' | 'catalogo' | 'sin-precio' — para poder mostrar en
     pantalla cuál se usó y no dejarlo en la nada.
     `precio` es el de compra; `precioObra` es el que multiplica al
     rendimiento del análisis.                                       */
  function precioInsumo(codigo, idx, pila) {
    var cod = String(codigo || '').trim();

    /* AUXILIAR: un código que no es un insumo suelto sino una receta —
       el cemento en kg cuya composición es "0,04 bolsa". Su precio no se
       lee de una lista: se calcula bajando por su receta, igual que una
       tarea. Así, tocar el precio de la bolsa mueve el kilo solo.
       `pila` corta las referencias circulares.                          */
    if (!idx.insumos[cod] && !idx.overrides[cod] && idx.analisis[cod]) {
      pila = pila || [];
      if (pila.indexOf(cod) === -1 && pila.length < 12) {
        var calc = calcularAnalisis(idx.analisis[cod], idx, pila.concat([cod]));
        return {
          precio: calc.price, precioObra: calc.price, factor: 1,
          unidadCompra: idx.analisis[cod].unit || '',
          origen: 'auxiliar', esAuxiliar: true,
          insumo: { code: cod, desc: idx.analisis[cod].desc, unit: idx.analisis[cod].unit },
          receta: calc
        };
      }
    }

    var base = idx.insumos[cod] || null;
    var o = idx.overrides[cod];
    var elegido = null, origen = 'sin-precio';
    if (o && (o.price !== undefined && o.price !== null && o.price !== '')) {
      elegido = o; origen = 'propio';
    } else if (base) {
      elegido = base; origen = 'catalogo';
    }
    if (!elegido) return { precio: 0, precioObra: 0, factor: 1, unidadCompra: '', origen: origen, insumo: null };
    // el factor lo define quien puso el precio: si el usuario carga su
    // bolsa de 40 kg, manda la suya
    var ref = (origen === 'propio' && (elegido.factor !== undefined || elegido.compra)) ? elegido : (base || elegido);
    var f = factorDe(ref);
    var precio = safeNum(elegido.price);
    return {
      precio: precio,
      precioObra: precio / f,
      factor: f,
      unidadCompra: unidadCompraDe(ref),
      origen: origen,
      insumo: base || elegido
    };
  }

  /* ── analisis unitario ────────────────────────────────────────
     Recalcula la receta con los precios vigentes. NO muta el
     catalogo: devuelve un objeto nuevo. Eso es lo que permite que
     cambiar un precio se vea en el presupuesto sin sincronizar
     copias a mano (el bug del que el total quedaba viejo).         */
  function calcularAnalisis(analisis, idx, pila) {
    var totales = { 'Materiales': 0, 'Mano de obra': 0, 'Equipos': 0 };
    var faltantes = [];
    var detalles = (analisis.details || []).map(function (d) {
      var p = precioInsumo(d.code, idx, pila);
      var cat = normalizarCategoria(d.category || categoriaDe(p.insumo, d.code));
      var qty = safeNum(d.qty);
      // el rendimiento está en unidad de OBRA, así que se multiplica por
      // el precio llevado a esa unidad (precio de compra ÷ factor)
      var subtotal = qty * p.precioObra;
      if (p.origen === 'sin-precio') faltantes.push(d.code);
      if (totales[cat] === undefined) totales[cat] = 0;
      totales[cat] += subtotal;
      return {
        code: d.code,
        desc: (p.insumo && p.insumo.desc) || d.desc || '',
        unit: (p.insumo && p.insumo.unit) || d.unit || 'gl',
        category: cat,
        qty: qty,                 // RENDIMIENTO: cantidad por unidad de tarea
        unitPrice: p.precioObra,  // por unidad de obra, que es lo que se multiplica
        precioCompra: p.precio,   // por unidad de compra, que es lo que se paga
        factor: p.factor,
        unidadCompra: p.unidadCompra,
        origenPrecio: p.origen,
        esAuxiliar: !!p.esAuxiliar,
        receta: p.receta || null,
        subtotal: subtotal
      };
    });
    var precio = totales['Materiales'] + totales['Mano de obra'] + totales['Equipos'];
    return {
      code: analisis.code,
      rubro: analisis.rubro || 'Sin rubro',
      desc: analisis.desc || '',
      unit: analisis.unit || 'gl',
      materials: totales['Materiales'],
      labor: totales['Mano de obra'],
      equipment: totales['Equipos'],
      price: precio,
      details: detalles,
      insumosSinPrecio: faltantes
    };
  }

  /* Todos los analisis del catalogo, ya con overrides aplicados. */
  function calcularTodosLosAnalisis(catalogo, overrides) {
    var idx = indexar(catalogo, overrides);
    return (catalogo.analisis || []).map(function (a) { return calcularAnalisis(a, idx); });
  }

  /* ── coeficiente K ────────────────────────────────────────────
     K lleva del costo al precio y NO incluye IVA. Dos modos:
       'aditivo'  → K = 1 + gg + beneficio + iibb + financiacion
       'cascada'  → K = (1+gg)(1+ben)(1+iibb)(1+fin)
     El default es aditivo porque es lo que venia haciendo la app;
     el modo queda a la vista para que nadie se coma la diferencia. */
  function componentesK(params) {
    var p = params || {};
    return [
      { clave: 'gg', label: 'Gastos generales', pct: safeNum(p.ggPct) },
      { clave: 'beneficio', label: 'Beneficio', pct: safeNum(p.beneficioPct) },
      { clave: 'iibb', label: 'Ingresos brutos', pct: safeNum(p.iibbPct) },
      { clave: 'financiacion', label: 'Financiacion', pct: safeNum(p.financiacionPct) }
    ];
  }

  function calcularK(params) {
    var modo = (params && params.modoK) === 'cascada' ? 'cascada' : 'aditivo';
    var comps = componentesK(params);
    var k;
    if (modo === 'cascada') {
      k = comps.reduce(function (acc, c) { return acc * (1 + c.pct / 100); }, 1);
    } else {
      k = comps.reduce(function (acc, c) { return acc + c.pct / 100; }, 1);
    }
    return { modo: modo, k: k, componentes: comps };
  }

  /* ── presupuesto ──────────────────────────────────────────────
     items: [{code, qty, desc?, unit?, precioManual?, sector?}]
     Devuelve UNA sola verdad de los numeros: la pantalla y el Excel
     leen de aca, asi no vuelven a dar distinto.                    */
  function calcularPresupuesto(items, catalogo, overrides, params) {
    var idx = indexar(catalogo, overrides);
    var p = params || {};
    var filas = (items || []).map(function (it, i) {
      var a = idx.analisis[String(it.code || '').trim()];
      var calc = a ? calcularAnalisis(a, idx) : null;
      var precioUnit = (it.precioManual !== undefined && it.precioManual !== null && it.precioManual !== '')
        ? safeNum(it.precioManual)
        : (calc ? calc.price : safeNum(it.price));
      var qty = safeNum(it.qty);
      return {
        id: it.id !== undefined ? it.id : i,
        code: it.code,
        desc: (calc && calc.desc) || it.desc || '',
        unit: (calc && calc.unit) || it.unit || 'gl',
        rubro: (calc && calc.rubro) || it.rubro || 'Sin rubro',
        sector: it.sector || '',
        qty: qty,
        precioUnitario: precioUnit,
        precioManual: it.precioManual !== undefined && it.precioManual !== null && it.precioManual !== '',
        costoTotal: qty * precioUnit,
        materiales: calc ? calc.materials * qty : 0,
        manoObra: calc ? calc.labor * qty : 0,
        equipos: calc ? calc.equipment * qty : 0,
        analisis: calc,
        sinAnalisis: !calc
      };
    });

    return cerrarPresupuesto(filas, p);
  }

  /* ── el cierre del presupuesto ────────────────────────────────
     De los renglones para arriba: costo, K, IVA, rubros e incidencia.
     Vive aparte porque las filas pueden venir de dos lados — del Motor
     con el catalogo en la mano, o del servidor cuando el catalogo NO
     baja — y el K tiene que salir del mismo lugar en los dos casos.
     Si estuviera escrito dos veces, un dia el Excel y la pantalla
     dirian distinto y nadie sabria cual de los dos miente.          */
  function cerrarPresupuesto(filas, params, incidencia) {
    var p = params || {};
    var costo = filas.reduce(function (s, f) { return s + f.costoTotal; }, 0);
    var K = calcularK(p);
    var precioSinIva = costo * K.k;
    var ivaPct = safeNum(p.ivaPct === undefined ? 21 : p.ivaPct);
    var iva = precioSinIva * ivaPct / 100;

    // apertura del K en pesos, para mostrarla desglosada
    var recargo = precioSinIva - costo;
    var sumaPct = K.componentes.reduce(function (s, c) { return s + c.pct; }, 0);
    var aperturaK = K.componentes.map(function (c) {
      return {
        clave: c.clave, label: c.label, pct: c.pct,
        monto: sumaPct ? recargo * (c.pct / sumaPct) : 0
      };
    });

    return {
      items: filas,
      rubros: agruparPorRubro(filas),
      costo: costo,
      k: K.k,
      modoK: K.modo,
      aperturaK: aperturaK,
      recargo: recargo,
      precioSinIva: precioSinIva,
      ivaPct: ivaPct,
      iva: iva,
      total: precioSinIva + iva,
      // Incidencias sobre el costo, que es lo que mira el que compra.
      // Cuando el catalogo no baja, el reparto por categoria lo manda el
      // servidor ya sumado: es el unico que ve los precios.
      incidencia: incidencia || {
        materiales: filas.reduce(function (s, f) { return s + f.materiales; }, 0),
        manoObra: filas.reduce(function (s, f) { return s + f.manoObra; }, 0),
        equipos: filas.reduce(function (s, f) { return s + f.equipos; }, 0)
      }
    };
  }

  function agruparPorRubro(filas) {
    var mapa = Object.create(null), orden = [];
    filas.forEach(function (f) {
      var r = f.rubro || 'Sin rubro';
      if (!mapa[r]) { mapa[r] = { rubro: r, costo: 0, items: [] }; orden.push(r); }
      mapa[r].costo += f.costoTotal;
      mapa[r].items.push(f);
    });
    var total = orden.reduce(function (s, r) { return s + mapa[r].costo; }, 0);
    return orden.map(function (r) {
      mapa[r].pct = total ? (mapa[r].costo / total) * 100 : 0;
      return mapa[r];
    });
  }

  /* ── materiales de obra ───────────────────────────────────────
     Consolida los insumos de todas las tareas del presupuesto:
     cantidad total = rendimiento x cantidad de computo.            */
  function consolidarInsumos(items, catalogo, overrides, filtroCategoria) {
    var idx = indexar(catalogo, overrides);
    var acc = Object.create(null), orden = [];
    /* Un auxiliar no se compra: se compra lo que tiene adentro. Al cemento
       en kilos no le hacés una orden de compra, se la hacés a la bolsa.
       Por eso la lista BAJA por los auxiliares hasta el insumo que el
       corralón factura, multiplicando las cantidades en el camino.      */
    function sumar(d, cantidad, calc, via) {
      if (d.esAuxiliar && d.receta && via.length < 12) {
        d.receta.details.forEach(function (h) {
          sumar(h, cantidad * h.qty, calc, via.concat([d.code]));
        });
        return;
      }
      if (filtroCategoria && d.category !== filtroCategoria) return;
      var key = d.code;
      if (!acc[key]) {
        acc[key] = {
          code: d.code, desc: d.desc, unit: d.unit, category: d.category,
          unitPrice: d.unitPrice, origenPrecio: d.origenPrecio,
          precioCompra: d.precioCompra, factor: d.factor, unidadCompra: d.unidadCompra,
          cantidad: 0, total: 0, rubros: {}, tareas: [], via: via.slice()
        };
        orden.push(key);
      }
      acc[key].cantidad += cantidad;
      acc[key].total += cantidad * d.unitPrice;
      acc[key].rubros[calc.rubro] = true;
      acc[key].tareas.push({ code: calc.code, desc: calc.desc, cantidad: cantidad });
    }

    (items || []).forEach(function (it) {
      var a = idx.analisis[String(it.code || '').trim()];
      if (!a) return;
      var calc = calcularAnalisis(a, idx);
      var qtyTarea = safeNum(it.qty);
      calc.details.forEach(function (d) {
        sumar(d, d.qty * qtyTarea, calc, []);
      });
    });
    return orden.map(function (k) {
      var r = acc[k];
      r.rubros = Object.keys(r.rubros);
      // lo que se PIDE: unidades enteras de compra
      r.cantidadCompra = cantidadDeCompra(r.cantidad, r.factor, r.unidadCompra || r.unit);
      r.totalCompra = r.cantidadCompra * safeNum(r.precioCompra);
      r.sobrante = r.factor > 1 ? (r.cantidadCompra * r.factor) - r.cantidad : 0;
      return r;
    }).sort(function (a, b) { return b.total - a.total; });
  }

  /* ── control de coherencia del catalogo ───────────────────────
     Un Excel de costos viene con los analisis CONGELADOS: los
     subtotales se calcularon con la lista de precios de aquel dia.
     Si despues alguien toco la hoja de precios y no recalculo, la
     receta y la lista dejan de coincidir y nadie se entera.
     Esto lo pone a la vista: por cada insumo, que precio trae la
     lista, con cual quedaron hechos los analisis, y a que tareas
     les cambia el numero.                                          */
  function auditarCatalogo(catalogo) {
    var idx = indexar(catalogo, []);
    var porInsumo = Object.create(null), orden = [];
    var huerfanos = Object.create(null);

    (catalogo.analisis || []).forEach(function (a) {
      (a.details || []).forEach(function (d) {
        var cod = String(d.code || '').trim();
        var base = idx.insumos[cod];
        if (!base) {
          if (!huerfanos[cod]) huerfanos[cod] = { code: cod, desc: d.desc || '', tareas: [] };
          huerfanos[cod].tareas.push(a.code);
          return;
        }
        var pLista = safeNum(base.price);
        var pAnalisis = safeNum(d.unitPrice);
        if (!pAnalisis || Math.abs(pLista - pAnalisis) < 0.01) return;
        if (!porInsumo[cod]) {
          porInsumo[cod] = {
            code: cod, desc: base.desc || d.desc || '', unit: base.unit || d.unit || '',
            precioLista: pLista, precioAnalisis: pAnalisis,
            ratio: pAnalisis ? pLista / pAnalisis : 0,
            tareas: []
          };
          orden.push(cod);
        }
        porInsumo[cod].tareas.push({ code: a.code, desc: a.desc });
      });
    });

    var desalineados = orden.map(function (c) { return porInsumo[c]; })
      .sort(function (a, b) { return Math.abs(Math.log(b.ratio || 1)) - Math.abs(Math.log(a.ratio || 1)); });

    // tareas cuyo precio cambia al recalcular desde la lista vigente
    var tareasQueCambian = [];
    (catalogo.analisis || []).forEach(function (a) {
      var c = calcularAnalisis(a, idx);
      var viejo = safeNum(a.price);
      if (viejo && Math.abs(c.price - viejo) > 0.05) {
        tareasQueCambian.push({
          code: a.code, desc: a.desc, rubro: a.rubro, unit: a.unit,
          precioExcel: viejo, precioRecalculado: c.price,
          variacionPct: ((c.price / viejo) - 1) * 100
        });
      }
    });
    tareasQueCambian.sort(function (a, b) { return Math.abs(b.variacionPct) - Math.abs(a.variacionPct); });

    return {
      desalineados: desalineados,
      huerfanos: Object.keys(huerfanos).map(function (k) { return huerfanos[k]; }),
      tareasQueCambian: tareasQueCambian,
      totalInsumos: (catalogo.insumos || []).length,
      totalAnalisis: (catalogo.analisis || []).length
    };
  }

  var API = {
    CATEGORIAS: CATEGORIAS,
    safeNum: safeNum,
    precioDeTexto: precioDeTexto,
    auditarCatalogo: auditarCatalogo,
    factorDe: factorDe,
    cantidadDeCompra: cantidadDeCompra,
    esDiscreta: esDiscreta,
    redondear: redondear,
    categoriaDe: categoriaDe,
    normalizarCategoria: normalizarCategoria,
    indexar: indexar,
    precioInsumo: precioInsumo,
    calcularAnalisis: calcularAnalisis,
    calcularTodosLosAnalisis: calcularTodosLosAnalisis,
    calcularK: calcularK,
    calcularPresupuesto: calcularPresupuesto,
    cerrarPresupuesto: cerrarPresupuesto,
    consolidarInsumos: consolidarInsumos
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.Motor = API;
})(typeof window !== 'undefined' ? window : globalThis);
