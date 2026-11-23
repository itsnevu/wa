# Tugas 5A · Gerbang 1: Audit migrasi v8 sebelum dibekukan

**TL;DR**
1. Skema v8 cocok dengan kode: **49 statement SQL** dari 9 file di-`prepare` terhadap v8 tanpa satu pun gagal, semua trigger v8 menyala, dan setiap query analytics memakai indeks.
2. Ada **dua blocker** terkait hapus. (a) Deal yang belum diputuskan tetapi punya event sistem (sweep "tak terjawab", eskalasi SLA) tidak bisa dihapus. (b) `DELETE /numbers/:id` menghapus kredensial WhatsApp **sebelum** DELETE yang kemudian ditolak FK.
3. Satu keputusan desain harus diambil **sebelum** v8 dibekukan: kolom jam operasional di v8 tumpang tindih dengan jadwal per hari di v9.

Status: **audit saja**, tanpa kode perbaikan. Database operasional tidak disentuh. Menunggu persetujuan.

---

## 1. Ringkasan perubahan

Tidak ada perubahan kode. File bukti yang ditambahkan (`docs/deal-analytics/v8-audit/`):

| File | Isi |
|---|---|
| `v8-contents.txt` | Delta schema v7 → v8 yang sebenarnya, semua FK, semua indeks, uji jalankan ulang |
| `column-check.txt` | Hasil `prepare` 49 statement SQL terhadap v8 + uji trigger |
| `query-plans.txt` | `EXPLAIN QUERY PLAN` untuk 7 query/trigger analytics |
| `grep-names.txt` | Grep mentah untuk 20 nama tabel, kolom, indeks, dan trigger (202 baris) |
| `delete-routes.txt` | Respons HTTP hapus chat dan nomor yang punya deal sudah diputuskan |

### Isi v8 yang sebenarnya (`src/dealAnalyticsMigration.js`)

| Objek | Jenis | Baris |
|---|---|---|
| `tenants.analytics_timezone TEXT NOT NULL DEFAULT 'Asia/Jakarta'` | kolom | 31 |
| `tenants.analytics_open_min INTEGER CHECK(0..1439)` | kolom | 32 |
| `tenants.analytics_close_min INTEGER CHECK(0..1439)` | kolom | 33 |
| `messages.analytics_source TEXT CHECK IN ('ai','human')` | kolom | 34 |
| `deal_analytics_opened ON deals(tenant_id,created_at,id)` | indeks | 35 |
| `deal_verification_by_decision ON deal_verifications(deal_id,decision,id)` | indeks | 36 |
| `deal_analytics_messages ON messages(tenant_id,chat_id,from_me,id)` | indeks | 37 |
| `deal_events_no_delete` (didefinisikan ulang: event sistem boleh terhapus saat chat/nomor hilang) | trigger, **mengubah objek v6** | 23-26 |
| `deal_analytics_purge BEFORE DELETE ON deals` | trigger | 27-29 |
| `deal_analytics_insert AFTER INSERT ON deals` | trigger | 39-43 |
| `deal_analytics_dimensions AFTER INSERT ON deal_events` | trigger | 50-54 |
| `deal_analytics_answered AFTER INSERT ON messages` | trigger | 55-61 |
| Backfill `analytics_opened`, `analytics_dimensions`, `analytics_baseline` | INSERT saja | 44-49, 64-73 |

### Temuan, urut tingkat

#### Blocker

