# Tugas 5A · Gerbang 2: Perbaikan v8 setelah audit

**TL;DR**
1. Semua perbaikan yang diminta sudah ada di v8 dan teruji. Tes 1–13 hijau (tes 1 dan 2 terbukti merah sebelum perbaikan), regresi 28/28, cek browser analytics dan T04 lulus.
2. **Satu tes lama masih merah:** `tests/deal-foundation.test.mjs` "v5 database upgrades…" (milik Codex). Tes itu men-drop daftar objek v8 yang ditulis manual, termasuk `analytics_close_min` yang sekarang sudah dicabut. Perbaikannya butuh izin mengubah file Codex. Sesuai aturan, saya berhenti di sini.
3. **Temuan baru yang penting untuk pembekuan:** fingerprint schema hanya mencakup tabel dan kolom. Perubahan trigger, indeks, FK `ON DELETE`, dan CHECK **tidak terdeteksi** saat start. Sudah dibuktikan dengan tes.

---

## 1. Ringkasan perubahan

| file:line | Perubahan | Alasan |
|---|---|---|
| `src/dealAnalyticsMigration.js:17-24` | `DEAL_EVENT_TYPES` (18 tipe, `is_system`) + tabel `deal_event_types(type PK, is_system CHECK 0/1)` diisi di v8 (`:47-48`) | Keputusan 1: tabel rujukan, bukan whitelist |
| `:25-28` | `DECIDED_STATES` + ekspresi `decided` = state ∈ {verified_lunas, dp_aktif, dp_termin, dp_hangus, rejected, refunded, cancelled} **atau** ada event `decision` | Keputusan 1 |
| `:115-123` | `deal_events_no_delete` tanpa filter tipe (hanya mengizinkan saat chat/nomor deal sudah hilang). `deal_decided_delete_guard` BEFORE DELETE ON deals → `RAISE(ABORT,'DEAL_DECIDED: …')`. `deal_analytics_purge` menghapus seluruh event deal yang belum diputuskan. | BL-1 |
| `:50-74` | Rebuild `deal_evidence`: `message_id` nullable `ON DELETE SET NULL`, `snapshot_sender_name/body/at NOT NULL DEFAULT`. Backfill snapshot dari pesan. Trigger scope UPDATE mengizinkan NULL. Trigger `deal_evidence_snapshot` AFTER INSERT mengisi snapshot. | Keputusan FK 1 (bukti vs retensi) |
| `:76-100` | Rebuild `deal_verifications`: `"by"` nullable `ON DELETE SET NULL`, `actor_label TEXT NOT NULL DEFAULT ''`, backfill label. Trigger scope INSERT tetap mewajibkan verifier anggota tenant; UPDATE mengizinkan NULL. Trigger `deal_verifications_label` AFTER INSERT. | Keputusan FK 2 |
| `:36-45` | Trigger tabel lain yang merujuk tabel yang di-rebuild disimpan dengan SQL persisnya dari `sqlite_master`, lalu dibuat ulang | SQLite memvalidasi ulang trigger saat rename; tanpa ini migrasi gagal (`deals_other_reason_update`, milik v6) |
| `:125-126` | `analytics_open_min` dan `analytics_close_min` **dihapus** dari v8; `analytics_timezone` tetap | Keputusan 2 |
| `src/dealAnalytics.js:10-13,35-55` | Hanya membaca dan menulis `analytics_timezone`. Jam dari `config.businessStart/End` (`source:'server_config'`). Field JS diganti `start_min`/`end_min`. `configureDealHours` hanya menerima `timezone`. | Keputusan 2 + tes 10 |
| `public/deal-analytics.js:47,94-98,108` | Form hanya untuk zona waktu; jam tampil read-only dengan keterangan "mengikuti konfigurasi server" | Keputusan 2 |
| `src/routes.js:194-216` | `deleteFailure()`: `DEAL_DECIDED` → 409 `{code:'DEAL_DECIDED'}`, `SQLITE_CONSTRAINT*` → 409 `{code:'CONSTRAINT'}`, `SQLITE_*` lain → 400. Hapus nomor: 404 kalau tidak ada → DELETE dulu → `disconnect` dan `forgetSession` best-effort, masing-masing dibungkus try/catch dengan log `[number.delete]` | Keputusan 3 (BL-2, RD-1) |
| `src/routes.js:373` | Hapus chat memakai `deleteFailure` | Keputusan 3 |
| `src/routes.js:481-484` | Hapus user memakai `deleteFailure` | Keputusan 3 |
| `src/wa.js:686-707` | `forgetSession(id)` (melempar error supaya bisa dicatat) dan `cleanOrphanSessions()` (folder sesi numerik tanpa baris `numbers` dan tidak live) | Pembersihan sesi yatim |
| `src/index.js:67` | `wa.cleanOrphanSessions()` dipanggil sekali saat startup, sebelum `restoreAll` | Pembersihan sesi yatim (lihat bagian 4: penempatan di job 6 jam dicabut) |
| `src/schema-fingerprints.json` | Regenerasi lewat generator; **hanya `current` yang berubah** | Invarian |
| `tests/deal-delete.test.mjs` (baru) | Tes 1–10 (+5b sesi yatim) lewat HTTP nyata | Tes wajib |
| `tests/v7-fixture.mjs` (baru) | Membangun database v7 **asli** lewat rantai migrasi yang sama dengan generator, lalu diisi data v7 | Tes 11/12 tanpa downgrade manual |
| `tests/deal-analytics-migration.test.mjs` (ditulis ulang) | 11a–d, 12, 7, 7b | Tes wajib 11, 12, dan fingerprint |
| `tests/deal-analytics.test.mjs:22-23,52,230,238` | Jam dari config (dipulihkan tiap tes); body PATCH hanya `timezone` | Mengikuti keputusan 2 |

