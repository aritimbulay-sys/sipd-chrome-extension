/* Parser & ekstraktor data SIPD — dipakai di service worker, content script, dan popup. */
(function (global) {
  'use strict';
  if (global.SIPDExtract) return;

  var U = global.SIPDUtil;
  var E = {};

  var MAX_RECORDS = 20000;
  var MAX_COLUMNS = 150;

  /* ------------------------------------------------------------------ *
   * 1. Penelusuran JSON: menemukan array-of-object di dalam respons API
   * ------------------------------------------------------------------ */

  function isObj(v) { return U.isObj(v); }
  E.isObj = isObj;

  E.parseJson = function (text) {
    if (typeof text !== 'string') return null;
    var s = text.trim();
    if (!s || (s.charAt(0) !== '{' && s.charAt(0) !== '[')) return null;
    try { return JSON.parse(s); } catch (e) { return null; }
  };

  E.findArrays = function (root, opts) {
    opts = opts || {};
    var maxDepth = opts.maxDepth || 10;
    var minLen = opts.minLen || 1;
    var found = [];
    var seen = {};
    var stack = [{ node: root, path: '$', depth: 0 }];

    while (stack.length) {
      var item = stack.pop();
      var node = item.node;
      if (node === null || node === undefined || item.depth > maxDepth) continue;

      if (Array.isArray(node)) {
        var objs = node.filter(isObj);
        var qualifies = node.length >= minLen && objs.length > 0 && objs.length >= Math.ceil(node.length * 0.5);
        if (qualifies) {
          if (!seen[item.path]) {
            seen[item.path] = true;
            found.push({ path: item.path, records: node.slice(0, MAX_RECORDS) });
          }
          continue;
        }
        for (var i = 0; i < Math.min(node.length, 60); i++) {
          if (node[i] && typeof node[i] === 'object') {
            stack.push({ node: node[i], path: item.path + '[' + i + ']', depth: item.depth + 1 });
          }
        }
        continue;
      }

      if (isObj(node)) {
        var keys = Object.keys(node);
        for (var k = 0; k < keys.length; k++) {
          var v = node[keys[k]];
          if (v && typeof v === 'object') {
            stack.push({ node: v, path: item.path + '.' + keys[k], depth: item.depth + 1 });
          }
        }
      }
    }

    found.sort(function (a, b) {
      var ka = a.records[0] ? Object.keys(a.records[0]).length : 0;
      var kb = b.records[0] ? Object.keys(b.records[0]).length : 0;
      return kb - ka;
    });
    return found;
  };

  /* ------------------------------------------------------------------ *
   * 2. Normalisasi record menjadi objek datar (flatten)
   * ------------------------------------------------------------------ */

  E.flatten = function (rec, prefix, out, depth) {
    out = out || {};
    depth = depth || 0;
    if (!isObj(rec) || depth > 4) return out;

    Object.keys(rec).forEach(function (key) {
      var v = rec[key];
      var name = prefix ? prefix + '.' + key : key;
      if (isObj(v)) {
        E.flatten(v, name, out, depth + 1);
      } else if (Array.isArray(v)) {
        if (!v.length) {
          out[name] = '';
        } else if (v.every(function (x) { return !isObj(x) && !Array.isArray(x); })) {
          out[name] = v.join(', ');
        } else {
          out[name] = U.truncate(JSON.stringify(v), 300);
        }
      } else {
        out[name] = v;
      }
    });
    return out;
  };

  E.normalize = function (records, columnLimit) {
    var limit = columnLimit || MAX_COLUMNS;
    var rows = [];
    for (var i = 0; i < records.length && i < MAX_RECORDS; i++) {
      var r = records[i];
      rows.push(isObj(r) ? E.flatten(r) : { nilai: r });
    }
    var columns = [];
    var seen = {};
    for (var ri = 0; ri < rows.length; ri++) {
      var keys = Object.keys(rows[ri]);
      for (var ki = 0; ki < keys.length; ki++) {
        var k = keys[ki];
        if (!seen[k]) {
          seen[k] = true;
          if (columns.length < limit) columns.push(k);
        }
      }
      if (columns.length >= limit) break;
    }
    return { columns: columns, rows: rows, truncated: records.length > MAX_RECORDS };
  };

  /* ------------------------------------------------------------------ *
   * 3. Deteksi kolom: Perangkat Daerah / Batasan Pagu / Rincian Belanja
   * ------------------------------------------------------------------ */

  var ROLES = [
    ['namaPD', [
      /nama.*(perangkat.?daerah|skpd|opd|dinas|badan|unit|sub.?unit)/i,
      /(perangkat.?daerah|skpd|opd|sub.?unit|unit|dinas|badan).*nama/i,
      /^(nama|nama_?skpd|skpd|unit|perangkat.?daerah|perangkat)$/i,
      /perangkat.?daerah/i
    ]],
    ['kodePD', [
      /kode.*(skpd|opd|perangkat|unit|sub.?unit)/i,
      /(skpd|opd|unit).*kode/i
    ]],
    ['pagu', [
      /(batas.?pagu|pagu)/i,
      /(alokasi|anggaran)/i,
      /(total|jumlah|nilai)/i
    ]],
    ['rincian', [
      /(nama|uraian|keterangan|rincian|rinci).*(belanja|rekening|akun|rincian|rinci|kegiatan|program|giat)/i,
      /(belanja|rekening|akun|kegiatan|program|giat).*(nama|uraian|rinci)/i,
      /^(rincian|rinci|uraian|nama_?belanja|nama_?rekening|rincian|belanja|akun|rinci_giat|rincian_giat)$/i
    ]],
    ['kodeRek', [
      /kode.*(rekening|akun|belanja)/i,
      /(rekening|akun).*kode/i
    ]],
    ['program', [/nama.?program/i, /^program$/i, /kode.?program/i]],
    ['kegiatan', [/nama.?kegiatan/i, /^kegiatan$/i, /kode.?kegiatan/i]],
    ['subKegiatan', [/sub.?kegiatan/i]],
    ['sumberDana', [/sumber.?dana/i]],
    ['tahun', [/tahun.?anggaran/i, /^tahun$/i]]
  ];

  var ROLE_LABELS = {
    namaPD: 'Nama Perangkat Daerah',
    kodePD: 'Kode Perangkat Daerah',
    pagu: 'Batasan Pagu SKPD',
    rincian: 'Rincian Belanja',
    kodeRek: 'Kode Rekening',
    program: 'Program',
    kegiatan: 'Kegiatan',
    subKegiatan: 'Sub Kegiatan',
    sumberDana: 'Sumber Dana',
    tahun: 'Tahun'
  };
  E.ROLE_LABELS = ROLE_LABELS;
  E.ROLE_ORDER = ROLES.map(function (r) { return r[0]; });

  function scoreColumn(col, patterns) {
    var c = String(col).toLowerCase();
    for (var i = 0; i < patterns.length; i++) {
      if (patterns[i].test(c)) return patterns.length - i;
    }
    return 0;
  }

  E.numericRatio = function (rows, col) {
    var n = 0, num = 0;
    var max = Math.min(rows.length, 60);
    for (var i = 0; i < max; i++) {
      var v = rows[i][col];
      if (v === null || v === undefined || v === '') continue;
      n++;
      if (U.parseIndoNumber(v) !== null) num++;
    }
    return n ? num / n : 0;
  };

  E.detectRoles = function (columns, rows, overrides) {
    rows = rows || [];
    var map = {};
    var used = {};

    ROLES.forEach(function (roleDef) {
      var role = roleDef[0];
      var patterns = roleDef[1];
      var best = null;
      var bestScore = 0;

      columns.forEach(function (col) {
        if (used[col]) return;
        var score = scoreColumn(col, patterns);
        if (score <= 0) return;

        if (role === 'pagu') score += E.numericRatio(rows, col) >= 0.7 ? 2 : 0;
        if (role === 'pagu' && /(skpd|batas)/i.test(col)) score += 2;
        if (role === 'namaPD' || role === 'rincian') score += E.numericRatio(rows, col) === 0 ? 1 : 0;
        if (role === 'rincian' && /(giat|rinci|belanja)/i.test(col)) score += 2;
        if (role === 'pagu' && /(validasi|inputan|set_pagu_giat)/i.test(col)) score -= 3;
        if (role === 'rincian' && /terbuka/i.test(col)) score -= 3;
        if (role === 'rincian' && /(rincian belanja$|rinci_giat|rincian_giat)/i.test(col)) score += 3;
        if (role === 'namaPD' && /perangkat/i.test(col)) score += 2;

        if (score > bestScore || (score === bestScore && best && col.length < best.length)) {
          best = col;
          bestScore = score;
        }
      });

      if (best) {
        map[role] = best;
        used[best] = true;
      }
    });

    if (map.pagu && E.numericRatio(rows, map.pagu) < 0.5) {
      var alternatif = null;
      columns.forEach(function (col) {
        if (used[col] && col !== map.pagu) return;
        if (!/(pagu|alokasi|anggaran|jumlah|total|nilai)/i.test(col)) return;
        if (E.numericRatio(rows, col) >= 0.8) {
          if (!alternatif || col.length < alternatif.length) alternatif = col;
        }
      });
      if (alternatif) map.pagu = alternatif;
    }

    if (!map.rincian) {
      var generik = [
        [/(^|[._])(uraian|keterangan|ket|rincian|rinci)(_?(belanja|rekening|akun|giat))?$/i],
        [/(^|[._])(nama|uraian|keterangan|ket|rinci)$/i],
        [/(uraian|keterangan|nama|rincian|rinci)/i]
      ];
      for (var gi = 0; gi < generik.length && !map.rincian; gi++) {
        for (var ci = 0; ci < columns.length; ci++) {
          var col2 = columns[ci];
          if (used[col2]) continue;
          if (!generik[gi][0].test(col2)) continue;
          if (E.numericRatio(rows, col2) > 0.2) continue;
          map.rincian = col2;
          used[col2] = true;
          break;
        }
      }
    }

    if (!map.rincian) {
      map.rincian = map.subKegiatan || map.kegiatan || map.program || undefined;
      if (!map.rincian) delete map.rincian;
    }

    if (overrides) {
      Object.keys(overrides).forEach(function (role) {
        var col = overrides[role];
        if (col && columns.indexOf(col) !== -1) map[role] = col;
      });
    }

    return map;
  };

  E.autoRoleSummary = function (captures) {
    var tally = {};
    (captures || []).forEach(function (cap) {
      var map = E.detectRoles(cap.columns || [], cap.rows || []);
      var weight = Math.max(1, cap.count || 1);
      Object.keys(map).forEach(function (role) {
        if (!map[role]) return;
        tally[role] = tally[role] || {};
        tally[role][map[role]] = (tally[role][map[role]] || 0) + weight;
      });
    });
    var out = {};
    Object.keys(tally).forEach(function (role) {
      var best = null;
      var bestN = 0;
      Object.keys(tally[role]).forEach(function (col) {
        if (tally[role][col] > bestN) { bestN = tally[role][col]; best = col; }
      });
      out[role] = best;
    });
    return out;
  };

  E.columnSamples = function (captures) {
    var index = {};
    var order = [];
    (captures || []).forEach(function (cap) {
      var cols = cap.columns || [];
      var rows = cap.rows || [];
      var scan = Math.min(rows.length, 500);
      cols.forEach(function (col) {
        if (!index[col]) {
          index[col] = { name: col, count: 0, samples: [] };
          order.push(col);
        }
        var entry = index[col];
        for (var i = 0; i < scan; i++) {
          var v = rows[i][col];
          if (v === null || v === undefined || v === '') continue;
          entry.count++;
          if (entry.samples.length < 3) {
            var s = U.truncate(String(v).replace(/\s+/g, ' '), 48);
            if (entry.samples.indexOf(s) === -1) entry.samples.push(s);
          }
        }
      });
    });
    return order.map(function (c) { return index[c]; });
  };

  /* ------------------------------------------------------------------ *
   * 4. Penyusunan sheet laporan
   * ------------------------------------------------------------------ */

  var LAPORAN_HEADER = [
    'Nama Perangkat Daerah', 'Kode', 'Batasan Pagu SKPD', 'Rincian Belanja',
    'Kode Rekening', 'Program', 'Kegiatan', 'Sub Kegiatan', 'Sumber Dana', 'Tahun', 'Sumber Data'
  ];
  var RINCIAN_HEADER = ['Nama Perangkat Daerah', 'Kode Rekening', 'Rincian Belanja', 'Pagu', 'Sumber Data'];
  var PD_HEADER = ['Nama Perangkat Daerah', 'Kode', 'Total Pagu (auto)', 'Jumlah Baris Rincian', 'Sumber Data'];
  var RINGKASAN_HEADER = ['Jenis', 'Sumber', 'Path/Sheet', 'Jumlah Baris', 'Waktu'];

  function pick(row, col) {
    if (!col) return '';
    var v = row[col];
    if (v === null || v === undefined) return '';
    return v;
  }

  function text(v) {
    if (v === null || v === undefined) return '';
    return String(v).trim();
  }

  E.buildSheets = function (captures, mapping) {
    mapping = mapping || {};
    var laporan = [LAPORAN_HEADER.slice()];
    var rincian = [RINCIAN_HEADER.slice()];
    var pdRows = [];
    var pdMap = {};
    var ringkasan = [RINGKASAN_HEADER.slice()];
    var mentahColumns = ['Sumber', 'Path', 'Baris'];
    var mentahSeen = {};
    var mentah = [];

    (captures || []).forEach(function (cap) {
      var rows = cap.rows || [];
      var columns = cap.columns || [];
      var label = cap.label || cap.url || 'data';
      var role = E.detectRoles(columns, rows, mapping);

      ringkasan.push([
        cap.kind === 'dom' ? 'Tabel Halaman' : 'Respons API',
        cap.url || label,
        cap.path || cap.label || '',
        rows.length,
        cap.ts ? new Date(cap.ts).toLocaleString('id-ID') : ''
      ]);

      columns.forEach(function (col) {
        var name = col;
        if (!mentahSeen[name]) {
          mentahSeen[name] = true;
          if (mentahColumns.length < 120) mentahColumns.push(name);
        }
      });

      var last = {};
      rows.forEach(function (row) {
        Object.keys(role).forEach(function (r) {
          var v = text(pick(row, role[r]));
          if (v) last[r] = v;
        });

        var nad = text(pick(row, role.namaPD)) || last.namaPD || '';
        var kode = text(pick(row, role.kodePD)) || last.kodePD || '';
        var paguRaw = pick(row, role.pagu);
        var paguNum = U.parseIndoNumber(paguRaw);
        var namaRincian = pick(row, role.rincian);
        var kodeRek = text(pick(row, role.kodeRek));
        var program = text(pick(row, role.program)) || last.program || '';
        var kegiatan = text(pick(row, role.kegiatan)) || last.kegiatan || '';
        var sub = text(pick(row, role.subKegiatan)) || last.subKegiatan || '';
        var dana = text(pick(row, role.sumberDana)) || last.sumberDana || '';
        var tahun = text(pick(row, role.tahun)) || last.tahun || '';

        if (nad || paguNum !== null || (namaRincian !== null && namaRincian !== undefined && namaRincian !== '') || kodeRek || program || kegiatan) {
          laporan.push([
            nad, kode, paguNum !== null ? paguNum : text(paguRaw), (namaRincian === null || namaRincian === undefined) ? '' : namaRincian,
            kodeRek, program, kegiatan, sub, dana, tahun, label
          ]);
        }

        if ((namaRincian !== null && namaRincian !== undefined && namaRincian !== '') || kodeRek) {
          rincian.push([nad, kodeRek, (namaRincian === null || namaRincian === undefined) ? '' : namaRincian, paguNum !== null ? paguNum : text(paguRaw), label]);
        }

        if (nad) {
          var key = (kode || '') + '|' + nad + '|' + label;
          if (!pdMap[key]) {
            pdMap[key] = { nad: nad, kode: kode, total: 0, count: 0, label: label };
            pdRows.push(pdMap[key]);
          }
          var agg = pdMap[key];
          if (paguNum !== null) agg.total += paguNum;
          if ((namaRincian !== null && namaRincian !== undefined && namaRincian !== '') || kodeRek) agg.count += 1;
        }

        var obj = { Sumber: cap.kind === 'dom' ? 'DOM' : 'API', Path: cap.path || cap.label || label };
        columns.forEach(function (col) {
          if (mentahColumns.indexOf(col) !== -1) {
            var v = pick(row, col);
            obj[col] = (v === null || v === undefined) ? '' : v;
          }
        });
        mentah.push(obj);
      });
    });

    var pdSheet = [PD_HEADER.slice()];
    pdRows.sort(function (a, b) {
      if (b.total !== a.total) return b.total - a.total;
      return String(a.nad).localeCompare(String(b.nad));
    });
    pdRows.forEach(function (p) {
      pdSheet.push([p.nad, p.kode, p.total, p.count, p.label]);
    });

    var mentahSheet = [mentahColumns.slice()];
    mentah.forEach(function (o) {
      mentahSheet.push(mentahColumns.map(function (c) { return o[c] === undefined ? '' : o[c]; }));
    });

    return {
      ringkasan: ringkasan,
      laporan: laporan,
      perangkatDaerah: pdSheet,
      rincianBelanja: rincian,
      mentah: mentahSheet
    };
  };

  /* ------------------------------------------------------------------ *
   * 5. Laporan ringkas 3 kolom
   * ------------------------------------------------------------------ */

  /* Kolom Pagu Validasi pada data SIPD: set_pagu_giat (API) atau "Pagu Validasi" (tabel). */
  function findPaguValidasiColumn(columns) {
    var exact = (columns || []).filter(function (c) { return /^set_pagu_giat$/i.test(String(c)); })[0];
    if (exact) return exact;
    return (columns || []).filter(function (c) { return /pagu.*validasi|validasi.*pagu/i.test(String(c)); })[0] || null;
  }

  function colValue(row, col) {
    if (!col) return '';
    var v = row[col];
    return v === null || v === undefined ? '' : v;
  }

  E.build3ColumnReport = function (captures) {
    var HEADER = ['NO', 'Perangkat Daerah', 'Batasan Pagu SKPD', 'Rincian Belanja', 'Selisih', 'Progres', 'Keterangan', 'Status Validasi'];
    var rows = [HEADER];
    var fill = [''];
    var seen = {};
    var totalPagu = 0;
    var totalRincian = 0;
    var no = 0;

    var newestFirst = (captures || []).slice().sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
    var listSkpd = newestFirst.filter(function (c) { return /list_skpd/i.test(String(c.url || '')); });
    var source = listSkpd.length ? [listSkpd[0]] : newestFirst;
    var yearCount = {};

    source.forEach(function (cap) {
      var columns = cap.columns || [];
      var recs = cap.rows || [];
      var role = E.detectRoles(columns, recs);
      var pvCol = findPaguValidasiColumn(columns);

      recs.forEach(function (r) {
        var nadRaw = pick(r, role.namaPD);
        var nad = text(nadRaw);
        if (!nad && role.kodePD) nad = text(pick(r, role.kodePD));
        if (!nad) return;

        var key = nad.toLowerCase().replace(/\s+/g, ' ');
        if (seen[key]) return;
        seen[key] = true;

        var paguRaw = pick(r, role.pagu);
        var paguNum = U.parseIndoNumber(paguRaw);
        var rincianRaw = pick(r, role.rincian);
        var rincianNum = U.parseIndoNumber(rincianRaw);
        if (paguNum === null && rincianNum === null) return;

        var yr = text(pick(r, role.tahun));
        if (yr) yearCount[yr] = (yearCount[yr] || 0) + 1;

        var selisih = (paguNum !== null && rincianNum !== null) ? rincianNum - paguNum : null;
        var progres = (paguNum !== null && rincianNum !== null && paguNum !== 0) ? E.floorProgres(rincianNum / paguNum) : null;
        var ket = E.keterangan(selisih);

        no++;
        var pvRaw = colValue(r, pvCol);
        var pvNum = U.parseIndoNumber(pvRaw);
        var statusVal = '';
        if (pvNum !== null && paguNum !== null && ket === 'Sudah Sesuai') {
          statusVal = Math.abs(pvNum - paguNum) < 0.005 ? 'Sudah Validasi' : 'Belum Validasi';
        }
        rows.push([
          no,
          nad,
          paguNum !== null ? paguNum : (paguRaw === null || paguRaw === undefined ? '' : paguRaw),
          rincianNum !== null ? rincianNum : (rincianRaw === null || rincianRaw === undefined ? '' : rincianRaw),
          selisih !== null ? selisih : '',
          progres !== null ? progres : '',
          ket,
          statusVal
        ]);
        fill.push(fillKey(ket));

        if (paguNum !== null) totalPagu += paguNum;
        if (rincianNum !== null) totalRincian += rincianNum;
      });
    });

    var totalSelisih = totalRincian - totalPagu;
    var totalProgres = totalPagu !== 0 ? E.floorProgres(totalRincian / totalPagu) : '';
    var totalKet = E.keterangan(totalSelisih);
    rows.push(['', 'TOTAL', totalPagu, totalRincian, totalSelisih, totalProgres, totalKet, '']);
    fill.push(fillKey(totalKet));
    var tahun = '';
    Object.keys(yearCount).forEach(function (y) {
      if (!tahun || yearCount[y] > yearCount[tahun]) tahun = y;
    });
    return { columns: HEADER.slice(), rows: rows, fill: fill, pctCols: [5], tahun: tahun };
  };

  /**
   * Progres dipotong (bukan dibulatkan) ke 4 desimal pecahan = 2 desimal persen.
   * Mencegah 99,995% tampil sebagai 100% saat selisih masih minus.
   */
  E.floorProgres = function (ratio) {
    if (typeof ratio !== 'number' || !isFinite(ratio)) return ratio;
    return Math.floor(ratio * 10000 + 1e-9) / 10000;
  };

  /**
   * Warna baris: 'hijau' untuk Sudah Sesuai, 'merah' untuk Lebih Input, kosong lainnya.
   */
  function fillKey(ket) {
    if (ket === 'Sudah Sesuai') return 'hijau';
    if (ket === 'Lebih Input') return 'merah';
    return '';
  }

  /**
   * Keterangan berdasarkan selisih (Rincian Belanja - Batasan Pagu SKPD):
   *   0        → Sudah Sesuai
   *   minus    → Kurang Input
   *   lebih>0  → Lebih Input
   */
  E.keterangan = function (selisih) {
    if (selisih === null || selisih === undefined || !isFinite(selisih)) return '';
    if (Math.abs(selisih) < 0.005) return 'Sudah Sesuai';
    if (selisih < 0) return 'Kurang Input';
    return 'Lebih Input';
  };

  /* ------------------------------------------------------------------ *
   * 6. Scraping tabel HTML (fallback bila API tidak tertangkap)
   * ------------------------------------------------------------------ */

  function tableToGrid(table) {
    var rows = Array.prototype.slice.call(table.rows || []);
    var grid = [];

    rows.forEach(function (tr, r) {
      if (!grid[r]) grid[r] = [];
      var c = 0;
      Array.prototype.slice.call(tr.cells).forEach(function (cell) {
        while (grid[r][c] !== undefined) c++;
        var txt = (cell.innerText || cell.textContent || '').replace(/\s+/g, ' ').trim();
        var rs = Math.max(1, cell.rowSpan || 1);
        var cs = Math.max(1, cell.colSpan || 1);
        for (var i = 0; i < rs; i++) {
          if (!grid[r + i]) grid[r + i] = [];
          for (var j = 0; j < cs; j++) {
            if (grid[r + i][c + j] === undefined) {
              grid[r + i][c + j] = (i === 0 && j === 0) ? txt : '';
            }
          }
        }
        c += cs;
      });
    });

    var width = grid.reduce(function (m, row) { return Math.max(m, row.length); }, 0);
    grid.forEach(function (row) {
      for (var i = 0; i < width; i++) {
        if (row[i] === undefined || row[i] === null) row[i] = '';
      }
      row.length = width;
    });
    return grid;
  }

  function describeTable(table, index) {
    if (table.caption && (table.caption.innerText || '').trim()) {
      return (table.caption.innerText || '').trim();
    }
    var el = table;
    for (var depth = 0; depth < 6 && el; depth++) {
      var prev = el.previousElementSibling;
      var guard = 0;
      while (prev && guard++ < 8) {
        var tag = prev.tagName ? prev.tagName.toLowerCase() : '';
        var txt = (prev.innerText || '').replace(/\s+/g, ' ').trim();
        if (txt && txt.length <= 70 && /^(h1|h2|h3|h4|h5|h6|label|caption|p|span|div)$/.test(tag)) {
          return txt;
        }
        prev = prev.previousElementSibling;
      }
      el = el.parentElement;
    }
    return 'Tabel ' + (index + 1);
  }

  E.scrapeTables = function (doc) {
    doc = doc || global.document;
    if (!doc) return [];
    var out = [];
    var tables = Array.prototype.slice.call(doc.querySelectorAll('table'));

    tables.forEach(function (table, index) {
      var grid = tableToGrid(table);
      if (grid.length < 2) return;

      var headCount = 1;
      if (table.tHead && table.tHead.rows.length) {
        headCount = Math.min(table.tHead.rows.length, grid.length - 1);
      }
      if (headCount < 1) headCount = 1;

      var headerRows = grid.slice(0, headCount);
      var ncols = grid[0] ? grid[0].length : 0;
      if (!ncols) return;

      var columns = [];
      for (var c = 0; c < ncols; c++) {
        var parts = [];
        headerRows.forEach(function (hr) {
          var v = (hr[c] || '').trim();
          if (v && parts.indexOf(v) === -1) parts.push(v);
        });
        var name = parts.join(' / ').trim() || ('Kolom ' + (c + 1));
        columns.push(name);
      }

      var counter = {};
      columns = columns.map(function (name) {
        if (counter[name] === undefined) { counter[name] = 0; return name; }
        counter[name] += 1;
        return name + ' (' + counter[name] + ')';
      });

      var rows = [];
      for (var r = headCount; r < grid.length; r++) {
        var cells = grid[r];
        if (!cells.some(function (v) { return String(v || '').trim() !== ''; })) continue;
        var obj = {};
        var hasData = false;
        for (var i = 0; i < columns.length; i++) {
          var value = String(cells[i] === undefined ? '' : cells[i]).trim();
          obj[columns[i]] = value;
          if (value) hasData = true;
        }
        if (hasData) rows.push(obj);
        if (rows.length >= MAX_RECORDS) break;
      }

      if (!rows.length) return;
      if (columns.length < 2) return;

      out.push({
        name: describeTable(table, index),
        columns: columns,
        rows: rows
      });
    });

    return out;
  };

  E.MAX_RECORDS = MAX_RECORDS;
  global.SIPDExtract = E;
})(typeof self !== 'undefined' ? self : this);
