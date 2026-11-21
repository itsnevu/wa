# Laporan Tugas 3: Analytics Closing dan DP

Tanggal: 22 November 2026 · Branch: `feat/platform-capabilities` · Status: **belum di-commit, belum dideploy**

Laporan ini punya dua bagian. Bagian A menginventaris pekerjaan Codex yang ada di working tree. Bagian B menjelaskan
apa yang saya (Claude) lanjutkan dan perbaiki untuk Tugas 3. Semua klaim tes di bawah disertai perintah dan output
aktual dari sesi ini.

---

## Ringkasan

- Analytics closing dan DP sekarang lengkap: backend yang sudah diaudit, dashboard tenant, ekspor CSV, dan agregat platform.
- Draft menyimpan **satu regresi serius** yang sudah diperbaiki: sejak migrasi v8, menghapus chat atau nomor yang
  punya deal belum diputuskan selalu gagal (`FOREIGN KEY constraint failed`), padahal di v7 diizinkan.
- Ada empat bug lain yang juga sudah diperbaiki: nama agen kosong pada atribusi, status terminal lama tanpa bukti yang terhitung
  sebagai "pending", rentang tanggal yang ditolak karena selisih jam milidetik antara browser dan server, dan tren mingguan yang
  memakai minggu UTC, bukan minggu menurut zona waktu tenant.
- Hasil tes: **100/100** `node --test`, **28/28** skrip regresi T03, cek browser T04 lulus, dan cek browser analytics lulus 3 dari 3 percobaan.
- Database operasional (`data/app.db`) **tidak disentuh** dan masih di schema v4. Migrasi v5 sampai v8 perlu dijalankan
  saat jendela maintenance.

---

## A. Pekerjaan Codex (inventaris working tree)

Isi bagian ini disusun dari inspeksi file dan tes, bukan dari log Codex. Repo ini **tidak punya `AGENTS.md`**, jadi
koordinasi mengikuti aturan di instruksi tugas.

| Area | File utama | Isi |
|---|---|---|
| T04 platform & capabilities | `src/capabilities.js`, `src/platformRoutes.js`, `src/platformMigration.js`, `src/platformAudit.js`, `src/platformGrantState.js`, `public/platform.js/.css`, `tests/tenant-t04.test.mjs`, `docs/t04/` | Role platform admin tanpa akses isi chat bawaan. Grant masuk tenant yang wajib beralasan, read-only, dan punya masa berlaku. Audit log append-only. Schema v4. |
| Kesehatan sesi (v5) | `src/sessionHealth*.js`, `public/session-health.*`, `tests/session-health.test.mjs` | Status sinkron per nomor, resync yang di-scope per tenant, antrean kirim, dan backfill riwayat opsional. |
| Fondasi deal (v6) | `src/dealMigration.js`, `src/dealDetection.js`, `src/dealClassifier.js`, `src/dealReasons.js`, `tests/deal-foundation.test.mjs` | Tabel `deals`, `deal_events` (append-only), `dp_payments`, `deal_verifications`, dan `classifier_runs`. Deteksi deal dari chat dengan classifier regex di worker. Taksonomi alasan drop-off. |
| Review deal (v7) | `src/dealReview*.js`, `public/deal-review.*`, `tests/deal-review.test.mjs`, `docs/t05/` | Antrean verifikasi, keputusan (lunas, DP, cicilan, tolak, butuh info), job SLA/DP hangus/digest, dan audit sampel 5%. |
| Draft analytics (v8) | `src/dealAnalytics.js`, `src/dealAnalyticsMigration.js`, `src/dealAnalyticsRoutes.js`, serta integrasi di `src/routes.js`, `src/platformRoutes.js`, `src/wa.js`, `src/db.js` | Migrasi v8 (event `analytics_*`, kolom jam operasional, `messages.analytics_source`), replay fakta dari event, endpoint tenant dan platform, CSV, dan refund dengan four-eyes. Route sudah tercatat di inventory. |
| Penyesuaian bersama | `src/schemaMigrations.js`, `scripts/build-schema-fingerprints.mjs`, `src/schema-fingerprints.json`, `tests/route-inventory.*`, `docs/t01/route-inventory.md`, `src/index.js` | Rantai migrasi v1 sampai v8, generator fingerprint, dan timer job deal. |

Codex sudah menyiapkan sebagian besar logika metrik (rumus, `low_sample`, redaksi CSV, refund idempoten). Yang belum ada
adalah UI, tes khusus analytics, dan pemeriksaan dampak migrasi v8 terhadap penghapusan data.

---

## B. Lanjutan dan perbaikan dari Claude

### B1. Perbaikan backend

