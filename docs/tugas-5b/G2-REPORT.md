# Tugas 5B · G2: Hardening pra-beku

**TL;DR**
1. Kedelapan item G2 selesai dan semuanya diverifikasi:
   - route hapus ber-scope tenant dan beraudit;
   - bukti retensi lewat job sungguhan;
   - job sesi yatim 30 menit;
   - error handler terpusat dengan request id;
   - bukti cakupan route inventory;
   - script drill backup;
   - lingkungan raqio sudah bersih sendiri.
2. **Tanpa perubahan schema**: audit hapus memakai tabel `platform_audit` (v4, append-only) yang sudah dipakai health sesi. v8 tidak berubah dari G1.
3. Suite **124/124**, regresi **28/28**, cek browser analytics dan T04 lulus.

---

## 1. Ringkasan perubahan

| file:line | Perubahan | Alasan |
|---|---|---|
| `src/apiErrors.js` (baru) | `requestId` (header `X-Request-Id`, pakai id klien kalau formatnya valid), `describeError` (DEAL_DECIDED/CONSTRAINT → 409, SQLite lain → 400, 4xx dipertahankan, lainnya → 500), `sendError`, `apiErrorHandler` | 2.5 |
| `src/httpSurface.js:12,20,30,36` | `app.use(requestId)` sebelum routes; `app.use(apiErrorHandler)` setelah `/api` dan `/media`; keduanya terdaftar sebagai *infrastructure* inventory | 2.5, 2.6 |
| `src/routes.js` `deleteFailure/deleteReason/scoped*` | Hapus chat dan nomor kini `requireTenantScope`; lookup memakai `tenant_id` aktif (tenant lain → 404). Hapus user: harus anggota tenant aktif (404), dan ditolak 409 `USER_IN_OTHER_TENANT` kalau akun juga anggota workspace lain. Setiap hapus menulis audit **dalam transaksi yang sama**. Alasan opsional maksimal 500 karakter. | 2.1, 2.2 |
| `src/platformAudit.js:2` | Aksi `chat_deleted`, `number_deleted`, `user_deleted` | 2.2 |
| `src/wa.js` `sessionsRestored`, `cleanOrphanSessions`, `restoreAll` | Job tidak melakukan apa pun sampai `restoreAll` selesai (`finally`); melewati folder yang punya baris `numbers` (status apa pun, termasuk pairing), socket `connecting`, atau `live` | 2.4 |
| `src/index.js` | `setInterval(cleanOrphanSessionsJob, 30 * 60 * 1000)` dengan fungsi bernama; pemanggilan saat startup dipindah ke **setelah** `await restoreAll()` | 2.4 |
| `tests/route-inventory.allowlist.mjs`, `baseline.json`, `docs/t01/route-inventory.md` | Dua pengecualian T06 dicabut; pending T06 34 → 32; dokumen diregenerasi lewat `scripts/inventory-routes.mjs` | 2.1, 2.6 |
| `scripts/drill-backup.mjs` (baru) | Satu perintah: backup (API backup SQLite, sumber read-only) → restore ke salinan → `integrity_check` → server terhadap salinan → `/api/health` → stop | 2.7 |
| `tests/delete-hardening.test.mjs` (baru) | 7 tes G2 (2.1 ×2, 2.2 ×2, 2.3, 2.4, 2.5) | Tes wajib |
| `tests/deal-delete.test.mjs:94-95` | 5b memanggil `restoreAll()` lebih dulu (syarat baru 2.4) | Menyesuaikan perilaku yang disengaja |

## 2. Yang ditingkatkan

- **Dalam cakupan:**
  - Hapus lintas tenant tidak mungkin lagi (dulu `DELETE /chats/:id` dan `/numbers/:id` tidak di-scope).
  - Setiap hapus tercatat dan bisa dilihat owner di `/api/tenant/audit`.
  - Error database tidak lagi membocorkan SQL atau stack trace.
  - Sesi yatim dibersihkan berkala tanpa risiko mengganggu nomor yang sedang dipulihkan atau dipasangkan.
  - Ada drill backup yang bisa diulang.
- **Di luar cakupan:** tidak ada.

## 3. Bonus di luar cakupan

| Bonus | Cara revert |
|---|---|
| `bonus` Hapus user ditolak `409 USER_IN_OTHER_TENANT` kalau akun juga anggota workspace lain. Tanpa ini, admin tenant A bisa menghapus akun global yang masih dipakai tenant B. | Hapus baris `if (member.other_tenants) …` di `DELETE /users/:id` dan tes `2.1 pengguna yang juga anggota tenant lain…` |

## 4. Keputusan yang saya ambil sendiri

