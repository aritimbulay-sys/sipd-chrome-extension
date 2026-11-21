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

  function getPageZoom(callback) {
    chrome.tabs.getCurrent(function (tab) {
      if (!tab || !chrome.tabs.getZoom) {
        callback(1);
        return;
      }
      chrome.tabs.getZoom(tab.id, function (z) {
        var zoom = typeof z === 'number' && z > 0 ? z : 1;
        callback(Math.max(0.25, Math.min(5, zoom)));
      });
    });
  }

  function exportPng() {
    if (!lastRender) {
      live.textContent = 'Laporan belum siap. Tunggu data tampil lalu coba lagi.';
      return;
    }
    getPageZoom(function (zoom) { drawPng(zoom); });
  }

  function drawPng(zoom) {
    if (!lastRender) return;
    var report = lastRender.report;
    var stag = lastRender.stag || {};
    var rows = report.rows;
    var cols = report.columns;
    var PAD = 8;
    var SCALE = 2 * zoom;
    var FONT = 'bold 11px Arial, Helvetica, sans-serif';
    var FONT_HEAD = 'bold 11px Arial, Helvetica, sans-serif';
    var FONT_BADGE = 'bold 9px Arial, Helvetica, sans-serif';
    var measureCtx = document.createElement('canvas').getContext('2d');
    var KET_COLOR = { 'Sudah Sesuai': '#065f46', 'Kurang Input': '#92400e', 'Lebih Input': '#991b1b' };

    function textOf(r, c) {
      var v = r[c];
      if (report.pctCols.indexOf(c) !== -1) return fmtPct(v);
      if (NUM_COLS.indexOf(c) !== -1) return fmt(v);
      if (c === STATUS_COL) return v === 'Sudah Validasi' || v === 'Belum Validasi' ? v : '';
      return v == null ? '' : String(v);
    }

    function alignOf(c) {
      if (NUM_COLS.indexOf(c) !== -1) return 'right';
      if (report.pctCols.indexOf(c) !== -1 || CENTER_COLS.indexOf(c) !== -1) return 'center';
      return 'left';
    }

    measureCtx.font = FONT;
    var widths = cols.map(function (name, c) {
      var w = measureCtx.measureText(String(name)).width;
      measureCtx.font = FONT;
      for (var i = 1; i < rows.length; i++) {
        var t = textOf(rows[i], c);
        var extra = 0;
        if (c === 1 && stag[rows[i][1]]) {
          measureCtx.font = FONT_BADGE;
          extra = measureCtx.measureText('Stagnan').width + 14;
          measureCtx.font = FONT;
        }
        w = Math.max(w, measureCtx.measureText(t).width + extra);
      }
      if (c === STATUS_COL) w = Math.max(w, 110);
      return Math.ceil(w + PAD * 2);
    });

    var MARGIN = 14;
    var TITLE_H = 22;
    var LINE_H = 16;
    var ROW_H = 24;
    var HEAD_H = 24;
    var tableW = widths.reduce(function (a, b) { return a + b; }, 0);
    var W = Math.max(tableW, 900) + MARGIN * 2;

    var opdRows = rows.slice(1, rows.length - 1);
    var sesuai = opdRows.filter(function (r) { return r[6] === 'Sudah Sesuai'; }).length;
    var belum = opdRows.length - sesuai;
    var title = document.getElementById('title').textContent;
    var sub = document.getElementById('sub').textContent;

    var y = MARGIN;
    var H = MARGIN + TITLE_H + LINE_H * 3 + 8 + HEAD_H + ROW_H * (rows.length - 1) + MARGIN;

    var canvas = document.createElement('canvas');
    canvas.width = W * SCALE;
    canvas.height = H * SCALE;
    var ctx = canvas.getContext('2d');
    ctx.scale(SCALE, SCALE);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = 'middle';

    function roundRect(x, yy, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, yy);
      ctx.arcTo(x + w, yy, x + w, yy + h, r);
      ctx.arcTo(x + w, yy + h, x, yy + h, r);
      ctx.arcTo(x, yy + h, x, yy, r);
      ctx.arcTo(x, yy, x + w, yy, r);
      ctx.closePath();
    }

    function badge(text, x, yy, bg, font) {
      ctx.font = font;
      var w = ctx.measureText(text).width + 12;
      var h = font === FONT_BADGE ? 14 : 16;
      roundRect(x, yy - h / 2, w, h, 3);
      ctx.fillStyle = bg;
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.fillText(text, x + 6, yy + 0.5);
      return w;
    }

    ctx.textAlign = 'left';
    ctx.font = 'bold 16px Arial, Helvetica, sans-serif';
    ctx.fillStyle = '#1d4ed8';
    ctx.fillText(title, MARGIN, y + TITLE_H / 2);
    y += TITLE_H + 4;

    ctx.font = 'bold 12px Arial, Helvetica, sans-serif';
    ctx.fillStyle = '#000000';
    ctx.fillText('OPD sudah sesuai : ' + sesuai, MARGIN, y + LINE_H / 2);
    y += LINE_H;
    ctx.fillText('OPD belum sesuai : ' + belum, MARGIN, y + LINE_H / 2);
    y += LINE_H;
    ctx.font = '10px Arial, Helvetica, sans-serif';
    ctx.fillStyle = '#334155';
    ctx.fillText(sub, MARGIN, y + LINE_H / 2);
    y += LINE_H + 8;

    var x0 = MARGIN;
    var colX = [];
    var cx = x0;
    widths.forEach(function (w, c) { colX.push(cx); cx += w; });

    function rowBg(fillKey, isTotal) {
      if (isTotal) return '#e8efff';
      if (fillKey === 'hijau') return '#92d050';
      if (fillKey === 'merah') return '#ff5050';
      return '#ffffff';
    }

    function drawRow(r, isTotal, fillKey, top, h, isHead) {
      var bg = isHead ? '#eef2f9' : rowBg(fillKey, isTotal);
      ctx.fillStyle = bg;
      ctx.fillRect(x0, top, tableW, h);
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1;
      ctx.strokeRect(x0 + 0.5, top + 0.5, tableW - 1, h - 1);
      for (var c = 0; c < cols.length; c++) {
        if (c > 0) {
          ctx.beginPath();
          ctx.moveTo(colX[c] + 0.5, top);
          ctx.lineTo(colX[c] + 0.5, top + h);
          ctx.strokeStyle = '#cbd5e1';
          ctx.stroke();
        }
        var mid = top + h / 2;
        var align = isHead ? 'center' : alignOf(c);
        var textX = align === 'left' ? colX[c] + PAD
          : align === 'right' ? colX[c] + widths[c] - PAD
          : colX[c] + widths[c] / 2;
        ctx.textAlign = align;
        if (isHead) {
          ctx.font = FONT_HEAD;
          ctx.fillStyle = '#000000';
          ctx.fillText(String(cols[c]), textX, mid);
          continue;
        }
        var t = textOf(r, c);
        if (c === STATUS_COL) {
          if (t) {
            var bgB = t === 'Sudah Validasi' ? '#16a34a' : '#dc2626';
            ctx.textAlign = 'left';
            ctx.font = FONT_BADGE;
            var bw = ctx.measureText(t).width + 12;
            badge(t, colX[c] + (widths[c] - bw) / 2, mid, bgB, FONT_BADGE);
          }
          continue;
        }
        ctx.font = FONT;
        ctx.fillStyle = '#000000';
        if (c === 6) ctx.fillStyle = KET_COLOR[r[6]] || '#000000';
        ctx.fillText(t, textX, mid);
        if (c === 1 && !isTotal && stag[r[1]]) {
          ctx.font = FONT;
          var nameW = ctx.measureText(t).width;
          badge('Stagnan', colX[c] + PAD + nameW + 6, mid, '#dc2626', FONT_BADGE);
        }
      }
    }

    drawRow(cols, false, '', y, HEAD_H, true);
    y += HEAD_H;
    for (var i = 1; i < rows.length - 1; i++) {
      drawRow(rows[i], false, report.fill[i], y, ROW_H, false);
      y += ROW_H;
    }
    var last = rows.length - 1;
    drawRow(rows[last], true, report.fill[last], y, ROW_H, false);

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
      live.textContent = 'PNG tersimpan (zoom ' + Math.round(zoom * 100) + '%).';
    }, 'image/png');
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
