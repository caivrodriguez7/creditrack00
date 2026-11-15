/* CrediTrack PDF Lite: a tiny, dependency-free PDF writer used by the Reports export (js/components/report-export.js).
   It works offline (no library, no CDN) and makes selectable-text PDFs with the standard Helvetica fonts.
   - Pages are A4. Coordinates are in points with the origin at the TOP-LEFT (y grows downwards); the writer flips them.
   - The standard fonts have no peso sign, so every "\u20B1" is drawn as a "P" with two bars through its stem (a vector glyph).
   - Characters Helvetica/WinAnsi cannot show are replaced with "?".
   Usage:
     var doc = new CrediTrackPdf({ title: "..." });
     doc.addPage(); doc.text("Hello", 40, 60, { size: 12, bold: true, color: "#071A52" });
     doc.rect(40, 80, 100, 20, { fill: "#F3F8F8", stroke: "#D6E4E6" });
     doc.line(40, 120, 200, 120, { color: "#D6E4E6", width: 0.5 });
     doc.download("report.pdf");            // or doc.toBlob()
   Page footers that need the total page count: loop over doc.pageCount() and call doc.setPage(n). */
(function () {
  "use strict";

  var PAGE_W = 595.28, PAGE_H = 841.89;     // A4 in points
  var PESO = "\u20B1";

  // Glyph widths (1/1000 em) for character codes 32..255 (WinAnsi), generated from the Adobe Helvetica metrics.
  var WIDTHS = {
    r: [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,761,556,0,222,556,333,1000,556,556,333,1000,667,333,1000,0,611,0,0,222,222,333,333,350,556,1000,333,1000,500,333,944,0,500,667,278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500],
    b: [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,761,556,0,278,556,500,1000,556,556,333,1000,667,333,1000,0,611,0,0,278,278,500,500,350,556,1000,333,1000,556,333,944,0,500,667,278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333,400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556]
  };
  // Unicode characters outside Latin-1 that WinAnsi does have
  var WIN_ANSI = { "\u20AC": 0x80, "\u2026": 0x85, "\u2018": 0x91, "\u2019": 0x92, "\u201C": 0x93, "\u201D": 0x94, "\u2022": 0x95, "\u2013": 0x96, "\u2014": 0x97 };

  function code(ch) {
    var c = ch.charCodeAt(0);
    if ((c >= 32 && c <= 126) || (c >= 160 && c <= 255)) return c;
    if (WIN_ANSI[ch]) return WIN_ANSI[ch];
    return 63;   // "?"
  }
  function glyphWidth(c, bold) { return (bold ? WIDTHS.b : WIDTHS.r)[c - 32] || 0; }
  function num(n) { return (Math.round(n * 100) / 100).toString(); }
  function rgb(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    var v = m ? parseInt(m[1], 16) : 0;
    return num(((v >> 16) & 255) / 255) + " " + num(((v >> 8) & 255) / 255) + " " + num((v & 255) / 255);
  }
  function escapeText(codes) {
    return codes.map(function (c) {
      var ch = String.fromCharCode(c);
      return (ch === "\\" || ch === "(" || ch === ")") ? "\\" + ch : ch;
    }).join("");
  }

  // Width of a string in points (the peso sign is as wide as a "P")
  function measure(str, size, bold) {
    var total = 0;
    String(str).split("").forEach(function (ch) { total += glyphWidth(ch === PESO ? 80 : code(ch), bold); });
    return total * size / 1000;
  }
  // Shortens text with "..." so it is at most maxWidth points wide
  function fit(str, size, bold, maxWidth) {
    str = String(str);
    if (measure(str, size, bold) <= maxWidth) return str;
    while (str.length > 1 && measure(str + "...", size, bold) > maxWidth) str = str.slice(0, -1);
    return str.replace(/\s+$/, "") + "...";
  }

  function CrediTrackPdf(options) {
    this.options = options || {};
    this.pages = [];       // each page: an array of content-stream strings
    this.current = null;
    this.images = [];      // images added with addImage(), written once and shared by every page
  }
  CrediTrackPdf.prototype.pageSize = function () { return { width: PAGE_W, height: PAGE_H }; };
  CrediTrackPdf.prototype.pageCount = function () { return this.pages.length; };
  CrediTrackPdf.prototype.addPage = function () { this.current = []; this.pages.push(this.current); return this.pages.length; };
  CrediTrackPdf.prototype.setPage = function (n) { this.current = this.pages[n - 1]; };
  // ---- Images (logo) ----
  // CrediTrackPdf.loadImage(url, pixelWidth) -> Promise of { w, h, rgb, alpha } (raw 8-bit RGB plus a separate alpha mask,
  // so PNG logos with a transparent background keep their transparency). Same-origin files only.
  function bin(u8) {
    var out = [], CHUNK = 8192;
    for (var i = 0; i < u8.length; i += CHUNK) out.push(String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK)));
    return out.join("");
  }
  CrediTrackPdf.loadImage = function (url, pixelWidth) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        try {
          var w = pixelWidth || img.naturalWidth, h = Math.max(1, Math.round(img.naturalHeight * w / img.naturalWidth));
          var cv = document.createElement("canvas"); cv.width = w; cv.height = h;
          var g = cv.getContext("2d"); g.drawImage(img, 0, 0, w, h);
          var px = g.getImageData(0, 0, w, h).data, rgb = new Uint8Array(w * h * 3), alpha = new Uint8Array(w * h);
          for (var i = 0, n = w * h; i < n; i++) {
            rgb[i * 3] = px[i * 4]; rgb[i * 3 + 1] = px[i * 4 + 1]; rgb[i * 3 + 2] = px[i * 4 + 2]; alpha[i] = px[i * 4 + 3];
          }
          resolve({ w: w, h: h, rgb: bin(rgb), alpha: bin(alpha) });
        } catch (e) { reject(e); }
      };
      img.onerror = function () { reject(new Error("Could not load image: " + url)); };
      img.src = url;
    });
  };
  // Draws a loaded image with its top-left corner at (x, y), w x h points
  CrediTrackPdf.prototype.image = function (img, x, y, w, h) {
    if (!img) return;
    var idx = this.images.indexOf(img);
    if (idx < 0) { this.images.push(img); idx = this.images.length - 1; }
    this.current.push("q " + num(w) + " 0 0 " + num(h) + " " + num(x) + " " + num(PAGE_H - y - h) + " cm /Im" + (idx + 1) + " Do Q");
  };

  CrediTrackPdf.prototype.measure = measure;
  CrediTrackPdf.prototype.fit = fit;

  CrediTrackPdf.prototype.line = function (x1, y1, x2, y2, o) {
    o = o || {};
    this.current.push(num(o.width || 0.5) + " w " + rgb(o.color || "#000000") + " RG " +
      num(x1) + " " + num(PAGE_H - y1) + " m " + num(x2) + " " + num(PAGE_H - y2) + " l S");
  };
  // o.fill and/or o.stroke are hex colors; o.radius rounds the corners
  CrediTrackPdf.prototype.rect = function (x, y, w, h, o) {
    o = o || {};
    var parts = [], r = Math.min(o.radius || 0, w / 2, h / 2), top = PAGE_H - y, bottom = PAGE_H - y - h;
    if (o.fill) parts.push(rgb(o.fill) + " rg");
    if (o.stroke) parts.push(rgb(o.stroke) + " RG " + num(o.lineWidth || 0.6) + " w");
    if (r > 0) {
      var k = r * 0.5523;   // circle approximation with Bezier curves
      parts.push(num(x + r) + " " + num(bottom) + " m " +
        num(x + w - r) + " " + num(bottom) + " l " + num(x + w - r + k) + " " + num(bottom) + " " + num(x + w) + " " + num(bottom + r - k) + " " + num(x + w) + " " + num(bottom + r) + " c " +
        num(x + w) + " " + num(top - r) + " l " + num(x + w) + " " + num(top - r + k) + " " + num(x + w - r + k) + " " + num(top) + " " + num(x + w - r) + " " + num(top) + " c " +
        num(x + r) + " " + num(top) + " l " + num(x + r - k) + " " + num(top) + " " + num(x) + " " + num(top - r + k) + " " + num(x) + " " + num(top - r) + " c " +
        num(x) + " " + num(bottom + r) + " l " + num(x) + " " + num(bottom + r - k) + " " + num(x + r - k) + " " + num(bottom) + " " + num(x + r) + " " + num(bottom) + " c h");
    } else {
      parts.push(num(x) + " " + num(bottom) + " " + num(w) + " " + num(h) + " re");
    }
    parts.push(o.fill && o.stroke ? "B" : o.fill ? "f" : "S");
    this.current.push(parts.join(" "));
  };

  // Draws one line of text with its BASELINE at y. o: size, bold, color, align ("left" | "right" | "center").
  CrediTrackPdf.prototype.text = function (str, x, y, o) {
    o = o || {};
    var size = o.size || 10, bold = !!o.bold, color = o.color || "#000000";
    str = String(str);
    var width = measure(str, size, bold);
    if (o.align === "right") x -= width; else if (o.align === "center") x -= width / 2;
    var font = bold ? "/F2 " : "/F1 ", base = PAGE_H - y, out = this.current, self = this;
    var pieces = str.split(PESO);
    pieces.forEach(function (piece, i) {
      if (piece) {
        var codes = piece.split("").map(code);
        out.push("BT " + rgb(color) + " rg " + font + num(size) + " Tf " + num(x) + " " + num(base) + " Td (" + escapeText(codes) + ") Tj ET");
        x += measure(piece, size, bold);
      }
      if (i < pieces.length - 1) { self._peso(x, base, size, bold, color); x += glyphWidth(80, bold) * size / 1000; }
    });
  };
  // The peso sign: a "P" with two thin bars across the stem
  CrediTrackPdf.prototype._peso = function (x, base, size, bold, color) {
    var out = this.current, w = glyphWidth(80, bold) * size / 1000;
    out.push("BT " + rgb(color) + " rg " + (bold ? "/F2 " : "/F1 ") + num(size) + " Tf " + num(x) + " " + num(base) + " Td (P) Tj ET");
    var thick = Math.max(0.35, size * (bold ? 0.075 : 0.06));
    [0.3, 0.43].forEach(function (f) {
      var yy = base + size * f;
      out.push(num(thick) + " w " + rgb(color) + " RG " + num(x + w * 0.06) + " " + num(yy) + " m " + num(x + w * 0.88) + " " + num(yy) + " l S");
    });
  };

  // ---- Build the file ----
  CrediTrackPdf.prototype.toBytes = function () {
    var objects = [], self = this;
    function add(body) { objects.push(body); return objects.length; }     // object number = index + 1
    var n = this.pages.length, imgs = this.images, first = 6 + imgs.length * 2;   // first page's content object number
    // 1 catalog, 2 page tree, 3 and 4 fonts, 5 info, then (soft mask, image) pairs, then (content, page) pairs
    add("<< /Type /Catalog /Pages 2 0 R >>");
    var kids = [];
    for (var i = 0; i < n; i++) kids.push((first + i * 2 + 1) + " 0 R");
    add("<< /Type /Pages /Count " + n + " /Kids [" + kids.join(" ") + "] >>");
    add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    var title = escapeText(String(this.options.title || "CrediTrack Report").split("").map(code));
    add("<< /Title (" + title + ") /Creator (CrediTrack) /Producer (CrediTrack PDF Lite) >>");
    var xobjects = "";
    imgs.forEach(function (im, k) {
      var maskNo = 6 + k * 2, imgNo = maskNo + 1;
      add("<< /Type /XObject /Subtype /Image /Width " + im.w + " /Height " + im.h + " /ColorSpace /DeviceGray /BitsPerComponent 8 /Length " + im.alpha.length + " >>\nstream\n" + im.alpha + "\nendstream");
      add("<< /Type /XObject /Subtype /Image /Width " + im.w + " /Height " + im.h + " /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask " + maskNo + " 0 R /Length " + im.rgb.length + " >>\nstream\n" + im.rgb + "\nendstream");
      xobjects += "/Im" + (k + 1) + " " + imgNo + " 0 R ";
    });
    var xres = imgs.length ? " /XObject << " + xobjects + ">>" : "";
    this.pages.forEach(function (ops, p) {
      var stream = ops.join("\n");
      add("<< /Length " + stream.length + " >>\nstream\n" + stream + "\nendstream");
      add("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + PAGE_W + " " + PAGE_H + "] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>" + xres + " >> /Contents " + (first + p * 2) + " 0 R >>");
    });
    var pdf = "%PDF-1.4\n", offsets = [];
    objects.forEach(function (body, idx) {
      offsets.push(pdf.length);
      pdf += (idx + 1) + " 0 obj\n" + body + "\nendobj\n";
    });
    var xref = pdf.length;
    pdf += "xref\n0 " + (objects.length + 1) + "\n0000000000 65535 f \n";
    offsets.forEach(function (o) { pdf += ("0000000000" + o).slice(-10) + " 00000 n \n"; });
    pdf += "trailer\n<< /Size " + (objects.length + 1) + " /Root 1 0 R /Info 5 0 R >>\nstartxref\n" + xref + "\n%%EOF";
    // Every character is below 256, so one character is one byte
    var bytes = new Uint8Array(pdf.length);
    for (var k = 0; k < pdf.length; k++) bytes[k] = pdf.charCodeAt(k) & 255;
    return bytes;
  };
  CrediTrackPdf.prototype.toBlob = function () { return new Blob([this.toBytes()], { type: "application/pdf" }); };
  CrediTrackPdf.prototype.download = function (filename) { window.CrediTrackDownload(this.toBlob(), filename); };

  // Shared by PDF and CSV: saves a Blob as a file through a temporary link
  window.CrediTrackDownload = function (blob, filename) {
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = filename; a.rel = "noopener"; a.style.display = "none";
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1500);
  };

  window.CrediTrackPdf = CrediTrackPdf;
})();
