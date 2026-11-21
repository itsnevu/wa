# Tugas 5B · G3: Pembekuan v8 dan migrasi produksi

**TL;DR**
1. v8 dibekukan (`30fdc1d`, `V8-FREEZE.md` dengan fingerprint + hash DDL penuh). Database operasional dimigrasikan **v4 → v8 dalam 182 ms** di bawah kunci instance tunggal: `integrity_check: ok`, data utuh, hash DDL identik dengan gladi.
2. :3100 berjalan lagi dengan kode baru; kedua nomor WhatsApp kembali **online**.
3. Smoke produksi yang butuh login atau bersifat merusak (buat/putuskan deal, hapus chat/nomor) **tidak saya jalankan di data asli**. Semuanya lulus di gladi pada salinan data produksi yang sama persis. **Perlu kamu cek di UI.**

---

## 1. Ringkasan perubahan

| Commit / file | Perubahan | Alasan |
|---|---|---|
| `d90b6ff` `src/instanceLock.js` (baru), `src/db.js` | `data/app.db.lock` (pid, role, waktu) diambil sebelum database dibuka atau dimigrasi; instance hidup lain → start dan migrasi ditolak; kunci basi diambil alih; dilepas saat keluar normal | Aturan 3: migrasi di bawah kunci tunggal |
| `d90b6ff` `tests/instance-lock.test.mjs` | 2 tes | Bukti kunci |
| `30fdc1d` `docs/deal-analytics/V8-FREEZE.md`, `v8-freeze/` | Manifest beku: fingerprint, sha256 berkas migrasi, hash DDL penuh (build bersih dan salinan produksi), hasil gladi, langkah rollback teruji | 3.1.4 |
| `30fdc1d` `AGENTS.md` | v1–v8 beku, wajib v9+, catatan kunci instance | 3.1.5 |
| `data/app.db` | **Dimigrasikan v4 → v8** (tidak di-commit; `data/` diabaikan git) | 3.2 |
| `docs/tugas-5b/G3-REPORT.md`, `g3/` | Laporan ini dan bukti produksi | — |

Proses yang dihentikan: preview :3200 (PID 32580) dan server lama :3100 (PID 31876, kode 21 Nov). Server baru :3100 berjalan sebagai PID 26196.

## 2. Yang ditingkatkan

- **Dalam cakupan:**
  - Database produksi kini v8; menu Analytics dan Verifikasi deal punya backend-nya.
  - Ada kunci yang mencegah dua instance atau migrasi bersamaan pada folder data yang sama.
  - Ada manifest pembekuan yang juga menjaga trigger dan indeks (hash DDL).
  - Ada jalur rollback yang sudah diuji ke kode v4 yang di-commit.
- **Di luar cakupan:** tidak ada.

## 3. Bonus di luar cakupan

Tidak ada. Kunci instance diminta aturan 3, tetapi belum ada di kode, jadi dibangun sebagai prasyarat G3 (commit tersendiri).

## 4. Keputusan yang saya ambil sendiri

| Keputusan | Alternatif ditolak | Alasan |
|---|---|---|
| Kunci berbasis file + cek pid di `src/db.js` | Kunci OS (`flock`) atau `BEGIN EXCLUSIVE` saja | `BEGIN IMMEDIATE` migrasi tidak mendeteksi server lain yang hanya membuka database (WAL). File + pid bekerja di Windows dan menangani proses yang mati. |
| **Gladi dijalankan sebelum menulis `V8-FREEZE.md`** | Freeze dulu baru gladi | Manifest wajib memuat hasil uji di salinan |
| Rollback diuji dengan **kode `7bc7377` (v4)** di worktree | Kode saat ini | Kode v8 menolak database v4 (atau memigrasikannya ulang). Rollback sejati = kode lama + data lama. |
| Password admin diganti **hanya di salinan gladi** untuk smoke | Smoke tanpa login | Smoke route analytics/review/keputusan butuh sesi |
| **Tidak** menjalankan smoke merusak di produksi | Membuat/menghapus data di `data/app.db` | Aturan 1 (`data/app.db` hanya disentuh di langkah migrasi); "hapus nomor" di produksi menghapus nomor WhatsApp sungguhan |
| Proses `node src/index.js` PID 13276 (:3300) **tidak dimatikan** | Mematikannya | Milik **sesi Claude lain** (scratchpad `aed9b80b…`) dengan `DATA_DIR` miliknya sendiri; tidak memegang database produksi |

