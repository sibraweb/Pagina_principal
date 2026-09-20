/* ───────────────────────────────────────────────────────────────
   IMPORTAR — Excel / CSV que trae CUALQUIERA.
   Nadie va a acomodar su planilla a nuestras columnas, asi que se
   detecta la fila de encabezado, se sugiere el mapeo y se deja
   confirmar a ojo antes de importar nada.
   ─────────────────────────────────────────────────────────────── */
(function (global) {
  'use strict';

  var M = global.Motor;

  /* Palabras con las que se reconoce cada columna. El orden importa:
     gana la primera que matchea.                                   */
  var DICCIONARIO = {
    codigo: ['codigo', 'código', 'cod.', 'cod', 'item', 'ítem', 'art', 'articulo', 'artículo', 'sku', 'nro'],
    descripcion: ['descripcion', 'descripción', 'detalle', 'designacion', 'designación', 'tarea', 'concepto', 'insumo', 'material', 'nombre'],
    unidad: ['unidad', 'un.', 'un', 'ud', 'medida', 'u.m.', 'um'],
    cantidad: ['cantidad', 'cant.', 'cant', 'computo', 'cómputo', 'qty', 'metros', 'total'],
    sector: ['sector', 'zona', 'nivel', 'piso', 'sub obra', 'subobra', 'etapa', 'ubicacion', 'ubicación'],
    rubro: ['rubro', 'capitulo', 'capítulo', 'familia', 'subrubro'],
    precio: ['precio', 'p. unitario', 'p unitario', 'unitario', 'valor', 'costo', 'importe', '$']
  };

  var CAMPOS_COMPUTO = [
    { clave: 'codigo', label: 'Código de la tarea', requerido: true },
    { clave: 'cantidad', label: 'Cantidad (cómputo)', requerido: true },
    { clave: 'descripcion', label: 'Descripción', requerido: false },
    { clave: 'unidad', label: 'Unidad', requerido: false },
    { clave: 'sector', label: 'Sector / nivel', requerido: false },
    { clave: 'rubro', label: 'Rubro', requerido: false }
  ];

  var CAMPOS_PRECIOS = [
    { clave: 'codigo', label: 'Código del insumo', requerido: true },
    { clave: 'precio', label: 'Precio unitario', requerido: true },
    { clave: 'descripcion', label: 'Descripción', requerido: false },
    { clave: 'unidad', label: 'Unidad', requerido: false }
  ];

  function normalizar(t) {
    return String(t === null || t === undefined ? '' : t)
      .toLowerCase().trim()
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  /* ── lectura ──────────────────────────────────────────────── */
  function leerArchivo(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onerror = function () { reject(new Error('No se pudo leer el archivo')); };
      r.onload = function (e) {
        try {
          var wb, esCSV = /\.csv$/i.test(file.name);
          if (esCSV) wb = XLSX.read(new TextDecoder('utf-8').decode(e.target.result), { type: 'string' });
          else wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
          var hojas = wb.SheetNames.map(function (n) {
            return { nombre: n, filas: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: null, blankrows: false }) };
          }).filter(function (h) { return h.filas.length; });
          if (!hojas.length) return reject(new Error('El archivo no tiene datos'));
          resolve({ nombre: file.name, hojas: hojas });
        } catch (err) { reject(err); }
      };
      r.readAsArrayBuffer(file);
    });
  }

  /* ── encabezado ───────────────────────────────────────────
     Se busca en las primeras filas la que mas columnas conocidas
     tenga y que ademas tenga datos debajo.                       */
  function detectarEncabezado(filas) {
    var mejor = { fila: 0, puntaje: -1 };
    var limite = Math.min(filas.length, 25);
    for (var i = 0; i < limite; i++) {
      var f = filas[i] || [];
      var puntaje = 0, textos = 0;
      f.forEach(function (c) {
        var t = normalizar(c);
        if (!t) return;
        textos++;
        Object.keys(DICCIONARIO).forEach(function (k) {
          if (DICCIONARIO[k].some(function (p) { return t === p || t.indexOf(p) === 0; })) puntaje += 2;
        });
      });
      if (textos >= 2 && puntaje > mejor.puntaje) mejor = { fila: i, puntaje: puntaje };
    }
    return mejor.puntaje > 0 ? mejor.fila : 0;
  }

  function sugerirMapeo(encabezados, campos) {
    var usadas = {}, mapeo = {};
    campos.forEach(function (campo) {
      var mejorIdx = -1, mejorPeso = 0;
      encabezados.forEach(function (h, idx) {
        if (usadas[idx]) return;
        var t = normalizar(h);
        if (!t) return;
        DICCIONARIO[campo.clave].forEach(function (p, orden) {
          var peso = 0;
          if (t === p) peso = 100 - orden;
          else if (t.indexOf(p) === 0) peso = 60 - orden;
          else if (t.indexOf(p) > -1) peso = 30 - orden;
          if (peso > mejorPeso) { mejorPeso = peso; mejorIdx = idx; }
        });
      });
      if (mejorIdx > -1) { mapeo[campo.clave] = mejorIdx; usadas[mejorIdx] = true; }
      else mapeo[campo.clave] = -1;
    });
    return mapeo;
  }

  function valor(fila, idx) {
    if (idx === undefined || idx < 0) return '';
    var v = fila[idx];
    return v === null || v === undefined ? '' : v;
  }

  /* ── filas → renglones de computo ─────────────────────────── */
  function filasAComputo(filas, mapeo, filaEncabezado) {
    var out = [], descartadas = 0;
    for (var i = filaEncabezado + 1; i < filas.length; i++) {
      var f = filas[i] || [];
      var codigo = String(valor(f, mapeo.codigo)).trim();
      var cantidad = M.safeNum(valor(f, mapeo.cantidad));
      var desc = String(valor(f, mapeo.descripcion)).trim();
      if (!codigo && !desc) continue;
      if (!codigo) { descartadas++; continue; }
      // una fila de subtotal o de titulo no trae cantidad utilizable
      if (!cantidad) { descartadas++; continue; }
      out.push({
        code: codigo,
        desc: desc,
        unit: String(valor(f, mapeo.unidad)).trim(),
        sector: String(valor(f, mapeo.sector)).trim(),
        rubro: String(valor(f, mapeo.rubro)).trim(),
        qty: cantidad
      });
    }
    return { items: out, descartadas: descartadas };
  }

  /* ── filas → lista de precios propia ──────────────────────── */
  function filasAPrecios(filas, mapeo, filaEncabezado) {
    var out = [], descartadas = 0;
    for (var i = filaEncabezado + 1; i < filas.length; i++) {
      var f = filas[i] || [];
      var codigo = String(valor(f, mapeo.codigo)).trim();
      var precio = M.precioDeTexto(valor(f, mapeo.precio));
      if (!codigo) { continue; }
      if (!precio) { descartadas++; continue; }
      out.push({
        code: codigo,
        desc: String(valor(f, mapeo.descripcion)).trim(),
        unit: String(valor(f, mapeo.unidad)).trim(),
        price: precio
      });
    }
    return { items: out, descartadas: descartadas };
  }

  /* ── plantillas ───────────────────────────────────────────── */
  function bajarPlantillaComputo(catalogo) {
    var ejemplo = (catalogo.analisis || []).slice(0, 3);
    var filas = [['Codigo', 'Descripcion', 'Unidad', 'Sector', 'Cantidad']];
    ejemplo.forEach(function (a) { filas.push([a.code, a.desc, a.unit, 'Planta baja', 0]); });
    exportarHoja(filas, 'Computo', 'plantilla_computo.xlsx');
  }

  function bajarPlantillaPrecios(catalogo) {
    var ejemplo = (catalogo.insumos || []).slice(0, 5);
    var filas = [['Codigo', 'Descripcion', 'Unidad', 'Precio']];
    ejemplo.forEach(function (i) { filas.push([i.code, i.desc, i.unit, '']); });
    exportarHoja(filas, 'Mis precios', 'plantilla_mis_precios.xlsx');
  }

  function exportarHoja(filas, nombreHoja, nombreArchivo) {
    var ws = XLSX.utils.aoa_to_sheet(filas);
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, nombreHoja.slice(0, 31));
    XLSX.writeFile(wb, nombreArchivo);
  }

  function exportarLibro(hojas, nombreArchivo) {
    var wb = XLSX.utils.book_new();
    hojas.forEach(function (h) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(h.filas), h.nombre.slice(0, 31));
    });
    XLSX.writeFile(wb, nombreArchivo);
  }

  global.Importar = {
    CAMPOS_COMPUTO: CAMPOS_COMPUTO,
    CAMPOS_PRECIOS: CAMPOS_PRECIOS,
    leerArchivo: leerArchivo,
    detectarEncabezado: detectarEncabezado,
    sugerirMapeo: sugerirMapeo,
    filasAComputo: filasAComputo,
    filasAPrecios: filasAPrecios,
    bajarPlantillaComputo: bajarPlantillaComputo,
    bajarPlantillaPrecios: bajarPlantillaPrecios,
    exportarHoja: exportarHoja,
    exportarLibro: exportarLibro
  };
})(typeof window !== 'undefined' ? window : globalThis);
