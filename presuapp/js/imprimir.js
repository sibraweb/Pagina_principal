/* ───────────────────────────────────────────────────────────────
   IMPRIMIR — el mismo libro que va a Excel, en A4 para PDF.

   No se arma un segundo informe: se imprimen las MISMAS hojas que
   arma el Excel (armarLibro / el plan), así el PDF y la planilla no
   pueden dar distinto. El navegador ofrece "Guardar como PDF".

   Se imprime desde un iframe escondido y no desde una ventana nueva:
   el PDF sale después de recalcular (una promesa), y a esa altura el
   navegador ya no considera que lo pidió un clic y bloquea la ventana.
   ─────────────────────────────────────────────────────────────── */
(function (global) {
  'use strict';

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  var NUM = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function celda(v) {
    if (typeof v === 'number' && isFinite(v)) return '<td class="n">' + NUM.format(v) + '</td>';
    return '<td>' + esc(v) + '</td>';
  }
  function fuerte(fila) {
    var t = String(fila[1] || fila[0] || '');
    return /^(subtotal|total|costo de obra|precio sin iva|coeficiente|iva )/i.test(t);
  }

  /* Una hoja: las filas cortas de arriba son el encabezado del documento,
     la primera fila ancha son los títulos de columna, una fila de una sola
     celda es un rubro. */
  function hojaHTML(h) {
    var filas = h.filas || [];
    var ancho = filas.reduce(function (m, f) { return Math.max(m, f.length); }, 0);
    var i = 0, out = '<section><h2>' + esc(h.nombre) + '</h2>';
    var meta = [];
    while (i < filas.length && filas[i].length < 3) {
      // un dato sin valor (Comitente: —) no se imprime
      if (filas[i].length && !(filas[i].length === 2 && (filas[i][1] === '' || filas[i][1] === null))) meta.push(filas[i].filter(function (x) { return x !== ''; }).map(esc).join(': '));
      i++;
    }
    if (meta.length) out += '<div class="meta">' + meta.join('<br>') + '</div>';
    if (i >= filas.length) return out + '</section>';
    out += '<table><thead><tr>' + filas[i].map(function (t) { return '<th>' + esc(t) + '</th>'; }).join('') + '</tr></thead><tbody>';
    for (i = i + 1; i < filas.length; i++) {
      var f = filas[i];
      if (!f.length) { out += '<tr class="aire"><td colspan="' + ancho + '"></td></tr>'; continue; }
      if (f.length === 1) { out += '<tr class="rubro"><td colspan="' + ancho + '">' + esc(f[0]) + '</td></tr>'; continue; }
      var tds = '';
      for (var j = 0; j < ancho; j++) tds += celda(f[j]);
      out += '<tr' + (fuerte(f) ? ' class="fuerte"' : '') + '>' + tds + '</tr>';
    }
    return out + '</tbody></table></section>';
  }

  function libro(hojas, op) {
    op = op || {};
    var obra = op.obra || {};
    var ancho = hojas.reduce(function (m, h) {
      return Math.max(m, (h.filas || []).reduce(function (x, f) { return Math.max(x, f.length); }, 0));
    }, 0);
    var logo = new URL('assets/sibratech-constructora.png', location.href).href;
    var hoy = new Date().toLocaleDateString('es-AR');
    var html = '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>' +
      esc((obra.nombre || 'Obra') + ' - ' + (op.titulo || 'PresupuestApp')) + '</title><style>' +
      '@page{size:A4 ' + (ancho > 9 ? 'landscape' : 'portrait') + ';margin:12mm}' +
      'body{font-family:Arial,Helvetica,sans-serif;font-size:9pt;color:#1a1a1a;margin:0}' +
      'header{display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #E10600;padding-bottom:6px;margin-bottom:10px}' +
      'header img{height:34px}header .der{text-align:right;font-size:8pt;color:#555}' +
      'h1{font-size:14pt;margin:0 0 2px}h2{font-size:11pt;margin:14px 0 6px;color:#E10600;text-transform:uppercase;letter-spacing:.5px}' +
      'section{page-break-after:always}section:last-of-type{page-break-after:auto}' +
      '.meta{font-size:8.5pt;color:#444;margin-bottom:8px}' +
      'table{width:100%;border-collapse:collapse}th{background:#f0f0f0;text-align:left;font-size:8pt;padding:4px;border-bottom:1px solid #999}' +
      'td{padding:3px 4px;border-bottom:1px solid #e4e4e4;vertical-align:top}td.n{text-align:right;white-space:nowrap}' +
      'tr.rubro td{font-weight:bold;background:#fafafa;padding-top:6px}tr.fuerte td{font-weight:bold}tr.aire td{border:0;height:4px}' +
      'thead{display:table-header-group}tr{page-break-inside:avoid}' +
      'footer{margin-top:14px;font-size:7.5pt;color:#777;border-top:1px solid #ddd;padding-top:4px}' +
      '</style></head><body>' +
      '<header><div><img src="' + esc(logo) + '" alt="SIBRATECH"></div><div class="der">' +
      '<h1>' + esc(op.titulo || '') + '</h1>' + esc(obra.nombre || '') +
      (obra.cliente ? ' · ' + esc(obra.cliente) : '') + (obra.ubicacion ? ' · ' + esc(obra.ubicacion) : '') +
      '<br>Impreso el ' + esc(hoy) + (op.autor ? ' por ' + esc(op.autor) : '') + '</div></header>' +
      hojas.map(hojaHTML).join('') +
      '<footer>Hecho con PresupuestApp · SIBRATECH Constructora · sibratech.com.ar — un presupuesto hecho con la app es una referencia, no una oferta.</footer>' +
      '</body></html>';

    var viejo = document.getElementById('presuapp-impresion');
    if (viejo) viejo.remove();
    var f = document.createElement('iframe');
    f.id = 'presuapp-impresion';
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(f);
    var d = f.contentWindow.document;
    d.open(); d.write(html); d.close();
    if (op.sinImprimir) { f.style.cssText = 'position:fixed;inset:5%;width:90%;height:90%;background:#fff;z-index:5000;border:1px solid #999'; return f; }   // para los tests
    // se espera el logo: sin eso el PDF sale sin membrete
    var img = d.querySelector('img');
    var listo = function () { f.contentWindow.focus(); f.contentWindow.print(); };
    if (img && !img.complete) { img.onload = listo; img.onerror = listo; } else setTimeout(listo, 50);
  }

  global.Imprimir = { libro: libro, hojaHTML: hojaHTML };
})(window);
