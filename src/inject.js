/* Dijalankan di konteks halaman (MAIN world) untuk menangkap respons API SIPD. */
(function () {
  'use strict';
  if (window.__SIPD_HOOKED__) return;
  window.__SIPD_HOOKED__ = true;

  var MAX_BODY = 8 * 1024 * 1024; // 8 MB per respons
  var ASSET = /\.(js|css|png|jpe?g|gif|svg|ico|woff2?|ttf|eot|map|webp|avif|mp4|pdf)(\?|#|$)/i;

  function absolute(url) {
    try { return new URL(String(url), location.href).href; } catch (e) { return String(url); }
  }

  function post(url, method, body) {
    if (!body || body.length > MAX_BODY) return;
    var trimmed = body.trim();
    if (!trimmed) return;
    var first = trimmed.charAt(0);
    if (first !== '{' && first !== '[') return; // hanya JSON
    try {
      window.postMessage({
        __sipd: true,
        kind: 'response',
        url: absolute(url),
        method: String(method || 'GET').toUpperCase(),
        body: trimmed,
        at: Date.now()
      }, '*');
    } catch (e) { /* abaikan */ }
  }

  function isInteresting(url) {
    if (!url) return false;
    var u = String(url);
    if (ASSET.test(u)) return false;
    if (/^\s*(data|blob):/i.test(u)) return false;
    return true;
  }

  /* ---------------- fetch ---------------- */
  var nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function' && !nativeFetch.__sipdWrapped) {
    var wrapped = function (input, init) {
      var url = '';
      var method = 'GET';
      try {
        if (typeof input === 'string') {
          url = input;
        } else if (input && typeof input === 'object') {
          url = input.url || '';
          method = (init && init.method) || input.method || 'GET';
        }
        if (init && init.method) method = init.method;
      } catch (e) { /* abaikan */ }

      var promise = nativeFetch.apply(this, arguments);
      try {
        return promise.then(function (response) {
          try {
            if (isInteresting(url) && response && typeof response.clone === 'function') {
              var ct = '';
              try { ct = response.headers.get('content-type') || ''; } catch (e) { ct = ''; }
              if (!ct || /json|text|javascript/i.test(ct)) {
                var clone = response.clone();
                clone.text().then(function (text) { post(url, method, text); }).catch(function () {});
              }
            }
          } catch (e) { /* abaikan */ }
          return response;
        });
      } catch (e) {
        return promise;
      }
    };
    wrapped.__sipdWrapped = true;
    window.fetch = wrapped;
  }

  /* ---------------- XMLHttpRequest ---------------- */
  var XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype && !XHR.prototype.__sipdWrapped) {
    var nativeOpen = XHR.prototype.open;
    var nativeSend = XHR.prototype.send;

    XHR.prototype.open = function (method, url) {
      try {
        this.__sipdInfo = { method: method, url: url };
      } catch (e) { /* abaikan */ }
      return nativeOpen.apply(this, arguments);
    };

    XHR.prototype.send = function () {
      var xhr = this;
      try {
        xhr.addEventListener('load', function () {
          try {
            var info = xhr.__sipdInfo || {};
            if (!isInteresting(info.url)) return;
            var type = xhr.responseType;
            var text = null;
            if (!type || type === 'text') {
              text = xhr.responseText;
            } else if (type === 'json' && xhr.response) {
              text = JSON.stringify(xhr.response);
            }
            if (text) post(info.url, info.method, text);
          } catch (e) { /* abaikan */ }
        });
      } catch (e) { /* abaikan */ }
      return nativeSend.apply(this, arguments);
    };

    XHR.prototype.__sipdWrapped = true;
  }
})();