| # | file:line | Temuan | Bukti |
|---|---|---|---|
| **BL-1** | `src/dealAnalyticsMigration.js:20-29` | Purge trigger hanya menganggap 4 tipe event sebagai bookkeeping (`opened/dimensions/baseline/answered`). Event lain yang **juga ditulis sistem** (`actor` NULL) membuat deal belum diputuskan tidak bisa dihapus: `analytics_unanswered` dari sweep (`dealAnalytics.js:79`), `sla_escalated` (`dealReviewJobs.js:46`), `sla_expired` (`:41`), dan `dp_reminder_skipped` (`:72`). Setiap deal kandidat yang lebih dari 24 jam pasti mendapat `sla_escalated`, jadi praktis hampir semua deal belum diputuskan **tidak bisa dihapus**. | `column-check.txt`: `delete chat with undecided deal after system sweep event -> FAIL (FOREIGN KEY constraint failed)` |
| **BL-2** | `src/routes.js:194-198` (di luar v8, dipicu FK v6/v8) | `DELETE /numbers/:id` memanggil `wa.disconnect(id, true)` (menghapus folder `sessions/<id>`, `wa.js:683`) **sebelum** `q.deleteNumber`. Kalau nomor punya deal sudah diputuskan, DELETE ditolak FK. Hasilnya nomor tetap ada, tetapi sesi WhatsApp-nya sudah logout dan harus pairing ulang. | `delete-routes.txt`: status 500, `number row still exists: true`. Penghapusan kredensial dibuktikan dari kode (`wa.js:677`, `:683`); di probe tidak terjadi karena tidak ada socket aktif. |

#### Risiko data

| # | file:line | Temuan | Bukti / catatan |
|---|---|---|---|
| RD-1 | `src/routes.js:356`, `:197`, `:464` | Penolakan FK saat hapus chat, nomor, atau user menghasilkan **500 berupa HTML** berisi `SqliteError` dan stack trace. Tidak ada pesan yang jelas (tes wajib 2), dan detail internal bocor. | `delete-routes.txt`: `500 <!DOCTYPE html> … <pre>Sqlite…` |
| RD-2 | `src/dealAnalyticsMigration.js:31-33` vs rencana 0.6 | v8 sudah membuat `analytics_timezone/open_min/close_min` (satu jadwal untuk semua hari). 0.6 akan menambah jadwal per hari dan hari libur. Kalau v8 dibekukan apa adanya, dua kolom `open/close` menjadi warisan permanen yang harus terus disinkronkan atau diabaikan. | Lihat pertanyaan di bagian 6 |
| RD-3 | `src/dealMigration.js:49` (v6) | `deal_verifications.by → users ON DELETE NO ACTION`. `DELETE /users/:id` (`routes.js:464`) untuk admin yang pernah memverifikasi deal ditolak dengan 500 (sama seperti RD-1). | Dari `v8-contents.txt`. v6, tidak diubah (aturan keras 5). |
| RD-4 | `tests/deal-analytics-migration.test.mjs:76-83` | Tes hapus mencakup kasus 1 (chat, belum diputuskan) dan kasus 2 (chat, sudah diputuskan), tetapi **kasus 3 (hapus nomor dengan deal belum diputuskan) belum dites**, dan belum ada bukti bahwa tes gagal pada kode sebelum perbaikan. Kasus BL-1 juga belum dites. | — |

#### Kosmetik / catatan

| # | file:line | Temuan |
|---|---|---|
| K-1 | `src/dealMigration.js:4` (v6) | CHECK `deals.state` mengizinkan `dp_termin`, `refunded`, `cancelled`, tetapi kode tidak pernah menulisnya (`dp_termin` hanya dipakai sebagai tipe event). Tidak berbahaya; v6 tidak diubah. |
| K-2 | `src/wa.js:505` | `analytics_source` hanya diisi oleh `sendText`. Kiriman lewat kutip/media dan pesan dari HP sendiri bernilai NULL. Atribusi "manusia" tetap terbaca lewat `agent_id`. |
| K-3 | `src/schemaMigrations.js:51` | `migrateDealAnalytics(db)` dipanggil tanpa `if(fromVersion<8)`, berbeda gaya dari baris v2–v7. Aman karena runner `return` saat versi = 8 (`:31`). |
| K-4 | `query-plans.txt` | `history` dan `lastReplyMark` memakai temp B-tree untuk `ORDER BY`. Tidak perlu indeks tambahan untuk volume per tenant. |

#### Bersih (dengan bukti)

