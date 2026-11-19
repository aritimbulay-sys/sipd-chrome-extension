# SIPD Anggaran Scraper

Ekstensi Chrome (Manifest V3) untuk memantau progres input **Rincian Belanja** per Perangkat Daerah pada aplikasi SIPD RI (`sipd-ri.kemendagri.go.id`), lalu menampilkannya dalam laporan live yang bisa dicetak ke PDF atau diekspor ke Excel.

Data: **Nama Perangkat Daerah**, **Batasan Pagu SKPD**, **Rincian Belanja**, dengan kolom turunan **Selisih**, **Progres**, dan **Keterangan**.

## Fitur

- **Tombol aktif hanya di halaman cascading.** Di halaman lain ikon extension redup dan tidak bisa diklik. Chrome tidak mengizinkan ikon disembunyikan sepenuhnya.
- **Otomatis 100 data per halaman.** Saat halaman cascading dibuka, ekstensi memilih *Items per page = 100* sehingga semua OPD tampil dalam satu halaman.
- **Tangkapan data API.** Respons JSON dari SIPD (terutama `list_skpd`) ditangkap dan disimpan di IndexedDB browser. Data tidak dikirim ke server mana pun.
- **Laporan live.** Halaman laporan memeriksa data setiap 5 detik dan memperbarui tabel, ringkasan, dan judul saat ada perubahan.
- **Muat Ulang Data SIPD.** Memuat ulang tab SIPD agar data terbaru terambil.
- **Ekspor PDF dan Excel.** Warna baris: hijau untuk *Sudah Sesuai*, merah untuk *Lebih Input*.

## Aturan perhitungan

| Kolom | Rumus / aturan |
|---|---|
| Selisih | Rincian Belanja − Batasan Pagu SKPD |
| Progres | Rincian Belanja ÷ Batasan Pagu SKPD, dipotong (bukan dibulatkan) ke 2 desimal persen |
| Keterangan | Selisih = 0 → **Sudah Sesuai**; Selisih minus → **Kurang Input**; Selisih > 0 → **Lebih Input** |

Laporan memakai **satu tarikan terbaru** dari daftar OPD SIPD (`list_skpd`). Tahun di judul diambil dari kolom `tahun` pada data.

## Instalasi

1. Clone atau unduh repo ini.
2. Buka `chrome://extensions`.
3. Aktifkan **Developer mode** (kanan atas).
4. Klik **Load unpacked**, lalu pilih folder `sipd-scraper-extension` (folder yang berisi `manifest.json`).
5. Setiap kali kode berubah, klik ⟳ **Reload** pada kartu ekstensi, lalu tutup dan buka lagi tab yang terkait.

## Penggunaan

1. Buka `https://sipd-ri.kemendagri.go.id/penganggaran/anggaran/cascading` dan login.
2. Tunggu tabel tampil. Items per page akan diatur ke 100 secara otomatis.
3. Klik ikon extension, lalu pilih **Buka Laporan Live / PDF**.
4. Di laporan:
   - **Muat Ulang Data SIPD**: memuat ulang tab SIPD dan menunggu data baru.
   - **Cetak / Simpan PDF**: cetak atau simpan sebagai PDF (pilih *Save as PDF*).
5. Dari popup, **Unduh Laporan (Excel)** menghasilkan Excel ringkas, dan **Ekspor Lengkap (.xlsx)** menghasilkan semua sheet.

### Tombol lain di popup

- **Pindai Tabel Halaman**: menyimpan tabel yang sedang tampil.
- **Auto Kumpulkan Halaman…**: menekan tombol "halaman berikutnya" berulang kali dan menyimpan tiap halaman.
- **Atur 100 per Halaman**: mengatur Items per page ke 100 secara manual.
- **Pemetaan Kolom…**: memilih kolom sumber secara manual bila deteksi otomatis keliru.
- **Ekspor CSV**: mengekspor sheet yang sedang aktif.
- **Bersihkan**: menghapus semua data tersimpan.

## Diagnosa

- **Angka laporan belum berubah setelah SIPD diperbarui:** klik **Muat Ulang Data SIPD**, lalu tunggu beberapa detik. Jika perlu, klik **Bersihkan** di popup, lalu ulangi langkah di halaman SIPD.
- **Items per page belum 100:** pastikan halaman cascading sudah tampil penuh. Jika tetap gagal, gunakan **Atur 100 per Halaman** di popup dan periksa pesan statusnya.
- **Tombol ekstensi redup:** pastikan tab aktif berada di halaman cascading.
- **Error di extension:** buka `chrome://extensions`, klik **Errors** pada kartu ekstensi, atau **Inspect views: service worker** untuk log background.

## Pengembangan

Uji mandiri (parser, deteksi kolom, penulis XLSX, dan logika laporan):

```bash
node tools/selftest.js
```

Ikon PNG bisa dibuat ulang dengan:

```bash
python3 tools/make-icons.py
```

Uji UI popup memakai jsdom dan fake-indexeddb. Pasang keduanya di folder terpisah, lalu jalankan:

```bash
mkdir -p /tmp/sipd-smoke && cd /tmp/sipd-smoke && npm i jsdom fake-indexeddb
NODE_PATH=/tmp/sipd-smoke/node_modules node /path/ke/sipd-scraper-extension/tools/smoke-test.js
```

## Struktur

```
sipd-scraper-extension/
├── manifest.json
├── icons/                     ikon 16/32/48/128 px
├── src/
│   ├── inject.js              hook fetch & XHR di konteks halaman (MAIN world)
│   ├── bridge.js              jembatan halaman ↔ extension, scrape tabel, auto-halaman, 100 per halaman
│   ├── background.js          service worker: simpan tangkapan, badge, tombol aktif per halaman
│   ├── popup.html/.css/.js    antarmuka popup
│   ├── app.html               mode besar (tab penuh)
│   ├── report.html/.js        laporan live (PDF & pemantauan)
│   └── lib/
│       ├── util.js            parser angka format Indonesia, hash
│       ├── extract.js         penelusuran JSON, deteksi kolom, penyusun laporan
│       ├── db.js              IndexedDB
│       └── xlsx.js            penulis .xlsx (ZIP + OOXML, tanpa dependensi)
└── tools/                     selftest.js, smoke-test.js, make-icons.py
```

## Catatan keamanan

- Ekstensi hanya meminta akses ke domain `kemendagri.go.id`.
- Data hanya disimpan lokal di browser. Tidak ada pengiriman data ke server.
- Ekstensi tidak menyimpan kredensial login SIPD.
