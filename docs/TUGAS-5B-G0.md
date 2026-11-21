# Tugas 5B · G0: Inventarisasi dan commit pekerjaan Codex

**TL;DR**
1. Pekerjaan Codex masuk sebagai **5 commit berurutan**: pengaman resume AI → T04 (v4) → v5 → v6 → v7, ditambah `AGENTS.md`. Hunk di file bersama dipecah per fase, dan setiap commit dites di worktree terpisah.
2. Kelima commit Codex memakai prefiks `wip:`. Tidak ada merah yang disebabkan kode fasenya sendiri: penyebabnya kondisi `data/app.db` (sudah v4) atau tes Codex yang sudah ditulis untuk keadaan v8.
3. Working tree sekarang hanya berisi pekerjaan saya untuk G1. Suite di working tree: 117 tes, 116 lulus. Yang merah satu, dan akan diperbaiki commit G1 #1.

---

## 1. Ringkasan perubahan

Kode tidak diubah sama sekali. Isi working tree hanya dipindahkan ke commit.

| Commit | Isi | File |
|---|---|---|
| `6c0b6cf` wip: fix(ai) | `/ai/resume` hanya bisa setelah anggaran habis (409 kalau belum); UI `can_resume` | 3 |
| `7bc7377` wip: feat(platform) T04 (v4) | capabilities, konsol platform, grant JIT, audit, undangan owner, `PHASE-0-PLAN.md`, `docs/t04/` | 94 (65 file bukti) |
| `8dafdc3` wip: feat(sessions) v5 | health sinkronisasi, resync, antrean kirim, insert ber-tenant, `docs/.session-health-verification/` | 49 (29 bukti) |
| `8c53f9d` wip: feat(deals) v6 | fondasi deal, classifier regex di worker, hook ingest, sweep, `docs/t05/evidence/verify-prompt1` | 49 (29 bukti) |
| `6417051` wip: feat(deals) v7 | antrean review, keputusan, job SLA/DP, media bukti, menu Verifikasi deal, `verify-prompt2` | 47 (29 bukti) |
| `8e37090` docs(agents) | `AGENTS.md` | 1 |

Setiap badan commit Codex memuat: `Authored by Codex (sesi 21-22 Nov 2026), committed by Claude setelah Codex kena limit.` ditambah isi, tes yang merah, dan penyebabnya. Identitas git Codex tidak diketahui, sehingga `--author` tidak dipakai.

### Cara pemecahan file bersama
- Script (`scratchpad/g0-split.mjs`) membangun isi tiap file bersama per fase dengan **mencabut hunk fase berikutnya** dari versi akhir. Setiap pencabutan wajib cocok tepat satu kali; kalau tidak, script berhenti dan tidak menebak.
- Akhir baris CRLF/LF campuran dipertahankan per baris.
- Isi di-stage lewat `git hash-object -w` + `git update-index --cacheinfo`, sehingga working tree tidak disentuh.
- `src/schema-fingerprints.json` dan `docs/t01/route-inventory.md` **diregenerasi lewat generator proyek** di worktree untuk setiap fase, tidak diedit tangan.
- Versi schema yang di-hardcode di `tests/tenant-t03` dan `tests/tenant-prerequisites` disesuaikan per fase (4, 5, 6, 7).

## 2. Yang ditingkatkan

- **Dalam cakupan:** pekerjaan Codex yang sebelumnya hanya ada di working tree kini tercatat di histori, per fase, dengan bukti tes per commit. Snapshot penuh sebelum mulai: `scratchpad/g0-snapshot/wip-1795290473.patch` (280 file) dan `wip-src-1795290473.tgz` (529 entri).
- **Di luar cakupan:** tidak ada.

## 3. Bonus di luar cakupan

Tidak ada.

## 4. Keputusan yang saya ambil sendiri

| Keputusan | Alternatif ditolak | Alasan |
|---|---|---|
| Perubahan resume AI jadi **commit sendiri** sebelum T04 | Digabung ke T04 | Ditulis 19 Nov 01:37, terpisah dari T04 (18 Nov), dan isinya tidak berhubungan dengan platform |
| Pemecahan **per hunk** untuk 12 file bersama | Per file saja | Commit per file membuat v5–v7 tidak bisa dijalankan (misalnya `wa.js` v5 memanggil `queueDealDetection` milik v6) |
| Isi tes Codex dipertahankan apa adanya, walau ber-hardcode v8 | Menyesuaikan tes per fase | Menyesuaikan berarti mengarang versi tes yang tidak pernah ada; aturan meminta commit `wip:` kalau merah |
| Snapshot di scratchpad, bukan `/tmp` | `/tmp` | Aturan sesi mewajibkan file sementara di scratchpad. Penanda `git add -N` dilepas lagi setelah patch dibuat, sehingga index bersih. |
| Worktree uji diberi **salinan read-only** `data/app.db` (backup API) | Tanpa salinan | `tests/tenant-t01` membaca `data/app.db` dari folder kerja; tanpa salinan, hasil per fase tidak setara dengan suite di repo utama. Database asli hanya dibaca, sama seperti yang dilakukan suite itu sendiri. |
| `docs/t03/evidence/verify-before/*` dan `artifacts/ai/*.png` **tidak** masuk G0 | Masuk T04 | Isinya ditulis ulang oleh run regresi selama sesi ini (oleh saya), bukan bagian fase Codex. Masuk G1 #2. |

