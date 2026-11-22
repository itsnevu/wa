# Runbook operasional WA Suite

Ringkas, untuk operator. Semua perintah dari folder repo.

## Cek kesehatan
- `GET /api/health` → proses hidup (`schema_version`, `schema_ddl_hash`).
- `GET /api/ready` → 200 bila database terbuka dan skema sesuai versi kode; 503 + `reasons` bila belum.
  Metrik: `queue_depth`, `drops_by_reason`, `oldest_pending_job_age_ms`, `running_jobs`.

## Menghentikan server dengan aman
Kirim SIGINT/SIGTERM (Ctrl+C). Server berhenti menerima request, menunggu request dan job berjalan,
melakukan `wal_checkpoint(TRUNCATE)`, menutup database, lalu keluar 0. Bila macet > 10 detik → keluar 1.
Kunci `data/app.db.lock` dari proses yang sudah mati diambil alih otomatis saat start berikutnya.

## Migrasi skema (maintenance)
1. Hentikan server (lihat di atas); pastikan tidak ada proses yang memegang `data/app.db.lock`.
2. Backup eksplisit (online, terverifikasi):
   `node -e "const D=require('better-sqlite3');const s=new D('data/app.db',{readonly:true});s.backup('data/migration-backups/pre-manual.sqlite').then(()=>s.close())"`
3. Gladi di salinan: salin backup ke folder lain, `DATA_DIR=<salinan> ALLOW_AUTO_MIGRATE=1 node scripts/migrate-schema.mjs`.
4. Produksi: `ALLOW_AUTO_MIGRATE=1 node scripts/migrate-schema.mjs`.
   Migrasi otomatis membuat backup `pre-t01-*.sqlite`, berjalan dalam satu transaksi, dan **di-rollback** bila
   `foreign_key_check` atau `integrity_check` gagal. Bila backup gagal dibuat, migrasi tidak berjalan.
5. `PORT=3100 npm start`, lalu `GET /api/ready` → 200.

## Migrasi gagal
- Pesan `integrity_check failed … rolled back` atau `foreign key verification failed`: database **tidak berubah**
  (transaksi di-rollback). Jangan ulangi di produksi; ulangi gladi di salinan dan periksa backup.
- Pesan `Schema DDL hash mismatch for version N; recorded hash X; current hash Y`: skema berubah di luar migrasi.
  Pulihkan backup terverifikasi (di bawah) atau jalankan ulang migrasi di salinan untuk menemukan perbedaannya.
- Pesan `Schema version A != B; run ALLOW_AUTO_MIGRATE=1 …`: kode lebih baru dari database; jalankan migrasi.

## Pemulihan backup (rollback)
1. Hentikan server.
2. Pilih backup: `data/migration-backups/pre-v9-*.sqlite` (manual) atau `pre-t01-*.sqlite` (otomatis, terbaru).
3. Cek: `node -e "const D=require('better-sqlite3');const d=new D('<backup>',{readonly:true});console.log(d.pragma('integrity_check',{simple:true}),d.prepare('select max(version) v from schema_migrations').get())"` → `ok`.
4. Salin `data/app.db` saat ini ke tempat aman, lalu salin backup menjadi `data/app.db` (hapus `app.db-wal`/`app.db-shm` lama).
5. Jalankan kode yang sesuai versi backup (lihat `V8-FREEZE.md` / `V9-FREEZE.md`), lalu `GET /api/ready`.

## Rotasi kunci media (HMAC)
1. `MEDIA_SIGNING_KEY_PREVIOUS=<kunci lama>`, `MEDIA_SIGNING_KEY_PREVIOUS_UNTIL=<epoch ms, mis. sekarang + 10 menit>`,
   `MEDIA_SIGNING_KEY=<kunci baru ≥32 karakter>`; restart server.
2. Setelah batas waktu lewat, hapus dua variabel `*_PREVIOUS*`. Tautan media tetap berlaku 5 menit.

## Tes
- `node scripts/run-tests.mjs` (karantina: `tests/QUARANTINE.md`), `--realtime-only` / `--no-realtime`.
- `node scripts/run-t03-regressions.mjs`, `node scripts/check-tenant-scope.mjs`.
- Baseline/penerimaan: `node scripts/test-baseline.mjs --seq 10 --par 3`.