## 2. Yang ditingkatkan

- **Dalam cakupan:**
  - Deal belum diputuskan bisa dihapus apa pun tipe event-nya.
  - Deal sudah diputuskan ditolak dengan 409 JSON berpesan jelas.
  - Hapus nomor tidak lagi me-logout sesi kalau DELETE gagal.
  - Bukti deal bertahan melewati retensi pesan.
  - Verifier bisa dihapus tanpa kehilangan jejak nama.
  - Jam operasional tidak lagi menjadi kolom mati.
- **Di luar cakupan:** tidak ada.

## 3. Bonus di luar cakupan

Tidak ada. Penanganan hapus user (`routes.js:481-484`) termasuk dalam "ketiga route hapus" di keputusan 3.

## 4. Keputusan yang saya ambil sendiri

| Keputusan | Alternatif ditolak | Alasan |
|---|---|---|
| Kolom snapshot `NOT NULL DEFAULT ''`/`0`, diisi trigger AFTER INSERT | Mengubah `INSERT INTO deal_evidence` di `dealDetection.js:27` dan `dealReview.js:56` (file Codex) | Kedua penulis tetap bekerja tanpa diubah; snapshot tetap terisi saat bukti dicatat |
| `actor_label` diisi trigger AFTER INSERT | Mengubah `insertVerification` di `dealReview.js` | Alasan sama: file Codex tidak disentuh |
| Nama kolom tetap `"by"` (bukan `actor`) | Rename ke `actor` | `"by"` dipakai `dealReview.js:58,201` dan backfill v8. Rename menyentuh file Codex dan menambah risiko. Lihat bagian 6. |
| `deal_event_types` **tidak** dipaksakan lewat trigger INSERT pada `deal_events` | Trigger yang menolak tipe tak terdaftar | Spesifikasi meminta penegakan lewat tes. Trigger akan membuat job produksi gagal saat runtime kalau ada tipe baru. Tes menangkap tipe baru sebelum merge (dibuktikan dengan probe). |
| `is_system` tidak dipakai aturan hapus | Menghapus hanya event `is_system=1` | Aturan keputusan 1 berbasis state/decision; deal yang belum diputuskan dihapus bersama **seluruh** event-nya. `is_system` dipertahankan sebagai metadata terdaftar. |
| Pembersihan sesi yatim saat startup saja; **penempatan di job retensi 6 jam dicabut** | Tetap di job 6 jam | Tes lama `verify-phase5` menjalankan badan job retensi di sandbox tanpa `wa` dan menjadi merah. Sesuai aturan, saya mencabut baris saya sendiri dan tidak membuat solusi baru. Lihat bagian 6. |
| Injeksi kegagalan tes 5: proses lain memegang folder sesi sebagai cwd (EPERM di Windows) | Mengganti `sessions` dengan file, chmod read-only | Dibuktikan bahwa `rmSync({force})` tidak gagal pada ENOTDIR atau read-only; hanya kunci cwd yang membuatnya gagal |

