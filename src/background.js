/* Service worker: menyimpan hasil tangkapan API & tabel HTML ke IndexedDB. */
importScripts('lib/util.js', 'lib/extract.js', 'lib/db.js');

var U = self.SIPDUtil;
var E = self.SIPDExtract;
var DB = self.SIPDDB;

var captureEnabled = true;
var seenHashes = new Set();
var lastBadgeText = '';

/* ---------------- pengaturan ---------------- */
chrome.storage.local.get({ captureEnabled: true }, function (items) {
  captureEnabled = items.captureEnabled !== false;
  updateBadge(true);
});

chrome.storage.onChanged.addListener(function (changes, area) {
  if (area === 'local' && changes.captureEnabled) {
    captureEnabled = changes.captureEnabled.newValue !== false;
  }
});

/* ---------------- tombol aktif hanya di halaman cascading ---------------- */
var CASCADING_URL = /^https:\/\/sipd-ri\.kemendagri\.go\.id\/penganggaran\/anggaran\/cascading(?:[?#/]|$)/i;

function syncActionForTab(tabId, url) {
  var enabled = CASCADING_URL.test(String(url || ''));
  try {
    if (enabled) chrome.action.enable(tabId);
    else chrome.action.disable(tabId);
  } catch (e) { /* abaikan */ }
}

function setupActionScope() {
  try { chrome.action.disable(); } catch (e) { /* abaikan */ }
  chrome.tabs.query({}, function (tabs) {
    (tabs || []).forEach(function (t) { syncActionForTab(t.id, t.url); });
  });
}

chrome.runtime.onInstalled.addListener(setupActionScope);
chrome.runtime.onStartup.addListener(setupActionScope);
setupActionScope();

chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
  if (changeInfo.url !== undefined || changeInfo.status === 'loading' || changeInfo.status === 'complete') {
    syncActionForTab(tabId, changeInfo.url || tab.url);
  }
});

chrome.tabs.onActivated.addListener(function (info) {
  chrome.tabs.get(info.tabId, function (tab) {
    if (tab) syncActionForTab(tab.id, tab.url);
  });
});

/* ---------------- badge ---------------- */
function updateBadge(force) {
  DB.all().then(function (all) {
    var rows = 0;
    (all || []).forEach(function (cap) { rows += cap.count || 0; });
    var text = '';
    if (rows > 0) {
      text = rows >= 1000 ? (Math.round(rows / 100) / 10) + 'k' : String(rows);
      if (text.length > 4) text = text.slice(0, 4);
    }
    if (force || text !== lastBadgeText) {
      lastBadgeText = text;
      try { chrome.action.setBadgeText({ text: text }); } catch (e) { /* abaikan */ }
      try { chrome.action.setBadgeBackgroundColor({ color: '#1d4ed8' }); } catch (e) { /* abaikan */ }
    }
  }).catch(function () { /* abaikan */ });
}

/* ---------------- penyimpanan ---------------- */
function trimText(value, max) {
  var s = value === null || value === undefined ? '' : String(value);
  return s.length > max ? s.slice(0, max) : s;
}

function rowSignature(rows, columns) {
  if (!rows || !rows.length) return '';
  var parts = rows.map(function (r) {
    return columns.map(function (c) { return trimText(r[c], 400); }).join('\u0001');
  });
  return U.hash(parts.join('\u0002'));
}

function isDuplicate(hash) {
  if (seenHashes.has(hash)) return Promise.resolve(true);
  return DB.findByHash(hash).then(function (existing) {
    if (existing) { seenHashes.add(hash); return true; }
    return false;
  }).catch(function () { return false; });
}

function saveCapture(record) {
  return DB.findByHash(record.hash).then(function (existing) {
    if (existing) {
      return DB.touch(existing.id, record.ts).then(function () { return { skipped: true }; });
    }
    return DB.add(record).then(function (id) {
      record.id = id;
      return { saved: true, id: id };
    });
  }).catch(function () { return { skipped: true }; });
}