| Poin | Hasil |
|---|---|
| 1. Kolom dipakai vs dibuat | 49/49 statement valid, 0 gagal; semua trigger menyala |
| 2. `NOT NULL` tanpa default | Tidak ada. Satu-satunya `NOT NULL` baru punya `DEFAULT 'Asia/Jakarta'` |
| 3. CHECK dua arah | `analytics_source`: kode menulis `'ai'`/`'human'`/NULL ✓. `open/close_min` 0..1439 sama dengan validasi API `<1440` ✓. State yang ditulis kode (`no_signal, candidate, awaiting_proof, proof_submitted, verified_lunas, dp_aktif, rejected, dp_hangus, expired`) semuanya diterima ✓. `origin` direct/dp ✓. `reason_code` dari taksonomi ✓. `sender_role` tidak ada di v8 (milik v11+) ✓. Kebalikannya lihat K-1. |
| 5. Indeks | Ketujuh query analytics memakai indeks; tidak ada full scan; ketiga indeks v8 terpakai |
| 6. Backfill | **Tidak ada `UPDATE`**. Hanya `INSERT` event per deal yang sudah ada (append-only), sehingga baris lama tidak diubah |
| 7. Transaksi | Seluruh v8 berjalan di dalam satu transaksi `immediate` runner (`schemaMigrations.js:39-55`) dengan `foreign_key_check` sebelum commit |
| 9. Versi + fingerprint | `SCHEMA_VERSION=8`; `current` diperiksa sebelum commit migrasi; generator dijalankan ulang tanpa perubahan |

### File yang akan diubah di Gerbang 2 (perkiraan)

| File | Perubahan | Perkiraan |
|---|---|---|
| `src/dealAnalyticsMigration.js` | BL-1: aturan purge berbasis "ada aksi manusia" (lihat bagian 6). RD-2 sesuai keputusan. | ~10–25 baris |
| `src/routes.js` (bersama) | BL-2: urutan hapus nomor (DB dulu, baru disconnect). RD-1: FK ditolak → 409 + pesan jelas untuk chat, nomor, user. | ~20 baris |
| `src/dealAnalytics.js`, `public/deal-analytics.js` | Hanya kalau RD-2 memindahkan kolom jam | 0–30 baris |
| `tests/deal-analytics-migration.test.mjs` | Kasus 3, kasus BL-1, kasus route 409; dibuktikan merah sebelum perbaikan | ~40 baris |
| `scripts/check-v8-schema.mjs` (baru) | Tes wajib 8 dan 9: prepare semua SQL + CHECK dua arah, sebagai tes permanen | ~60 baris |
| `src/schema-fingerprints.json` | Regenerasi; hanya `current` | otomatis |

---

## 2. Yang ditingkatkan

Belum ada; ini gerbang audit.
- **Dalam cakupan:** pemetaan lengkap isi v8 dan buktinya.
- **Di luar cakupan:** dicatat saja: RD-3 (FK user v6) dan K-1.

## 3. Bonus di luar cakupan

Tidak ada.

## 4. Keputusan yang saya ambil sendiri

| Keputusan | Alternatif ditolak | Alasan |
|---|---|---|
| Pemeriksaan kolom dilakukan dengan `db.prepare` setiap literal SQL di schema v8 nyata | Grep nama kolom | SQL memakai alias, subquery, dan `json_object`; grep tidak bisa membuktikan kolom ada, sedangkan SQLite menolak kolom yang tidak ada saat prepare |
| Trigger diuji dengan benar-benar menyalakannya | Hanya membaca DDL | SQLite tidak memvalidasi referensi di badan trigger sampai trigger menyala |
| Audit `routes.js` (hapus chat/nomor/user) dimasukkan meski bukan file v8 | Membatasi ke file v8 | Tes wajib 1–3 diuji lewat perilaku hapus, dan perilaku itu lewat route |

## 5. Sudah diverifikasi vs masih asumsi

### Sudah diverifikasi

