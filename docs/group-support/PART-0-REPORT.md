# Tugas 5 · Bagian 0: Laporan (berhenti lebih awal di 0.4)

**TL;DR**
1. Selesai dengan bukti: 0.2 (tiga koreksi bukti), 0.1 (hotfix pengingat DP ke grup), 0.3 (`AGENTS.md`), dan commit (c) dokumen audit.
2. **Berhenti di 0.4:** HEAD masih di schema v3, dan seluruh pekerjaan Codex v4–v7 belum di-commit. Commit (a) dan (b) tidak bisa berdiri sendiri.
3. **0.5 (migrasi produksi) dan 0.6 belum dikerjakan.** Migrasi operasional ke v8 sebelum v4–v7 dibekukan bisa membuat database ditolak saat startup.

---

## 1. Ringkasan perubahan

| file:line | Perubahan | Alasan |
|---|---|---|
| `scripts/verify-ai5.mjs:21-31` | Menguji dua jalur: resume ditolak 409 saat kuota belum habis (budget dan notice tidak berubah), lalu resume 200 setelah kuota benar-benar habis | 0.2.1: versi saya sebelumnya hanya menguji jalur sukses |
| `src/dealReviewJobs.js:24-25` | `export const isGroupChat` memakai `chat_type === 'group'`, dengan fallback sufiks `@g.us` | 0.1 |
| `src/dealReviewJobs.js:68-75` | Pengingat untuk chat grup dilewati. Notice ditandai terkirim (supaya tidak dicoba ulang) dan dicatat sebagai event `dp_reminder_skipped {kind, reason:'group_chat'}` | 0.1: mencegah sisa tagihan diumumkan ke grup |
| `tests/dp-reminder-group.test.mjs` (baru) | 2 tes: grup dilewati, dicatat, dan tidak dicoba ulang; DM tetap terkirim; unit `isGroupChat` | Tes wajib 13 |
| `AGENTS.md` (baru) | Kepemilikan file, protokol file bersama, klaim migrasi v9/v11+, aturan commit, larangan, format laporan | 0.3 |
| commit `eb79821` | `docs/group-support/GATE-1-AUDIT.md` + `evidence/` (5 file, hanya dokumen) | 0.4 (c) |

**Solusi permanen pengingat DP** adalah mengirim ke DM pembeli (`buyer_jid`). Itu ada di Tugas 6 dan sudah dicatat sebagai backlog.

## 2. Yang ditingkatkan

- **Dalam cakupan:**
  - Kebocoran tagihan ke grup tertutup.
  - Tes AI menguji kedua jalur `/ai/resume`.
  - Klaim fingerprint diperbaiki menjadi lebih tepat (lihat bagian 5).
  - Ada aturan koordinasi tertulis antar agen.
- **Di luar cakupan:** tidak ada.

## 3. Bonus di luar cakupan

Tidak ada.

## 4. Keputusan yang saya ambil sendiri

| Keputusan | Alternatif ditolak | Alasan |
|---|---|---|
| Pengingat grup yang dilewati ditandai `delivered_at` + event `dp_reminder_skipped` | Biarkan notice tetap pending | Job berjalan berulang; notice pending akan dicek terus tanpa akhir dan menyembunyikan bahwa pengingat sengaja tidak dikirim |
| Hotfix diletakkan di `dealReviewJobs.js` (file milik Codex) | Membungkus `sendReminder` di `src/index.js` | Tugas meminta perbaikan di titik kirim; di sini `jid` dan `chat_type` sudah tersedia dari query |
| Nomor migrasi v9 (koreksi analytics) dan v11+ (grup) diklaim di `AGENTS.md` | Menentukan nomor saat menulis migrasi | Mencegah Codex dan Claude memakai nomor yang sama |
| **Berhenti sebelum commit (a)/(b) dan 0.5** | Commit apa adanya atau ikut meng-commit file Codex | Lihat bagian 6 |

## 5. Sudah diverifikasi vs masih asumsi

### Sudah diverifikasi

**0.2.1 Dua assert skrip AI:**
```
$ ALLOW_AUTO_MIGRATE=1 MULTITENANT_ENABLED=0 node --regexp-interpret-all scripts/verify-ai5.mjs
ASSERT resume-before-exhausted: status 409, daily_tokens 200000, notice kept
ASSERT resume-after-exhausted: status 200, daily_tokens 240000
PASS ai5: validation 400, auth 401/403, secret masking, resume +20%/clear notice, ...; exit 0

$ … scripts/verify-ai-final.mjs
node  scripts/verify-ai5.mjs: exit 0
PASS final: ai1–6, hardening, module guide, clean npm start; exit 0
(artifacts/ai/verify-ai5.mjs.log memuat kedua baris ASSERT yang sama)
```