| Keputusan | Alternatif ditolak | Alasan |
|---|---|---|
| Audit hapus memakai `platform_audit` yang sudah ada | Tabel audit baru di v8 | Tabelnya sudah append-only (trigger), ber-tenant, punya kolom aktor/target/`before_json`/`reason`, dan sudah dibaca owner audit. Health sesi (v5) sudah memakainya untuk aksi tenant. Tanpa perubahan schema, v8 tetap sama dengan G1. |
| Audit dan hapus dalam satu transaksi | Audit setelah hapus | Hapus yang ditolak database tidak boleh meninggalkan audit "terhapus" (dibuktikan di tes 2.2) |
| Bukti retensi menjalankan **badan job persis dari `src/index.js`** di vm | Memindah retensi ke modul baru | Memindah akan merusak kontrak `verify-phase5` yang mengekstrak blok yang sama; cara ini menguji kode yang benar-benar berjalan di produksi |
| Job sesi yatim memakai **fungsi bernama**, ditaruh setelah blok retensi | `setInterval(() => {…})` | Regex `verify-phase5` dimulai dari `setInterval(() => {` pertama; bentuk anonim sebelumnya membuat tes itu merah (G2 sesi lalu) |
| SQLite non-constraint → **400** sesuai spesifikasi | 503 untuk `SQLITE_BUSY` | Spesifikasi meminta 409/400; lihat kritik 6.1 |
| Drill G2 dijalankan terhadap **fixture v7**, bukan `data/app.db` | Menjalankan terhadap data asli | Aturan keras 1. Script sudah siap untuk G3 (default `--source data/app.db`). |
| Raqio tidak dimatikan | Mematikan :3000 | :3005 sudah tidak ada; :3000 adalah satu-satunya instance, dijalankan ulang 03:53 |

## 5. Sudah diverifikasi vs masih asumsi

### Sudah diverifikasi

**Output tes G2** (`docs/tugas-5b/g2/tests.txt`):
```
✔ 2.1 hapus lintas tenant -> 404; data dan sesi tenant asli utuh
✔ 2.1 pengguna yang juga anggota tenant lain tidak dihapus dari satu workspace
✔ 2.2 audit log untuk hapus chat, nomor, dan pengguna (aktor, entitas, ringkasan, alasan, append-only)
✔ 2.2 hapus yang ditolak database tidak meninggalkan audit
✔ 2.3 job retensi sungguhan: pesan lama terhapus, deal_evidence bertahan, message_id NULL, snapshot utuh
✔ 2.4 job sesi yatim: menunggu restoreAll, bandingkan dengan database (bukan mtime), lewati nomor pairing
✔ 2.5 handler error terpusat: JSON, code, request id, tanpa stack atau SQL
✔ 5b. sesi yatim dibersihkan oleh job, sesi nomor aktif dipertahankan
```
Isi yang diuji, singkatnya:
- **2.1:** B-0 menghapus chat 10, nomor 10, dan user 11 milik A → ketiganya 404 JSON; baris, jumlah pesan, dan `sessions/10/creds.json` A tetap; tidak ada audit tertulis.
- **2.2:** before_json chat `{"number_id":11,"messages":3,"deals":0}`, nomor `{"name":"A-number-1","phone":"620001","chats":0,"messages":0,"deals":0}`, user `{"username":"A-temp","role":"agent","verifications":0}`. Alasan 501 karakter → 400 dan tidak ada yang terhapus. `UPDATE`/`DELETE` audit → `append-only`. Owner melihat ketiganya di `/api/tenant/audit`. Hapus yang ditolak (deal lunas) → 409 `DEAL_DECIDED` + `request_id`, dan jumlah audit tidak bertambah.
- **2.3:** badan `setInterval` retensi dari `src/index.js` dijalankan dengan `RETENTION_DAYS=30`: pesan 40 hari terhapus, pesan 1 hari tetap; `deal_evidence.message_id = NULL`, snapshot `Rina` / `Bukti TF` / ts asli utuh.
- **2.4:** sebelum `restoreAll` → 0 terhapus. Sesudahnya → 1 terhapus (folder tanpa baris). Folder nomor 10 dengan mtime 2020 tetap. Folder nomor ber-status `pairing` tetap. Wiring 30 menit dan urutan startup dicek dari sumber.
- **2.5:** JSON rusak → 400 `BAD_REQUEST` dengan `request_id` = header klien. `X-Request-Id` dibuat otomatis (UUID). Route dengan `SqliteError` constraint → 409, `SQLITE_BUSY` async → 400, error biasa → 500. Respons tidak memuat teks SQL, nama tabel, maupun path file; detail hanya masuk log server.

