/* Jembatan antara skrip halaman (MAIN world), popup, dan service worker. */
(function () {
  'use strict';
  if (window.__SIPD_BRIDGE__) return;
  window.__SIPD_BRIDGE__ = true;

  function detectTahunAnggaran() {
    try {
      var u = new URL(location.href);
      var keys = ['tahun', 'ta', 'year', 'thn', 'tahun_anggaran', 'tahunAnggaran'];
      for (var i = 0; i < keys.length; i++) {
        var v = u.searchParams.get(keys[i]);
        if (v && /^\d{4}$/.test(String(v).trim())) return String(v).trim();
      }
    } catch (e) { /* abaikan */ }

    // selected option in select
    try {
      var selects = document.querySelectorAll('select');
      for (var s = 0; s < selects.length; s++) {
        var sel = selects[s];
        var idx = sel.selectedIndex;
        if (idx >= 0 && sel.options && sel.options[idx]) {
          var txt = String(sel.options[idx].textContent || sel.options[idx].value || '').trim();
          if (/^\d{4}$/.test(txt)) return txt;
        }
      }
    } catch (e) { /* abaikan */ }

    // combobox / selected value
    try {
      var nodes = document.querySelectorAll('[role="combobox"], .ant-select-selection-item, .mat-select-value-text, .p-dropdown-label, .el-select .el-input__inner');
      for (var n = 0; n < nodes.length; n++) {
        var t = String(nodes[n].textContent || nodes[n].value || '').trim();
        if (/^\d{4}$/.test(t)) return t;
      }
    } catch (e) { /* abaikan */ }

    // text regex
    try {
      var body = document.body ? (document.body.innerText || '') : '';
      var m = body.match(/tahun\s*anggaran[^0-9]{0,20}(\d{4})/i);
      if (m) return m[1];
      m = body.match(/ta\.?\s*\:?\s*(\d{4})/i);
      if (m) return m[1];
    } catch (e) { /* abaikan */ }

    return null;
  }

  var IS_TOP = (function () {
    try { return window.top === window; } catch (e) { return false; }
  })();

  function sendToBackground(message) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(message, function (response) {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(response || { ok: true });
        });
      } catch (e) {
        resolve({ ok: false, error: String(e && e.message ? e.message : e) });
      }
    });
  }

  function notify(message) {
    try { chrome.runtime.sendMessage(message, function () { void chrome.runtime.lastError; }); } catch (e) { /* abaikan */ }
  }

  /* ---- 1. Terima data respons dari skrip utama ---- */
  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    var data = event.data;
    if (!data || data.__sipd !== true) return;
    if (data.kind === 'response') {
      sendToBackground({
        type: 'networkCapture',
        url: data.url,
        method: data.method,
        body: data.body,
        at: data.at,
        tahunAnggaran: detectTahunAnggaran()
      });
    }
  }, false);

  /* ---- 2. Bantu penarikan tabel HTML ---- */
  function tableSignature() {
    var tables = document.querySelectorAll('table');
    var parts = [];
    for (var i = 0; i < tables.length && i < 8; i++) {
      var text = tables[i].innerText || '';
      parts.push(text.length + ':' + text.slice(0, 400));
    }
    return parts.join('|');
  }

  function isDisabled(el) {
    if (!el) return true;
    if (el.disabled) return true;
    var cls = '';
    try {
      cls = (typeof el.className === 'string') ? el.className : (el.className && el.className.baseVal) || '';
    } catch (e) { cls = ''; }
    if (cls && /(^|[\s-])(disabled|is-disabled)([\s-]|$)/i.test(cls)) return true;
    if (el.getAttribute && (el.getAttribute('aria-disabled') === 'true' || el.hasAttribute('disabled'))) return true;
    return false;
  }

  function findNextButton() {
    var selectors = [
      'button[aria-label="Next page"]',
      'button[aria-label="Halaman berikutnya"]',
      '[aria-label*="next" i]',
      '.ant-pagination-next button',
      '.ant-pagination-next',
      'li[title="Next Page"]',
      'li[title="Berikutnya"]',
      'button.next',
      'a.next',
      '[class*="pagination"] [class*="next"]',
      '[class*="pager"] [class*="next"]'
    ];

    for (var i = 0; i < selectors.length; i++) {
      var nodes;
      try { nodes = document.querySelectorAll(selectors[i]); } catch (e) { continue; }
      for (var j = 0; j < nodes.length; j++) {
        var el = nodes[j];
        if (isDisabled(el)) continue;
        var parentLi = el.closest ? el.closest('li') : null;
        if (parentLi && parentLi !== el && isDisabled(parentLi)) continue;
        return el;
      }
    }

    var words = ['berikutnya', 'selanjutnya', 'next', '>', '›', '»'];
    var candidates = document.querySelectorAll('button,a,li,span,div[role="button"]');
    for (var k = 0; k < candidates.length; k++) {
      var node = candidates[k];
      var label = (node.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (!label || label.length > 24) continue;
      if (words.indexOf(label) === -1) continue;
      if (isDisabled(node)) continue;
      return node;
    }
    return null;
  }

  function countRows(tables) {
    return tables.reduce(function (sum, t) { return sum + (t.rows ? t.rows.length : 0); }, 0);
  }

  function waitForChange(before, timeoutMs) {
    return new Promise(function (resolve) {
      var start = Date.now();
      (function poll() {
        if (tableSignature() !== before) { resolve(true); return; }
        if (Date.now() - start > timeoutMs) { resolve(false); return; }
        setTimeout(poll, 300);
      })();
    });
  }

  function findItemsPerPageControl() {
    var labels = Array.prototype.slice.call(document.querySelectorAll('span,div,label,p,td,mat-label'))
      .filter(function (el) {
        var t = (el.textContent || '').replace(/\s+/g, ' ').trim();
        return t.length <= 40 && /(items? per page|baris per halaman|data per halaman|per halaman)/i.test(t);
      })
      .sort(function (a, b) { return (a.textContent || '').length - (b.textContent || '').length; });

    var selector = 'select,[role="combobox"],[role="listbox"],mat-select,.mat-select,.ng-select,.ant-select,.p-dropdown,.el-select,button';
    for (var i = 0; i < labels.length; i++) {
      var node = labels[i];
      for (var depth = 0; depth < 5 && node; depth++) {
        var found = node.querySelectorAll ? node.querySelectorAll(selector) : [];
        for (var j = 0; j < found.length; j++) {
          if (!isDisabled(found[j]) && /\d/.test(found[j].textContent || found[j].value || '')) return found[j];
        }
        node = node.parentElement;
      }
    }
    return null;
  }

  function setItemsPerPage(size) {
    var target = String(size);
    var control = findItemsPerPageControl();
    if (!control) return Promise.resolve({ ok: false, reason: 'Kontrol "Items per page" tidak ditemukan' });

    if (control.tagName === 'SELECT') {
      var opt = Array.prototype.slice.call(control.options).filter(function (o) {
        return (o.textContent || '').trim() === target || o.value === target;
      })[0];
      if (!opt) return Promise.resolve({ ok: false, reason: 'Opsi ' + target + ' tidak tersedia' });
      if (control.value === opt.value) return Promise.resolve({ ok: true, already: true });
      control.value = opt.value;
      control.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      if ((control.textContent || '').trim() === target) return Promise.resolve({ ok: true, already: true });
      var before = tableSignature();
      try { control.click(); } catch (e) { /* abaikan */ }

      return window.SIPDUtil.sleep(500).then(function () {
        var options = Array.prototype.slice.call(document.querySelectorAll(
          '[role="option"],mat-option,.mat-option,.ng-option,.ant-select-item-option,.p-dropdown-item,.el-select-dropdown__item,li,option'
        )).filter(function (el) {
          return (el.textContent || '').trim() === target && el.offsetParent !== null;
        });
        if (!options.length) {
          try { control.click(); } catch (e) { /* abaikan */ }
          return { ok: false, reason: 'Opsi ' + target + ' tidak muncul di daftar' };
        }
        try { options[0].click(); } catch (e) { /* abaikan */ }
        return waitForChange(before, 8000).then(function (changed) {
          return { ok: true, changed: changed };
        });
      });
    }
    return waitForChange(tableSignature(), 1).then(function () { return { ok: true }; });
  }

  function autoCollect(options) {
    options = options || {};
    var maxPages = Math.max(1, Math.min(500, options.maxPages || 50));
    var waitMs = Math.max(1000, Math.min(30000, options.waitMs || 5000));
    var page = 1;
    var totalRows = 0;

    function step() {
      if (page > maxPages) {
        notify({ type: 'progress', phase: 'done', page: page - 1, rows: totalRows, reason: 'Batas halaman tercapai' });
        return Promise.resolve({ ok: true, pages: page - 1, rows: totalRows });
      }

      var tables = window.SIPDExtract.scrapeTables(document);
      var payload = tables.map(function (t) {
        return { page: page, name: t.name, columns: t.columns, rows: t.rows };
      });

      var run = payload.length
        ? sendToBackground({
            type: 'saveDOM',
            url: location.href,
            label: (document.title || 'Tabel') + ' · hal. ' + page,
            page: page,
            tahunAnggaran: detectTahunAnggaran(),
            tables: payload
          })
        : Promise.resolve();

      return run.then(function () {
        var rowsOnPage = countRows(tables);
        totalRows += rowsOnPage;
        notify({ type: 'progress', phase: 'page', page: page, rows: rowsOnPage, total: totalRows, maxPages: maxPages });

        if (page >= maxPages) {
          notify({ type: 'progress', phase: 'done', page: page, rows: totalRows, reason: 'Batas halaman tercapai' });
          return { ok: true, pages: page, rows: totalRows };
        }

        var next = findNextButton();
        if (!next) {
          notify({ type: 'progress', phase: 'done', page: page, rows: totalRows, reason: 'Tombol halaman berikutnya tidak ditemukan' });
          return { ok: true, pages: page, rows: totalRows };
        }

        var before = tableSignature();
        try { next.click(); } catch (e) { /* abaikan */ }

        return waitForChange(before, waitMs).then(function (changed) {
          if (!changed) {
            notify({ type: 'progress', phase: 'done', page: page, rows: totalRows, reason: 'Data tidak berubah (mungkin sudah halaman terakhir)' });
            return { ok: true, pages: page, rows: totalRows };
          }
          page++;
          return window.SIPDUtil.sleep(600).then(step);
        });
      });
    }

    return window.SIPDUtil.sleep(400).then(function () {
      return setItemsPerPage(100);
    }).then(function (res) {
      notify({ type: 'progress', phase: 'pagesize', ok: !!(res && res.ok), reason: res && res.reason });
      return window.SIPDUtil.sleep(600);
    }).then(step);
  }

  /* ---- Otomatis: 100 data per halaman saat membuka halaman cascading ---- */
  var autoPageSizeFailures = 0;
  var autoPageSizeBusy = false;

  function isCascadingPath() {
    return /\/penganggaran\/(penganggaran\/)?anggaran\/cascading/i.test(location.pathname);
  }

  function currentPageSize() {
    var control = findItemsPerPageControl();
    if (!control) return null;
    var raw = control.tagName === 'SELECT' ? control.value : (control.textContent || '');
    var m = String(raw).match(/\d+/);
    return m ? m[0] : null;
  }

  function ensureMaxPageSize() {
    if (!IS_TOP || !isCascadingPath() || autoPageSizeBusy) return;
    if (autoPageSizeFailures >= 5) return;
    if (currentPageSize() === '100') { autoPageSizeFailures = 0; return; }
    if (!findItemsPerPageControl()) return;

    autoPageSizeBusy = true;
    setItemsPerPage(100).then(function (res) {
      if (res && res.ok) autoPageSizeFailures = 0;
      else autoPageSizeFailures++;
      notify({ type: 'progress', phase: 'pagesize', ok: !!(res && res.ok), reason: res && res.reason });
    }).catch(function () {
      autoPageSizeFailures++;
    }).then(function () {
      autoPageSizeBusy = false;
    });
  }

  var lastPath = location.pathname;
  ensureMaxPageSize();
  setInterval(function () {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      autoPageSizeFailures = 0;
    }
    ensureMaxPageSize();
  }, 1000);
  try {
    var mo = new MutationObserver(function () { ensureMaxPageSize(); });
    if (document.documentElement) mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) { /* abaikan */ }

  /* ---- 3. Perintah dari popup ---- */
  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || !message.type) return;

    if (message.type === 'ping') {
      sendResponse({ ok: true, url: location.href, title: document.title, top: IS_TOP });
      return true;
    }

    if (!IS_TOP) {
      sendResponse({ ok: false, error: 'Perintah hanya berlaku pada frame utama' });
      return true;
    }

    if (message.type === 'scrapeDOM') {
      try {
        var tables = window.SIPDExtract.scrapeTables(document);
        sendResponse({
          ok: true,
          url: location.href,
          title: document.title,
          tables: tables.map(function (t) { return { name: t.name, columns: t.columns, rows: t.rows }; })
        });
      } catch (e) {
        sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
      }
      return true;
    }

    if (message.type === 'setPageSize') {
      setItemsPerPage(message.size || 100)
        .then(function (res) { sendResponse(res && res.ok ? { ok: true, result: res } : { ok: false, error: (res && res.reason) || 'Gagal' }); })
        .catch(function (error) { sendResponse({ ok: false, error: String(error && error.message ? error.message : error) }); });
      return true;
    }

    if (message.type === 'autoCollect') {
      autoCollect(message)
        .then(function (result) { sendResponse({ ok: true, result: result }); })
        .catch(function (error) { sendResponse({ ok: false, error: String(error && error.message ? error.message : error) }); });
      return true;
    }

    return false;
  });
})();
