# SIPD Scraper Extension — Versi 2

Ekstensi Chrome/Chromium untuk menarik data **Nama Perangkat Daerah**, **Batasan Pagu SKPD**, dan **Rincian Belanja** dari SIPD (host baru):

- Target halaman: `https://sipd.kemendagri.go.id/penganggaran/penganggaran/anggaran/cascading`

## Instalasi (Chrome & Chromium)

1. Buka `chrome://extensions` (atau `chromium://extensions`).
2. Aktifkan **Developer mode**.
3. Klik **Load unpacked**.
4. Pilih folder `sipd-scraper-extension-v2`.

## Fitur
- Tangkap data otomatis dari API `list_skpd`.
- Laporan live (PDF/PNG/Excel) dengan warna baris (hijau/merah).
- Badge Status Validasi dan Stagnan (3 jam).
- Auto-reload halaman cascading (aktif/nonaktif + interval menit).
- Sinkronisasi otomatis ke server web NAS (opsional, diatur di Options).

## Pengaturan server (NAS)
Klik kanan ikon ekstensi → **Options** → isi alamat server (contoh: `http://192.168.110.160:8090`) → centang sinkronisasi → Simpan.

## Catatan
- Versi ini menarget host `sipd.kemendagri.go.id` (bukan `sipd-ri.kemendagri.go.id`).
- Kompatibel dengan Chrome dan Chromium (Manifest V3).
EOF
echo done