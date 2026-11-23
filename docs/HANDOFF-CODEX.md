# Prompt serah-terima untuk Codex: lanjutan Tugas 5B (G4–G6) dan backlog

> Salin seluruh isi di bawah garis ke Codex.

---

# TUGAS 5B lanjutan: G4 (penegakan hash DDL), G5 (v9), G6 (penutupan)

## Peran
Engineer di codebase WA Suite (Node.js, Express 5, better-sqlite3, Baileys, WebSocket, multi-tenant, migrasi berversi + fingerprint). Bekerja dengan bukti. Boleh membantah spesifikasi bila bertentangan dengan kode nyata, dan wajib melaporkannya sebelum lanjut.

## Wajib dibaca dulu
1. `AGENTS.md`: kepemilikan file, file bersama, aturan migrasi (**v1–v8 beku**), commit, larangan.
2. `docs/deal-analytics/V8-FREEZE.md`: fingerprint, hash DDL, langkah rollback v8.
3. `docs/tugas-5b/G2-REPORT.md` dan `docs/tugas-5b/G3-REPORT.md`: keadaan terakhir, keputusan, kritik, risiko sisa.
4. `git log --oneline -20`: pekerjaanmu (v4–v7) sudah di-commit Claude sebagai `wip:` per fase (lihat `docs/TUGAS-5B-G0.md` untuk dasar pemecahan hunk).

## Kondisi saat ini (22 Nov 2026)
- Branch `feat/platform-capabilities`, HEAD `e412785`, working tree bersih. Suite `node --test tests/*.test.mjs` **126/126**, regresi `node scripts/run-t03-regressions.mjs` **28/28**.
- **Database operasional `data/app.db` sudah v8** (dimigrasikan G3, `integrity_check: ok`). Backup sebelum migrasi: `data/migration-backups/pre-v8-20261121T215210Z.sqlite`.
- **Server :3100 berjalan dengan kode v8** dan memegang `data/app.db.lock`. Jangan jalankan instance kedua pada `data/`; server dan `scripts/migrate-schema.mjs` akan menolak.
- Fingerprint (`src/schemaFingerprint.js`) **hanya menjaga tabel dan kolom**. Trigger, indeks, dan CHECK **tidak** terjaga saat startup (dibuktikan `tests/deal-analytics-migration.test.mjs` tes 7b).
- Hash DDL penuh **berbeda antara build bersih dan database produksi** (hanya urutan kolom `chats`). Hash wajib dicatat per database, bukan dibandingkan dengan build bersih.
- Dashboard analytics **belum boleh dibuka ke pengguna** sampai v9 beku dan termigrasi (jam operasional masih dari config server).
- Ada sesi Claude lain yang menjalankan server demo di :3300 dengan `DATA_DIR` sendiri; jangan dimatikan, tidak memegang `data/app.db`.

## Yang belum selesai
| # | Item | Status |
|---|---|---|
| 0 | Cek UI produksi: menu Analytics dan Verifikasi deal di :3100 tidak 404 (butuh login operator) | **Menunggu operator**; bukan tugasmu, tapi catat hasilnya bila sudah dikonfirmasi |
| 1 | G4: penegakan hash DDL saat startup | Belum |
| 2 | G5: migrasi v9 | Belum |
| 3 | G6: penutupan | Belum |
| 4 | Backlog kritik (lihat bagian akhir) | Dicatat, tidak wajib di tugas ini |

## Struktur kerja
Tiga gerbang. Di setiap gerbang berhenti, kirim laporan + feedback, tunggu persetujuan. **Commit di akhir setiap gerbang**; tidak boleh ada pekerjaan yang menyeberang gerbang tanpa di-commit.

