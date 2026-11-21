# Pembekuan schema v8 (Deal analytics)

**Status: BEKU** sejak 22 November 2026, sebelum database operasional dimigrasikan.
Perubahan schema berikutnya **wajib** berupa migrasi v9 atau lebih tinggi. Isi v1–v8 tidak boleh diubah.

## Identitas

| Item | Nilai |
|---|---|
| Versi | `SCHEMA_VERSION = 8`, label `Deal analytics` |
| Kode migrasi pada saat beku | commit `d90b6ff` (kunci instance) di atas `724b0e7` (pengokohan v8) |
| Fingerprint v8 (`known.current`, tabel + kolom) | `915debfcbcf7980db7d97c8c9af5f1f992a9c0470cb04041df480b8c393faa83` |
| Fingerprint v1–v7 | Tidak berubah sejak commit `6417051` (v7); diverifikasi dengan generator dijalankan ulang (0 perubahan) |

### Hash berkas migrasi (sha256)

| Berkas | sha256 |
|---|---|
| `src/dealAnalyticsMigration.js` | `d86b683ae8b094e2695c74fd4e9bc5ac2936806a6e06589c9cf852c15538f759` |
| `src/schemaMigrations.js` | `304de9dc4fdf98c21caf0b5ce6da1806086469ab632641b7049d72be964428e9` |
| `src/schema-fingerprints.json` | `a5f0685815b31f130d4e65b20a1c7623c4e88a2ce9a5a33d2a202776f2143cb1` |
| `scripts/build-schema-fingerprints.mjs` | `9ca7e21fa70109a8021cee6f47772ea545e0f6810988e15c27f3b6becf1280d9` |

Hash berkas dihitung dari isi working tree (LF) pada saat beku.

### Hash DDL penuh (tabel, kolom, trigger, indeks, view)

Hash = sha256 dari `[type, name, tbl_name, sql dengan whitespace dinormalkan]` seluruh objek `sqlite_master` (kecuali `sqlite_*`), diurutkan per `type, name`.

| Database | Hash DDL | Objek |
|---|---|---|
| v8 dibangun bersih lewat rantai migrasi (in-memory) | `e6cffdab64306eca9317d973ee63a7e07a863da7bb0907b1585b4089c40c59d3` | 39 tabel, 52 indeks, 98 trigger |
| **Salinan produksi** setelah migrasi v4 → v8 (gladi) | `9d60718e578948c47d2153c68d8026dc73c2f7a123234da4e5d81c57756457a2` | sama |

**Keduanya berbeda, dan itu wajar.** Satu-satunya objek yang berbeda adalah tabel `chats`: database produksi tumbuh lewat `ALTER TABLE ADD COLUMN` dari skema lama sehingga **urutan kolomnya** berbeda dari build bersih. Fingerprint tidak terpengaruh (kolom diurutkan per nama). Akibatnya, hash DDL harus dicatat **per database saat migrasi** dan dibandingkan dengan database itu sendiri, bukan dengan build bersih (masukan untuk G4). Hash yang dicatat G4 untuk database operasional ditambahkan di bawah setelah G4.

## Hasil uji di salinan (sebelum migrasi produksi)

Bukti mentah di `docs/deal-analytics/v8-freeze/`.

| Uji | Hasil |
|---|---|
| Drill backup terhadap `data/app.db` (`scripts/drill-backup.mjs`) | backup 786.432 byte dalam 18 ms, `integrity_check: ok` (v4), server sehat terhadap salinan setelah migrasi, `data/app.db` tetap v4 |
| Migrasi v4 → v8 di salinan | **126 ms**, exit 0, fingerprint = v8, `integrity_check: ok`, `foreign_key_check`: 0 |
| Data | Jumlah baris 12 tabel tidak berubah (2 nomor, 40 chat, 1.883 pesan, 1 user, 1 tenant, …) |
| Migrasi dijalankan kedua kali | 89 ms, tidak ada migrasi; fingerprint, hash DDL, versi, dan jumlah baris identik |
| Smoke API | login 200 · `/deals/analytics` 200 · `/deals/review` 200 · keputusan "tolak" 200 · hapus chat deal belum diputuskan 200 · hapus chat deal sudah diputuskan 409 `DEAL_DECIDED` · hapus nomor bersih 200 · audit `chat_deleted` dan `number_deleted` tercatat |
| Drill rollback | Backup dipulihkan, server dijalankan dari kode **`7bc7377` (v4)** → `/api/health` 200, database tetap v4 |

## Langkah rollback yang sudah diuji

1. Hentikan server (`:3100`).
2. Pindahkan `data/app.db`, `data/app.db-wal`, `data/app.db-shm` ke folder cadangan.
3. Salin backup sebelum migrasi (lihat laporan G3) menjadi `data/app.db`.
4. Jalankan kode v4: `git worktree add ../wa-rollback 7bc7377`, lalu dari folder itu `DATA_DIR=<repo>/data node --regexp-interpret-all src/index.js`. Kode saat ini (v8) **menolak** database v4 kecuali `ALLOW_AUTO_MIGRATE=1`, dan itu justru akan memigrasikan ulang.
5. Cek `/api/health` = 200 dan `SELECT max(version) FROM schema_migrations` = 4.

## Pernyataan

Schema v8 dibekukan. Migrasi `src/dealAnalyticsMigration.js` dan entri v8 di `src/schemaMigrations.js` tidak boleh diubah lagi. Fingerprint tidak menjaga trigger, indeks, maupun CHECK; sampai mekanisme hash DDL G4 berlaku, kepatuhan dijaga oleh manifest ini dan tinjauan kode.
