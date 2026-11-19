#!/usr/bin/env node
/* Uji mandiri: parser, deteksi kolom, dan penulis XLSX (tanpa browser). */
'use strict';

global.self = global;
require('../src/lib/util.js');
require('../src/lib/extract.js');
require('../src/lib/xlsx.js');

const fs = require('fs');
const os = require('os');
const path = require('path');

const E = global.SIPDExtract;
let failures = 0;

function check(label, condition, extra) {
  if (condition) {
    console.log('  ok   ' + label);
  } else {
    failures++;
    console.log('  FAIL ' + label + (extra ? ' → ' + extra : ''));
  }
}

console.log('\n[1] Deteksi array di dalam respons API');
const payload = {
  data: {
    total: 2,
    rows: [
      { id: 1, kode_skpd: '1.01.01', nama_skpd: 'Dinas Pendidikan', batas_pagu: '1.234.567.890,00', nama_sub_kegiatan: 'Belanja Alat Tulis' },
      { id: 2, kode_skpd: '1.01.01', nama_skpd: 'Dinas Pendidikan', batas_pagu: '2.000.000,00', nama_sub_kegiatan: 'Belanja Cetak' }
    ]
  }
};
const arrays = E.findArrays(payload);
check('menemukan 1 array', arrays.length === 1, JSON.stringify(arrays.map(a => a.path)));
check('path benar', arrays[0] && arrays[0].path === '$.data.rows', arrays[0] && arrays[0].path);

console.log('\n[2] Normalisasi & deteksi kolom');
const normalized = E.normalize(arrays[0].records);
const roles = E.detectRoles(normalized.columns, normalized.rows);
console.log('  kolom  :', normalized.columns.join(', '));
console.log('  peran  :', JSON.stringify(roles));
check('nama PD terdeteksi', roles.namaPD === 'nama_skpd', roles.namaPD);
check('pagu terdeteksi', roles.pagu === 'batas_pagu', roles.pagu);
check('rincian terdeteksi', roles.rincian === 'nama_sub_kegiatan', roles.rincian);

console.log('\n[3] Angka format Indonesia');
check('1.234.567.890,00', global.SIPDUtil.parseIndoNumber('1.234.567.890,00') === 1234567890);
check('Rp 2.000.000', global.SIPDUtil.parseIndoNumber('Rp 2.000.000') === 2000000);
check('1,234,567.89', global.SIPDUtil.parseIndoNumber('1,234,567.89') === 1234567.89);
check('"1.234" -> 1234', global.SIPDUtil.parseIndoNumber('1.234') === 1234);
check('teks biasa -> null', global.SIPDUtil.parseIndoNumber('Belanja Modal') === null);

console.log('\n[4] Penyusunan sheet laporan');
const sheets = E.buildSheets([
  { kind: 'api', url: 'https://contoh/api/cascading', path: '$.data.rows', label: 'data.rows', ts: Date.now(), columns: normalized.columns, rows: normalized.rows, count: 2 }
]);
check('laporan punya header + 2 baris', sheets.laporan.length === 3, String(sheets.laporan.length));
check('perangkat daerah 1 baris + header', sheets.perangkatDaerah.length === 2, String(sheets.perangkatDaerah.length));
check('total pagu diagregasi', sheets.perangkatDaerah[1][2] === 1236567890, String(sheets.perangkatDaerah[1] && sheets.perangkatDaerah[1][2]));
check('rincian belanja 2 baris + header', sheets.rincianBelanja.length === 3, String(sheets.rincianBelanja.length));

console.log('\n[5] Penulis XLSX');
const bytes = global.SIPDXlsx.build([
  { name: 'Laporan', rows: sheets.laporan },
  { name: 'Perangkat Daerah', rows: sheets.perangkatDaerah },
  { name: 'Rincian Belanja', rows: sheets.rincianBelanja },
  { name: 'Nama Sangat Panjang Sekali Melebihi Batas', rows: [['a', 'b'], [1, 2]] },
  { name: 'Laporan', rows: [['duplikat']] }
]);
const out = path.join(os.tmpdir(), 'sipd-scraper-selftest.xlsx');
fs.writeFileSync(out, Buffer.from(bytes));
console.log('  berkas :', out, bytes.length, 'byte');
check('ukuran wajar', bytes.length > 1000);

