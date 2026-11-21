# WA Suite

Dashboard multi-nomor WhatsApp Business. Satu nomor = satu sesi linked device.

## Lampiran bertanda tangan (PR 01)

Unduhan media memakai sesi dashboard dan URL HMAC berumur lima menit; `/media/<nama-file>` lama ditutup. Default `MEDIA_SIGNED_URLS_ENABLED=0` menonaktifkan unduhan dengan HTTP 503. Untuk canary sesudah review, pasang `MEDIA_SIGNED_URLS_ENABLED=1` dan `MEDIA_SIGNING_KEY` acak minimal 32 karakter melalui environment atau `.env` lokal. Jangan commit atau mencetak key. Kunci yang kosong/terlalu pendek menghentikan startup sebelum database dibuka bila flag aktif.

Sebelum startup versi baru, buat backup SQLite konsisten menggunakan SQLite backup API dari proses yang tidak mengimpor `src/db.js` (modul itu menjalankan migrasi). Contoh dari root repo:

```powershell
New-Item -ItemType Directory -Force backups | Out-Null
node --input-type=module -e "import Database from 'better-sqlite3'; const d=new Database('data/app.db',{readonly:true}); await d.backup('backups/pre-pr01.db'); d.close();"
node scripts/audit-media.mjs data/app.db --snapshot-test
```

Gunakan nama backup yang belum ada untuk setiap rilis, simpan backup di lokasi privat, lalu audit lagi sesudah migrasi pada target rilis. Script audit membuka source read-only dan menguji migrasi pada snapshot sementara. Query diagnosis: `scripts/sql/media-ownership-audit.sql`. Mismatch atau filename lintas nomor harus ditinjau sebelum rilis; tidak ada koreksi pemilik otomatis. Prosedur rollback, output test dan screenshot ada di [laporan PR 01](docs/pr01/REPORT.md), keputusan arsitektur di [ADR 0001](docs/adr/0001-signed-media-ownership.md).

## Backup
Otomatis harian jam BACKUP_HOUR, disimpan di BACKUP_DIR, disimpan BACKUP_KEEP terakhir.
Isi zip: app.db dan folder sessions. Set BACKUP_MEDIA=1 untuk ikut menyertakan media.
Zip berisi kredensial sesi: jangan diunggah ke tempat publik tanpa enkripsi.

Restore: matikan server, ekstrak zip menimpa folder data, jalankan npm start.
Jika ada app.db-wal atau app.db-shm lama, pindahkan keduanya sebelum restore database.
Penjadwal memakai timezone proses, diperiksa saat startup dan setiap 30 menit.
Jika server mati pada jam backup, backup dijalankan saat startup setelah jam tersebut.

## Jalan
HOST default 127.0.0.1. Akses dari HP memerlukan HOST=0.0.0.0.
TRUST_PROXY=1 hanya bila aplikasi berada di balik satu reverse proxy terpercaya.
SECURE_COOKIE=1 menambahkan atribut Secure pada cookie sesi sehingga browser hanya
mengirimnya melalui HTTPS; gunakan SECURE_COOKIE=0 untuk HTTP lokal.
PASS_MIN default 12 (minimal 12) berlaku saat mengganti password dan membuat agen.
Halaman Akun menyediakan ganti username, ganti password, dan keluar dari semua perangkat.
Keluar dari semua perangkat membatalkan seluruh sesi login dashboard akun tersebut.

Copy-Item .env.example .env   # ganti ADMIN_PASS
npm i
npm start                     # buka http://localhost:3000

## Memasang sebagai aplikasi
WA Suite bisa dipasang sebagai aplikasi (PWA). Browser hanya mengaktifkan service worker
dan tombol pasang di secure context: HTTPS, atau http://localhost di perangkat yang sama.

**Lewat http://IP-LAN (misal http://192.168.1.10:3000) tombol pasang tidak muncul dan
service worker tidak aktif.** Dashboard tetap bisa dipakai di browser, tetapi tidak bisa
dipasang dan tidak punya halaman offline. Pakai salah satu opsi HTTPS di bawah.

### Opsi A: Tailscale (disarankan)
1. Install Tailscale di laptop server dan di HP, login ke tailnet yang sama.
2. Di `.env` laptop: `HOST=127.0.0.1`, `SECURE_COOKIE=1`, `TRUST_PROXY=1`.
3. Jalankan `npm start`, lalu `tailscale serve --bg 3000`.
4. Di HP buka `https://<host>.<tailnet>.ts.net` (nama tampil di output `tailscale serve status`).
5. Chrome: menu titik tiga - Pasang aplikasi / Tambahkan ke layar utama,
   atau tombol unduh di rail dashboard.

Sertifikat dari Tailscale sudah dipercaya browser, jadi tidak perlu langkah tambahan.

### Opsi B: Caddy lokal
Caddyfile:

    wa.local {
        tls internal
        reverse_proxy localhost:3000
    }

Set `HOST=127.0.0.1`, `SECURE_COOKIE=1`, `TRUST_PROXY=1`, jalankan `caddy run`.
HP harus bisa me-resolve `wa.local` ke IP laptop (DNS router atau entri hosts), dan
**sertifikat root CA Caddy harus dipasang dan dipercaya di HP** (Android: Setelan -
Keamanan - Enkripsi & kredensial - Instal sertifikat CA). Root ada di folder data Caddy,
`pki/authorities/local/root.crt`. Tanpa itu Chrome menolak sertifikat dan PWA tidak aktif.

### Pembaruan
Service worker menyimpan aset di cache. Saat daftar aset shell berubah, naikkan versi `V`
di `public/sw.js`; `sw.js` disajikan dengan `Cache-Control: no-cache` agar versi baru
segera terambil.

## Alur
Login admin - + Nomor - masukkan nomor format 62 - salin pairing code -
di HP: WhatsApp Business - Perangkat tertaut - Tautkan dengan nomor telepon.
Sesi disimpan di data/sessions/<id>. Backup folder itu.

## Batas
- 1 nomor = 1 sesi, maksimal 4 linked device per nomor
- HP harus online; offline lebih dari 14 hari sesi lepas
- Unofficial client, risiko ban ada. Pakai delay, jangan blast nomor dingin