**Isi v8 (delta v7 → v8, dari rantai migrasi nyata di DB in-memory):**
```
~ table:tenants (definisi berubah)        ~ table:messages (definisi berubah)
~ trigger:deal_events_no_delete (definisi berubah)
+ trigger:deal_analytics_purge ON deals   + trigger:deal_analytics_insert ON deals
+ trigger:deal_analytics_dimensions ON deal_events   + trigger:deal_analytics_answered ON messages
+ index:deal_analytics_opened ON deals    + index:deal_verification_by_decision ON deal_verifications
+ index:deal_analytics_messages ON messages
+ tenants.analytics_timezone NOT NULL DEFAULT 'Asia/Jakarta'
+ tenants.analytics_open_min   + tenants.analytics_close_min   + messages.analytics_source
```

**Pemeriksaan kolom + trigger:**
```
prepared 49 SQL literals, 0 failed; triggers fired -> analytics_opened,analytics_dimensions,analytics_unanswered,
analytics_dimensions,analytics_answered; delete chat with undecided deal after system sweep event -> FAIL (FOREIGN KEY constraint failed)
```

**FK (lengkap) dan penilaian maksud:**

| FK | ON DELETE | Sesuai maksud? |
|---|---|---|
| `deals.chat_id → chats` | CASCADE | Ya untuk deal belum diputuskan. Deal sudah diputuskan ditahan oleh `deal_events` RESTRICT. |
| `deals.session_id → numbers` | CASCADE | Sama seperti di atas |
| `deals.tenant_id → tenants` | NO ACTION | Ya (tenant di-soft-delete) |
| `deals.product_id/order_id → …` | SET NULL | Ya |
| `deals.assigned_to → users` | SET NULL | Ya |
| `deal_events.deal_id → deals` | **RESTRICT** | Ya untuk deal sudah diputuskan. **Terlalu ketat** untuk event sistem (BL-1). |
| `deal_evidence/dp_payments/deal_verifications.deal_id → deals` | CASCADE | Ya (hanya terjadi kalau deal boleh terhapus) |
| `deal_evidence.message_id → messages` | CASCADE | Ambigu, lihat bagian 6 |
| `dp_payments.proof_message_id → messages` | SET NULL | Ya (ledger tetap, bukti hilang karena retensi) |
| `deal_verifications.by → users` | NO ACTION | Ambigu (RD-3) |
| `deal_job_notices.deal_id → deals` | CASCADE | Ya |
| `messages.chat_id/number_id` | CASCADE | Ya |

Tiga kasus hapus pada kode sekarang:

