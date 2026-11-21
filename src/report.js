/* Laporan progres live: memantau data tersimpan dan memperbarui tampilan saat ada perubahan. */
(function () {
  'use strict';

  var U = window.SIPDUtil, E = window.SIPDExtract, DB = window.SIPDDB;
  var POLL_MS = 5000;
  var NUM_COLS = [2, 3, 4];
  var STATUS_COL = 7;
  var KET_COL = 6;
  var CENTER_COLS = [0, 5, 6, 7];

  var sub = document.getElementById('sub');
  var wrap = document.getElementById('wrap');
  var foot = document.getElementById('foot');
  var live = document.getElementById('live');
  var lastSig = null;
  var lastRender = null;

  function fmt(n) {
    return (typeof n === 'number') ? n.toLocaleString('id-ID') : (n == null ? '' : String(n));
  }

  function fmtPct(v) {
    if (typeof v !== 'number' || !isFinite(v)) return '';
    return (v * 100).toLocaleString('id-ID', { maximumFractionDigits: 2 }) + '%';
  }

  function signature(captures) {
    return captures.map(function (c) { return c.id + ':' + c.ts + ':' + (c.count || 0); }).join('|');
  }

  var STAGNAN_MS = 3 * 60 * 60 * 1000;

  /* OPD dengan Keterangan Kurang/Lebih Input yang selisihnya tidak berubah ≥ 3 jam. */
  function stagnanMap(report, state) {
    var out = {};
    var now = Date.now();
    report.rows.slice(1, report.rows.length - 1).forEach(function (r) {
      var ket = r[6];
      if (ket !== 'Kurang Input' && ket !== 'Lebih Input') return;
      var st = state[r[1]];
      if (st && typeof st.changedAt === 'number' && now - st.changedAt >= STAGNAN_MS) out[r[1]] = true;
    });
    return out;
  }

  function getState() {
    return new Promise(function (resolve) {
      chrome.storage.local.get({ selisihState: {} }, function (items) {
        resolve((items && items.selisihState) || {});
      });
    });
  }

  function render(captures, report, stag) {
    var now = new Date();
    var stamp = now.toLocaleString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    var title = document.getElementById('title');
    title.textContent = 'Laporan Progres Input Rincian Belanja pada Aplikasi SIPD Tahun Anggaran ' + (report.tahun || '-') + ' (Update : ' + stamp + ' WIB)';
    document.title = title.textContent;

    var opdData = report.rows.slice(1, report.rows.length - 1);
    var sesuai = opdData.filter(function (r) { return r[6] === 'Sudah Sesuai'; }).length;
    var belum = opdData.length - sesuai;
    document.getElementById('summary').innerHTML =
      'OPD sudah sesuai : ' + sesuai + '<br>OPD belum sesuai : ' + belum;

    if (report.rows.length <= 2) {
      wrap.innerHTML = '<div class="empty">Belum ada data. Buka halaman SIPD cascading lalu klik “Muat Ulang Data SIPD”.</div>';
      sub.textContent = 'Tidak ada data tersimpan.';
      return;
    }

    sub.textContent = 'Sumber: ' + captures.length + ' tangkapan data · ' + opdData.length +
      ' baris · dibuat ' + now.toLocaleString('id-ID');

    var html = '<table><thead><tr>';
    report.columns.forEach(function (c) { html += '<th>' + U.escapeXml(c) + '</th>'; });
    html += '</tr></thead><tbody>';

    function rowHtml(r, isTotal, fillKey) {
      var out = '<tr' + (isTotal ? ' class="total"' : '') +
        (fillKey === 'hijau' ? ' class="sesuai"' : fillKey === 'merah' ? ' class="lebih-row"' : '') + '>';
      for (var c = 0; c < report.columns.length; c++) {
        var v = r[c];
        var cls = '';
        var content;
        if (report.pctCols.indexOf(c) !== -1) {
          cls = '';
          content = fmtPct(v);
        } else if (NUM_COLS.indexOf(c) !== -1) {
          cls = ' class="num"';
          content = fmt(v);
        } else if (c === STATUS_COL) {
          if (v === 'Sudah Validasi') content = '<span class="badge-hijau">Sudah Validasi</span>';
          else if (v === 'Belum Validasi') content = '<span class="badge-merah">Belum Validasi</span>';
          else content = '';
        } else {
          content = U.escapeXml(v == null ? '' : v);
          if (c === 1 && stag && stag[r[1]]) {
            content += ' <span class="stagnan">Stagnan</span>';
          }
        }
        if (c === KET_COL) {
          if (v === 'Sudah Sesuai') cls = ' class="ok"';
          else if (v === 'Kurang Input') cls = ' class="kurang"';
          else if (v === 'Lebih Input') cls = ' class="lebih"';
        }
        if (CENTER_COLS.indexOf(c) !== -1) {
          cls = cls ? cls.replace('class="', 'class="ctr ') : ' class="ctr"';
        }
        out += '<td' + cls + '>' + content + '</td>';
      }
      return out + '</tr>';
    }

    for (var i = 1; i < report.rows.length - 1; i++) {
      html += rowHtml(report.rows[i], false, report.fill[i]);
    }
    var last = report.rows.length - 1;
    html += rowHtml(report.rows[last], true, report.fill[last]);
    html += '</tbody></table>';

    wrap.innerHTML = html;
    lastRender = { report: report, stag: stag };
    foot.textContent = 'Klik "Cetak / Simpan PDF" atau Ctrl+P, lalu pilih "Save as PDF".';
  }

  function tick() {
    return Promise.all([DB.all(), getState()]).then(function (vals) {
      var all = vals[0] || [];
      var state = vals[1];
      var captures = all.slice().sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
      var report = E.build3ColumnReport(captures);
      var stag = stagnanMap(report, state);
      var key = signature(captures) + '#' + Object.keys(stag).sort().join('|');
      if (key === lastSig) {
        live.textContent = 'Live · dicek ' + new Date().toLocaleTimeString('id-ID');
        return;
      }
      lastSig = key;
      render(captures, report, stag);
      live.textContent = 'Live · diperbarui ' + new Date().toLocaleTimeString('id-ID');
    }).catch(function (e) {
      wrap.innerHTML = '<div class="empty">Gagal memuat data: ' +
        U.escapeXml(String(e && e.message ? e.message : e)) + '</div>';
    });
  }

  function exportPng() {
    if (!lastRender) {
      live.textContent = 'Laporan belum siap. Tunggu data tampil lalu coba lagi.';
      return;
    }
    var title = document.getElementById('title');
    var foot = document.getElementById('foot');
    var dpr = window.devicePixelRatio || 1;
    var pageW = document.documentElement.clientWidth;
    var contentH = Math.ceil(foot.getBoundingClientRect().bottom - title.getBoundingClientRect().top);
    var H = contentH + 48;

    var cssText = Array.prototype.map.call(document.querySelectorAll('style'), function (s) {
      return s.textContent;
    }).join('\n').replace(/&/g, '&amp;').replace(/</g, '&lt;');

    var inner = ['title', 'summary', 'sub', 'wrap', 'foot'].map(function (id) {
      var el = document.getElementById(id);
      return el ? el.outerHTML : '';
    }).join('');

    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + pageW + '" height="' + H + '">' +
      '<foreignObject x="0" y="0" width="' + pageW + '" height="' + H + '">' +
      '<div xmlns="http://www.w3.org/1999/xhtml" style="width:' + pageW + 'px;height:' + H + 'px;padding:24px;box-sizing:border-box;background:#fff;">' +
      '<style>' + cssText + '</style>' + inner +
      '</div></foreignObject></svg>';

    var img = new Image();
    img.onload = function () {
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(pageW * dpr);
      canvas.height = Math.round(H * dpr);
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      try {
        canvas.toBlob(function (blob) {
          if (!blob) {
            live.textContent = 'Gagal membuat PNG.';
            return;
          }
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = 'Laporan-Progres-SIPD_' + stampNow() + '.png';
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(function () { URL.revokeObjectURL(url); }, 20000);
          live.textContent = 'PNG tersimpan (' + canvas.width + ' × ' + canvas.height + ' px).';
        }, 'image/png');
      } catch (e) {
        live.textContent = 'Gagal membuat PNG: ' + (e && e.message ? e.message : e);
      }
    };
    img.onerror = function () {
      live.textContent = 'Gagal merender halaman menjadi gambar.';
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function stampNow() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  function reloadSipd() {
    live.textContent = 'Memuat ulang tab SIPD…';
    chrome.runtime.sendMessage({ type: 'reloadSipd' }, function (res) {
      if (chrome.runtime.lastError || !res || !res.ok) {
        live.textContent = (res && res.error) || 'Buka halaman SIPD di salah satu tab terlebih dahulu.';
        return;
      }
      live.textContent = 'Tab SIPD dimuat ulang. Menunggu data baru…';
    });
  }

  function on(id, handler) {
    var node = document.getElementById(id);
    if (node) node.addEventListener('click', handler);
  }

  on('btn-print', function () { window.print(); });
  on('btn-png', exportPng);
  on('btn-reload', reloadSipd);

  var autoOn = document.getElementById('auto-on');
  var autoMin = document.getElementById('auto-min');

  function saveAutoReload() {
    var minutes = Math.max(1, Math.min(1440, parseInt(autoMin.value, 10) || 5));
    autoMin.value = minutes;
    chrome.storage.local.set({ autoReload: { enabled: autoOn.checked, minutes: minutes } });
    live.textContent = autoOn.checked
      ? 'Muat ulang otomatis aktif: tiap ' + minutes + ' menit.'
      : 'Muat ulang otomatis nonaktif.';
  }

  if (autoOn && autoMin) {
    chrome.storage.local.get({ autoReload: { enabled: false, minutes: 5 } }, function (items) {
      var cfg = items.autoReload || {};
      autoOn.checked = !!cfg.enabled;
      autoMin.value = cfg.minutes || 5;
    });
    autoOn.addEventListener('change', saveAutoReload);
    autoMin.addEventListener('change', saveAutoReload);
  }

  tick();
  setInterval(tick, POLL_MS);
})();