## 5. Sudah diverifikasi vs masih asumsi

### Sudah diverifikasi

**Tes 1 dan 2 sebelum perbaikan** (`v8-audit/gate2-red-before.txt`, seluruh 12 tes baru merah):
```
✖ 1. hapus chat dengan deal kandidat ber-event sla_escalated -> berhasil
  AssertionError [ERR_ASSERTION]: <!DOCTYPE html>
  <html lang="en">
✖ 2. hapus chat dengan deal rejected -> 409 JSON
  AssertionError [ERR_ASSERTION]: <!DOCTYPE html>
  <html lang="en">
✖ 3. … SqliteError: FOREIGN KEY constraint failed
ℹ tests 12 · pass 0 · fail 12
```

**Tes 1–10 sesudah perbaikan** (`v8-audit/gate2-green-after.txt`):
```
✔ 1. hapus chat dengan deal kandidat ber-event sla_escalated -> berhasil
✔ 2. hapus chat dengan deal rejected -> 409 JSON
✔ 3. hapus chat dengan deal verified_lunas -> 409 JSON (state saja sudah cukup)
✔ 4. hapus nomor dengan deal belum diputuskan -> berhasil, sesi ikut dibersihkan
✔ 5. disconnect gagal -> baris tetap terhapus, kegagalan tercatat
✔ 5b. sesi yatim dibersihkan oleh job, sesi nomor aktif dipertahankan
✔ 6. hapus nomor yang tidak ada -> 404 JSON
✔ 7. setiap tipe event terdaftar di deal_event_types; perilaku hapus per tipe
✔ 8. purge pesan tidak menghapus deal_evidence; message_id jadi NULL, snapshot utuh
✔ 9. hapus user yang pernah memverifikasi -> berhasil, actor_label tetap
✔ 10. tidak ada kode yang membaca open_min/close_min
ℹ tests 11 · pass 11 · fail 0
```

**Tes 7: tipe tak terdaftar menggagalkan tes** (probe sementara `src/__probe_unregistered.js`, sudah dihapus):
```
  + actual - expected
  +   'tipe_baru_palsu'
    actual: [ 'tipe_baru_palsu' ],
(setelah probe dihapus) ℹ pass 11 · fail 0
```

**Tes 11, 12, dan fingerprint** (`v8-audit/gate2-migration.txt`):
```
MIGRATION v7->v8 {"ms":34,"before":{"deals":5,"deal_events":3,"deal_evidence":1,"deal_verifications":2,"dp_payments":1,"messages":1,"chats":5,"tenants":2},
  "after":{…"deal_events":18…},"delta":{"deals":0,"deal_events":15,"deal_evidence":0,"deal_verifications":0,"dp_payments":0,"messages":0,"chats":0,"tenants":0}}
✔ 11a. v7 -> v8 pada salinan berisi data: versi, fingerprint, backup, baris terdampak
✔ 11b. migrasi dijalankan kedua kali: tidak ada perubahan schema maupun data
✔ 11c. backfill: snapshot bukti, label verifier, dan metrik hanya dari keputusan tercatat
✔ 11d. aturan hapus setelah migrasi: belum diputuskan (dengan sla_escalated) ikut terhapus, sudah diputuskan ditolak
ROLLBACK start without ALLOW_AUTO_MIGRATE: 1 Schema version ${fromVersion} != ${SCHEMA_VERSION}; run ALLOW_AUTO_MIGRATE=1 …
ROLLBACK start with ALLOW_AUTO_MIGRATE=1: healthy = true
✔ 12. rollback: backup otomatis dipulihkan sebagai v7 yang valid, server menolak tanpa izin migrasi lalu start setelah diizinkan
TAMPERED column start: 1 Schema fingerprint mismatch; startup refused');
✔ 7. fingerprint tidak cocok (kolom berubah) -> server menolak start dengan pesan jelas
DRIFT index+trigger start: healthy = true
✔ 7b. batas fingerprint: perubahan indeks/trigger TIDAK terdeteksi saat start
ℹ tests 7 · pass 7 · fail 0
```
Catatan: baris `ROLLBACK …` mencetak teks sumber pesan error (Node menampilkan baris kode yang melempar error); pesan aktualnya `Schema version 7 != 8; run ALLOW_AUTO_MIGRATE=1 …`, dan regex tes `/Schema version 7 != 8/` cocok.