| Kasus | Hasil sekarang |
|---|---|
| Hapus chat, deal belum diputuskan, tanpa event sistem tambahan | Berhasil (tes `deal-analytics-migration` #3) |
| Hapus chat, deal belum diputuskan, ada sweep/SLA | **Gagal** (BL-1) |
| Hapus chat, deal sudah diputuskan | Ditolak, tetapi **500 HTML** (RD-1) |
| Hapus nomor, deal belum diputuskan | Berhasil di probe Tugas 3; **belum ada tes permanen** (RD-4) |
| Hapus nomor, deal sudah diputuskan | Ditolak, 500, **dan kredensial sesi sudah terhapus lebih dulu** (BL-2) |

**Respons route (`delete-routes.txt`):**
```
DELETE chat with decided deal  -> 500 <!DOCTYPE html> … <title>Error</title> … <pre>Sqlite
DELETE number with decided deal -> 500 <!DOCTYPE html> … <title>Error</title> … <pre>Sqlite
  number row still exists: true | session creds still on disk: true
```

**Query plan (`query-plans.txt`):**
```
history          | SEARCH d USING COVERING INDEX deal_analytics_opened (tenant_id=? AND created_at>? AND created_at<?) ; SEARCH e USING INDEX deal_events_history (deal_id=? AND type=?) ; USE TEMP B-TREE FOR ORDER BY
latestInbound    | SEARCH messages USING INDEX deal_analytics_messages (tenant_id=? AND chat_id=? AND from_me=?)
replied          | SEARCH messages USING INDEX deal_analytics_messages (tenant_id=? AND chat_id=? AND from_me=? AND id>?)
openForReply     | SEARCH d USING INDEX deals_review_queue (tenant_id=? AND state=?)
lastReplyMark    | SEARCH deal_events USING INDEX deal_events_history (deal_id=? AND type=?) ; USE TEMP B-TREE FOR ORDER BY
answeredTrigger  | SEARCH d USING INDEX deals_review_queue (tenant_id=? AND state=?)
purgeTrigger     | SEARCH deal_events USING COVERING INDEX deal_events_history (deal_id=?)
```

**Penulis event (actor):** 6 pemanggilan dengan `null` (sistem): `dealAnalytics.js:79`, `dealReviewJobs.js:34,41,46,72,85`. 7 pemanggilan dengan `scope.userId` (manusia): `dealAnalytics.js:275,279,286`, `dealReview.js:139,176,189,219,233`. Detail di grep di atas.

**Jalankan ulang:**
```
RERUN migrateDealAnalytics langsung: GAGAL -> trigger deal_analytics_purge already exists
schemaMigrations.js:31  if(fromVersion===SCHEMA_VERSION)return;   ← runner melewati v8 kalau sudah di v8
```

**Fingerprint:**
```
generator dijalankan ulang: TIDAK ada perubahan
legacy/t01/v1/v2: sama dengan HEAD · v3–v7: BARU (milik Codex, belum di-commit) · current: BERBEDA dari HEAD
```

**Grep mentah** untuk 20 nama ada di `v8-audit/grep-names.txt`. Contoh:
```
### analytics_timezone
src/dealAnalytics.js:11:const tenantHours = db.prepare(`SELECT analytics_timezone AS timezone,analytics_open_min AS open_min,
src/dealAnalytics.js:13:const setHours = db.prepare(`UPDATE tenants SET analytics_timezone=?,analytics_open_min=?,analytics_close_min=?
src/dealAnalyticsMigration.js:31:    ALTER TABLE tenants ADD COLUMN analytics_timezone TEXT NOT NULL DEFAULT 'Asia/Jakarta';
### analytics_source
src/dealAnalyticsMigration.js:10:    WHEN EXISTS(SELECT 1 FROM messages m WHERE … m.analytics_source='ai')
src/dealAnalyticsMigration.js:34:    ALTER TABLE messages ADD COLUMN analytics_source TEXT CHECK(analytics_source IN ('ai','human'));
src/db.js:112:  insertMessageWithSource: db.prepare('INSERT OR IGNORE INTO messages (…, analytics_source) VALUES (…)'),
```

### Masih asumsi
- BL-2 dengan socket aktif: penghapusan kredensial dibuktikan dari alur kode (`wa.js:673-683`), belum dari sesi WhatsApp nyata.
- Waktu migrasi v8 pada data operasional: belum diukur (Gerbang 3).
- Seberapa banyak deal belum diputuskan di produksi yang sudah punya `sla_escalated`: produksi masih v4, jadi belum ada deal sama sekali.

## 6. Kritik terhadap spesifikasi dan pertanyaan

1. **"Idempoten bila dijalankan ulang" (aturan keras 3).** Fungsi `migrateDealAnalytics` tidak idempoten kalau dipanggil langsung dua kali (`trigger … already exists`), sama seperti v2–v7. Idempotensi dijamin oleh runner melalui pemeriksaan versi. Membuat DDL v8 idempoten di level fungsi (`IF NOT EXISTS`, cek kolom) berarti v8 berbeda gaya dari v2–v7 dan justru menutupi kesalahan, misalnya migrasi parsial. Usulan: tes wajib 5 diartikan "runner dijalankan dua kali: tidak ada perubahan schema maupun data".
2. **Definisi "deal sudah diputuskan" (BL-1) perlu disahkan.** Pilihan:
   - **(a) Ada event dengan `actor` tidak NULL** (aksi manusia: keputusan, bukti, refund, audit, kualifikasi manual). **Saya rekomendasikan ini.** Sederhana, dan tidak perlu diubah tiap kali job baru menulis event sistem.
   - (b) Ada event `decision`. Lebih longgar; deal yang buktinya sudah dicatat manusia (`proof_recorded`) bisa ikut terhapus.

   Kedua pilihan **lebih longgar dari v7** untuk deal yang sudah dieskalasi SLA: di v7, `sla_escalated` juga menahan hapus. Itu sesuai maksud produk di spesifikasi ("deal belum diputuskan boleh ikut terhapus"), tetapi tetap merupakan perubahan perilaku dari v7.
3. **RD-2, jam operasional di v8.** Karena v8 belum beku, ada dua pilihan:
   - (a) Biarkan `open/close_min` di v8; v9 membuat tabel jadwal per hari yang diisi dari kedua kolom ini, sehingga keduanya jadi kolom warisan.
   - **(b) Keluarkan `open/close_min` dari v8 sekarang; v8 hanya menyimpan `analytics_timezone`; jadwal penuh di v9.** Saya rekomendasikan ini. Schema bersih, tanpa kolom mati permanen. Konsekuensinya, sampai v9 jam operasional memakai default `config` dan endpoint `PATCH /deals/analytics/hours` hanya bisa mengubah zona waktu.
4. **BL-2 dan RD-1 ada di `src/routes.js` (file bersama, bukan v8).** Tes wajib 2 ("ditolak dengan pesan jelas") tidak bisa lulus tanpa mengubah route. Perlu izin menyentuh `routes.js`; perubahannya kecil, cukup try/catch FK → 409, dan urutan hapus nomor.
5. **FK yang ambigu maksudnya:**
   - `deal_evidence.message_id → messages ON DELETE CASCADE` (v6). Retensi pesan (`index.js:53`) menghapus pesan, sehingga **bukti deal yang sudah diputuskan ikut hilang** tanpa jejak di `deal_evidence`. Apakah bukti harus bertahan melewati retensi?
   - `deal_verifications.by → users NO ACTION` (v6): admin yang pernah memverifikasi tidak bisa dihapus. Apakah maksudnya memang begitu (jejak audit), atau seharusnya SET NULL?
   - `deals.tenant_id → tenants NO ACTION`: aman karena tenant di-soft-delete, tetapi hard delete tenant tidak akan pernah bisa.
6. **Tes wajib 6 ("rollback ke v7 dari backup → server start") tidak bisa dijalankan dengan data operasional.** Produksi ada di v4, jadi backup produksi juga v4. Usulan: drill rollback memakai salinan yang sudah dimigrasikan v4 → v7, lalu v8, lalu restore ke salinan v7.

## 7. Risiko sisa

- **BL-1** membuat fitur hapus chat atau nomor praktis tidak bisa dipakai untuk deal yang lebih dari 24 jam, begitu v8 jalan di produksi.
- **BL-2** sudah ada sejak v6 (bukan karena v8), tetapi baru terpicu setelah ada deal. Begitu produksi ada di v6 atau lebih, menghapus nomor yang punya deal sudah diputuskan akan me-logout nomor itu tanpa menghapusnya.
- RD-3, K-1, dan FK `deal_evidence.message_id` ada di v6, jadi tidak diperbaiki di tugas ini (aturan keras 5); hanya dicatat.
- Pekerjaan Codex v4–v7 masih belum di-commit (lihat `docs/group-support/PART-0-REPORT.md`). Pembekuan v8 bergantung pada v4–v7 yang juga ikut beku.

## 8. Usulan langkah berikutnya

1. **Jawab pertanyaan 2, 3, dan 4 di bagian 6.** Ketiganya menentukan isi akhir v8 dan cakupan Gerbang 2.
2. Gerbang 2: perbaiki BL-1, BL-2, RD-1, dan RD-2 sesuai keputusan; tambahkan tes kasus 3, BL-1, dan route 409, beserta bukti merah sebelum dan hijau sesudah; tambahkan `scripts/check-v8-schema.mjs` permanen untuk tes wajib 8 dan 9.
3. Sebelum Gerbang 3: Codex commit v4–v7, supaya yang dibekukan adalah kode yang sudah di-commit.
4. Gerbang 3 sesuai urutan wajib, dengan drill rollback memakai salinan v7 (kritik 6).
