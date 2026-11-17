# Laporan T01 — fondasi tenant

18 November 2026, Asia/Jakarta. Baseline `5c033e42231fa7dff1e81bd2b39ba91c3e17ae06`.

T01 diimplementasikan di working tree: skema tenant/membership, migrasi backup-expand-backfill-contract, resolver scope, dan ADR. Berhenti pada T01. Belum membuat commit/PR, belum menyalakan flag, dan belum memigrasikan database asli `data/app.db`. Verifikasi data lokal dijalankan pada snapshot sementara melalui SQLite backup API.

## File

| File | Perubahan |
|---|---|
| `src/tenantMigration.js` | Inventaris 21 tabel, backup WAL-aware, default tenant/membership, backfill, NOT NULL/FK, indeks/trigger, laporan dan idempotensi |
| `src/tenantScope.js` | Resolver sesi/membership/status dan middleware bermarker untuk T02 |
| `src/db.js` | Backup sebelum bootstrap lama; migrasi sebelum prepared statements aplikasi dibuat; konfigurasi resolver |
| `src/config.js`, `.env.example` | Flag default mati; aktivasi ditolak sebelum DB dibuka selama tahap isolasi belum selesai |
| `package.json` | `npm run test:tenant:t01` |
| `tests/tenant-t01.test.mjs`, `tests/tenant-fixture.mjs` | Matriks resolver, migrasi, fixture A/B lengkap, startup/restart |
| `scripts/verify-tenant-baseline.mjs` | Mengulang suite terhadap source SHA baseline di direktori sementara tanpa mengubah working tree |
| `docs/adr/0002-tenant-foundation-sqlite.md` | Keputusan SQLite, scope global/tenant, rollout/rollback dan pemicu Postgres + RLS |
| `FINDINGS.md`, `docs/t01/evidence/*` | Temuan dan bukti eksekusi |

File pengguna `PHASE-0-PLAN.md` dibiarkan utuh.

## Output gagal-sebelum dan hijau

- [Red awal](evidence/red.txt): `node --test tests/tenant-t01.test.mjs`, SHA baseline di atas, exit **1**, tiga test awal gagal karena modul tenant belum tersedia. Run sandbox pertama terblokir spawn EPERM; bukti red ini berasal dari run yang berhasil menjalankan test.
- [Red suite lengkap pada baseline](evidence/red-complete-baseline.txt): `node scripts/verify-tenant-baseline.mjs`, inner command `node --test tests/tenant-t01.test.mjs`, exit inner **1**, **0 pass / 7 fail**. Enam gagal karena modul baru tidak ada; satu karena kolom tenant_id belum ada. Runner luar exit 0 hanya bila baseline terbukti merah. Tiga test awal ditulis/dijalankan sebelum implementasi; test ketahanan tambahan ditambahkan sesudahnya dan kemudian dijalankan pada source baseline yang sama. Ini bukan klaim bahwa seluruh tujuh test telah ditulis sebelum implementasi.
- [Temuan antara](evidence/intermediate-20-vs-21.txt): exit **1**, assertion 20 vs 21. Snapshot lokal belum memiliki media_records. Test final memakai jalur bootstrap aplikasi sebenarnya, tetap mensyaratkan **21 tabel** serta kesetaraan jumlah semua tabel lama. Tidak ada assertion yang dihapus untuk menghijaukan hasil.
- [Green T01](evidence/green.txt): `node --test tests/tenant-t01.test.mjs`, exit **0**, **7 pass / 0 fail**.
- Regresi mode lama: [inbox](evidence/regression-inbox.txt), [aturan AI](evidence/regression-ai-rules.txt), dan [path media](evidence/regression-media-paths.txt), seluruhnya exit **0**. Path media: 3 pass / 0 fail. Ini bukan klaim seluruh suite historis sudah hijau; F0-W01 tetap terbuka.

## Matriks hasil T01

| Kasus | Hasil |
|---|---|
| Sesi A → tenant A; sesi B → tenant B | PASS, scope sesuai sesi |
| Cookie A + tenant_id B pada body, params, atau query | PASS, 403 |
| Query tenant_id berbentuk array | PASS, 403 |
| Cookie B + principal terautentikasi A | PASS, 401 |
| Tanpa sesi / token tidak dikenal / sesi kedaluwarsa | PASS, 401 |
| Membership dicabut, sesi sama digunakan lagi | PASS, 403 pada panggilan berikutnya |
| Tenant suspended | PASS, 403 |
| Admin global P tanpa membership/active tenant | PASS, 403; tidak ada bypass admin |
| Satu user menjadi anggota A dan B, active tenant diset di server | PASS, resolver mengikuti active tenant yang valid |
| A/B masing-masing owner, agen, dua nomor, dan semua 21 jenis resource | PASS, fixture deterministik dibersihkan setelah test |
| Kunci alami sama di A dan B | PASS; tidak saling bentrok |
| Mengubah tenant_id resource atau menghubungkan pesan/label ke resource tenant lain | PASS, ditolak trigger |
| Owner kedua pada tenant sama | PASS, ditolak unique index |
| tenant_id NULL | PASS, ditolak constraint fisik |
| Backup sebelum perubahan, FK/index dan high-water AUTOINCREMENT tetap utuh | PASS |
| Backup gagal | PASS, skema tidak berubah |
| Verifikasi FK gagal setelah rebuild | PASS, seluruh perubahan T01 rollback, FK enforcement pulih |
| Migrasi ulang | PASS, no-op |
| Writer lama flag 0, bootstrap kosong, restart | PASS |
| Flag 1 pada build T01 | PASS, startup ditolak sebelum direktori DB dibuat |