## Aturan keras
1. Jangan menyentuh `data/app.db` selain di langkah migrasi v9 (G5), dan hanya setelah gladi di salinan lulus.
2. Setiap migrasi didahului backup (`node scripts/drill-backup.mjs` lalu backup eksplisit); bila backup gagal, migrasi batal.
3. Migrasi di bawah kunci instance; hentikan :3100 dulu (`data/app.db.lock` harus hilang), lalu nyalakan lagi dengan `PORT=3100 npm start`.
4. Fingerprint hanya lewat `node scripts/build-schema-fingerprints.mjs`; nilai `v1`–`v8` tidak boleh berubah.
5. **Jangan mengubah isi v1–v8**, termasuk `src/dealAnalyticsMigration.js`. Algoritma `schemaFingerprint` juga tidak boleh diubah (akan mengubah v1–v7).
6. `tenantScope` di setiap query baru; setiap route baru terdaftar di route inventory (`tests/route-inventory.test.mjs` hijau, dokumen diregenerasi lewat `node scripts/inventory-routes.mjs`).
7. Ingest tidak boleh diblokir. Guard 11 alasan, bucket, dan kuota tidak berubah perilakunya.
8. Larangan `git reset --hard`, `git stash`, `git checkout -- <file>`, dan menulis ulang histori. Commit rusak diperbaiki dengan commit baru.
9. Tes lama merah → berhenti dan laporkan.
10. Jangan menjalankan smoke yang merusak (hapus nomor/chat, buat deal) di `data/app.db`; lakukan di salinan.

---

## G4: Penegakan integritas skema (hash DDL)

Tujuan: menutup celah fingerprint tanpa mengubah algoritma fingerprint.

1. Migrasi **v9 tidak dipakai untuk ini.** Tabel `schema_ddl_hash (version, hash, grandfathered, created_at)` ditambahkan sebagai bagian dari mekanisme startup (jelaskan di laporan apakah tabel ini sendiri ikut dihitung; usul: dikecualikan dari hash).
2. Fungsi hash DDL: sha256 dari `[type, name, tbl_name, sql dengan whitespace dinormalkan]` seluruh objek `sqlite_master` kecuali `sqlite_*` dan `schema_ddl_hash`, diurutkan `type, name`. Pakai definisi yang sama dengan `V8-FREEZE.md` supaya hash produksi `9d60718e578948c47d2153c68d8026dc73c2f7a123234da4e5d81c57756457a2` bisa dicocokkan.
3. Saat migrasi selesai, hitung hash versi itu dan simpan.
4. Saat startup, hitung ulang dan bandingkan. Tidak cocok → tolak start dengan pesan yang menyebut versi, hash tercatat, hash sekarang, dan langkah pemulihan (restore backup / jalankan ulang migrasi di salinan).
5. Versi yang terpasang sebelum mekanisme ini ada (database produksi di v8): catat hash pada startup pertama, tandai `grandfathered=1`, tulis peringatan di log. Penegakan ketat berlaku sejak v9.
6. `/api/health` (atau endpoint readiness baru yang terdaftar di inventory) memaparkan versi schema dan hash aktif, tanpa data sensitif.
7. Perbarui `V8-FREEZE.md` dengan hash yang tercatat di database produksi.
8. Generator (`scripts/build-schema-fingerprints.mjs`) ikut menghitung hash DDL **sejak v9**. Versi lama tidak dihitung ulang.

Tes wajib:
1. Hash tidak cocok → startup ditolak dengan pesan lengkap.
2. Versi `grandfathered` tidak menolak start, tetapi menulis peringatan.
3. Ubah trigger pada versi ber-hash → ditolak (balikkan perilaku tes 7b yang sekarang membuktikan celah ini).
4. Ubah indeks pada versi ber-hash → ditolak.
5. Health/readiness memuat versi dan hash.

Penerapan ke produksi: hentikan :3100, backup, jalankan sekali di salinan (drill), lalu nyalakan :3100. Startup pertama mencatat hash v8 sebagai `grandfathered`; bandingkan dengan `9d60718e…`.

---

## G5: v9

Migrasi v9, commit terpisah, `docs/deal-analytics/V9-FREEZE.md` dengan protokol yang sama seperti G3 (gladi di salinan → beku → backup → migrasi produksi di bawah kunci → `integrity_check` → restart → smoke non-merusak).