## 5. Sudah diverifikasi vs masih asumsi

### Sudah diverifikasi

**`git log --oneline -10`:**
```
8e37090 docs(agents): add AGENTS.md coordination rules for Codex and Claude
6417051 wip: feat(deals): deal review queue, decisions and SLA/DP jobs (schema v7)
8c53f9d wip: feat(deals): deal foundation and detection classifier (schema v6)
8dafdc3 wip: feat(sessions): session sync health, resync and send queue (schema v5)
7bc7377 wip: feat(platform): T04 platform console and time-boxed tenant access (schema v4)
6c0b6cf wip: fix(ai): refuse AI resume until the daily budget is exhausted
eb79821 docs(groups): add gate 1 audit for group chat support
f6bf7dc fix(auth): complete T04 session and reconnect prerequisites
6c714b3 fix(auth): reject static data overlap before database initialization
b6b57e1 feat(auth): bind session to active tenant
```

**Hasil suite per commit** (`node --test tests/*.test.mjs` di worktree yang isinya persis tree commit):

| Commit | Tes | Lulus | Gagal | Tes merah dan penyebab |
|---|---|---|---|---|
| `6c0b6cf` AI | 47 | 46 | 1 | `production database COPY`: `data/app.db` sudah v4, kode mengenal v1–v3 (`Schema version mismatch`) |
| `7bc7377` T04 | 68 | 67 | 1 | `production database COPY`: database sudah termigrasi, laporan `tenant_migrations` usang (chats `28` vs `40`); diperbaiki Codex di v5 |
| `8dafdc3` v5 | 74 | 73 | 1 | `session health columns, current fingerprint…`: mengharapkan versi `8`, mendapat `5` |
| `8c53f9d` v6 | 81 | 78 | 3 | session-health (versi 8); `current fingerprint, foundation tables` (versi 8, dapat 6); `v5 database upgrades` (men-drop objek v8) |
| `6417051` v7 | 86 | 83 | 3 | sama dengan v6 |

**Fingerprint per fase** (dihasilkan generator; cocok dengan nilai di file akhir):
```
T04 current = 089ba35f…   (= v4 akhir)
v5  current = 7a85a940…   (= v5 akhir)
v6  current = 8a25d11a…   (= v6 akhir)
v7  current = 9c12b667…   (= v7 akhir)
```

**Pemecahan hunk benar:**
- Semua varian lolos `node --check` dalam mode ESM. Pengecek dibuktikan bekerja dengan probe `return` di level atas, yang tertangkap.
- Dua kesalahan pemecahan **tertangkap dan diperbaiki sebelum commit**: kurung yatim di `wa.js` dan sisa `deleteFailure` di `routes.js`.
- Sisa diff di working tree untuk file bersama hanya hunk saya: `public/index.html` +10/−1 (sama dengan bukti 0.2.3 sebelumnya), `src/wa.js` +21/−1 (helper sesi + `insertMessageWithSource`), `src/routes.js` +24/−4 (`deleteFailure` + mount analytics).

**`git status --porcelain` setelah G0:** tidak ada file fase Codex tersisa. Yang tersisa, semuanya untuk G1:
```
src/dealAnalytics*.js (3), public/deal-analytics.* (2), tests/deal-analytics*.mjs, deal-delete, dp-reminder-group, v7-fixture,
scripts/check-deal-analytics-browser.mjs, scripts/verify-ai5.mjs,
hunk saya di: src/wa.js, db.js, routes.js, index.js, dealReviewJobs.js, platformRoutes.js, schemaMigrations.js,
  public/index.html, sw.js, scripts/build-schema-fingerprints.mjs, src/schema-fingerprints.json,
  tests/tenant-t03, tenant-prerequisites, docs/t01/route-inventory.md,
docs/deal-analytics/**, docs/group-support/PART-0-REPORT.md, docs/LAPORAN-*.md,
docs/t03/evidence/verify-before/** (29), artifacts/ai/*.png (4)
```

