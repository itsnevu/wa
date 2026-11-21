# Tugas 5B · G1: Commit pekerjaan Claude

**TL;DR**
1. Lima commit sesuai urutan spesifikasi, ditambah satu commit dokumen. Working tree bersih.
2. Setelah commit terakhir: **suite 117/117**, regresi **28/28**, cek browser analytics dan T04 lulus.
3. Satu catatan kejujuran: file migrasi v8 masuk commit Tugas 3 dalam bentuk akhirnya yang sudah dikokohkan, karena bentuk draft antaranya tidak pernah tersimpan.

---

## 1. Ringkasan perubahan

| # | Commit | Isi | Suite pada tree commit |
|---|---|---|---|
| 1 | `4566b6c` test(deals): drop removed operating-hour columns from fixture | `tests/deal-foundation.test.mjs:54`: `DROP COLUMN analytics_close_min/open_min` → `DROP TABLE deal_event_types` (−1/+1) | Hijau bersama #3 (7/7 pada tree penuh) |
| 2 | `53df7ce` test(ai): cover both resume paths in verify-ai5 | `scripts/verify-ai5.mjs` (409 lalu 200), bukti regresi `docs/t03/evidence/verify-before/`, screenshot `artifacts/ai/` | — (skrip regresi, bukan `node --test`) |
| 3 | `35f6abf` feat(analytics) (schema v8) | `src/dealAnalytics*.js`, `public/deal-analytics.*`, tes analytics, cek browser; hunk Tugas 3 di `db.js`, `wa.js`, `routes.js`, `platformRoutes.js`, `index.html`, `sw.js`; runner/generator/fingerprint v8; route inventory | **97/97** |
| 4 | `798d60f` fix(deals): skip DP reminders in group chats | Hunk hotfix `src/dealReviewJobs.js`, `tests/dp-reminder-group.test.mjs`, `docs/group-support/PART-0-REPORT.md` | **99/99** |
| 5 | `724b0e7` fix(schema): harden v8 before freeze | `deleteFailure` + urutan hapus nomor (`routes.js`), helper sesi (`wa.js`), pembersihan saat startup (`index.js`), `tests/deal-delete`, `v7-fixture`, `deal-analytics-migration`, dokumen audit v8 | **117/117** |
| 6 | docs | Laporan sesi (`LAPORAN-*`, `TUGAS-5B-G0/G1`) dan bukti dari run verifikasi final | — |

## 2. Yang ditingkatkan

- **Dalam cakupan:** seluruh pekerjaan sesi ini tercatat di git, dengan setiap commit kode dites di worktree terpisah. Tidak ada lagi pekerjaan yang hanya ada di working tree.
- **Di luar cakupan:** tidak ada.

## 3. Bonus di luar cakupan

Tidak ada.

## 4. Keputusan yang saya ambil sendiri