1. Ambang "tak terjawab": **4 jam operasional**, hanya untuk state `candidate`, `awaiting_proof`, `dp_aktif`. 24 jam tetap sebagai eskalasi ke owner, bukan kriteria hitung. Perhitungan memakai jadwal operasional, bukan jam dinding.
2. Pendapatan: bruto = `sum(amount)` pada `verified_lunas`; kas masuk = `sum(paid_amount)`. Dua kolom berdampingan; tandai `amount_mismatch` bila kas masuk < tagihan. Jangan menurunkan pendapatan dari OCR.
3. Jadwal operasional per hari (7 baris, default disalin dari hari kerja) + tabel pengecualian hari libur. v8 hanya menyimpan `tenants.analytics_timezone`; jam buka/tutup saat ini dari `config.businessStart/End`.
4. Pencatatan "tak terjawab" pindah dari saat dashboard dibuka (`sweepUnanswered` di `src/dealAnalytics.js`, dipanggil dari `scopedFacts`) ke job 5 menit, idempoten lewat unique `(deal_id, bucket)`. Setelah ini **tidak boleh ada jalur tulis yang dipicu request baca.**
5. Pengingat DP yang dilewati (`dp_reminder_skipped`, hotfix grup): **catatan konflik.** "Terbitkan ke DM pembeli" butuh `buyer_jid`, yang baru ada di v11+ (dukungan grup). Usul: di v9 cukup sediakan antrean pemindaian ulang dan tandai "menunggu buyer_jid"; pengiriman sesungguhnya di v11+. Laporkan keputusanmu sebelum mengerjakan.

Tes wajib: ambang hanya menghitung state yang ditentukan; chat di luar jadwal tidak menurunkan rate; jadwal per hari dan hari libur terbaca; job idempoten; **membuka dashboard tidak menulis apa pun**; bruto vs kas masuk dan `amount_mismatch`; perilaku item 5 sesuai keputusan.

Setelah v9 beku dan termigrasi, dashboard boleh dibuka ke pengguna. UI analytics (`public/deal-analytics.js`) perlu form jadwal per hari dan hari libur, rapi di desktop dan 360 px (`node scripts/check-deal-analytics-browser.mjs`).

---

## G6: Penutupan

1. Suite penuh, seluruh regresi, cek browser desktop + 360 px (`check-deal-analytics-browser.mjs`, `check-t04-browser.mjs`).
2. `AGENTS.md`: v8 dan v9 beku, mekanisme hash DDL berlaku, catatan sesi.
3. Ringkasan backlog (bagian berikut) dan status akhir setiap gerbang beserta bukti.

---

## Backlog (catat; kerjakan hanya bila diminta)
- **Dukungan chat grup (Tugas 5 Fase B, v11+):** `chat_type`, atribusi pengirim (`participant`/`participantAlt`, bukan `participantPn`), `lid_map`, `groups`, `buyer_jid`, UI grup, feature flag `group_support_enabled`. Audit dan keputusan: `docs/group-support/GATE-1-AUDIT.md`. Grup **tidak** dilayani AI; guard 11 alasan tidak berubah.
- **Tugas 6:** `group_settings` (mode off/mention/all), guard grup sebelum alasan ke-2, bucket per chat dengan batas grup, takeover per pengirim, deteksi deal per `buyer_jid`, pengingat DP ke DM pembeli, perbaikan deal `needs_repair`.
- **Kritik terbuka dari G2/G3:**
  - `SQLITE_BUSY`/`LOCKED` sebaiknya 503 + `Retry-After`, bukan 400 (`src/apiErrors.js`).
  - Ringkasan isi audit hapus tersembunyi dari owner (owner audit meredaksi `before_json`).
  - "Hapus user" = hapus akun global; model yang tepat adalah "keluarkan dari workspace".
  - `tests/tenant-t01.test.mjs` membaca `data/app.db` langsung; ganti dengan fixture.
  - 32 route masih pending T06 (+ T05) tanpa `tenantScope`, termasuk pencarian pesan.
  - Timestamp pesan memakai waktu terima (`Date.now()`), bukan `messageTimestamp`.
  - Kontak yang sama bisa muncul dua kali (LID dan nomor telepon).

## Format laporan (setiap gerbang, termasuk bila berhenti lebih awal atau gagal)
TL;DR maksimal 3 baris, lalu:
1. Ringkasan perubahan `file:line` → perubahan → alasan
2. Yang ditingkatkan (dalam / di luar cakupan)
3. Bonus di luar cakupan + cara revert
4. Keputusan sendiri + alternatif ditolak
5. Sudah diverifikasi (dengan output) vs masih asumsi
6. Kritik terhadap spesifikasi
7. Risiko sisa
8. Usulan langkah berikutnya

Tanpa bukti di bagian 5, jangan tulis "beres" atau "aman". Tes gagal atau di-skip wajib disebut. G4: bagian 5 memuat output tes 1–5 dan hash yang tercatat di produksi. G5: bagian 5 memuat output tes v9, durasi migrasi, `integrity_check`, dan bukti pembekuan v9.