| # | Masalah di draft | Perbaikan | File |
|---|---|---|---|
| 1 | **Regresi penghapusan.** Trigger v8 menulis `analytics_opened`/`analytics_dimensions` untuk setiap deal. Karena `deal_events.deal_id` memakai `ON DELETE RESTRICT`, menghapus chat atau nomor dengan deal hasil deteksi yang belum diputuskan selalu gagal. Di v7 hal ini diizinkan. Terbukti di fixture: `chat delete FAIL: FOREIGN KEY constraint failed`. | Trigger `deal_analytics_purge` menghapus event bookkeeping sistem (`analytics_opened/dimensions/baseline/answered`) **hanya** kalau deal tidak punya event bisnis. `deal_events_no_delete` hanya mengizinkan penghapusan tipe sistem itu ketika chat atau nomor deal sudah hilang (cascade). Hasilnya, delete langsung tetap diblokir dan deal yang sudah diputuskan tetap dilindungi, persis seperti v7. | `src/dealAnalyticsMigration.js` |
| 2 | `qualified_unanswered` hanya bisa dicatat manual lewat endpoint. | `sweepUnanswered(tenantId, now)` dengan clock injeksi. Pesan masuk dihitung hanya kalau diterima **di dalam jam operasional tenant** dan tidak dibalas selama 24 jam. Setiap pesan masuk dicatat sekali per deal (idempoten lewat `inbound_id`). Sweep berjalan sebelum setiap pembacaan tenant, platform, atau CSV. Endpoint manual memakai logika yang sama. | `src/dealAnalytics.js` |
| 3 | Nama agen kosong ketika chat tidak di-assign. `agent_id` diambil dari pesan keluar terakhir, tapi namanya hanya dicari dari assignee, sehingga label menjadi "Agen #11". | ID dan nama memakai ekspresi yang sama. Nama hanya diambil kalau user tersebut anggota tenant deal (mencegah nama bocor lintas tenant). | `src/dealAnalyticsMigration.js` |
| 4 | Status terminal v7 tanpa bukti keputusan (misalnya `rejected` tanpa `deal_verifications`) jatuh kembali ke `candidate` dan terhitung "pending verifikasi". | Diberi status replay `unverified_legacy`. Status ini terlihat di `counts.unverified_legacy` dan di catatan dashboard, tetapi **tidak masuk metrik apa pun**. | `src/dealAnalytics.js` |
| 5 | Tren mingguan memakai minggu UTC. | `weekOf(at, timezone)` membuat minggu Senin–Minggu menurut zona waktu tenant. Agregat platform memakai UTC karena tenant berbeda-beda. | `src/dealAnalytics.js` |
| 6 | Rentang tanggal ditolak (`400`) ketika jam browser sedikit lebih maju dari server. Ditemukan lewat cek browser yang gagal 1 dari 2 percobaan. | Akhir rentang yang ada di masa depan dipotong ke `now`, bukan ditolak. Replay tetap memakai `e.at <= now`. | `src/dealAnalytics.js` |
| 7 | Beberapa metrik tidak membawa `n`. | `open_deals` dan `pending_verification` sekarang berbentuk `{value, n, …}`, dan `funnel_note` ditambahkan. | `src/dealAnalytics.js` |
| 8 | Escape CSV belum menangani sel yang diawali tab atau CR. | Pola `^[\t\r]|^\s*[=+@-]` diberi awalan `'`. | `src/dealAnalytics.js` |
| 9 | Fingerprint schema. | Diregenerasi dengan generator yang ada. Hanya `current` (v8) yang berubah; v1 sampai v7 tetap. | `src/schema-fingerprints.json` |

Classifier dan taksonomi alasan **tidak diubah**.

### B2. Dashboard tenant (baru)

File: `public/deal-analytics.js`, `public/deal-analytics.css`. Menu baru di rail: **Analytics closing**.

- **8 KPI**, masing-masing dengan `n`: closing rate, porsi DP, DP terlunasi, deal terbuka (DP aktif + menunggu bukti), pending verifikasi (terpisah dari closing), AOV, pendapatan bruto, dan pendapatan neto. Rate dengan n < 10 diberi tanda **n < 10**. Pembagi nol tampil sebagai **"Data belum tersedia"**.
- Tren mingguan deal lunas (tooltip per minggu berisi closing% dan n).
- Funnel inquiry → qualified → kandidat → bukti/DP → lunas, dengan catatan bahwa inquiry hanya mencakup chat yang sudah tercatat sebagai deal.
- DP vs langsung, AOV neto, alasan drop-off, serta time-to-close dan aging (antrean verifikasi, DP aktif, DP hangus) dengan rata-rata dan **p90**.
- Rincian per produk, nomor, agen, dan AI vs manusia. Atribusi kosong tampil eksplisit sebagai "Belum tercatat" atau "Belum diketahui".
- Form jam operasional (zona waktu IANA, jam buka dan tutup) dan tombol **Ekspor CSV**.
- Agen melihat pesan penolakan yang jelas, bukan angka.

