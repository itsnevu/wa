# WA Suite

Dashboard multi-nomor WhatsApp Business. Satu nomor = satu sesi linked device.

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
SECURE_COOKIE=1 untuk akses HTTPS. Ubah password lewat halaman Akun.

Copy-Item .env.example .env   # ganti ADMIN_PASS
npm i
npm start                     # buka http://localhost:3000

## Alur
Login admin - + Nomor - masukkan nomor format 62 - salin pairing code -
di HP: WhatsApp Business - Perangkat tertaut - Tautkan dengan nomor telepon.
Sesi disimpan di data/sessions/<id>. Backup folder itu.

## Batas
- 1 nomor = 1 sesi, maksimal 4 linked device per nomor
- HP harus online; offline lebih dari 14 hari sesi lepas
- Unofficial client, risiko ban ada. Pakai delay, jangan blast nomor dingin