## 5. Sudah diverifikasi vs masih asumsi

### Sudah diverifikasi

**Kunci instance** (`tests/instance-lock.test.mjs`):
```
✔ kunci: instance kedua dan migrasi ditolak selama pemegang hidup; dilepas saat pemegang berhenti
✔ kunci basi dari pid yang tidak ada diambil alih
Suite penuh: ℹ tests 126 · pass 126 · fail 0 · regresi 28/28
```

**Fingerprint, hanya `current` yang berubah:**
```
$ node scripts/build-schema-fingerprints.mjs → 0 file berubah
legacy, t01, v1–v6: sama dengan commit v7 (6417051)
v7: baru (= nilai current di commit v7) · current: berbeda (v8 = 915debf…)
```

**Drill backup terhadap data asli** (`v8-freeze/drill-production-backup.txt`):
```
{"step":"backup", … "bytes":786432,"ms":18}
{"step":"integrity_check","result":"ok","schema_version":4}
{"step":"server_start", … "healthy":true,"ms":813, … "[schema] {\"version\":8 …"}
{"result":"OK", … "steps":5}
data/app.db setelah drill: versi 4
```

**Gladi di salinan** (`v8-freeze/rehearsal.json`):
```
migrate1: exit 0, 126 ms → version 8, fingerprint = current, integrity ok, fk 0
migrate2: exit 0, 89 ms, "(tidak ada log migrasi: sudah v8)"
second_run_changes_nothing: true · fingerprint_is_current: true · rows_unchanged: true
smoke: login 200, analytics 200, review 200, decide_reject 200, delete_chat_undecided 200,
       delete_chat_decided "409 DEAL_DECIDED", delete_number_with_decided_deal 409, delete_number_clean 200,
       audit_rows chat_deleted 1, number_deleted 1
```

**Drill rollback:**
```
HEAD is now at 7bc7377 wip: feat(platform): T04 … (schema v4)
export const SCHEMA_VERSION=4;
rollback server (kode 7bc7377, data backup): {"ok":true} 200
db rollback tetap versi 4
```

**Migrasi produksi:**
```
lock file: False · listen 3100: False · proses yang memegang data/app.db: tidak ada
backup: data/migration-backups/pre-v8-20261121T215210Z.sqlite · 786432 byte · integrity ok · v4 · 1883 pesan · 40 chat
$ ALLOW_AUTO_MIGRATE=1 node scripts/migrate-schema.mjs
exit 0, durasi 182 ms
[schema] {"version":8,"backup":"data/migration-backups/…","backupCount":2,"backupBytes":1081344}
lock dilepas setelah migrasi
```

**`integrity_check` produksi** (`g3/production-check.json`):
```
"integrity_check": "ok", "foreign_key_check": 0,
"versions": "1:T01, 2:T03 sessions, 3:T04 prerequisites, 4:T04 platform, 5:Session sync health, 6:Deal foundation, 7:Deal review, 8:Deal analytics",
"fingerprint_is_v8": true, "ddl_hash": "9d60718e…", "ddl_equals_rehearsal": true,
"rows": { "numbers": 2, "chats": 40, "messages": 1883, "users": 1, "tenants": 1, "deals": 0, "deal_events": 0 }
```

**Smoke produksi (bagian yang bisa dijalankan tanpa login dan tanpa merusak):**
```
/api/health → {"ok":true}, X-Request-Id: a17dad5e-…        (kode baru aktif)
data/app.db.lock → {"pid":26196,"role":"server",…}           (kunci dipegang server)
log startup: "[http] http://localhost:3100", tanpa migrasi ulang, tanpa error
numbers: admin online, cs1 online                            (sesi WhatsApp dipulihkan)
```