**0.2.2 Semua database di mesin ini** (dibaca read-only, fingerprint dicocokkan ke `src/schema-fingerprints.json`):
```
$ find . -path ./node_modules -prune -o \( -name "*.db" -o -name "*.sqlite" -o -name "*.sqlite3" -o -name "*.db-wal" \) -print
./data/app.db                                   version=4  fingerprint=v4
./data/app.db-wal                               (wal)
./data/migration-backups/pre-t01-1cab6c03-….sqlite  version=-  fingerprint=legacy.preMedia

Fixture tes yang tersisa di %TEMP% (24 database app.db):
     22 version=-  fingerprint=legacy.empty
      1 version=4  fingerprint=v4
      1 version=5  fingerprint=v5
```
**Koreksi klaim:** sebelumnya saya menulis "hanya fixture yang terdampak". Kenyataannya **tidak ada database apa pun yang berada di draft v8**, sehingga perubahan fingerprint v8 tidak berdampak ke database mana pun saat ini.

**0.2.3 File bersama.** `git diff HEAD` pada `public/index.html` mencampur hunk Codex dan hunk saya:
```
$ git diff --stat public/index.html public/sw.js src/schema-fingerprints.json
 public/index.html            | 77 ++++++++++++++++++++++++++++++++++++++++----
 public/sw.js                 |  4 ++-
 src/schema-fingerprints.json |  7 +++-
```
Untuk memisahkan bagian saya, index.html direkonstruksi tanpa 6 hunk saya, lalu dibandingkan:
```
$ git diff --no-index --stat index.before-claude.html public/index.html
 1 file changed, 10 insertions(+), 1 deletion(-)
-  … ['dashboard', 'account', 'monitor', 'notifications', 'search', 'ai', 'deals'].includes(name));
+  … ['dashboard', 'account', 'monitor', 'notifications', 'search', 'ai', 'deals', 'analytics'].includes(name));
(+ 9 baris tambahan murni: link CSS, tombol rail, script, blok pages.analytics, railPages.railAnalytics)
```
Terbukti bagian saya murni penambahan, kecuali satu kata `'analytics'`. Di `sw.js`, bagian saya: `V` v27 → v28 dan satu baris `SHELL.push('/deal-analytics.js', '/deal-analytics.css')`. Perubahan v24 → v27 dan `SHELL.push` platform/session-health/deal-review adalah hunk Codex.

**0.1 Hotfix:**
```
$ node --test tests/dp-reminder-group.test.mjs tests/deal-review.test.mjs
✔ pengingat DP: grup dilewati dan dicatat, DM tetap terkirim, tidak dicoba ulang
✔ isGroupChat: chat_type menang, sufiks JID sebagai fallback
✔ boot job logic escalates, digests, retries DP reminders and expires independently   (tes lama tetap hijau)
ℹ pass 7 · fail 0
```

**Suite penuh setelah Bagian 0:**
```
$ node --test tests/*.test.mjs        → tests 102 · pass 102 · fail 0
$ node scripts/run-t03-regressions.mjs → exit 0 · 28 lulus · 0 gagal
```

**Ketergantungan commit (dasar keputusan berhenti):**
```
$ git show HEAD:src/schemaMigrations.js | grep SCHEMA_VERSION=
export const SCHEMA_VERSION=3;
src/dealReview.js UNTRACKED · src/dealMigration.js UNTRACKED · src/sessionHealth.js UNTRACKED
src/capabilities.js UNTRACKED · src/platformRoutes.js UNTRACKED · src/dealReviewJobs.js UNTRACKED
src/dealAnalytics.js:3: import { DAY, appendDealEvent } from './dealReview.js';
git diff --stat (bersama): src/wa.js 269 · src/routes.js 67 · src/schemaMigrations.js 24 · src/index.js 11 · src/db.js 5
```

