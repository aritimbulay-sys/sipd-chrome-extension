/* Penyimpanan hasil tarikan memakai IndexedDB (dipakai service worker & popup). */
(function (global) {
  'use strict';
  if (global.SIPDDB) return;

  var DB_NAME = 'sipd-scraper';
  var DB_VERSION = 1;
  var STORE = 'captures';
  var MAX_CAPTURES = 800;

  var dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          var store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
          store.createIndex('ts', 'ts');
          store.createIndex('hash', 'hash');
          store.createIndex('kind', 'kind');
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }

  function tx(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, mode);
        var store = t.objectStore(STORE);
        var result;
        try {
          result = fn(store);
        } catch (e) {
          reject(e);
          return;
        }
        t.oncomplete = function () { resolve(result && result.__req ? result.__req.result : result); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
      });
    });
  }

  var DB = {};

  DB.add = function (record) {
    return tx('readwrite', function (store) {
      var req = store.add(record);
      return { __req: req };
    });
  };

  DB.all = function () {
    return tx('readonly', function (store) {
      var req = store.getAll();
      return { __req: req };
    });
  };

  DB.count = function () {
    return tx('readonly', function (store) {
      var req = store.count();
      return { __req: req };
    });
  };

  DB.findByHash = function (hash) {
    return tx('readonly', function (store) {
      var req = store.index('hash').get(hash);
      return { __req: req };
    });
  };

  DB.touch = function (id, ts) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, 'readwrite');
        var store = t.objectStore(STORE);
        var req = store.get(id);
        req.onsuccess = function () {
          var rec = req.result;
          if (rec) {
            rec.ts = ts;
            store.put(rec);
          }
        };
        t.oncomplete = function () { resolve(); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
      });
    });
  };

  DB.remove = function (id) {
    return tx('readwrite', function (store) {
      store.delete(id);
    });
  };

  DB.clear = function () {
    return tx('readwrite', function (store) {
      store.clear();
    });
  };

  /* Buang data terlama bila melebihi batas. */
  DB.trim = function (max) {
    max = max || MAX_CAPTURES;
    return DB.all().then(function (all) {
      if (!all || all.length <= max) return 0;
      all.sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
      var drop = all.slice(0, all.length - max);
      return Promise.all(drop.map(function (r) { return DB.remove(r.id); })).then(function () {
        return drop.length;
      });
    });
  };

  DB.MAX_CAPTURES = MAX_CAPTURES;
  global.SIPDDB = DB;
})(typeof self !== 'undefined' ? self : this);