**Fingerprint:**
```
$ node scripts/build-schema-fingerprints.mjs   (dibandingkan dengan salinan sebelum Gerbang 2)
berubah: current
-  "current": "eb57ecce…"   (nilai HEAD)
+  "current": "915debfcbcf7980db7d97c8c9af5f1f992a9c0470cb04041df480b8c393faa83"
```

**Tes 13** (`v8-audit/gate2-full-suite.txt`):
```
$ node --test tests/*.test.mjs
INVENTORY {"total":108,"public":3,"scoped":43,"pending":{"T05":18,"T06":34,"T08":4,"T13":5,"T07":1}}
ℹ tests 117 · pass 116 · fail 1
✖ v5 database upgrades with a v5 backup and existing messages intact
  Error [SqliteError]: no such column: "analytics_close_min"

$ node scripts/run-t03-regressions.mjs
exit 0 · 28 lulus · 0 gagal      (sempat 27/1: verify-phase5 "[sesi] wa is not defined" → baris saya dicabut)

$ node scripts/check-deal-analytics-browser.mjs
PASS deal analytics UI: 8 KPI with n, n<10 badge, weekly trend, funnel note, explicit unknown attribution, CSV link,
no overflow at 1366px and 360px, agent refused

$ node scripts/check-t04-browser.mjs
T04 UI verified at desktop and 360px
```

**Pembaca `open_min`/`close_min`:** tes 10 memindai seluruh `src/` dan `public/` (`.js`, `.mjs`, `.html`) dan hasilnya 0 baris. Di `tests/` tersisa satu baris, yaitu `tests/deal-foundation.test.mjs:54`, yang menjadi penyebab tes merah di atas.

**Tipe event:** pemindai menemukan semua tipe yang ditulis di `src/` (lewat `appendDealEvent`, `INSERT INTO deal_events … SELECT`, dan notice `dp_*` yang dicatat ulang sebagai event), dan semuanya terdaftar. Ada 18 tipe terdaftar: `analytics_opened, analytics_dimensions, analytics_baseline, analytics_answered, analytics_unanswered, sla_escalated, sla_expired, dp_hangus, dp_h_minus_1, dp_h_plus_1, dp_reminder_skipped, decision, proof_recorded, dp_termin, refund, analytics_qualified, audit_sampled, audit_completed`.

### Masih asumsi
- **Tes 5 dengan socket WhatsApp aktif:** diuji dengan kegagalan hapus folder sesi. Jalur `disconnect` pada socket live tidak bisa diuji tanpa WhatsApp; kodenya dibungkus try/catch yang terpisah.
- **Durasi migrasi pada data operasional:** 34 ms pada 5 deal di fixture. Data operasional (v4, belum ada deal) baru diukur di Gerbang 3.
- **"Rollback ke v7 → server start"** diuji sebagai: backup otomatis = v7 valid (fingerprint, versi 1–7, `integrity_check`, isi data sama dengan sebelum migrasi). Server dengan kode sekarang **menolak** tanpa izin migrasi, dan start setelah diizinkan. Kode v7 sendiri **tidak ada di git** (HEAD masih v3), jadi "start dengan kode v7" tidak bisa dijalankan.

## 6. Kritik terhadap spesifikasi dan hal yang harus diputuskan

1. **Tes lama merah, `tests/deal-foundation.test.mjs:54` (file Codex).** Tes itu menurunkan schema ke v5 dengan men-drop objek v8 satu per satu, termasuk dua kolom yang sudah dicabut. Patch yang saya usulkan, 2 baris dan hanya di tes, tanpa menyentuh kode produksi:
   ```diff
   - ALTER TABLE tenants DROP COLUMN analytics_close_min; ALTER TABLE tenants DROP COLUMN analytics_open_min;
   + DROP TABLE deal_event_types;
   ```
   (`deal_evidence`, `deal_verifications`, dan trigger pada `deals` sudah ikut ter-drop oleh `DROP TABLE` yang ada di baris 55–56.) **Perlu izin untuk mengubah file Codex**, atau Codex yang menerapkannya.