Screenshot: `docs/deal-analytics/evidence/analytics-desktop.png`, `analytics-360px.png`.

### B3. Patch file bersama (minimal, hanya menambah baris)

| File | Perubahan |
|---|---|
| `public/index.html` | +1 `<link>` CSS, +1 tombol rail, +1 `<script>`, +1 blok `pages.analytics`, +1 baris `railPages.railAnalytics`. Satu baris lama diubah: `'analytics'` ditambahkan ke daftar halaman tanpa tombol aksi. |
| `public/sw.js` | `V` dinaikkan dari `wa-suite-v27` ke `v28` (diwajibkan komentar file), +1 baris `SHELL.push` untuk aset analytics. |
| `src/schema-fingerprints.json` | Regenerasi otomatis; hanya `current` yang berubah. |

`src/routes.js`, `src/platformRoutes.js`, route inventory, dan migrasi bersama lainnya **tidak saya ubah**. Draft sudah
memasang dan mencatat route dengan benar.

### B4. Akses dan scope

| Route | Scope | Owner / tenant_admin | Agent | Platform admin |
|---|---|---|---|---|
| `GET /api/deals/analytics` | tenant | 200 (detail) | 403 | ditolak (tidak ada tenant aktif atau grant) |
| `GET /api/deals/analytics/export` | tenant | 200 CSV, `no-store` | 403 | ditolak |
| `PATCH /api/deals/analytics/hours` | tenant | 200 | 403 | ditolak |
| `POST /api/deals/:id/analytics-outcome` | tenant | refund wajib oleh pengelola selain pemverifikasi | 403 | ditolak |
| `GET /api/platform/deal-analytics` | platform `tenant.list` | 403 | 403 | 200: hanya total lintas tenant, tanpa grup, daftar deal, nama, atau isi chat |

Platform admin yang memakai grant tetap ditolak di analytics tenant (`!scope.grant`). Semua route tercatat sebagai `scoped` di
`docs/t01/route-inventory.md`.

---

## C. Definisi dan asumsi metrik

| Metrik | Rumus |
|---|---|
| closing_rate | verified_lunas ÷ (verified_lunas + rejected + qualified_unanswered + dp_hangus) |
| dp_share | deal yang pernah dp_aktif ÷ deal dengan uang masuk |
| dp_settle | verified_lunas(origin=dp) ÷ (verified_lunas(origin=dp) + dp_hangus) |
| open_deals | dp_aktif + awaiting_proof |

Asumsi yang perlu disetujui pemilik produk:

1. **Kohort per tanggal deal dibuka.** Metrik periode X mencakup deal yang dibuka dalam periode X, dengan hasil akhir dihitung sampai `now`.
2. **Tak terjawab** berarti pesan masuk terakhir dalam jam operasional tidak dibalas selama **24 jam wall-clock** (`UNANSWERED_AFTER`). Pesan di luar jam operasional tidak pernah dihitung, walaupun tetap tidak dibalas keesokan harinya. Jam operasional tidak membedakan hari kerja dan akhir pekan. Kalau buka sama dengan tutup, artinya 24 jam (ini default ketika belum diatur).
3. **Bruto** memakai nominal tagihan deal saat diverifikasi, bukan nominal bukti transfer yang di-override. Refund mengurangi neto dan tidak mengubah status lunas maupun closing rate.
4. Status v7 `verified_lunas`/`rejected` tanpa baris `deal_verifications` dianggap **tidak terverifikasi** (`unverified_legacy`).
5. Hanya deal dengan status `candidate`, `awaiting_proof`, atau `expired` yang bisa menjadi "tak terjawab". `proof_submitted` sedang menunggu tim kita sendiri, jadi masuk "pending verifikasi".
6. Agregat platform memakai minggu UTC.
7. CSV dipotong sesuai `RETENTION_DAYS`, meredaksi deret ≥ 7 digit (contoh: `12******90`), dan memberi awalan `'` pada sel yang diawali `= + - @`, tab, atau CR.

---

## D. Tes: perintah dan hasil

Tes baru:
- `tests/deal-analytics.test.mjs` (11 tes): ketujuh skenario wajib, replay as-of, atribusi, minggu menurut zona waktu, dan role lewat HTTP.
- `tests/deal-analytics-migration.test.mjs` (3 tes): menurunkan fixture ke schema v7 yang persis (fingerprint dicek), mengisi data v7, memigrasikan ke v8, lalu memeriksa backfill, metrik, dan semantik penghapusan.
- `scripts/check-deal-analytics-browser.mjs`: Chrome headless pada 1366 px dan 360 px.

