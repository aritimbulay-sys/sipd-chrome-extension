(function () {
  'use strict';
  var urlInput = document.getElementById('serverUrl');
  var syncInput = document.getElementById('syncEnabled');
  var status = document.getElementById('status');

  chrome.storage.local.get({ serverUrl: '', syncEnabled: false }, function (items) {
    urlInput.value = items.serverUrl || '';
    syncInput.checked = !!items.syncEnabled;
  });

  document.getElementById('save').addEventListener('click', function () {
    var url = urlInput.value.trim().replace(/\/+$/, '');
    chrome.storage.local.set({ serverUrl: url, syncEnabled: syncInput.checked }, function () {
      status.textContent = 'Tersimpan. Sinkronisasi: ' + (syncInput.checked ? 'AKTIF' : 'NONAKTIF') +
        (url ? ' → ' + url : '');
      status.style.color = '#065f46';
    });
  });

  // Sinkronisasi manual: baca semua capture dari IndexedDB lalu POST ke server
  document.getElementById('syncNow').addEventListener('click', async () => {
    const status = document.getElementById('syncStatus');
    status.textContent = 'Membaca data lokal…';
    status.style.color = '#64748b';
    try {
      const cfg = await new Promise((resolve) => {
        chrome.storage.local.get({ serverUrl: '', syncEnabled: false }, resolve);
      });
      if (!cfg.serverUrl) {
        status.style.color = '#dc2626';
        status.textContent = 'Isi alamat server terlebih dahulu.';
        return;
      }
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('sipd-scraper', 1);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const tx = db.transaction('captures', 'readonly');
      const store = tx.objectStore('captures');
      const all = await new Promise((resolve, reject) => {
        const r = store.getAll();
        r.onsuccess = () => resolve(r.result || []);
        r.onerror = () => reject(r.error);
      });
      if (!all.length) {
        status.style.color = '#dc2626';
        status.textContent = 'Tidak ada data lokal untuk dikirim.';
        return;
      }
      status.textContent = 'Mengirim ' + all.length + ' data…';
      const url = cfg.serverUrl.replace(/\/+$/, '') + '/api/captures';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(all)
      });
      const data = await res.json();
      if (res.ok) {
        // kirim juga state selisih (stagnan)
        try {
          const st = await new Promise((resolve) => chrome.storage.local.get({ selisihState: {} }, (it) => resolve(it.selisihState || {})));
          if (Object.keys(st).length) {
            await fetch(cfg.serverUrl.replace(/\/+$/, '') + '/api/selisih-state', {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(st)
            });
          }
        } catch (e) {}
        status.style.color = '#065f46';
        status.textContent = 'Berhasil: ' + (data.added || 0) + ' data baru dikirim (total server: ' + data.total + ').';
      } else {
        status.style.color = '#dc2626';
        status.textContent = 'Gagal: ' + (data.error || res.status);
      }
    } catch (e) {
      status.style.color = '#dc2626';
      status.textContent = 'Error: ' + (e && e.message ? e.message : e);
    }
  });
})();
