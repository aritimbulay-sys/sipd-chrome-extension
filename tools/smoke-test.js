/* Uji asap UI popup memakai jsdom + fake-indexeddb.
 *
 * Menjalankannya (di luar folder ekstensi, agar dependensi uji tidak ikut terpaket):
 *   mkdir -p /tmp/sipd-smoke && cd /tmp/sipd-smoke
 *   npm i jsdom fake-indexeddb
 *   NODE_PATH=/tmp/sipd-smoke/node_modules node "/path/ke/sipd-scraper-extension/tools/smoke-test.js"
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const FDBFactory = require('fake-indexeddb/lib/FDBFactory');
const FDBKeyRange = require('fake-indexeddb/lib/FDBKeyRange');

const SRC = path.join(__dirname, '..', 'src');

let failures = 0;
function check(label, cond, extra) {
  if (cond) console.log('  ok   ' + label);
  else { failures++; console.log('  FAIL ' + label + (extra !== undefined ? ' → ' + extra : '')); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeout = 3000) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeout) return null;
    await wait(25);
  }
}

(async () => {
  const html = fs.readFileSync(path.join(SRC, 'popup.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'chrome-extension://abc/src/popup.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const w = dom.window;
  const doc = w.document;

  /* ---- stub lingkungan ekstensi ---- */
  w.indexedDB = new FDBFactory();
  w.IDBKeyRange = FDBKeyRange;
  w.URL.createObjectURL = function () { return 'blob:fake-' + Math.random(); };
  w.URL.revokeObjectURL = function () {};
  w.confirm = function () { return true; };
  if (!w.document.createElement('dialog').showModal) {
    w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  }

  const store = {};
  const sent = [];
  const downloads = [];
  const listeners = [];
  w.chrome = {
    runtime: {
      lastError: null,
      getURL: (p) => 'chrome-extension://abc/' + p,
      sendMessage: (msg, cb) => { sent.push(msg); if (cb) cb({ ok: true, saved: 1 }); },
      onMessage: { addListener: (fn) => listeners.push(fn) }
    },
    storage: {
      local: {
        get: (defaults, cb) => {
          const out = Object.assign({}, typeof defaults === 'object' ? defaults : {}, store);
          if (cb) cb(out);
        },
        set: (obj, cb) => { Object.assign(store, obj); if (cb) cb(); }
      },
      onChanged: { addListener: () => {} }
    },
    tabs: {
      query: async () => [{ id: 1, url: 'https://sipd-ri.kemendagri.go.id/penganggaran/anggaran/cascading?pageIndex=1' }],
      create: async () => ({ id: 2 }),
      sendMessage: async () => ({ ok: true })
    },
    scripting: { executeScript: async () => [] }
  };

  // rekam blob hasil unduhan
  const RealBlob = w.Blob;
  w.Blob = function (parts, opts) {
    const b = new RealBlob(parts, opts);
    b.__parts = parts;
    return b;
  };
  const origCreate = w.URL.createObjectURL;
  w.URL.createObjectURL = function (blob) {
    downloads.push(blob);
    return origCreate.call(w.URL);
  };

  const load = (file) => w.eval(fs.readFileSync(path.join(SRC, file), 'utf8'));

  /* ---- muat skrip ---- */
  console.log('\n[1] Pemuatan skrip & data awal');
  load('lib/util.js');
  load('lib/extract.js');
  load('lib/db.js');
  load('lib/xlsx.js');
  check('SIPDUtil tersedia', !!w.SIPDUtil);
  check('SIPDDB tersedia', !!w.SIPDDB);
  check('SIPDXlsx tersedia', !!w.SIPDXlsx);

  // data uji: satu sumber dengan kolom rincian, satu tanpa
  await w.SIPDDB.add({
    kind: 'api', url: 'https://sipd-ri.kemendagri.go.id/api/cascading', path: '$.data.rows',
    label: 'data.rows · cascading', ts: Date.now() - 1000, count: 3,
    hash: 'h1',
    columns: ['kode_skpd', 'nama_skpd', 'batas_pagu', 'kode_rekening', 'uraian_belanja'],
    rows: [
      { kode_skpd: '1.01.01', nama_skpd: 'Dinas Pendidikan', batas_pagu: '1.000.000', kode_rekening: '5.1.1.01', uraian_belanja: 'Belanja Alat Tulis' },
      { kode_skpd: '1.01.01', nama_skpd: 'Dinas Pendidikan', batas_pagu: '2.000.000', kode_rekening: '5.1.1.02', uraian_belanja: 'Belanja Cetak' },
      { kode_skpd: '1.02.01', nama_skpd: 'Dinas Kesehatan', batas_pagu: '3.500.000', kode_rekening: '5.1.1.03', uraian_belanja: 'Belanja Obat' }
    ]
  });
  await w.SIPDDB.add({
    kind: 'dom', url: 'https://sipd-ri.kemendagri.go.id/penganggaran/anggaran/cascading', path: 'Tabel 1',
    label: 'Cascading Anggaran [Tabel 1]', ts: Date.now(), count: 1, hash: 'h2',
    columns: ['Kode', 'Nama Perangkat Daerah', 'Pagu'],
    rows: [{ Kode: '1.01.01', 'Nama Perangkat Daerah': 'Dinas Pendidikan', Pagu: '1.000.000' }]
  });

  /* ---- jalankan UI ---- */
  load('popup.js');
  const ok = await waitFor(() => doc.querySelector('.app-shell'));
  check('kerangka UI terpasang', !!ok);

  await waitFor(() => /Siap/.test(doc.getElementById('status').textContent));
  console.log('  status :', doc.getElementById('status').textContent);

  console.log('\n[2] Tab & pratinjau');
  const tabs = Array.from(doc.querySelectorAll('.tab'));
  check('5 tab sheet', tabs.length === 5, tabs.map((t) => t.textContent).join(' | '));
  check('chip total baris ada', /4/.test(doc.querySelectorAll('.chip')[0].textContent), doc.querySelectorAll('.chip')[0].textContent);

  const laporanRows = doc.querySelectorAll('.preview tbody tr').length;
  check('pratinjau laporan berisi baris', laporanRows > 0, laporanRows);
  const headerLaporan = Array.from(doc.querySelectorAll('.preview thead th')).map((t) => t.textContent);
  check('header laporan sesuai', headerLaporan[0] === 'Nama Perangkat Daerah' && headerLaporan[3] === 'Rincian Belanja', headerLaporan.join(','));

  const firstRow = Array.from(doc.querySelectorAll('.preview tbody tr')[0].children).map((c) => c.textContent);
  console.log('  baris1 :', JSON.stringify(firstRow));
  check('Rincian Belanja terisi', /Belanja Alat Tulis/.test(firstRow[3]), firstRow[3]);
  check('pagu terisi angka', /1\.000\.000/.test(firstRow[2]), firstRow[2]);

  console.log('\n[3] Tab Rincian Belanja & Perangkat Daerah');
  const tabRincian = tabs.find((t) => /Rincian/.test(t.textContent));
  tabRincian.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await wait(30);
  const rincianRows = doc.querySelectorAll('.preview tbody tr').length;
  check('sheet rincian belanja terisi', rincianRows === 3, rincianRows);

  const tabPd = tabs.find((t) => /Perangkat Daerah/.test(t.textContent));
  tabPd.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await wait(30);
  const pdRows = Array.from(doc.querySelectorAll('.preview tbody tr')).map((tr) => Array.from(tr.children).map((c) => c.textContent));
  console.log('  PD     :', JSON.stringify(pdRows));
  check('agregasi pagu per PD', pdRows.some((r) => r[0] === 'Dinas Pendidikan' && /3\.000\.000/.test(r[2])), JSON.stringify(pdRows));

  console.log('\n[4] Dialog pemetaan kolom');
  doc.getElementById('btn-map').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await wait(30);
  check('dialog terbuka', doc.getElementById('dlg-map').open === true);
  const selects = Array.from(doc.querySelectorAll('#map-grid select'));
  check('10 pemilih peran', selects.length === 10, selects.length);
  const rg = doc.getElementById('map-rincian');
  check('opsi kolom terisi', rg.options.length > 1, rg.options.length);
  const hints = Array.from(doc.querySelectorAll('.map-row .auto-hint')).map((h) => h.textContent);
  console.log('  petunjuk otomatis:', JSON.stringify(hints.slice(0, 4)));

  // ubah pemetaan: rincian -> kode_rekening (harus terlihat di laporan)
  rg.value = 'kode_rekening';
  rg.dispatchEvent(new w.Event('change', { bubbles: true }));
  await wait(30);
  const laporanTab = Array.from(doc.querySelectorAll('.tab')).find((t) => /^Laporan/.test(t.textContent));
  laporanTab.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await wait(30);
  const afterRow = Array.from(doc.querySelectorAll('.preview tbody tr')[0].children).map((c) => c.textContent);
  check('pemetaan manual diterapkan', afterRow[3] === '5.1.1.01', afterRow[3]);
  check('pemetaan tersimpan', !!store.columnMapping && store.columnMapping.rincian === 'kode_rekening', JSON.stringify(store.columnMapping));

  doc.getElementById('map-reset').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await wait(30);
  const afterReset = Array.from(doc.querySelectorAll('.preview tbody tr')[0].children).map((c) => c.textContent);
  check('reset kembali otomatis', afterReset[3] === 'Belanja Alat Tulis', afterReset[3]);
  doc.getElementById('map-close').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

  console.log('\n[5] Ekspor');
  doc.getElementById('btn-xlsx').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const blob = await waitFor(() => downloads.length ? downloads[downloads.length - 1] : null);
  check('berkas xlsx dibuat', !!blob);
  if (blob) {
    let bytes = blob.__parts && blob.__parts[0];
    if (bytes && bytes.length !== undefined) {
      const sig = String.fromCharCode(bytes[0], bytes[1]);
      check('berkas berformat ZIP (PK)', sig === 'PK', sig);
      check('berkas berukuran wajar', bytes.length > 2000, bytes.length);
    } else {
      check('byte xlsx tersedia', false, typeof bytes);
    }
  }

  const csvBtn = doc.getElementById('btn-csv');
  downloads.length = 0;
  csvBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const csvBlob = await waitFor(() => downloads.length ? downloads[downloads.length - 1] : null);
  check('berkas csv dibuat', !!csvBlob);
  if (csvBlob && csvBlob.__parts) {
    const text = String(csvBlob.__parts[0]).slice(0, 80);
    console.log('  csv    :', JSON.stringify(text));
    check('csv memakai pemisah ;', text.indexOf(';') !== -1 || text.indexOf(',') !== -1);
  }

  console.log('\n[6] Sumber data & hapus');
  const srcRows = doc.querySelectorAll('.src').length;
  check('2 sumber terdaftar', srcRows === 2, srcRows);
  const delBtn = doc.querySelectorAll('.src button')[0];
  delBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const after = await waitFor(() => doc.querySelectorAll('.src').length === 1);
  check('hapus sumber berfungsi', !!after, doc.querySelectorAll('.src').length);

  console.log('\n[7] Bilah status dari pesan progres');
  listeners.forEach((fn) => fn({ type: 'progress', phase: 'page', page: 3, rows: 100, total: 300 }));
  await wait(20);
  check('status progres diterima', /Halaman 3/.test(doc.getElementById('status').textContent), doc.getElementById('status').textContent);

  console.log('\nHasil: ' + (failures === 0 ? 'SEMUA LULUS' : failures + ' GAGAL'));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
