# Laporan T02 — inventaris scope rute

18 November 2026, Asia/Jakarta. Branch `feat/tenant-route-inventory`. T02 dibangun di atas commit fondasi T01 `023da83` dan perbaikan review `3d14f14`. Tidak ada resolver dipasang pada handler dan tidak ada query/otorisasi request diubah. Tidak melanjutkan ke T03/T05/T06.

## Prasyarat T01 (terpisah)

Enam prasyarat dituntaskan sebelum test T02 ditulis. [Laporan review T01](../t01/REVIEW-PREREQUISITES.md), [ADR](../adr/0002-tenant-foundation-sqlite.md), dan [matriks trigger](../t01/trigger-matrix.md) merekam versi eksplisit, lock IMMEDIATE, owner deterministik, trigger per relasi, retensi backup dan fingerprint. Verifikasi prasyarat + T01: 9/9 pass. Database asli tidak dimigrasikan. Commit lokal dibuat; tidak membuat atau memublikasikan PR remote.

## Ringkasan dan file

Inventaris membaca stack Express yang benar-benar diregistrasikan, bukan daftar rute tiruan. Express 5 memakai `app.router.stack`; walker juga mendukung `app._router.stack` dan `router.stack`, menelusuri router ter-mount serta `route.stack` per method. Registrasi `use()` diamati dalam proses test untuk memperoleh mount path Express 5 yang disimpan sebagai matcher closure. Function handler tidak dibungkus. Registrasi route diamati untuk mencatat file sumber.

| File | Fungsi |
|---|---|
| `src/httpSurface.js`, `src/index.js` | Mengekstrak konstruksi app/server/WSS yang sama ke factory tanpa listen/restore Baileys; entrypoint produksi tetap memasang listener, timers dan startup lama |
| `src/routeScopeMarker.js`, `src/tenantScope.js` | Memilih helper tunggal scoped(handler), mengembalikan function identik dengan properti tenantScoped; middleware resolver yang sudah ada memakai helper tetapi tidak dipasang |
| `tests/route-inventory-tools.mjs` | Observasi mount/route, walker rekursif, klasifikasi, validasi dan renderer dokumen |
| `tests/route-inventory.allowlist.mjs` | Allowlist publik beralasan dan 70 entri pending eksplisit milik PR T yang valid |
| `tests/route-inventory.baseline.json` | Baseline jumlah per PR dan identitas pending; tidak boleh menambah entri baru |
| `tests/route-inventory-context.mjs` | Database fixture sementara dan factory runtime yang sama; tidak membuka database asli |
| `tests/route-inventory.test.mjs` | Enforcement inventaris, per-method/urutan scope, subrouter palsu, duplikat, USE/static/upgrade, meta-test dan smoke HTTP |
| `scripts/inventory-routes.mjs` | Menghasilkan ulang dokumen hidup; gagal bila inventaris tidak valid, tidak menambah pending |
| `scripts/verify-route-inventory-meta.mjs` | Child suite dengan injeksi runtime: exit 1, lalu tanpa injeksi: exit 0 |
| `docs/t01/route-inventory.md` | Inventaris otomatis method/path/status/PR/file dan posisi sebelum scope middleware |
| `package.json`, `.github/workflows/tenant-route-inventory.yml` | npm commands dan gate CI pada push/PR |

Parser JSON yang dipegang factory dan requireAuth dengan identitas function yang tepat diperlakukan sebagai pipeline, bukan endpoint. Error handler arity 4 juga bukan endpoint normal. Middleware USE lain tetap diinventaris, termasuk header middleware media. Static hanya memperoleh pengecualian publik jika handler benar-benar dibuat express.static dengan root `public`; root lain tidak lolos hanya karena nama function-nya serveStatic. Upgrade listener tambahan yang tidak dikenali menjadi surface unscoped, termasuk ketika dipasang melalui prependListener.

## Output merah dan hijau

| Bukti | Command / SHA | Exit dan hasil |
|---|---|---|
| [Red awal](evidence/red.txt) | node --test tests/route-inventory.test.mjs, baseline 3d14f14eda64744773d15c22d30514efec6da81f | 1; 74 surface, 3 publik, 71 unscoped; 1 test pass / 2 fail |
| [Green akhir](evidence/green.txt) | INVENTORY_BASE_REF=3d14f14 node --test tests/route-inventory.test.mjs tests/tenant-prerequisites.test.mjs tests/tenant-t01.test.mjs | 0; 17 pass / 0 fail (8 T02 + 9 T01/prasyarat) |
| [Injeksi runtime](evidence/meta-injected-red.txt) | INVENTORY_INJECT_UNSCOPED=1 node --test tests/route-inventory.test.mjs | 1; Missing tenant scope: GET /__unscoped_injected |
| [Injeksi dihapus](evidence/meta-removed-green.txt) | INVENTORY_INJECT_UNSCOPED=0 node --test tests/route-inventory.test.mjs | 0; seluruh test T02 hijau |
| [Regresi inbox](evidence/regression-inbox.txt) | ALLOW_AUTO_MIGRATE=1 node --regexp-interpret-all scripts/verify-inbox.mjs | 0 |
| [Regresi aturan AI](evidence/regression-ai-rules.txt) | ALLOW_AUTO_MIGRATE=1 node --regexp-interpret-all scripts/verify-ai-rules.mjs | 0 |