### Masih asumsi (perlu dicek)
- **Analytics dan Verifikasi deal tidak lagi 404 di :3100.** Tanpa login, semua route `/api` (termasuk route fiktif) menjawab 401, sehingga tidak bisa dibuktikan dari luar. Dasar keyakinannya: kode yang sama lulus smoke di gladi (200/200), dan prosesnya terbukti kode baru (header `X-Request-Id`, file kunci). **Mohon buka kedua menu sekali dan pastikan tampil.** Karena database produksi belum punya deal, Analytics akan menampilkan tampilan kosong.
- **Buat/putuskan deal dan hapus chat/nomor di produksi:** hanya diuji di salinan (alasan di bagian 4).

## 6. Kritik terhadap spesifikasi

1. **Smoke produksi "buat deal, putuskan, hapus chat, hapus nomor"** bertentangan dengan aturan 1 dan berisiko: "hapus nomor" di produksi berarti menghapus nomor WhatsApp asli beserta sesinya. Usul: smoke produksi = health + versi/hash schema (G4.6) + satu login read-only oleh operator; aksi merusak hanya di salinan.
2. **Smoke produksi butuh kredensial.** Untuk otomasi tanpa kredensial manusia, perlu endpoint readiness yang memaparkan versi schema dan daftar modul aktif (sebagian dijawab G4.6).
3. **"Restore ke salinan → migrasi → … → migrasi produksi"** sebaiknya mensyaratkan bahwa database tidak ditulisi antara backup gladi dan migrasi produksi. Di sini terjamin karena server sudah mati sebelum drill, dan dibuktikan dengan hash DDL dan jumlah baris yang identik. Usul: jadikan syarat eksplisit.

## 7. Risiko sisa (yang belum terjaga sampai G4 selesai)

- **Trigger, indeks, dan CHECK v8 belum dijaga saat startup.** Fingerprint hanya menjaga tabel dan kolom; drift trigger/indeks tetap lolos start (dibuktikan di tes 7b). Sampai G4, satu-satunya penjaga adalah `V8-FREEZE.md` dan tinjauan kode.
- **Hash DDL bergantung pada database**: build bersih ≠ produksi (urutan kolom `chats`). G4 harus mencatat hash per database saat migrasi atau startup pertama, bukan membandingkan dengan build bersih.
- **Health belum memaparkan versi schema dan hash** (G4.6).
- **Kunci instance memakai cek pid.** Kalau pid daur ulang kebetulan dipakai proses lain, kunci basi dianggap hidup sehingga start ditolak (fail-safe; pesan menyebut pid untuk dihapus manual).
- **Server :3100 sekarang berjalan sebagai proses latar dari sesi Claude ini.** Kalau sesi ini berakhir, prosesnya bisa ikut berhenti; jalankan ulang lewat cara biasa (`npm start` dengan `PORT=3100`).
- **Ada sesi Claude lain** yang menjalankan server demo di :3300 dari repo yang sama, di luar koordinasi `AGENTS.md`.
- Backup sebelum migrasi: `data/migration-backups/pre-v8-20261121T215210Z.sqlite` (dan backup otomatis runner). Keduanya tidak di-commit (folder `data/` diabaikan git).

## 8. Sisa pekerjaan menuju langkah berikutnya

1. **Cek UI produksi** (bagian 5, masih asumsi): Analytics dan Verifikasi deal di :3100.
2. **G4:** tabel `schema_ddl_hash`, hash dicatat per database saat migrasi, startup menolak kalau tidak cocok, versi lama (v1–v8) ditandai `grandfathered` dengan peringatan, health memaparkan versi + hash, generator menghitung trigger/indeks/view sejak v9, plus tes 1–5.
3. Setelah G4, perbarui `V8-FREEZE.md` dengan hash yang tercatat di database produksi.