function handleNetwork(message) {
  if (!captureEnabled) return Promise.resolve({ ok: true, disabled: true });
  if (message.at && Date.now() - message.at > 120000) return Promise.resolve({ ok: true, stale: true });

  var payload = E.parseJson(message.body);
  if (!payload || typeof payload !== 'object') return Promise.resolve({ ok: true, ignored: true });

  var candidates = E.findArrays(payload, { minLen: 1 });
  if (!candidates.length) return Promise.resolve({ ok: true, ignored: true });

  var saved = 0;
  var chain = Promise.resolve();

  candidates.forEach(function (candidate) {
    chain = chain.then(function () {
      var normalized = E.normalize(candidate.records);
      if (!normalized.rows.length) return null;
      if (normalized.columns.length < 2 && normalized.rows.length < 3) return null;

      var hash = U.hash([
        'api', message.url, candidate.path,
        normalized.columns.join(','), normalized.rows.length,
        rowSignature(normalized.rows, normalized.columns)
      ].join('|'));

      return saveCapture({
        kind: 'api',
        url: message.url,
        path: candidate.path,
        label: candidate.path.replace(/^\$\.?/, '') + ' · ' + U.shortUrl(message.url),
        method: message.method || 'GET',
        ts: Date.now(),
        columns: normalized.columns,
        rows: normalized.rows,
        count: normalized.rows.length,
        truncated: !!normalized.truncated,
        hash: hash
      }).then(function (res) { if (res.saved) saved++; });
    });
  });

  return chain.then(function () {
    if (saved) {
      updateBadge();
      DB.trim().catch(function () { /* abaikan */ });
    }
    return { ok: true, saved: saved };
  });
}

function handleDOM(message) {
  var tables = message.tables || [];
  var saved = 0;
  var chain = Promise.resolve();

  tables.forEach(function (table) {
    chain = chain.then(function () {
      var normalized = E.normalize(table.rows || []);
      if (!normalized.rows.length) return null;
      // kolom dari header tabel diprioritaskan bila masih relevan
      var columns = (table.columns || []).filter(function (c) { return normalized.columns.indexOf(c) !== -1; });
      normalized.columns.forEach(function (c) { if (columns.indexOf(c) === -1) columns.push(c); });

      var hash = U.hash([
        'dom', message.url, message.page || 1, table.name || '',
        columns.join(','), normalized.rows.length,
        rowSignature(normalized.rows, columns)
      ].join('|'));

      return saveCapture({
        kind: 'dom',
        url: message.url,
        path: table.name || 'Tabel',
        label: (message.label || table.name || 'Tabel') + (table.name ? ' [' + table.name + ']' : ''),
        page: message.page || 1,
        ts: Date.now(),
        columns: columns,
        rows: normalized.rows,
        count: normalized.rows.length,
        truncated: !!normalized.truncated,
        hash: hash
      }).then(function (res) { if (res.saved) saved++; });
    });
  });

  return chain.then(function () {
    if (saved) {
      updateBadge();
      DB.trim().catch(function () { /* abaikan */ });
    }
    return { ok: true, saved: saved };
  });
}

/* ---------------- pesan masuk ---------------- */
chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message || !message.type) return;

  if (message.type === 'networkCapture') {
    handleNetwork(message)
      .then(function (res) { sendResponse(res); })
      .catch(function (err) { sendResponse({ ok: false, error: String(err) }); });
    return true;
  }

  if (message.type === 'saveDOM') {
    handleDOM(message)
      .then(function (res) { sendResponse(res); })
      .catch(function (err) { sendResponse({ ok: false, error: String(err) }); });
    return true;
  }

  if (message.type === 'stats') {
    DB.all().then(function (all) {
      var rows = 0, api = 0, dom = 0;
      (all || []).forEach(function (cap) {
        rows += cap.count || 0;
        if (cap.kind === 'dom') dom++; else api++;
      });
      sendResponse({ ok: true, captures: (all || []).length, rows: rows, api: api, dom: dom });
    }).catch(function (err) { sendResponse({ ok: false, error: String(err) }); });
    return true;
  }

  if (message.type === 'reloadSipd') {
    chrome.tabs.query({ url: 'https://*.kemendagri.go.id/*' }, function (tabs) {
      if (!tabs || !tabs.length) {
        sendResponse({ ok: false, error: 'Tab SIPD tidak ditemukan. Buka halaman SIPD terlebih dahulu.' });
        return;
      }
      var target = tabs.filter(function (t) { return t.active; })[0] || tabs[0];
      chrome.tabs.reload(target.id, {}, function () {
        sendResponse({ ok: true, tabId: target.id });
      });
    });
    return true;
  }

  if (message.type === 'refreshBadge') {
    updateBadge(true);
    sendResponse({ ok: true });
    return true;
  }

  return false;
});

/* Bersihkan cache hash saat service worker hidup kembali. */
DB.all().then(function (all) {
  (all || []).forEach(function (cap) { if (cap.hash) seenHashes.add(cap.hash); });
}).catch(function () { /* abaikan */ });
