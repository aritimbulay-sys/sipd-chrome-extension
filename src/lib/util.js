/* Utilitas umum — dipakai di service worker, content script, dan halaman ekstensi. */
(function (global) {
  'use strict';
  if (global.SIPDUtil) return;

  var U = {};

  U.isObj = function (v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
  };

  U.escapeXml = function (value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      switch (c) {
        case '&': return '&amp;';
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '"': return '&quot;';
        default: return '&apos;';
      }
    });
  };

  /* Membersihkan karakter kontrol yang tidak valid di XML. */
  U.stripControl = function (s) {
    return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  };

  /**
   * Mengubah nilai menjadi angka.
   * Mendukung format Indonesia ("1.234.567,89") maupun internasional ("1,234,567.89").
   * Mengembalikan null bila bukan angka.
   */
  U.parseIndoNumber = function (value) {
    if (typeof value === 'number') return isFinite(value) ? value : null;
    if (typeof value === 'boolean' || value === null || value === undefined) return null;
    var s = String(value).trim();
    if (!s) return null;

    var negative = /^\(.*\)$/.test(s) || /^-/.test(s);
    s = s.replace(/[^0-9.,]/g, '');
    if (!s || !/[0-9]/.test(s)) return null;

    var lastDot = s.lastIndexOf('.');
    var lastComma = s.lastIndexOf(',');
    var hasDot = lastDot !== -1;
    var hasComma = lastComma !== -1;
    var out;

    if (hasDot && hasComma) {
      if (lastDot > lastComma) {
        // 1,234,567.89
        out = s.replace(/,/g, '');
      } else {
        // 1.234.567,89
        out = s.replace(/\./g, '').replace(',', '.');
      }
    } else if (hasDot) {
      var dotCount = (s.match(/\./g) || []).length;
      if (dotCount > 1) out = s.replace(/\./g, '');
      else {
        var afterDot = s.length - lastDot - 1;
        out = afterDot === 3 ? s.replace('.', '') : s;
      }
    } else if (hasComma) {
      var commaCount = (s.match(/,/g) || []).length;
      if (commaCount > 1) out = s.replace(/,/g, '');
      else {
        var afterComma = s.length - lastComma - 1;
        out = afterComma === 3 ? s.replace(',', '') : s.replace(',', '.');
      }
    } else {
      out = s;
    }

    var n = parseFloat(out);
    if (!isFinite(n)) return null;
    return negative ? -n : n;
  };

  /* Angka -> string rupiah sederhana tanpa simbol mata uang. */
  U.formatNumber = function (n) {
    if (typeof n !== 'number' || !isFinite(n)) return '';
    return n.toLocaleString('id-ID', { maximumFractionDigits: 2 });
  };

  /* FNV-1a 32-bit, cukup untuk deteksi duplikat. */
  U.hash = function (str) {
    var h = 0x811c9dc5;
    var s = String(str);
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ('00000000' + h.toString(16)).slice(-8);
  };

  U.sleep = function (ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  };

  U.stamp = function (date) {
    var d = date || new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  };

  U.shortUrl = function (url) {
    try {
      var u = new URL(url);
      var seg = u.pathname.split('/').filter(Boolean).pop() || u.pathname;
      return seg + (u.search ? u.search : '');
    } catch (e) {
      return String(url).slice(0, 80);
    }
  };

  /* Memotong teks agar aman ditampilkan. */
  U.truncate = function (s, n) {
    s = String(s == null ? '' : s);
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  };

  global.SIPDUtil = U;
})(typeof self !== 'undefined' ? self : this);