2. **Fingerprint tidak menjaga trigger, indeks, FK, maupun CHECK (temuan baru, terbukti di tes 7b).** Premis tugas "setiap perubahan v8 akan mengubah fingerprint dan server menolak start" hanya berlaku untuk tabel dan kolom. Hampir semua perbaikan Gerbang 2 berupa trigger dan aksi FK, jadi tanpa penjaga tambahan, pembekuan v8 tidak bisa dibuktikan. Usulan untuk Gerbang 3, tanpa mengubah algoritma `schemaFingerprint` (yang akan mengubah v1–v7):
   - `V8-FREEZE.md` memuat **hash DDL penuh** (`sqlite_master.sql`, diurutkan), di samping fingerprint.
   - Tes permanen: migrasi v7 → v8 menghasilkan hash DDL yang sama persis dengan manifest.
   - (Opsional, perlu keputusan) pemeriksaan hash DDL saat startup sebagai migrasi v9.
3. **Pembersihan sesi yatim "di job yang sudah ada".** Job retensi 6 jam dikunci oleh tes lama `verify-phase5` (badannya dijalankan di sandbox tanpa `wa`). Pilihan:
   - **(a) Jalankan di job `checkBackup` 30 menit** (`index.js:47`). Saya rekomendasikan ini: job yang sudah ada dan tidak diuji di sandbox.
   - (b) Cukup saat startup, seperti sekarang.
   - (c) Perbarui `verify-phase5` supaya menyediakan `wa` di sandbox (file milik Codex).
4. **Nama kolom `deal_verifications.actor` di spesifikasi.** Kolom sebenarnya bernama `"by"`. Saya tidak me-rename (lihat bagian 4). Kalau rename tetap diinginkan, lebih baik dilakukan bersama Codex karena `dealReview.js` memakainya.
5. **Ada pembaca `open_min`/`close_min` lain?** Tidak ada di `src/` dan `public/` (tes 10). Satu-satunya sisa ada di `tests/deal-foundation.test.mjs:54` (poin 1).
6. **Ada tipe event yang belum masuk `deal_event_types`?** Tidak ada; pemindai menemukan semuanya terdaftar. Batas pemindai: tipe yang ditulis lewat variabel dinamis di luar pola `appendDealEvent(…,'literal')`, `INSERT … SELECT …'literal'`, dan notice `dp_*` tidak terdeteksi. Saat ini satu-satunya jalur dinamis adalah `dealReviewJobs.js:85` (`entry.kind`), yang tercakup lewat notice `dp_*`.
7. **Konsekuensi keputusan 2 masih berlaku:** sampai 0.6 (v9) mendarat, jam operasional mengikuti `BUSINESS_START/END` server untuk semua tenant. Dashboard tidak boleh dibuka ke pengguna sebelum itu.

## 7. Risiko sisa menuju pembekuan v8

- **Tes lama merah (poin 6.1).** Gerbang 3 tidak boleh dimulai sebelum tes ini hijau.
- **Pembekuan hanya terbukti untuk kolom (poin 6.2).** Tanpa hash DDL di manifest, perubahan trigger atau FK di v8 setelah beku tidak akan ketahuan.
- **v4–v7 belum di-commit** (milik Codex). Membekukan v8 berarti membekukan v4–v7 juga, karena fingerprint v8 bergantung pada keduanya.
- **Rebuild 2 tabel v6 di v8.** Ini mengubah definisi akhir objek v6 (`deal_evidence`, `deal_verifications`) lewat v8, sesuai keputusan FK. Migrasi v6 sendiri tidak diubah, tetapi ada risiko gesekan kalau Codex menambah migrasi yang mengasumsikan bentuk lama kedua tabel itu.
- **Route hapus chat dan nomor tetap tanpa `requireTenantScope`** (pending T05/T06 di inventory). Tidak diubah karena di luar batas tiga hal di `routes.js`.
- **Pembersihan sesi yatim hanya saat startup** sampai poin 6.3 diputuskan.
- RD-3 (verifier) sudah diperbaiki lewat SET NULL. K-1 (nilai CHECK state yang tidak dipakai) tetap ada; v6, tidak diubah.

## 8. Usulan langkah berikutnya

1. **Putuskan poin 6.1** (izin patch 2 baris di tes Codex), lalu jalankan ulang suite penuh untuk memastikan hijau.
2. **Putuskan poin 6.2** (hash DDL di manifest pembekuan) dan **6.3** (lokasi job sesi yatim).
3. Codex commit v4–v7.
4. Gerbang 3: salin database operasional → migrasi v4 → v8 di salinan → idempotensi → smoke → drill rollback → manifest (fingerprint + hash DDL) → `AGENTS.md` → commit `fix(schema): harden v8 before freeze`.