console.log('\n[6] Pemetaan kolom manual & cadangan rincian');
const caps = [{
  kind: 'api', url: 'https://contoh/api/cascading', path: '$.rows', label: 'rows',
  ts: Date.now(), count: 2,
  columns: ['kode_skpd', 'nama_skpd', 'pagu'],
  rows: [
    { kode_skpd: '1.01.01', nama_skpd: 'Dinas Pendidikan', pagu: '1.000' },
    { kode_skpd: '1.01.01', nama_skpd: 'Dinas Pendidikan', pagu: '2.000' }
  ]
}];
const tanpaRincian = E.buildSheets(caps);
check('tanpa kolom rincian → sheet rincian kosong', tanpaRincian.rincianBelanja.length === 1,
  String(tanpaRincian.rincianBelanja.length));

const mapUraian = E.buildSheets(caps, { rincian: 'nama_skpd' });
check('override manual terpakai', mapUraian.laporan[1][3] === 'Dinas Pendidikan', String(mapUraian.laporan[1][3]));
check('override mengisi sheet rincian', mapUraian.rincianBelanja.length === 3, String(mapUraian.rincianBelanja.length));

const capsSub = [{
  kind: 'api', url: 'u2', path: '$.rows', label: 'rows2', ts: Date.now(), count: 1,
  columns: ['nama_skpd', 'pagu', 'nama_sub_kegiatan'],
  rows: [{ nama_skpd: 'Dinas Kesehatan', pagu: '5.000', nama_sub_kegiatan: 'Belanja Obat' }]
}];
const cadangan = E.buildSheets(capsSub);
check('cadangan ke Sub Kegiatan', cadangan.rincianBelanja.length === 2, String(cadangan.rincianBelanja.length));

console.log('\n[7] Pemeriksa kolom & ringkasan otomatis');
const info = E.columnSamples(caps.concat(capsSub));
check('kolom terdaftar', info.length === 4, JSON.stringify(info.map(function (c) { return c.name; })));
check('contoh isi ada', info[1].samples.length > 0, JSON.stringify(info[1]));
console.log('  contoh :', JSON.stringify(info.slice(0, 4)));
const summary = E.autoRoleSummary(caps.concat(capsSub));
check('ringkasan otomatis mendeteksi namaPD', summary.namaPD === 'nama_skpd', JSON.stringify(summary));

console.log('\n[8] Kolom SIPD RI asli (cascading)');
const sipdRows = [{
  tahun: 2027, id_daerah: 284, id_skpd: 637, id_unit: 637,
  kode_skpd: '1.01.2.22.0.00.02.0000',
  nama_skpd: 'DINAS PENDIDIKAN DAN KEBUDAYAAN',
  total_giat: 133, belanja_terbuka: 133,
  set_pagu_skpd: 391847391023, set_pagu_giat: 339086710417,
  rinci_giat: 373675193043, rincian_terbuka: 133
}];
const sipdCaps = [{ kind: 'api', url: 'u', path: '$.data', label: 'data', ts: Date.now(), count: 1,
  columns: Object.keys(sipdRows[0]), rows: sipdRows }];
const sipdSheets = E.buildSheets(sipdCaps);
const sipdLap = sipdSheets.laporan[1];
console.log('  laporan:', JSON.stringify(sipdLap));
check('nama PD = nama_skpd', sipdLap[0] === 'DINAS PENDIDIKAN DAN KEBUDAYAAN', sipdLap[0]);
check('pagu = set_pagu_skpd', sipdLap[2] === 391847391023, String(sipdLap[2]));
check('rincian = rinci_giat', sipdLap[3] === 373675193043, String(sipdLap[3]));
check('sheet rincian belanja terisi', sipdSheets.rincianBelanja.length === 2, String(sipdSheets.rincianBelanja.length));
check('sheet perangkat daerah terisi', sipdSheets.perangkatDaerah.length === 2, String(sipdSheets.perangkatDaerah.length));

console.log('\n[9] Laporan memakai data terbaru bila ada beberapa tangkapan');
const oldCap = { kind: 'api', url: 'u', path: '$.d', label: 'lama', ts: 1000, count: 1,
  columns: ['nama_skpd', 'set_pagu_skpd', 'rinci_giat'],
  rows: [{ nama_skpd: 'DINAS X', set_pagu_skpd: 1000, rinci_giat: 400 }] };
const newCap = Object.assign({}, oldCap, { label: 'baru', ts: 2000,
  rows: [{ nama_skpd: 'DINAS X', set_pagu_skpd: 1000, rinci_giat: 1000 }] });
const rep = E.build3ColumnReport([oldCap, newCap]);
check('laporan memakai nilai terbaru (rincian 1000)', rep.rows[1][3] === 1000, JSON.stringify(rep.rows[1]));
check('tidak ada OPD ganda', rep.rows.length === 3, String(rep.rows.length));

console.log('\nHasil: ' + (failures === 0 ? 'SEMUA LULUS' : failures + ' GAGAL'));
process.exit(failures === 0 ? 0 : 1);
