# SIPD Anggaran Scraper (Chrome Extension)

Ekstensi Manifest V3 untuk menarik data dari SIPD RI (`sipd-ri.kemendagri.go.id`) dan mengekspornya ke Excel/CSV:

- **Nama Perangkat Daerah**
- **Batasan Pagu SKPD**
- **Rincian Belanja**

Data diambil dengan dua cara sekaligus:

1. **Tangkapan API** — skrip disuntikkan ke konteks halaman dan membungkus `fetch` + `XMLHttpRequest`, lalu menyimpan setiap respons JSON yang berisi array objek.
2. **Pindai tabel HTML** — membaca tabel yang tampil di layar, termasuk `rowspan`/`colspan` dan header bertingkat.

Semua data disimpan lokal di IndexedDB browser, tidak dikirim ke mana pun.

## Instalasi

1. Buka `chrome://extensions`
2. Aktifkan **Developer mode** (kanan atas)
3. Klik **Load unpacked**, pilih folder `sipd-scraper-extension`
4. **Setiap kali kode diubah:** klik ikon ⟳ (Reload) pada kartu ekstensi, lalu tutup–buka ulang popup

## Penggunaan

1. Buka halaman SIPD, mis. `https://sipd-ri.kemendagri.go.id/penganggaran/anggaran/cascading`, lalu login.
2. Tampilkan daftar yang diinginkan (atur **pageSize** ke maksimum).
3. Klik ikon ekstensi:
   - **Pindai Tabel Halaman** — menyimpan tabel yang sedang tampil.
   - **Auto Kumpulkan Halaman…** — menekan tombol “halaman berikutnya” berulang kali dan menyimpan tiap halaman.
   - **Unduh PDF** — membuka laporan 3 kolom (Perangkat Daerah, Batasan Pagu SKPD, Rincian Belanja) dan mencetak/menyimpan sebagai PDF.
   - **Unduh Laporan (Excel)** — mengunduh Excel ringkas 3 kolom + baris TOTAL.
   - **Pemetaan Kolom…** — menentukan kolom mana yang menjadi Perangkat Daerah / Pagu / Rincian Belanja.
   - **Muat Ulang** — memuat ulang daftar sumber dari penyimpanan.
   - **Ekspor Lengkap (.xlsx)** — mengekspor semua sheet (Laporan, Perangkat Daerah, Rincian Belanja, Ringkasan, Data Mentah).
   - **Ekspor CSV** — mengekspor sheet yang sedang aktif.

## Sheet hasil ekspor

| Sheet | Isi |
|---|---|
| Laporan | Gabungan: Nama PD, Kode, Batasan Pagu SKPD, Rincian Belanja, Kode Rekening, Program, Kegiatan, Sub Kegiatan, Sumber Dana, Tahun, Sumber Data |
| Perangkat Daerah | Daftar unik perangkat daerah + total pagu (hasil penjumlahan otomatis) |
| Rincian Belanja | Baris yang memiliki rincian/rekening beserta pagunya |
| Ringkasan | Daftar sumber data yang tertangkap |
| Data Mentah | Seluruh kolom mentah dari sumber API & tabel HTML |

## Kolom “Rincian Belanja” kosong?

Penyebab paling umum: **sumber yang tertangkap belum memuat baris rincian**.

Halaman *cascading* biasanya menampilkan level **Perangkat Daerah** (nama PD + batas pagu) saja.
Baris rincian (belanja/rekening/sub kegiatan) baru muncul setelah:

- baris PD **dikembangkan** (expand) sehingga tampil anak barisnya, atau
- filter/level tampilan diubah ke **Sub Kegiatan / Belanja / Rekening**.

Langkah perbaikan:

1. Buka **Pemetaan Kolom…** → klik **Kembalikan ke Otomatis** (menghapus pemetaan lama yang mungkin salah).
2. Klik **Muat Ulang**.
3. Cek tab **Laporan** — kolom Rincian Belanja seharusnya terisi (nilai `rinci_giat`).

Kolom yang tersedia pada halaman ini (otomatis dikenali sekarang):

| Kolom SIPD | Dipetakan ke |
|---|---|
| Perangkat Daerah (gabungan kode + nama) | Nama Perangkat Daerah |
| Batasan Pagu SKPD | Batasan Pagu SKPD |
| Rincian Belanja | Rincian Belanja |
| Pagu Validasi / Inputan Pagu | (diabaikan, agar tidak tertukar) |
| Rincian Belanja Terbuka | (diabaikan, agar tidak tertukar) |

Catatan: bila kolom rincian masih kosong, pastikan sumber data yang dipakai adalah yang terbaru (klik **Pindai Tabel Halaman** setelah halaman tampil penuh), lalu ulangi langkah 1–2.

Deteksi otomatis juga sudah diperkuat: bila kolom `uraian`/`nama`/`keterangan` tidak ada, sistem turun memakai Sub Kegiatan → Kegiatan → Program sebagai isi Rincian Belanja.

## Diagnosa

- **Tidak ada sumber API?** Perekaman otomatis hanya menangkap respons setelah ekstensi terpasang. Muat ulang halaman SIPD (F5) setelah memasang/menekan Reload ekstensi agar hook terpasang sejak awal.
- **Tabel tidak terbaca?** Pastikan daftar sudah benar-benar tampil di layar (bukan masih memuat).
- **Perekaman otomatis dimatikan?** Toggle di kanan atas header popup.
- **Periksa pesan galat:** `chrome://extensions` → kartu ekstensi → **Errors**, dan **Inspect views: service worker**.

## Pengembangan

```bash
cd sipd-scraper-extension
node tools/selftest.js      # uji parser, deteksi kolom, dan penulis XLSX
python3 tools/make-icons.py # membuat ulang ikon PNG
```

Uji UI (perlu jsdom + fake-indexeddb, jalankan di folder terpisah):

```bash
mkdir -p /tmp/sipd-smoke && cd /tmp/sipd-smoke && npm i jsdom fake-indexeddb
NODE_PATH=/tmp/sipd-smoke/node_modules node "/path/ke/sipd-scraper-extension/tools/smoke-test.js"
```

Struktur:

```
sipd-scraper-extension/
├── manifest.json
├── icons/                 ikon 16/32/48/128 px
├── src/
│   ├── inject.js          hook fetch & XHR di konteks halaman (MAIN world)
│   ├── bridge.js          jembatan pesan halaman ↔ ekstensi, scrape tabel, auto-halaman
│   ├── background.js      service worker: simpan ke IndexedDB, badge
│   ├── popup.html/.css/.js    antarmuka
│   ├── app.html           mode besar (tab penuh)
│   └── lib/
│       ├── util.js        parser angka format Indonesia, hash
│       ├── extract.js     penelusuran JSON, deteksi & pemetaan kolom, penyusun laporan
│       ├── db.js          IndexedDB
│       └── xlsx.js        penulis .xlsx (ZIP + OOXML, tanpa dependensi)
└── tools/                 skrip bantu (selftest.js, smoke-test.js, make-icons.py)
```
