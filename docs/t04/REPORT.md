# T04 · Konsol platform dan akses berbatas waktu

Admin platform dapat mengelola workspace dan membaca audit platform. Akses percakapan memakai grant JIT per sesi dan per tenant. Owner dapat membaca audit workspace aktifnya melalui `/api/tenant/audit`. Inventaris mencatat **pending T04 = 0** dan **pending T03 = 0**. [Inventaris HTTP dan WebSocket](../t01/route-inventory.md)

## Prasyarat

- Komit `f6bf7dc` mendarat sebelum implementasi konsol. F0-W01 mengganti assertion regex sumber dengan uji browser yang memutus WebSocket dan mengamati sambungan ulang. Assertion lama dihapus. [Bukti F0-W01](evidence/verify-prerequisites/verify-hardening.mjs.txt) · [28 verifier prasyarat](evidence/verify-prerequisites/summary.json)
- Prasyarat menguji pencabutan membership tenant aktif dan tenant lain, pemilihan otomatis untuk satu membership, serta `409 TENANT_NOT_SELECTED` dengan `reason: NO_MEMBERSHIP` untuk akun tanpa workspace.
- `GRACE_MS=0`. Request tab lain yang masih membawa ID sesi lama dapat menerima 401 setelah switch. [Kontrak sesi T03](../t03/STATUS-CONTRACT.md)
- `GET /api/platform/session` menjadi surface pertama milik T04. Rute ini sekarang memakai pemeriksaan capability platform dan sudah dikeluarkan dari pending.

## File utama

| File | Perubahan |
|---|---|
| `src/capabilities.js` | Peta role dan capability serta evaluasi scope melalui `can()` |
| `src/platformRoutes.js` | Daftar/detail tenant, create, suspend/reactivate, soft delete, kuota, role anggota, grant, audit, dan akses percakapan JIT |
| `src/platformMigration.js`, `src/schemaMigrations.js` | Skema v4, konversi role, undangan, grant, audit append-only, invalidasi sesi |
| `src/platformGrantState.js`, `src/platformAudit.js`, `src/sessionStore.js` | Pemeriksaan kedaluwarsa, pencabutan, throttle `last_seen_at`, audit dan reset scope |
| `src/auth.js`, `src/tenantScope.js`, `src/sessionRoutes.js` | Batas sesi platform, isolasi jalur lama, aktivasi undangan, daftar tenant di `/me` |
| `public/platform.js`, `public/platform.css`, `public/index.html` | Konsol, akses isi dengan penghitung waktu, dan audit owner |
| `tests/tenant-t04.test.mjs`, `scripts/check-t04-browser.mjs` | 21 skenario T04 dan pemeriksaan browser |

## Merah dan hijau

- Merah pada `f6bf7dc` sebelum kode T04. Sebanyak 19 dari 21 skenario gagal dan 2 lolos. [Log merah](evidence/red.txt)
- Hijau pada rangkaian terpadu. Sebanyak 68 tes lulus, termasuk 21 skenario T04, 2 prasyarat, regresi T03, migrasi, dan inventaris. Kasus audit membuktikan bahwa SQLite menolak `UPDATE`, `DELETE`, dan `INSERT OR REPLACE`. Kasus HTTP memeriksa isi dari tenant yang benar, menolak ID percakapan tenant lain, dan membuktikan penolakan tulis sebelum elevasi.
- Seluruh 28 verifier lulus di salinan workspace terisolasi. Runner memakai fixture migrasi dan `--regexp-interpret-all`, sama seperti bukti prasyarat. [Hasil 28 verifier](evidence/verify-after/summary.json) · [Uji WebSocket akhir](evidence/verify-after/verify-hardening.mjs.txt)

## Matriks capability

Kolom akun platform menggabungkan capability konsol dengan akses isi dari grant tenant yang sesuai. Kolom owner, tenant admin, dan agent berlaku dalam scope membership masing-masing.

| Capability | `none` | `admin` | `admin` + grant baca | `admin` + grant tulis | Owner | Tenant admin | Agent |
|---|---|---|---|---|---|---|---|
| `tenant.list`, `tenant.create`, `tenant.suspend`, `tenant.delete`, `quota.write` | — | Ya | Ya | Ya | — | — | — |
| `tenant.read`, `member.write` | — | Ya | Ya | Ya | Ya | Ya | — |
| `audit.read` | — | Ya | Ya | Ya | Ya | — | — |
| `content.read` | — | — | Ya | Ya | Ya | Ya | Ya |
| `content.write` | — | — | — | Ya | Ya | Ya | Ya |

Capability platform pada akun dengan grant tetap dievaluasi dengan scope platform. Grant baca memberikan `READ_ONLY_SCOPE` pada percobaan tulis. Request pertama setelah kedaluwarsa mendapat `409 GRANT_EXPIRED`, mencatat `grant_expired`, dan membersihkan tenant aktif serta ID grant sesi. Suspend mencabut sesi anggota dan grant. Reactivate memungkinkan anggota login lagi.

## Screenshot

| Tampilan | Desktop | 360 px |
|---|---|---|
| Daftar, filter, dan form buat workspace | [Desktop](evidence/platform-desktop.png) | [360 px](evidence/platform-360px.png) |
| Detail dan indikator grant baca | [Desktop](evidence/grant-desktop.png) | [360 px](evidence/grant-360px.png) |
| Audit owner | [Desktop](evidence/owner-audit-desktop.png) | [360 px](evidence/owner-audit-360px.png) |

## Risiko dan keputusan implementasi

- Grant memakai TTL default 60 menit dan batas maksimum 480 menit, dengan batas konfigurasi yang lebih rendah jika ditetapkan. Countdown UI menutup tampilan isi saat waktunya habis. API selalu menerapkan waktu server.
- Konsol JIT membuka maksimal 50 percakapan dan 100 pesan terbaru per tampilan. Ekspor JSON per percakapan dibatasi 10.000 pesan. Elevasi mengizinkan perubahan nama percakapan dengan audit `content_updated`. Handler JIT memakai predikat tenant sendiri. Isolasi umum query T05/T06 dan room T09 tetap pada tahap masing-masing.
- Undangan owner berlaku tujuh hari dan dapat dipakai sekali. Operator menyalin tautan aktivasi dari konsol dan menyampaikannya kepada penerima. Database hanya menyimpan hash token.
- Audit owner mengembalikan metadata tenant sendiri dan menghilangkan kedua snapshot JSON. Pemilihan actor, aksi, filter waktu dan cursor tersedia di API audit. Rentang waktu memakai epoch milidetik.
- Kuota tersimpan melalui `PATCH .../quota`. Penegakan kuota masuk T07/T12. `PLATFORM_CONFIRM_KEY` dapat dipakai lintas proses untuk menstabilkan token konfirmasi dan cursor yang ditandatangani.

## Rollback

Hentikan aplikasi dan arsipkan database v4 untuk menjaga perubahan dan audit terbaru. Pulihkan backup pra-v4 dari `migration-backups` ke `DATA_DIR/app.db` dengan aplikasi berhenti dan tangani file WAL/SHM sebagai bagian dari pemulihan SQLite. Jalankan kembali kode prasyarat `f6bf7dc` dan verifikasi skema v3 serta login. Perubahan setelah snapshot, termasuk tenant baru, undangan, audit, dan grant, hanya ada pada arsip v4 sampai direkonsiliasi. Sesi aktif perlu ditinjau saat pemulihan karena snapshot dapat memuat sesi yang kemudian dicabut.