Cookie sesi adalah bearer credential: cookie B utuh tanpa identitas independen mengautentikasi sebagai B. Test swapped identity di atas mendeteksi ketidakcocokan principal A dengan cookie B; tidak membuktikan penolakan pencurian cookie. Binding/rotasi sesi dan browser context masuk T03/T15.

## Hasil backfill pada salinan database lokal

Setiap tabel di bawah lulus NOT NULL, jumlah sebelum = sesudah, dan nol tenant_id kosong. Integrity check `ok`; foreign_key_check kosong. Ini salinan database di workspace yang tersedia, bukan verifikasi server produksi jarak jauh.

| Tabel | Sebelum | Sesudah | Tanpa tenant |
|---|---:|---:|---:|
| activity | 4 | 4 | 0 |
| numbers | 2 | 2 | 0 |
| send_count | 2 | 2 | 0 |
| chats | 28 | 28 | 0 |
| messages | 535 | 535 | 0 |
| notifications | 2 | 2 | 0 |
| rules | 0 | 0 | 0 |
| templates | 2 | 2 | 0 |
| labels | 2 | 2 | 0 |
| chat_labels | 2 | 2 | 0 |
| ai_settings | 2 | 2 | 0 |
| ai_usage | 1 | 1 | 0 |
| ai_notice | 0 | 0 | 0 |
| ai_alerts | 0 | 0 | 0 |
| ai_seen | 0 | 0 | 0 |
| ai_logs | 5 | 5 | 0 |
| products | 0 | 0 | 0 |
| orders | 0 | 0 | 0 |
| contacts | 0 | 0 | 0 |
| contacts_v2 | 0 | 0 | 0 |
| media_records | 79 | 79 | 0 |

media_records dibuat oleh bootstrap lama dan diisi dari pesan yang sudah ada; snapshot asli belum memiliki tabel itu. Angka sebelum di tabel berarti sesudah bootstrap lama, sebelum transaksi T01. Untuk 20 tabel yang sudah ada di snapshot asli, test juga membandingkan langsung jumlah asli dengan hasil akhir.

## Cakupan yang belum diuji/diimplementasikan pada T01

| Matriks lanjutan | Status |
|---|---|
| Semua endpoint daftar/detail/mutasi/ekspor/unduhan: A/A 200, A/B 404 | Menunggu T02, T05, T06, T08, T13 |
| Inventaris rute menolak handler tanpa scope | Menunggu T02; marker middleware sudah tersedia |
| Session switcher, rotasi sesi, role platform, konsol dan audit akses isi | Menunggu T03/T04 |
| Job, kredensial worker, kuota pesan dan AI antar-tenant | Menunggu T07/T12 |
| Signed URL lintas tenant, manipulasi tenant/expiry/path | Menunggu T08; alur media tidak diubah pada T01 |
| WebSocket room A/B dan direktori Baileys/media | Menunggu T09/T10 |
| Undangan expired/reuse/email berbeda, signup dan anti-abuse | Menunggu T11 |
| Ekspor, backup, hapus, retensi media A tidak menghapus B | Menunggu T13 dan pengujian E2E |
| Metrik/log per tenant, CI gate dan dua browser context | Menunggu T14/T15 |
| Screenshot desktop dan 360px | Tidak dibuat pada T01; belum ada UI tenant, menunggu T03/T11/T15 |

## Risiko sisa dan rollback

T01 belum menyediakan isolasi operasional multi-tenant. Query lama tetap global saat flag 0. Default kolom 'default' menjaga writer lama tetap bekerja dan wajib dihentikan/dilindungi sebelum aktivasi; jangan membuat tenant operasional lewat SQL lalu menjalankan aplikasi lama. Guard startup mencegah flag 1 membuka aplikasi yang belum aman. Resolver belum dipasang pada rute; seluruh handler baru harus memakai resolver saat T02/T03 diterapkan. Pemilihan owner default perlu ditinjau operator apabila beberapa admin lama ada; tidak ada user lama yang otomatis dianggap platform admin.

Migrasi otomatis terjadi pada startup berikutnya; gunakan maintenance window, hentikan semua instance penulis. Backup pertama sebelum bootstrap dan backup kedua sebelum transaksi disimpan di DATA_DIR/migration-backups; snapshot test sementara dibersihkan dan tidak di-commit. Backup memuat data sensitif, tidak dipangkas otomatis, dan membutuhkan ruang serta ACL yang sesuai. SQLite tetap tanpa RLS.

Rollback perilaku: pertahankan/set `MULTITENANT_ENABLED=0`; skema additive tetap ada dan mode lama sudah diuji. Rollback skema: hentikan seluruh proses, karantina DB/WAL/SHM terbaru, restore snapshot pertama pre-bootstrap, gunakan kode baseline lalu verifikasi integritas/jumlah baris. Restore meniadakan perubahan sejak snapshot; lakukan rekonsiliasi sebelum melanjutkan operasi. Tidak ada penghapusan kolom atau restore database asli yang dilakukan dalam pekerjaan ini.