**2.6, bukti cakupan inventory:**
```
== route dummy BER-SCOPE ditambahkan (belum ada di inventory)
✖ all registered HTTP, USE and upgrade surfaces have scope or reviewed exemption
  -   '| GET | /api/__inventory_probe | scoped |  | src/routes.js | yes |\n' +
ℹ pass 7 · fail 1
== route dummy dihapus (routes.js identik dengan sebelum probe)
ℹ pass 8 · fail 0
== route dummy TANPA scope (INVENTORY_INJECT_UNSCOPED=1)
ℹ pass 6 · fail 2
    actual: [ 'Missing tenant scope: GET /__unscoped_injected' ],
```

**2.7, drill** (`docs/tugas-5b/g2/drill-output.txt`, sumber = fixture v7):
```
{"step":"backup", … "bytes":…}
{"step":"restore","copy":"…\\wa-drill-sVFLyb\\app.db"}
{"step":"integrity_check","result":"ok","schema_version":7}
{"step":"server_start","port":52135,"healthy":true,"ms":575,"schema_log":"[schema] {\"version\":8, …"}
{"step":"server_stop","exit_code":null}          ← diakhiri dengan sinyal, bukan crash
{"result":"OK", … "steps":5}
sumber setelah drill: versi 7                     ← sumber tidak berubah
```

**2.8, lingkungan:**
```
== port 3000: node next dev -p 3000 (raqio/apps/web), dimulai 22 Nov 03:53
port 3005 : tidak ada
```

**Verifikasi penuh:**
```
$ node --test tests/*.test.mjs                 → ℹ tests 124 · pass 124 · fail 0 · skipped 0
$ node scripts/run-t03-regressions.mjs         → exit 0 · 28 lulus · 0 gagal
$ node scripts/check-deal-analytics-browser.mjs → PASS deal analytics UI …
$ node scripts/check-t04-browser.mjs           → T04 UI verified at desktop and 360px
$ verify-phase5 (job retensi asli)              → exit 0
```

### Masih asumsi
- **Penanganan error untuk "seluruh route yang menyentuh database"** dijamin secara struktural (Express 5 meneruskan error sync/async ke handler terakhir). Tidak setiap route diuji satu per satu; yang diuji: route hapus nyata, body rusak, dan tiga jenis error lewat handler yang sama.
- **Pengecualian "nomor sedang pairing" untuk socket live/`connecting`** tidak bisa diuji tanpa WhatsApp sungguhan. Yang diuji: nomor dengan baris ber-status `pairing`.
- **Drill terhadap data asli** baru akan dijalankan di G3.

## 6. Kritik terhadap spesifikasi

1. **"Petakan SqliteError ke 409/400"** memperlakukan `SQLITE_BUSY`/`SQLITE_IOERR` (gangguan server) sebagai kesalahan klien (400). Usul: constraint → 409, input → 400, busy/locked → 503 dengan `Retry-After`, IO → 500. Belum saya ubah karena spesifikasinya eksplisit.
2. **"Ringkasan isi: nomor"** di audit: saya simpan `phone` nomor WhatsApp (milik tenant sendiri), bukan nomor pelanggan. `before_json` disembunyikan dari owner oleh owner audit yang sudah ada (hanya platform admin yang melihatnya). Kalau owner perlu melihat ringkasannya, endpoint owner audit perlu diubah.
3. **Hapus user** sebenarnya adalah "hapus akun global". Model yang lebih tepat: "keluarkan dari workspace" (hapus `tenant_members`), lalu hapus akun hanya kalau tidak ada workspace tersisa. Sementara ini dijaga dengan `409 USER_IN_OTHER_TENANT` (bonus).

## 7. Risiko sisa

- Route lain yang masih pending T05/T06 (pending T06 kini 32) tetap tanpa `tenantScope`; G2 hanya menangani tiga route hapus.
- Owner tidak bisa melihat ringkasan isi audit hapus (kritik 6.2).
- `sessionsRestored` bersifat per proses. Kalau `restoreAll` tidak pernah dipanggil (misalnya proses selain server), job tidak pernah membersihkan apa pun. Itu disengaja dan aman.
- Fingerprint masih belum menjaga trigger dan indeks (G4).
- Server preview :3200 masih berjalan (dimatikan di G3.1); :3100 masih memakai kode lama.

## 8. Usulan langkah berikutnya

1. **G3:** matikan :3200 dan :3100 → regenerasi fingerprint → `V8-FREEZE.md` (termasuk hash DDL penuh, karena fingerprint saja tidak cukup) → drill dengan `node scripts/drill-backup.mjs` terhadap `data/app.db` → migrasi salinan dua kali → smoke → migrasi produksi di bawah kunci tunggal → `integrity_check` → restart :3100 → smoke produksi → langkah rollback tertulis.
2. Untuk aturan 3 G3 ("tolak bila ada instance lain memegang database"), perlu mekanisme kunci file. Saat ini tidak ada; akan saya usulkan dan bangun di awal G3 sebelum migrasi produksi.