Red awal dijalankan sebelum helper scoped dan pending diimplementasikan. Tiga test awal sudah menelusuri seluruh graph nyata; test ketahanan tambahan ditambahkan selama implementasi. Assertion inventaris tetap menolak setiap surface baru yang tidak memiliki marker/exemption; allowlist pending hanya membekukan utang rute lama yang terlihat pada red awal.

## Inventaris dan baseline pending

Inventaris lengkap: [route-inventory.md](../t01/route-inventory.md). Tidak menyalin daftar rute ke test sebagai sumber enumerasi.

| Status | Jumlah surface |
|---|---:|
| Total registrasi | 74 |
| Pasangan unik method/path | 73 |
| Publik | 3 |
| Pending | 71 |
| Ter-scope | 0 |
| Tidak terklasifikasi setelah pengecualian | 0 |

| PR pemilik | Pending surface |
|---|---:|
| T03 | 9 |
| T05 | 18 |
| T06 | 34 |
| T07 | 1 |
| T08 | 4 |
| T13 | 5 |
| Total | 71 |

Ada 70 entri pending method/path: dua middleware USE pada `/media/*` mempunyai key dan status pending yang sama, sehingga dihitung dua surface. Ini bukan konflik status. Public hanya POST `/api/login`, GET `/api/health`, dan static USE `/*`. Logout dan /me tetap pending T03 meskipun letaknya sebelum requireAuth global. Upgrade `/ws` dibebankan ke T03 untuk scope handshake; isolasi isi event/room tetap pekerjaan T09.

Seluruh 74 surface saat ini ditandai `Before resolver=yes`, karena belum ada tenant middleware yang mendahului registrasi/mount. Urutan ini diuji: middleware yang ditambahkan sesudah mount tidak menghijaukan router lama; scope untuk `/safe` tidak menghijaukan sibling `/unsafe`. Marker handler GET tidak menghijaukan POST pada route() yang sama. Keberadaan marker tidak membuktikan resolver dipanggil; pengujian itu sengaja milik T03.

Pending harus cocok persis dengan snapshot baseline yang sedang direview. Saat sebuah rute menjadi scoped, hapus entri pending, turunkan jumlah PR pemilik dan perbarui dokumen. CI membandingkan jumlah/identitas dengan base SHA PR (atau before SHA pada push), sehingga budget tidak dapat dinaikkan bersamaan dengan allowlist untuk menghijaukan rute baru. Entri baru tetap ditolak walau jumlah total tetap dengan menukar rute lama. Hanya introduksi pertama T02 yang boleh tidak memiliki baseline pada base commit; baseline yang pernah ada lalu dihapus tidak dapat diinisialisasi ulang diam-diam. Dokumen yang belum dihasilkan ulang membuat suite gagal.

## Matriks pemeriksaan T02

| Pemeriksaan | Hasil |
|---|---|
| Rute non-allowlist tanpa marker | PASS, ditolak |
| Duplikat method/path berstatus bertentangan, atau exemption duplikat | PASS, ditolak |
| Pending PR tidak valid, alasan kosong, exemption/baseline usang | PASS, ditolak |
| Jumlah pending naik / key pending baru dengan jumlah sama | PASS, ditolak |
| Nested fake router /outer/inner/lost GET+POST | PASS, keduanya terdeteksi unscoped |
| route().stack per method; marker tidak membungkus function | PASS |
| Middleware sebelum/sesudah mount dan prefix sibling | PASS |
| Static, USE /media, upgrade /ws dan upgrade listener tambahan | PASS |
| Meta-test sisip rute, hapus lagi di proses test | PASS, gagal terdeteksi lalu hijau |
| Suite child benar-benar exit 1 ketika diinjeksi, exit 0 setelah dihapus | PASS |
| Factory mempertahankan health/login/static/auth/media responses | PASS |
| Entry point tidak menambah registrasi di luar factory yang diperiksa | PASS, guard sumber pada index |

## CI, risiko, rollback

Gate workflow menjalankan `npm run test:tenant:routes` dengan full Git history dan INVENTORY_BASE_REF. Workflow ditambahkan dan perintah yang sama dijalankan lokal; eksekusi GitHub Actions dan pengaturan branch protection jarak jauh belum dilakukan. Jadikan job `Tenant route inventory / inventory` required di pengaturan repo bila dibutuhkan oleh kebijakan merge. Tidak ada koneksi WA asli atau layanan AI digunakan oleh suite inventaris.

T02 adalah gate struktur, belum isolasi data. Seluruh pending tetap berperilaku lama. Resolver tidak dipasang, kuota/worker/media URL/socket room tidak diubah. RegExp mount yang belum didukung gagal tertutup, bukan dilewati. Implicit HEAD dan OPTIONS bawaan framework diturunkan dari route yang sama; method eksplisit tetap diinventaris per stack. Sub-aplikasi/transport baru harus memperluas adapter inventaris dengan test sebelum dipakai; jangan memberi exemption untuk melewati graph yang tidak dikenal. Marker bisa ditaruh pada handler yang tidak memanggil resolver; pembuktian perilaku itu tetap T03.

Tidak ada migrasi data T02. Untuk rollback aplikasi, pertahankan flag multi-tenant 0 dan ubah konstruksi HTTP secara atomik bersama adapter inventaris, dengan seluruh gate tetap hijau. Tidak memerlukan restore database. Perubahan kebijakan startup/versi database hanya milik commit review T01 dan mempunyai prosedur rollback terpisah. Tidak ada test inventaris dinonaktifkan.
