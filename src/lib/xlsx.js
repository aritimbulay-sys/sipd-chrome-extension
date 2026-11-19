/* Penulis berkas .xlsx minimal (ZIP tanpa kompresi) — tanpa dependensi eksternal. */
(function (global) {
  'use strict';
  if (global.SIPDXlsx) return;

  var CRC_TABLE = (function () {
    var t = new Int32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function u16(n) { return [n & 0xFF, (n >>> 8) & 0xFF]; }
  function u32(n) { return [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF]; }

  function encode(text) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text);
    var utf8 = unescape(encodeURIComponent(text));
    var out = new Uint8Array(utf8.length);
    for (var i = 0; i < utf8.length; i++) out[i] = utf8.charCodeAt(i);
    return out;
  }

  /* ZIP dengan metode "stored" (tanpa kompresi). */
  function zip(files) {
    var localParts = [];
    var centralParts = [];
    var offset = 0;

    files.forEach(function (file) {
      var nameBytes = encode(file.name);
      var data = file.data;
      var crc = crc32(data);
      var size = data.length;

      var local = [].concat(
        u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
        u32(crc), u32(size), u32(size), u16(nameBytes.length), u16(0)
      );
      localParts.push(new Uint8Array(local), nameBytes, data);

      var central = [].concat(
        u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
        u32(crc), u32(size), u32(size), u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset)
      );
      centralParts.push(new Uint8Array(central), nameBytes);

      offset += local.length + nameBytes.length + size;
    });

    var centralStart = offset;
    var centralSize = centralParts.reduce(function (sum, p) { return sum + p.length; }, 0);
    var end = [].concat(
      u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
      u32(centralSize), u32(centralStart), u16(0)
    );

    var all = localParts.concat(centralParts, [new Uint8Array(end)]);
    var total = all.reduce(function (sum, p) { return sum + p.length; }, 0);
    var out = new Uint8Array(total);
    var pos = 0;
    all.forEach(function (p) { out.set(p, pos); pos += p.length; });
    return out;
  }

  function colName(index) {
    var i = index + 1;
    var s = '';
    while (i > 0) {
      var m = (i - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      i = Math.floor((i - 1) / 26);
    }
    return s;
  }

  function esc(value) {
    return global.SIPDUtil.stripControl(String(value)).replace(/[&<>"']/g, function (c) {
      switch (c) {
        case '&': return '&amp;';
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '"': return '&quot;';
        default: return '&apos;';
      }
    });
  }

  function cellXml(ref, value, style) {
    var s = style ? ' s="' + style + '"' : '';
    if (value === null || value === undefined || value === '') {
      return style ? '<c r="' + ref + '"' + s + '/>' : '';
    }
    if (typeof value === 'number' && isFinite(value)) {
      return '<c r="' + ref + '" s="' + (style || 3) + '"><v>' + value + '</v></c>';
    }
    if (typeof value === 'boolean') {
      return '<c r="' + ref + '" t="b"><v>' + (value ? 1 : 0) + '</v></c>';
    }
    return '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' + esc(value) + '</t></is></c>';
  }

  var MAX_ROWS = 200000;
  var MAX_COLS = 200;

  function sheetXml(rows, meta) {
    meta = meta || {};
    var fillRows = meta.fill || [];
    var pctCols = meta.pctCols || [];
    var limit = Math.min(rows.length, MAX_ROWS);
    var width = 0;
    var i, j;
    for (i = 0; i < limit; i++) width = Math.max(width, Math.min(rows[i].length, MAX_COLS));
    if (!width) width = 1;

    // lebar kolom otomatis
    var widths = new Array(width).fill(10);
    for (i = 0; i < Math.min(limit, 400); i++) {
      for (j = 0; j < Math.min(rows[i].length, width); j++) {
        var v = rows[i][j];
        var len = (v === null || v === undefined) ? 0 : String(v).length;
        if (len > widths[j]) widths[j] = Math.min(len, 60);
      }
    }
    var cols = '';
    for (j = 0; j < width; j++) {
      cols += '<col min="' + (j + 1) + '" max="' + (j + 1) + '" width="' + (widths[j] + 2) + '" customWidth="1"/>';
    }

    var body = '';
    for (i = 0; i < limit; i++) {
      var row = rows[i];
      var cells = '';
      var n = Math.min(row.length, width);
      var rowFill = i > 0 ? fillRows[i] : '';
      var green = rowFill === 'hijau';
      var red = rowFill === 'merah';
      for (j = 0; j < n; j++) {
        var style;
        var val = row[j];
        var isPct = pctCols.indexOf(j) !== -1 && typeof val === 'number';
        if (i === 0) style = 1;
        else if (typeof val === 'number') {
          if (isPct) style = green ? 6 : red ? 9 : 4;
          else style = green ? 5 : red ? 8 : 3;
        } else style = green ? 7 : red ? 10 : 0;
        cells += cellXml(colName(j) + (i + 1), val, style);
      }
      body += '<row r="' + (i + 1) + '">' + cells + '</row>';
    }

    var lastRef = colName(width - 1) + Math.max(limit, 1);
    var pane = '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';
    var filter = limit > 1 ? '<autoFilter ref="A1:' + lastRef + '"/>' : '';

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<dimension ref="A1:' + lastRef + '"/>' +
      pane +
      '<sheetFormatPr defaultRowHeight="15"/>' +
      '<cols>' + cols + '</cols>' +
      '<sheetData>' + body + '</sheetData>' +
      filter +
      '</worksheet>';
  }

  var STYLES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="2">' +
    '<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>' +
    '</fonts>' +
    '<fills count="4">' +
    '<fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FF92D050"/><bgColor indexed="64"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFFF5050"/><bgColor indexed="64"/></patternFill></fill>' +
    '</fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="11">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="3" fontId="0" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1"/>' +
    '<xf numFmtId="10" fontId="0" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1"/>' +
    '<xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1"/>' +
    '<xf numFmtId="3" fontId="0" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1"/>' +
    '<xf numFmtId="10" fontId="0" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1"/>' +
    '<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  function safeSheetName(name, used) {
    var n = String(name || 'Sheet').replace(/[\\/?*\[\]:]/g, ' ').trim().slice(0, 31) || 'Sheet';
    var base = n;
    var i = 2;
    while (used[n]) {
      var suffix = ' (' + i + ')';
      n = base.slice(0, 31 - suffix.length) + suffix;
      i++;
    }
    used[n] = true;
    return n;
  }

  /**
   * sheets: [{ name, rows: [[...]] }]
   * Mengembalikan Uint8Array berisi berkas .xlsx.
   */
  function build(sheets) {
    var used = {};
    var named = sheets.map(function (s) {
      return {
        name: safeSheetName(s.name, used),
        rows: s.rows && s.rows.length ? s.rows : [['']],
        fill: s.fill,
        pctCols: s.pctCols
      };
    });

    var files = [];

    var sheetEntries = named.map(function (s, i) {
      return '<sheet name="' + esc(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
    }).join('');

    files.push({
      name: '[Content_Types].xml',
      data: encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        named.map(function (s, i) {
          return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
        }).join('') +
        '</Types>')
    });

    files.push({
      name: '_rels/.rels',
      data: encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>')
    });

    files.push({
      name: 'xl/workbook.xml',
      data: encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets>' + sheetEntries + '</sheets>' +
        '</workbook>')
    });

    files.push({
      name: 'xl/_rels/workbook.xml.rels',
      data: encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        named.map(function (s, i) {
          return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
        }).join('') +
        '<Relationship Id="rId' + (named.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '</Relationships>')
    });

    files.push({ name: 'xl/styles.xml', data: encode(STYLES_XML) });

    named.forEach(function (s, i) {
      files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: encode(sheetXml(s.rows, { fill: s.fill, pctCols: s.pctCols })) });
    });

    return zip(files);
  }

  global.SIPDXlsx = { build: build, crc32: crc32 };
})(typeof self !== 'undefined' ? self : this);
