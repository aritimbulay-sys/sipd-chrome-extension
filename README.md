# SIPD Scraper Extension — Versi 3

Ekstensi Chrome/Chromium untuk menarik data **Nama Perangkat Daerah**, **Batasan Pagu SKPD**, dan **Rincian Belanja** dari SIPD.

Target halaman: `https://sipd.kemendagri.go.id/penganggaran/penganggaran/anggaran/cascading`

## Fitur baru v3
- Otomatis set 100 data per halaman saat membuka halaman cascading.
- Hanya **Perangkat Daerah induk** yang dihitung; unit SKPD (anak) di bawahnya tidak dihitung sebagai OPD terpisah.
- Semua fitur v2 (sinkronisasi NAS, ganti password, laporan, dll).

## Instalasi
1. Buka `chrome://extensions` / `chromium://extensions`.
2. Aktifkan **Developer mode**.
3. **Load unpacked** → pilih folder `sipd-scraper-extension-v3`.

## Catatan
- Filter unit SKPD bekerja otomatis. Jika kolom "unit"/"sub unit" tersedia di data, baris dengan nilai tersebut di-skip. Jika tidak, filter fallback ke kata kunci (Sekretariat, Bidang, UPT, dll).
EOF
echo done