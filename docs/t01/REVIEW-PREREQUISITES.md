# Review T01 sebelum T02

18 November 2026. T01 awal di-commit terpisah sebagai `023da83` (`feat(tenant): add tenant schema and scope resolver`). Perbaikan review pada dokumen ini merupakan commit terpisah di atasnya; T02 dimulai setelah commit perbaikan. Tidak ada push atau PR remote dibuat.

| Prasyarat | Hasil |
|---|---|
| Commit T01 utuh | `023da83`, tidak menyertakan PHASE-0-PLAN.md pengguna |
| Migrasi eksplisit | schema_migrations versi 1; default startup menolak versi 0; ALLOW_AUTO_MIGRATE=1 mengizinkan migrasi yang dikenali; satu BEGIN IMMEDIATE meliputi bootstrap, tenant dan pencatatan versi; FK diverifikasi sebelum commit |
| Owner default deterministik | Admin dengan ID terkecil, fallback user ID terkecil, disimpan pada report_json.defaultOwnerId dan dijelaskan ADR |
| Trigger satu per satu | [trigger-matrix.md](trigger-matrix.md): 23 relasi × INSERT/UPDATE dan 21 immutable tenant UPDATE; termasuk numbers.tenant_id serta kedua FK media_records |
| Backup ignore/retensi/ukuran | **/migration-backups/; N default 5; fixture N=2 mempertahankan 2 snapshot, total 737280 byte; ukuran runtime aktual dicetak bersama path backup |
| Fingerprint | SHA-256 tabel+atribut kolom kanonis dari manifest kode yang dibekukan; beda ditolak sebelum migrasi, diperiksa lagi setelah lock; tabel/kolom tambahan terbukti ditolak |

Verifikasi: `node --test tests/tenant-prerequisites.test.mjs tests/tenant-t01.test.mjs`, **exit 0, 9 pass / 0 fail**. Bukti: [review-prerequisites.txt](evidence/review-prerequisites.txt). Snapshot lokal pada run ini memiliki 565 pesan dan 82 registrasi media hasil bootstrap; seluruh jumlah dipertahankan dan nol tenant_id kosong. Angka laporan T01 awal adalah snapshot historis berbeda. Database asli tidak dimigrasikan.

Perubahan file: src/schemaMigrations.js, schemaFingerprint.js, schema-fingerprints.json, legacySchema.js, db.js, tenantMigration.js, config.js, scripts/migrate-schema.mjs, build-schema-fingerprints.mjs, tests/tenant-prerequisites.test.mjs, fixture/test T01, .env.example, .gitignore dan ADR. Query dan handler tidak dipasangi resolver.

Rollback: gunakan commit T01 sebelumnya hanya pada salinan/maintenance window; versi runner ini tidak menurunkan skema otomatis. ALLOW_AUTO_MIGRATE=0 menonaktifkan migrasi startup. Bila perlu rollback skema, hentikan semua penulis, karantina DB/WAL/SHM sekarang dan restore snapshot pre-migrasi seperti ADR. Backup yang tersisa tunduk pada retensi N; simpan snapshot maintenance di arsip operasional terpisah bila perlu dipertahankan lebih lama.