**Commit (c):**
```
$ git diff --cached --stat
 docs/group-support/GATE-1-AUDIT.md | 257 · evidence/grep-chat_id.txt 129 · grep-lid.txt 11 · grep-participant.txt 2 · grep-swhatsappnet.txt 42
 5 files changed, 441 insertions(+)
$ git log --oneline -1
eb79821 docs(groups): add gate 1 audit for group chat support
```

### Masih asumsi
- `chat_type` di hotfix baru berlaku setelah B1. Sampai saat itu hanya sufiks `@g.us` yang bekerja, dan itu sudah teruji.
- Belum dicek apakah database operasional punya deal yang berasal dari chat grup. Database itu di v4, sehingga tabel `deals` belum ada; secara struktur jawabannya tidak ada.

## 6. Kritik terhadap spesifikasi

1. **0.4 (a) dan (b) tidak bisa menjadi commit yang berdiri sendiri.** HEAD di schema v3. Tugas 3 bergantung pada v4–v7 milik Codex yang seluruhnya belum di-commit (lebih dari 20 file untracked, ditambah hunk di `wa.js`, `routes.js`, `schemaMigrations.js`, `index.js`, dan `db.js`). Ada tiga pilihan:
   - **(i)** Codex meng-commit pekerjaan T04–v7 lebih dulu, lalu saya commit (a) dan (b) di atasnya. **Saya rekomendasikan ini.** Hasilnya setiap commit bisa dijalankan, dan kepemilikan tetap jelas.
   - (ii) Saya commit (a) dan (b) dengan ikut membawa file dan hunk Codex. Hasilnya bisa jalan, tetapi mencampur pekerjaan dua agen dan melanggar `AGENTS.md` §1 dan §4.
   - (iii) Saya commit hanya file saya. HEAD tidak bisa dijalankan (import hilang, migrasi v8 tanpa v4–v7), dan tes (a) merah di HEAD.
2. **0.5 sebaiknya dijalankan setelah v4–v8 di-commit dan dibekukan.** Fingerprint v4–v7 berasal dari kode yang belum di-commit. Kalau Codex mengubah salah satu migrasi itu, database operasional yang sudah di v8 akan ditolak saat startup (`Schema fingerprint mismatch`), dan jalan keluarnya hanya restore backup. Urutan yang saya usulkan: commit Codex v4–v7 → commit (a)(b) → 0.5. Ini tetap "tidak dijadwalkan nanti", hanya menunggu satu commit.
3. **0.5 butuh server lokal di :3100 dihentikan.** Server itu memegang `data/app.db` dan menjalankan kode lama. Migrasi di bawah proses yang masih hidup tidak aman. Saya butuh konfirmasi bahwa server tersebut boleh dihentikan lalu dijalankan ulang.
4. **0.6 dan B1 akan menjadi migrasi v9 dan v11+, bukan perubahan di v8.** Begitu v8 dipakai database operasional, isinya tidak boleh diubah lagi. Nomor ini sudah diklaim di `AGENTS.md`.
5. **Commit hotfix 0.1 tidak ada di daftar 0.4.** Hotfix mengubah `src/dealReviewJobs.js`, yang **seluruhnya** belum di-commit (milik Codex). Hotfix hanya bisa di-commit bersama atau sesudah commit Codex. Usulan: commit keempat `fix(deals): skip DP reminders in group chats` setelah commit Codex.

## 7. Risiko sisa

- **Pengingat DP ke grup:** sudah tertutup di working tree, tetapi belum di-commit. Kalau working tree hilang, hotfix ikut hilang.
- **Risiko terbesar repo saat ini:** pekerjaan Codex v4–v7 dan Tugas 3 hanya ada di working tree, yang dipakai bersama dua agen.
- Server :3100 masih memakai kode lama dan database v4.
- Temuan audit Gerbang 1 yang belum diperbaiki tetap berlaku. Lihat `GATE-1-AUDIT.md` bagian 7.

## 8. Usulan langkah berikutnya

1. **Codex commit T04, v5, v6, dan v7** (beserta hunk file bersama miliknya). Ini membuka semua langkah berikutnya.
2. Saya commit (a) tes AI, (b) Tugas 3, dan (d) hotfix 0.1, masing-masing terpisah, di atas commit Codex.
3. **0.5:** hentikan server :3100, backup, uji di salinan, migrasi operasional ke v8, smoke, lalu siapkan rollback.
4. **0.6** sebagai migrasi v9, dengan commit sendiri.
5. Lanjut B1 + B2 (v11+), lalu Gerbang 2.
