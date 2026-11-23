/* Antarmuka popup & mode besar. */
(function () {
  'use strict';

  var U = window.SIPDUtil;
  var E = window.SIPDExtract;
  var DB = window.SIPDDB;
  var XLSX = window.SIPDXlsx;

  var root = document.getElementById('root');
  var IS_POPUP = document.body.classList.contains('popup');

  var MAX_SHEET_ROWS = 250000;
  var PREVIEW_ROWS = 200;
  var PREVIEW_COLS = 40;

  var SHEET_DEFS = [
    { key: 'laporan', name: 'Laporan', label: 'Laporan Gabungan' },
    { key: 'perangkatDaerah', name: 'Perangkat Daerah', label: 'Perangkat Daerah' },
    { key: 'rincianBelanja', name: 'Rincian Belanja', label: 'Rincian Belanja' },
    { key: 'ringkasan', name: 'Ringkasan', label: 'Ringkasan Sumber' },
    { key: 'mentah', name: 'Data Mentah', label: 'Data Mentah' }
  ];

  var state = {
    captures: [],
    sheets: {},
    active: 'laporan',
    busy: false,
    stats: { rows: 0, captures: 0, api: 0, dom: 0 },
    enabled: true,
    sep: ';',
    mapping: {},
    autoSummary: {},
    columnInfo: []
  };

  /* ------------------------------------------------------------------ */
  /* Kerangka UI                                                        */
  /* ------------------------------------------------------------------ */
  root.innerHTML =
    '<div class="app-shell">' +
      '<header class="hd">' +
        '<div class="brand">' +
          '<span class="logo"></span>' +
          '<div>' +
            '<h1>SIPD Anggaran Scraper</h1>' +
            '<p class="sub">Perangkat Daerah &middot; Batasan Pagu SKPD &middot; Rincian Belanja</p>' +
          '</div>' +
        '</div>' +
        '<label class="switch" title="Rekam otomatis respons API">' +
          '<input type="checkbox" id="enabled"><span class="track"></span><em>Rekam otomatis</em>' +
        '</label>' +
      '</header>' +

      '<div class="toolbar">' +
        '<button id="btn-scan" class="primary">Pindai Tabel Halaman</button>' +
        '<button id="btn-auto">Auto Kumpulkan Halaman&hellip;</button>' +
        '<button id="btn-pagesize">Atur 100 per Halaman</button>' +
        '<button id="btn-reload">Muat Ulang</button>' +
        '<button id="btn-pdf">Buka Laporan Live / PDF</button>' +
        '<button id="btn-report-xlsx">Unduh Laporan (Excel)</button>' +
        '<button id="btn-map">Pemetaan Kolom&hellip;</button>' +
        (IS_POPUP ? '<button id="btn-open">Buka Mode Besar</button>' : '') +
        '<button id="btn-clear" class="danger">Bersihkan</button>' +
      '</div>' +

      '<div class="statusbar"><span id="status" class="status">Memuat&hellip;</span></div>' +
      '<div class="chips" id="chips"></div>' +
      '<nav class="tabs" id="tabs"></nav>' +
      '<div class="preview" id="preview"><div class="empty">Belum ada data.</div></div>' +

      '<footer class="exports">' +
        '<div class="grow"><span id="preview-info" class="muted"></span></div>' +
        '<label class="csvopt">Pemisah CSV <select id="sep">' +
          '<option value=";">titik koma ;</option>' +
          '<option value=",">koma ,</option>' +
        '</select></label>' +
        '<button id="btn-csv">Ekspor CSV</button>' +
        '<button id="btn-xlsx" class="primary">Ekspor Lengkap (.xlsx)</button>' +
      '</footer>' +

      '<details class="sources">' +
        '<summary id="src-sum">Sumber data</summary>' +
        '<div class="src-list" id="sources"></div>' +
      '</details>' +

      '<dialog id="dlg-auto">' +
        '<div class="dlg-body">' +
          '<h2>Auto Kumpulkan Semua Halaman</h2>' +
          '<p>Ekstensi akan menekan tombol &ldquo;halaman berikutnya&rdquo; dan menyimpan tabel pada tiap halaman. Pastikan daftar sudah terbuka dan ukuran halaman (pageSize) sudah disetel maksimal.</p>' +
          '<div class="field"><span>Maksimum halaman</span><input type="number" id="in-pages" value="50" min="1" max="500"></div>' +
          '<div class="field"><span>Tunggu tiap halaman (ms)</span><input type="number" id="in-wait" value="5000" min="1000" max="30000" step="500"></div>' +
          '<p class="note">Bila data tidak berubah setelah tombol diklik, proses dianggap selesai.</p>' +
          '<div class="dlg-actions">' +
            '<button id="dlg-cancel">Batal</button>' +
            '<button id="dlg-start" class="primary">Mulai</button>' +
          '</div>' +
        '</div>' +
      '</dialog>' +
      '<dialog id="dlg-map">' +
        '<div class="dlg-body dlg-wide">' +
          '<h2>Pemetaan Kolom</h2>' +
          '<p>Pilih kolom sumber untuk tiap bagian laporan. Biarkan &ldquo;Otomatis&rdquo; bila hasil deteksi sudah sesuai. ' +
          'Pilihan berlaku untuk semua sumber yang memiliki kolom tersebut.</p>' +
          '<div class="map-grid" id="map-grid"></div>' +
          '<details class="col-wrap">' +
            '<summary id="col-sum">Daftar kolom pada data</summary>' +
            '<div class="col-list" id="col-list"></div>' +
          '</details>' +
          '<div class="dlg-actions">' +
            '<button id="map-reset">Kembalikan ke Otomatis</button>' +
            '<button id="map-close" class="primary">Tutup</button>' +
          '</div>' +
        '</div>' +
      '</dialog>' +
    '</div>';

  var el = {
    status: document.getElementById('status'),
    chips: document.getElementById('chips'),
    tabs: document.getElementById('tabs'),
    preview: document.getElementById('preview'),
    previewInfo: document.getElementById('preview-info'),
    sources: document.getElementById('sources'),
    srcSum: document.getElementById('src-sum'),
    enabled: document.getElementById('enabled'),
    sep: document.getElementById('sep'),
    dialog: document.getElementById('dlg-auto'),
    btnScan: document.getElementById('btn-scan'),
    btnAuto: document.getElementById('btn-auto'),
    btnReload: document.getElementById('btn-reload'),
    btnMap: document.getElementById('btn-map'),
    btnPdf: document.getElementById('btn-pdf'),
    btnReportXlsx: document.getElementById('btn-report-xlsx'),
    dlgMap: document.getElementById('dlg-map'),
    mapGrid: document.getElementById('map-grid'),
    colList: document.getElementById('col-list'),
    colSum: document.getElementById('col-sum'),
    btnClear: document.getElementById('btn-clear'),
    btnOpen: document.getElementById('btn-open'),
    btnCsv: document.getElementById('btn-csv'),
    btnXlsx: document.getElementById('btn-xlsx')
  };

  /* ------------------------------------------------------------------ */
  /* Pembantu                                                           */
  /* ------------------------------------------------------------------ */
  function setStatus(text, kind) {
    el.status.textContent = text;
    el.status.className = 'status' + (kind ? ' ' + kind : '');
  }

  function toast(text, kind) {
    setStatus(text, kind || 'ok');
  }

  function setBusy(busy) {
    state.busy = busy;
    [el.btnScan, el.btnAuto, el.btnReload, el.btnClear, el.btnCsv, el.btnXlsx, el.btnPdf, el.btnReportXlsx]
      .filter(Boolean)
      .forEach(function (b) { b.disabled = busy; });
    if (busy) el.status.classList.add('busy');
    else el.status.classList.remove('busy');
  }

  function sendToBackground(message) {
    return new Promise(function (resolve, reject) {
      try {
        chrome.runtime.sendMessage(message, function (response) {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(response || {});
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  function isSipdUrl(url) {
    return /^https:\/\/([a-z0-9-]+\.)*kemendagri\.go\.id\//i.test(String(url || ''));
  }

  function currentTab() {
    return chrome.tabs.query({ active: true, currentWindow: true }).then(function (tabs) {
      return tabs && tabs[0];
    });
  }

  function injectBridge(tabId) {
    return chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['src/lib/util.js', 'src/lib/extract.js', 'src/bridge.js']
    });
  }

  function sendToTab(message) {
    return currentTab().then(function (tab) {
      if (!tab || tab.id === undefined) throw new Error('Tidak ada tab aktif.');
      if (!isSipdUrl(tab.url)) {
        throw new Error('Buka halaman SIPD (sipd.kemendagri.go.id) pada tab aktif terlebih dahulu.');
      }
      return chrome.tabs.sendMessage(tab.id, message).catch(function () {
        return injectBridge(tab.id).then(function () {
          return chrome.tabs.sendMessage(tab.id, message);
        });
      });
    });
  }

  function escapeCell(value, sep) {
    var s = value === null || value === undefined ? '' : String(value);
    if (s.indexOf('"') !== -1 || s.indexOf('\n') !== -1 || s.indexOf('\r') !== -1 ||
        s.indexOf(sep) !== -1 || s.indexOf(';') !== -1 || s.indexOf(',') !== -1) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function download(name, data, mime) {
    var blob = new Blob([data], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 20000);
  }

  function fmtNum(n) {
    return typeof n === 'number' ? n.toLocaleString('id-ID') : String(n == null ? '' : n);
  }

  /* ------------------------------------------------------------------ */
  /* Pemuatan data                                                      */
  /* ------------------------------------------------------------------ */
  function budgeted(captures, maxRows) {
    var out = [];
    var used = 0;
    for (var i = 0; i < captures.length; i++) {
      if (used >= maxRows) break;
      var cap = captures[i];
      var rows = cap.rows || [];
      var allowed = Math.min(rows.length, maxRows - used);
      out.push(Object.assign({}, cap, { rows: rows.slice(0, allowed) }));
      used += allowed;
    }
    return out;
  }

  function buildSheets() {
    state.sheets = E.buildSheets(budgeted(state.captures, MAX_SHEET_ROWS), state.mapping);
  }

  function load(silent) {
    if (!silent) setStatus('Memuat data…', 'busy');
    return DB.all().then(function (all) {
      var captures = (all || []).slice().sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });

      var stats = { rows: 0, captures: captures.length, api: 0, dom: 0 };
      captures.forEach(function (cap) {
        stats.rows += cap.count || 0;
        if (cap.kind === 'dom') stats.dom++; else stats.api++;
      });
      state.stats = stats;
      state.captures = captures;

      var budgetedCaps = budgeted(captures, MAX_SHEET_ROWS);
      state.autoSummary = E.autoRoleSummary(budgetedCaps);
      state.columnInfo = E.columnSamples(budgetedCaps);
      buildSheets();

      renderChips();
      renderTabs();
      renderPreview();
      renderSources();

      if (!silent) {
        if (!captures.length) {
          setStatus('Belum ada data. Buka SIPD, tunggu tabel tampil, lalu klik “Pindai Tabel Halaman”.', 'warn');
        } else {
          setStatus('Siap. ' + fmtNum(stats.rows) + ' baris dari ' + stats.captures + ' sumber.', 'ok');
        }
      }
    }).catch(function (e) {
      setStatus('Gagal memuat data: ' + (e && e.message ? e.message : e), 'err');
    });
  }

  /* ------------------------------------------------------------------ */
  /* Render                                                             */
  /* ------------------------------------------------------------------ */
  function renderChips() {
    var items = [
      ['Total baris', state.stats.rows],
      ['Sumber API', state.stats.api],
      ['Tabel halaman', state.stats.dom],
      ['Perangkat daerah', Math.max(0, (state.sheets.perangkatDaerah || []).length - 1)],
      ['Rincian belanja', Math.max(0, (state.sheets.rincianBelanja || []).length - 1)]
    ];
    el.chips.innerHTML = '';
    items.forEach(function (pair) {
      var chip = document.createElement('span');
      chip.className = 'chip';
      var b = document.createElement('b');
      b.textContent = fmtNum(pair[1]);
      chip.appendChild(b);
      chip.appendChild(document.createTextNode(pair[0]));
      el.chips.appendChild(chip);
    });
  }

  function sheetRows(key) {
    return state.sheets[key] || [];
  }

  function renderTabs() {
    el.tabs.innerHTML = '';
    SHEET_DEFS.forEach(function (def) {
      var rows = sheetRows(def.key);
      var count = Math.max(0, rows.length - 1);
      var btn = document.createElement('button');
      btn.className = 'tab' + (state.active === def.key ? ' active' : '');
      btn.textContent = def.label;
      var n = document.createElement('span');
      n.className = 'n';
      n.textContent = '(' + fmtNum(count) + ')';
      btn.appendChild(n);
      btn.addEventListener('click', function () {
        state.active = def.key;
        renderTabs();
        renderPreview();
      });
      el.tabs.appendChild(btn);
    });
  }

  function renderPreview() {
    var rows = sheetRows(state.active);
    el.preview.innerHTML = '';

    if (!rows.length || (rows.length === 1 && !rows[0].length)) {
      var empty = document.createElement('div');
      empty.className = 'empty';
      empty.innerHTML = '<b>Belum ada data pada bagian ini.</b>' +
        'Buka halaman SIPD &rarr; tunggu tabel muncul &rarr; klik &ldquo;Pindai Tabel Halaman&rdquo;. ' +
        'Untuk data lengkap lintas halaman, gunakan &ldquo;Auto Kumpulkan Halaman&rdquo;.';
      el.preview.appendChild(empty);
      el.previewInfo.textContent = '';
      return;
    }

    var header = rows[0];
    var bodyRows = rows.slice(1);
    var cols = Math.min(header.length, PREVIEW_COLS);
    var shown = Math.min(bodyRows.length, PREVIEW_ROWS);

    var table = document.createElement('table');
    var thead = document.createElement('thead');
    var trh = document.createElement('tr');
    for (var c = 0; c < cols; c++) {
      var th = document.createElement('th');
      th.textContent = header[c] === undefined || header[c] === '' ? 'Kolom ' + (c + 1) : String(header[c]);
      trh.appendChild(th);
    }
    thead.appendChild(trh);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    for (var r = 0; r < shown; r++) {
      var tr = document.createElement('tr');
      for (var i = 0; i < cols; i++) {
        var value = bodyRows[r][i];
        var td = document.createElement('td');
        if (typeof value === 'number') {
          td.className = 'num';
          td.textContent = value.toLocaleString('id-ID');
        } else {
          td.textContent = value === null || value === undefined ? '' : String(value);
          td.title = td.textContent.length > 40 ? td.textContent : '';
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    el.preview.appendChild(table);

    var info = 'Menampilkan ' + fmtNum(shown) + ' dari ' + fmtNum(bodyRows.length) + ' baris';
    if (header.length > cols) info += ' · ' + fmtNum(cols) + ' dari ' + fmtNum(header.length) + ' kolom';
    if (bodyRows.length > shown) info += ' (pratinjau dipotong)';
    el.previewInfo.textContent = info;
  }

  function renderSources() {
    var caps = state.captures.slice().reverse();
    el.srcSum.textContent = 'Sumber data (' + caps.length + ')';
    el.sources.innerHTML = '';

    if (!caps.length) {
      var p = document.createElement('div');
      p.className = 'src';
      p.innerHTML = '<span class="label muted">Belum ada sumber data tersimpan.</span>';
      el.sources.appendChild(p);
      return;
    }

    caps.forEach(function (cap) {
      var row = document.createElement('div');
      row.className = 'src';

      var tag = document.createElement('span');
      tag.className = 'tag' + (cap.kind === 'dom' ? ' dom' : '');
      tag.textContent = cap.kind === 'dom' ? 'HTML' : 'API';

      var label = document.createElement('span');
      label.className = 'label';
      label.textContent = cap.label || cap.url || '(tanpa nama)';
      label.title = (cap.url || '') + (cap.path ? '\n' + cap.path : '');

      var meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = fmtNum(cap.count || 0) + ' baris';

      var del = document.createElement('button');
      del.textContent = 'Hapus';
      del.addEventListener('click', function () {
        DB.remove(cap.id).then(function () { return load(true); });
      });

      row.appendChild(tag);
      row.appendChild(label);
      row.appendChild(meta);
      row.appendChild(del);
      el.sources.appendChild(row);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Pemetaan kolom                                                     */
  /* ------------------------------------------------------------------ */
  function setMapping(role, column) {
    if (column) state.mapping[role] = column;
    else delete state.mapping[role];

    chrome.storage.local.set({ columnMapping: state.mapping });
    buildSheets();
    renderChips();
    renderTabs();
    renderPreview();
    renderMapping();
    setStatus('Pemetaan kolom diperbarui.', 'ok');
  }

  function renderMapping() {
    if (!el.mapGrid) return;
    var labels = E.ROLE_LABELS || {};
    var order = E.ROLE_ORDER || Object.keys(labels);
    var columns = state.columnInfo.map(function (c) { return c.name; });

    el.mapGrid.innerHTML = '';

    order.forEach(function (role) {
      var row = document.createElement('div');
      row.className = 'map-row';

      var label = document.createElement('label');
      label.textContent = labels[role] || role;
      label.setAttribute('for', 'map-' + role);

      var select = document.createElement('select');
      select.id = 'map-' + role;

      var auto = document.createElement('option');
      auto.value = '';
      auto.textContent = 'Otomatis';
      select.appendChild(auto);

      columns.forEach(function (col) {
        var opt = document.createElement('option');
        opt.value = col;
        opt.textContent = col;
        select.appendChild(opt);
      });

      var current = state.mapping[role];
      select.value = current && columns.indexOf(current) !== -1 ? current : '';

      select.addEventListener('change', function () {
        setMapping(role, select.value);
      });

      var hint = document.createElement('span');
      hint.className = 'auto-hint';
      hint.textContent = state.autoSummary[role]
        ? 'otomatis: ' + state.autoSummary[role]
        : 'belum terdeteksi otomatis';

      row.appendChild(label);
      row.appendChild(select);
      row.appendChild(hint);
      el.mapGrid.appendChild(row);
    });

    el.colSum.textContent = 'Daftar kolom pada data (' + state.columnInfo.length + ')';
    el.colList.innerHTML = '';

    if (!state.columnInfo.length) {
      var kosong = document.createElement('div');
      kosong.className = 'col-item muted';
      kosong.textContent = 'Belum ada kolom. Tarik data dari halaman SIPD terlebih dahulu.';
      el.colList.appendChild(kosong);
      return;
    }

    state.columnInfo.forEach(function (info) {
      var item = document.createElement('div');
      item.className = 'col-item';

      var name = document.createElement('b');
      name.textContent = info.name;

      var sample = document.createElement('span');
      sample.className = 'muted';
      sample.textContent = info.samples.length
        ? 'contoh: ' + info.samples.join('  ·  ')
        : '(tidak ada contoh isi)';

      item.appendChild(name);
      item.appendChild(sample);
      el.colList.appendChild(item);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Aksi                                                               */
  /* ------------------------------------------------------------------ */
  function scanDOM() {
    setBusy(true);
    setStatus('Memindai tabel pada halaman…', 'busy');
    var tabInfo = null;

    sendToTab({ type: 'scrapeDOM' }).then(function (res) {
      if (!res || !res.ok) throw new Error((res && res.error) || 'Gagal memindai halaman.');
      if (!res.tables || !res.tables.length) {
        throw new Error('Tidak ada tabel data yang terbaca. Pastikan daftar sudah tampil di layar.');
      }
      tabInfo = res;
      return sendToBackground({
        type: 'saveDOM',
        url: res.url,
        label: (res.title || 'Tabel') + ' · pindai manual',
        page: 1,
        tables: res.tables
      });
    }).then(function (res) {
      var saved = res && typeof res.saved === 'number' ? res.saved : 0;
      var tables = tabInfo ? tabInfo.tables.length : 0;
      toast('Selesai. ' + tables + ' tabel dibaca, ' + saved + ' sumber baru disimpan.', 'ok');
      return load(true);
    }).catch(function (e) {
      setStatus(e && e.message ? e.message : String(e), 'err');
    }).then(function () {
      setBusy(false);
    });
  }

  function autoCollect(maxPages, waitMs) {
    setBusy(true);
    setStatus('Auto kumpulkan dimulai (maks ' + maxPages + ' halaman)…', 'busy');
    sendToTab({ type: 'autoCollect', maxPages: maxPages, waitMs: waitMs }).then(function (res) {
      if (!res || !res.ok) throw new Error((res && res.error) || 'Auto kumpulkan gagal.');
      var r = res.result || {};
      toast('Selesai: ' + (r.pages || 0) + ' halaman, ' + fmtNum(r.rows || 0) + ' baris terbaca.', 'ok');
      return load(true);
    }).catch(function (e) {
      setStatus(e && e.message ? e.message : String(e), 'err');
    }).then(function () {
      setBusy(false);
    });
  }

  function exportXlsx() {
    if (!state.captures.length) {
      setStatus('Tidak ada data untuk diekspor.', 'warn');
      return;
    }
    setBusy(true);
    setStatus('Menyusun berkas Excel…', 'busy');

    // beri jeda agar status sempat digambar
    U.sleep(50).then(function () {
      try {
        var sheets = SHEET_DEFS.map(function (def) {
          return { name: def.name, rows: sheetRows(def.key) };
        }).filter(function (s) { return s.rows && s.rows.length > 1; });

        if (!sheets.length) throw new Error('Tidak ada baris data untuk diekspor.');

        var bytes = XLSX.build(sheets);
        download('SIPD-Anggaran_' + U.stamp() + '.xlsx', bytes,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        toast('Excel dibuat: ' + sheets.length + ' sheet, ' +
          fmtNum(sheets.reduce(function (s, x) { return s + x.rows.length - 1; }, 0)) + ' baris.', 'ok');
      } catch (e) {
        setStatus('Gagal membuat Excel: ' + (e && e.message ? e.message : e), 'err');
      }
      setBusy(false);
    });
  }

  function exportCsv() {
    var rows = sheetRows(state.active);
    if (!rows.length || rows.length < 2) {
      setStatus('Tidak ada data pada bagian ini untuk diekspor.', 'warn');
      return;
    }
    var sep = state.sep;
    var lines = rows.map(function (row) {
      return row.map(function (cell) { return escapeCell(cell, sep); }).join(sep);
    });
    var text = '\ufeff' + lines.join('\r\n');
    var def = SHEET_DEFS.filter(function (d) { return d.key === state.active; })[0] || { name: 'Data' };
    download('SIPD_' + def.name.replace(/\s+/g, '-') + '_' + U.stamp() + '.csv', text, 'text/csv;charset=utf-8');
    toast('CSV dibuat (' + fmtNum(rows.length - 1) + ' baris).', 'ok');
  }

  function exportReportXlsx() {
    if (!state.captures.length) {
      setStatus('Tidak ada data untuk diekspor.', 'warn');
      return;
    }
    setBusy(true);
    setStatus('Menyusun laporan Excel (3 kolom)…', 'busy');
    U.sleep(50).then(function () {
      try {
        var report = E.build3ColumnReport(budgeted(state.captures, MAX_SHEET_ROWS));
        var bytes = XLSX.build([{ name: 'Laporan', rows: report.rows, fill: report.fill, pctCols: report.pctCols }]);
        download('SIPD-Laporan_' + U.stamp() + '.xlsx', bytes,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        toast('Laporan Excel dibuat: ' + (report.rows.length - 2) + ' baris.', 'ok');
      } catch (e) {
        setStatus('Gagal membuat Excel: ' + (e && e.message ? e.message : e), 'err');
      }
      setBusy(false);
    });
  }

  function downloadPdf() {
    if (!state.captures.length) {
      setStatus('Tidak ada data. Tarik data dari halaman SIPD terlebih dahulu.', 'warn');
      return;
    }
    chrome.tabs.create({ url: chrome.runtime.getURL('src/report.html') });
    setStatus('Membuka laporan PDF…', 'ok');
  }

  /* ------------------------------------------------------------------ */
  /* Event                                                              */
  /* ------------------------------------------------------------------ */
  el.btnScan.addEventListener('click', scanDOM);
  document.getElementById('btn-pagesize').addEventListener('click', function () {
    setBusy(true);
    setStatus('Mengatur tampilan 100 data per halaman…', 'busy');
    sendToTab({ type: 'setPageSize', size: 100 }).then(function (res) {
      if (res && res.ok) toast('Tampilan diatur ke 100 data per halaman.', 'ok');
      else setStatus((res && res.error) || 'Gagal mengatur 100 per halaman.', 'warn');
    }).catch(function (e) {
      setStatus(e && e.message ? e.message : String(e), 'err');
    }).then(function () { setBusy(false); });
  });
  el.btnReload.addEventListener('click', function () { load(); });
  el.btnCsv.addEventListener('click', exportCsv);
  el.btnXlsx.addEventListener('click', exportXlsx);
  if (el.btnPdf) {
    el.btnPdf.addEventListener('click', downloadPdf);
  }
  if (el.btnReportXlsx) {
    el.btnReportXlsx.addEventListener('click', exportReportXlsx);
  }

  if (el.btnOpen) {
    el.btnOpen.addEventListener('click', function () {
      chrome.tabs.create({ url: chrome.runtime.getURL('src/app.html') });
    });
  }

  el.btnAuto.addEventListener('click', function () {
    if (el.dialog.showModal) el.dialog.showModal();
  });

  if (el.btnMap) {
    el.btnMap.addEventListener('click', function () {
      renderMapping();
      if (el.dlgMap.showModal) el.dlgMap.showModal();
    });
  }

  document.getElementById('map-close').addEventListener('click', function () {
    el.dlgMap.close();
  });

  document.getElementById('map-reset').addEventListener('click', function () {
    state.mapping = {};
    chrome.storage.local.set({ columnMapping: {} });
    buildSheets();
    renderChips();
    renderTabs();
    renderPreview();
    renderMapping();
    setStatus('Pemetaan dikembalikan ke deteksi otomatis.', 'ok');
  });

  document.getElementById('dlg-cancel').addEventListener('click', function () {
    el.dialog.close();
  });

  document.getElementById('dlg-start').addEventListener('click', function () {
    var pages = parseInt(document.getElementById('in-pages').value, 10) || 50;
    var wait = parseInt(document.getElementById('in-wait').value, 10) || 5000;
    el.dialog.close();
    autoCollect(Math.max(1, Math.min(500, pages)), Math.max(1000, Math.min(30000, wait)));
  });

  el.btnClear.addEventListener('click', function () {
    if (!window.confirm('Hapus semua data yang sudah tersimpan?')) return;
    setBusy(true);
    DB.clear().then(function () {
      chrome.storage.local.remove('selisihState');
      toast('Semua data dihapus.', 'ok');
      return load(true);
    }).catch(function (e) {
      setStatus('Gagal menghapus: ' + (e && e.message ? e.message : e), 'err');
    }).then(function () {
      setBusy(false);
      sendToBackground({ type: 'refreshBadge' }).catch(function () {});
    });
  });

  el.sep.addEventListener('change', function () {
    state.sep = el.sep.value;
    chrome.storage.local.set({ csvSeparator: el.sep.value });
  });

  el.enabled.addEventListener('change', function () {
    var value = el.enabled.checked;
    state.enabled = value;
    chrome.storage.local.set({ captureEnabled: value });
    setStatus(value ? 'Perekaman otomatis aktif.' : 'Perekaman otomatis dimatikan (sumber data tidak bertambah).', value ? 'ok' : 'warn');
  });

  document.getElementById('preview').addEventListener('scroll', function () { /* placeholder */ });

  chrome.runtime.onMessage.addListener(function (message) {
    if (!message) return;
    if (message.type === 'progress') {
      if (message.phase === 'page') {
        setStatus('Halaman ' + message.page + ' tersimpan (' + fmtNum(message.rows) + ' baris) — total ' +
          fmtNum(message.total) + ' baris. Lanjut…', 'busy');
      } else if (message.phase === 'done') {
        setStatus('Selesai pada halaman ' + message.page + '. ' + (message.reason || '') +
          ' Total ' + fmtNum(message.rows || 0) + ' baris.', 'ok');
        load(true);
      }
    }
  });

  /* ------------------------------------------------------------------ */
  /* Inisialisasi                                                       */
  /* ------------------------------------------------------------------ */
  chrome.storage.local.get({ captureEnabled: true, csvSeparator: ';', columnMapping: {} }, function (items) {
    state.enabled = items.captureEnabled !== false;
    state.sep = items.csvSeparator || ';';
    state.mapping = items.columnMapping || {};
    el.enabled.checked = state.enabled;
    el.sep.value = state.sep;

    load().then(function () {
      if (IS_POPUP) {
        el.sources.parentElement.open = state.captures.length > 0 && state.captures.length <= 6;
      }
    });
  });
})();
