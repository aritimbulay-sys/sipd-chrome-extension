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
})();