**Suite terakhir di working tree:**
```
ℹ tests 117 · pass 116 · fail 1
✖ v5 database upgrades with a v5 backup and existing messages intact   ← diperbaiki G1 #1
```

### Masih asumsi
- **Penentuan fase berbasis waktu file.** Misalnya `tenantScope.js` hunk `resolveInboundChatScope` dan `phase-harness.mjs` sama-sama ditulis 01:06:51, bersamaan dengan `dealDetection.js` (v6). Saya tidak punya log Codex.
- Regresi `run-t03-regressions` **tidak** dijalankan per commit (aturan G0 hanya meminta suite). Di v5, skrip `verify-ai3/4/rules/hardening` kemungkinan merah karena stub `recordHealth` baru ditambahkan Codex di v6.

## 6. Kritik terhadap spesifikasi dan hunk yang pemiliknya tidak jelas

| Hunk / file | Keputusan | Dasar penilaian |
|---|---|---|
| `src/ai/routes.js`, `public/ai.js`, `public/module-guide.js` | Commit sendiri, Codex | Ditulis bersamaan 19 Nov 01:37; tidak cocok tema fase mana pun; ada di working tree sebelum sesi |
| `PHASE-0-PLAN.md` | T04 | Rencana Fase 0 (17 Nov) yang mendasari T04; ada sebelum sesi |
| `src/db.js` `insert*ForTenant`, `src/limits.js` | v5 | Tidak ada di working tree saat sesi dimulai; dipakai `wa.js` v5; `limits.js` ditulis 00:26 (jendela v5) |
| `tests/tenant-t01.test.mjs`, `scripts/verify-tenant-sessions-browser.mjs` | v5 | Ditulis 00:23 dan 00:25 (jendela v5) |
| `src/tenantScope.js` | Dipecah: capability → T04, `resolveInboundChatScope` → v6 | Bagian v6 ditulis 01:06:51 bersama `dealDetection.js`, satu-satunya pemakai |
| `scripts/phase-harness`, `verify-ai3/4/rules`, `verify-hardening` (stub vm) | v6 | Kelimanya ditulis 01:06:51 |
| `src/media.js` | v7 | Ditulis 01:15:43, sama dengan `dealReview.js`, pemakai `dealProofAvailable` |
| `src/platformRoutes.js` route `/deal-analytics` | Dicabut dari T04 → G1 (Tugas 3) | Ditulis 01:19:40, bersamaan dengan `dealAnalyticsRoutes.js` |
| `src/wa.js` `insertMessageWithSource`, `src/db.js` statement-nya | G1 (Tugas 3) | Kolom `analytics_source` baru ada di v8 |
| `docs/t03/evidence/verify-before/*`, `artifacts/ai/*.png` | G1 #2 | Ditulis ulang oleh run regresi saya selama sesi |

**Kritik:**
1. **"Bila merah, commit wip:"** membuat kelima commit Codex berlabel `wip:`, padahal merahnya **bukan** dari kode fase itu. Usul: bedakan `wip:` (kode fase rusak) dari merah karena lingkungan atau tes masa depan. Untuk sekarang, penyebab sudah dicatat di badan setiap commit.
2. **"Jalankan suite" per commit** bergantung pada `data/app.db` lewat `tenant-t01`. Hasil suite jadi tergantung keadaan database lokal, bukan hanya kode. Usul: `tenant-t01` memakai fixture database legacy yang dibundel, bukan `data/app.db`.

## 7. Risiko sisa

- **Lima commit `wip:` di histori.** Commit-nya tidak rusak, tetapi siapa pun yang men-checkout `7bc7377`–`6417051` akan melihat suite merah. Sesuai aturan 12, ini tidak ditulis ulang.
- Penentuan fase berbasis waktu file bisa keliru untuk satu-dua hunk (bagian 5). Dampaknya terbatas: hunk tetap ada di histori, hanya mungkin di commit fase yang bertetangga.
- **Worktree uji masih ada** di `scratchpad/g0-wt` (detached, dengan salinan `data/app.db`). Akan dipakai lagi di G1, lalu dihapus (`git worktree remove`).
- Server preview :3200 dan :3100 masih berjalan seperti sebelumnya (tidak disentuh di G0).

## 8. Usulan langkah berikutnya

1. **G1:** lima commit saya, sesuai urutan spesifikasi: patch 2 baris `deal-foundation` → tes AI (+ bukti regresi & screenshot) → Tugas 3 → hotfix pengingat DP → pengokohan v8. Setelah commit terakhir, suite penuh harus 117/117 hijau dan working tree bersih.
2. Pertimbangkan kritik 6.2 (`tenant-t01` jangan membaca `data/app.db`) sebelum G3, karena G3 akan mengubah `data/app.db` ke v8 dan tes itu akan ikut berubah perilakunya.
