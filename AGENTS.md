# AGENTS.md

Aturan kerja untuk agen (Codex, Claude) yang berbagi working tree ini. Wajib dibaca sebelum mengedit.

## 1. Kepemilikan file

| Pemilik | File |
|---|---|
| Codex | `src/platform*.js`, `src/capabilities.js`, `src/sessionHealth*.js`, `src/deal{Migration,Detection,Classifier,Reasons,Review,ReviewJobs,ReviewMigration,ReviewRoutes}.js`, `public/{platform,session-health,deal-review}.*`, `tests/{tenant-t04,session-health,deal-foundation,deal-review}.test.mjs`, `docs/t04/`, `docs/t05/` |
| Claude | `src/dealAnalytics*.js`, `src/group*.js`, `src/chatType.js`, `public/{deal-analytics,group}.*`, `tests/{deal-analytics*,dp-reminder-group,group*}.test.mjs`, `scripts/check-{deal-analytics,group}-browser.mjs`, `docs/{deal-analytics,group-support}/` |
| Bersama | lihat §2 |

File milik agen lain hanya diubah untuk hotfix yang disebut eksplisit di tugas. Catat di laporan dengan `file:line`.

## 2. File bersama

`public/index.html`, `public/sw.js`, `src/schema-fingerprints.json`, `src/schemaMigrations.js`, `scripts/build-schema-fingerprints.mjs`, `src/routes.js`, `src/platformRoutes.js`, `src/db.js`, `src/wa.js`, `src/index.js`, `tests/route-inventory.*`, `docs/t01/route-inventory.md`.

Protokol:
1. Baca ulang `git diff <file>` tepat sebelum mengedit.
2. Patch sekecil mungkin. Utamakan menambah baris baru daripada mengubah baris lama.
3. Jangan menimpa blok yang sedang diubah agen lain. Catat blok yang bentrok dan minta koordinasi.
4. `public/sw.js`: naikkan `V` setiap kali `SHELL` berubah. Kalau bentrok, ambil angka tertinggi + 1.
5. `src/schema-fingerprints.json`: jangan diedit tangan. Selalu `node scripts/build-schema-fingerprints.mjs`. Nilai `v1..vN-1` tidak boleh berubah.
6. Route baru wajib lewat `requireTenantScope`/`requireCapability` dan muncul di `docs/t01/route-inventory.md` (tes `route-inventory` hijau).

## 3. Migrasi

| Versi | Isi | Pemilik |
|---|---|---|
| 1–7 | T01 … Deal review | — (sudah ada) |
| 8 | Deal analytics — **BEKU** (22 Nov 2026, `docs/deal-analytics/V8-FREEZE.md`) | Claude |
| 9 | Koreksi analytics (jadwal per hari, libur, tak terjawab 4 jam operasional, kas masuk) — **BEKU** (23 Nov 2026, `docs/deal-analytics/V9-FREEZE.md`) | Claude |
| 10 | Grup: `chat_type`, pengirim, `groups`, `lid_map`, `buyer_jid` | Claude (diklaim) |

- Klaim nomor di tabel ini **sebelum** menulis migrasi.
- Satu versi = satu fungsi `migrateX(db)` + satu baris di `src/schemaMigrations.js` + fingerprint `vN`.
- Migrasi versi yang sudah dipakai database operasional **tidak boleh diubah**. Perbaikan selalu versi baru.
- **v1–v9 beku.** Setiap perubahan schema berikutnya wajib v10 atau lebih tinggi. Fingerprint hanya menjaga
  tabel dan kolom; trigger, indeks, dan CHECK dijaga **hash DDL** (`src/schemaDdlHash.js`, tabel `schema_ddl_hash`):
  dicatat per database saat migrasi, dicek setiap startup. v8 `grandfathered` (hanya peringatan); sejak v9 hash
  berbeda → startup ditolak. Generator menghitung `ddl.vN` sejak v9. `/api/health` memuat versi dan hash aktif.
- Penulisan analytics hanya dari job latar (`startUnansweredJob`); request baca **tidak boleh menulis**.
- Server dan migrasi memegang `data/app.db.lock`; jangan jalankan dua instance pada folder data yang sama.
- Database operasional: backup → restore ke salinan → migrasi salinan + smoke → migrasi operasional + smoke. Tidak pernah migrasi langsung.

## 4. Commit

- Commit per tugas/sub-bagian, hanya file tugas itu (`git add <path>` eksplisit). **Dilarang** `git add -A` / `git add .` / `git commit -a`.
- Hunk file bersama milik agen lain tidak ikut di-commit (`git add -p` atau patch terpisah).
- Pesan commit: `type(scope): ringkasan`, contoh `fix(deals): skip DP reminders in group chats`.
- Sebelum commit: tampilkan `git status` dan `git diff --cached --stat` di laporan.

## 5. Dilarang

`git reset --hard`, `git stash`, `git checkout -- <file>`, `git clean`, rebase, force push, dan menghapus file agen lain tanpa pemberitahuan eksplisit di laporan.
Dilarang juga: restart server aktif atau migrasi database operasional di luar tugas yang memintanya.

## 6. Tes

- Suite lama harus hijau: `node --test tests/*.test.mjs`, `node scripts/run-t03-regressions.mjs`.
- Kalau tes lama merah: berhenti, laporkan, jangan lanjut.
- Gunakan fixture (`tests/tenant-fixture.mjs`) atau salinan database, bukan `data/app.db`.

## 7. Format laporan

TL;DR maksimal 3 baris, lalu:
1. Ringkasan perubahan: `file:line` → perubahan → alasan
2. Yang ditingkatkan (dalam / di luar cakupan)
3. Bonus di luar cakupan + cara revert
4. Keputusan sendiri: keputusan → alternatif ditolak → alasan
5. Terverifikasi (dengan output) vs masih asumsi
6. Kritik spesifikasi
7. Risiko sisa
8. Langkah berikutnya, urut prioritas

Jangan tulis "beres" tanpa bukti di bagian 5. Tes gagal atau di-skip wajib disebut.