| Skenario wajib | Tes |
|---|---|
| Pesan di luar jam operasional | `1. pesan di luar jam operasional …` (termasuk balasan dan keputusan tanpa hitung ganda, serta clock injeksi) |
| DP aktif vs DP hangus pada penyebut | `2. DP aktif di luar penyebut closing …` |
| Refund bruto/neto | `3. refund menurunkan neto …` (termasuk four-eyes, idempotensi, dan batas saldo) |
| Origin DP setelah lunas | `4. origin DP tetap DP setelah lunas` |
| Tanda n < 10 | `5. tanda n < 10 dan pembagi nol …` (batas 9 vs 10) |
| Redaksi CSV | `6. CSV meredaksi telepon/rekening …` (termasuk retensi) |
| Isolasi semua agregat | `7. isolasi semua agregat …` |

Output (dijalankan di sesi ini):

```
$ node --test tests/*.test.mjs
INVENTORY {"total":108,"public":3,"scoped":43,"pending":{"T05":18,"T06":34,"T08":4,"T13":5,"T07":1}}
ℹ tests 100
ℹ pass 100
ℹ fail 0

$ node scripts/run-t03-regressions.mjs
exit 0 · 28 skrip "exit":0 · 0 gagal

$ node scripts/check-t04-browser.mjs
T04 UI verified at desktop and 360px

$ node scripts/check-deal-analytics-browser.mjs   (3x berturut-turut)
PASS deal analytics UI: 8 KPI with n, n<10 badge, weekly trend, funnel note, explicit unknown attribution,
CSV link, no overflow at 1366px and 360px, agent refused; screenshots in docs/deal-analytics/evidence
```

Sebelum perubahan saya, suite yang sama menghasilkan 86/86. Penambahan 14 tes berasal dari dua file tes analytics.

---

## E. Risiko dan hal yang masih terbuka

1. **Database operasional masih v4.** Server lokal di port 3100 berjalan dengan kode lama dan tidak saya restart. Untuk
   memakai fitur ini perlu `ALLOW_AUTO_MIGRATE=1 node scripts/migrate-schema.mjs` (v4 → v8, dengan backup otomatis)
   saat maintenance. Ini sengaja tidak saya jalankan.
2. **Pembacaan menulis event.** GET analytics menjalankan sweep yang menambah event `analytics_unanswered` (idempoten,
   actor `null`). Agregat platform juga memicunya untuk semua tenant. Kalau tidak diinginkan, sweep bisa dipindah ke
   timer job, tetapi itu menyentuh `src/dealReviewJobs.js` atau `src/index.js` (milik Codex) sehingga perlu koordinasi.
3. **Append-only sedikit dilonggarkan.** Event bookkeeping sistem boleh terhapus ikut cascade ketika chat atau nomor dihapus
   dan deal belum punya keputusan. Event bisnis tetap tidak bisa dihapus. Perlu persetujuan reviewer.
4. **Fingerprint v8 berubah.** Database yang sudah dimigrasikan ke draft v8 sebelumnya (kalau ada) akan ditolak saat startup.
   Sejauh yang saya lihat hanya fixture tes yang terdampak, dan fixture selalu dibuat ulang.
5. **Konflik dengan Codex:** tidak ada blok yang bentrok saat diperiksa. File bersama yang saya sentuh hanya
   `public/index.html`, `public/sw.js` (termasuk bump `V`), dan `src/schema-fingerprints.json` (hasil generator). Kalau Codex
   juga menaikkan `V` atau meregenerasi fingerprint, ambil nilai terbaru dan jalankan ulang generator.
6. `scripts/run-t03-regressions.mjs` menulis ulang file bukti di `docs/t03/evidence/verify-before/`. File tersebut memang
   sudah termodifikasi sebelum sesi ini.
7. **Belum ada UI platform** untuk `/api/platform/deal-analytics` (API sudah ada dan teruji). Ini bisa ditambahkan di
   `public/platform.js` setelah koordinasi dengan Codex.
8. Belum ada commit. Commit seluruh working tree dilarang oleh instruksi tugas, jadi commit perlu memilih file Tugas 3 saja.

### File Tugas 3 (untuk commit terpilih)

```
src/dealAnalytics.js  src/dealAnalyticsMigration.js  src/dealAnalyticsRoutes.js
public/deal-analytics.js  public/deal-analytics.css
tests/deal-analytics.test.mjs  tests/deal-analytics-migration.test.mjs
scripts/check-deal-analytics-browser.mjs  docs/deal-analytics/
public/index.html (hunk analytics)  public/sw.js  src/schema-fingerprints.json
```