| Keputusan | Alternatif ditolak | Alasan |
|---|---|---|
| `dealAnalyticsMigration.js` masuk #3 dalam bentuk akhir | Merekonstruksi draft v8 dari ingatan | Draft antara tidak tersimpan; merekonstruksi berarti mengarang kode yang tidak pernah ada. Dicatat di badan commit #3. |
| Tes migrasi v7→v8 (`deal-analytics-migration`) + `v7-fixture` masuk #5 | Masuk #3 | Keduanya ditulis ulang total saat pengokohan v8 (gerbang 2) |
| Laporan sesi jadi commit dokumen tersendiri (#6) | Tidak di-commit | Aturan 11: tidak ada pekerjaan yang menyeberang gerbang tanpa di-commit |
| Bukti yang ditulis ulang oleh run final (`docs/t03/evidence/verify-before`, screenshot `docs/t04/evidence`) ikut #6 | Dibiarkan termodifikasi | Itu bukti dari verifikasi akhir G1 ini |
| Worktree uji dihapus setelah G1 (junction dilepas dengan `rmdir` lebih dulu) | Dibiarkan | Berisi salinan `data/app.db`. Junction dilepas terpisah supaya `node_modules` asli tidak ikut terhapus. |

## 5. Sudah diverifikasi vs masih asumsi

### Sudah diverifikasi

**`git status` + `git diff --cached --stat` sebelum tiap commit** (ringkas):
```
#1  tests/deal-foundation.test.mjs | 2 +-                       1 file
#2  34 files changed, 296 insertions(+), 582 deletions(-)      (verify-ai5 + 29 bukti + 4 screenshot)
#3  22 files changed, 1307 insertions(+), 14 deletions(-)
#4  3 files changed, 206 insertions(+)
#5  18 files changed, 1337 insertions(+), 5 deletions(-)
```

**Pemecahan hunk #3:** varian `wa.js` hanya selisih 18 baris dari versi akhir (helper sesi), dan varian `routes.js` hanya selisih bagian `deleteFailure`/hapus (0 baris analytics). Keduanya lolos `node --check` mode ESM. Fingerprint #3 hasil generator = `915debf…`, sama dengan file akhir (selisih 0).

**Suite per commit** (worktree terisolasi, tree commit tersebut):
```
#3  ℹ tests 97  · pass 97  · fail 0
#4  ℹ tests 99  · pass 99  · fail 0
#5  ℹ tests 117 · pass 117 · fail 0
```

**Verifikasi final di repo utama (setelah #5):**
```
$ node --test tests/*.test.mjs            → ℹ tests 117 · pass 117 · fail 0 · skipped 0
$ node scripts/run-t03-regressions.mjs    → exit 0 · 28 lulus · 0 gagal
$ node scripts/check-deal-analytics-browser.mjs → PASS deal analytics UI: 8 KPI with n, n<10 badge, ...
$ node scripts/check-t04-browser.mjs      → T04 UI verified at desktop and 360px
```

**Working tree setelah G1:** bersih (`git status --porcelain` kosong setelah commit #6).

**Worktree dihapus dengan aman:**
```
linkType: Junction → rmdir → junction ada lagi: False
isi node_modules asli: 151 (utuh) · worktree dir ada lagi: False
```

### Masih asumsi
- Commit #1 dan #2 tidak dites sendiri-sendiri. #1 hanya bermakna bersama v8 (#3), dan #2 menyentuh skrip regresi yang dicek di verifikasi final.

## 6. Kritik terhadap spesifikasi

1. **Urutan G1 (patch tes sebelum Tugas 3)** membuat commit #1 dan #2 berada di atas HEAD v7, di mana tes `deal-foundation` yang dipatch belum bisa hijau. Urutan "Tugas 3 → patch tes" akan membuat setiap commit bisa dites hijau sendiri-sendiri. Urutan spesifikasi tetap saya ikuti.
2. **"Tugas 3 termasuk berkas bersama" dan "pengokohan v8"** tidak bisa dipisah dengan bersih di file migrasi v8, karena keduanya mengubah file yang sama tanpa snapshot di antaranya. Untuk ke depan: commit di akhir setiap gerbang (aturan 11 tugas ini) mencegah masalah ini terulang.

## 7. Risiko sisa

- Lima commit `wip:` dari G0 tetap di histori (aturan 12, tidak ditulis ulang).
- **Database operasional masih v4, dan :3100 masih memakai kode lama.** Ini dikerjakan di G3.
- Fingerprint masih hanya menjaga tabel dan kolom; trigger dan indeks v8 belum terjaga sampai G4.
- Route hapus chat/nomor/user belum memakai `tenantScope` (G2.1).
- Server preview :3200 (salinan database + data dummy) masih berjalan; dimatikan di G3.1.

## 8. Usulan langkah berikutnya

1. **G2 (hardening pra-beku):**
   - `tenantScope` di route hapus + tes lintas tenant
   - audit log hapus
   - bukti purge retensi lewat job sungguhan
   - job sesi yatim 30 menit dengan tiga syaratnya
   - handler error terpusat untuk semua route ber-database
   - tes cakupan route inventory
   - skrip drill backup
   - matikan satu instance raqio
2. Pertimbangkan sebelum G3: `tests/tenant-t01` sebaiknya memakai fixture, bukan `data/app.db` (lihat G0 kritik 2), karena G3 akan mengubah database itu ke v8.
