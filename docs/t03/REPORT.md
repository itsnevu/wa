# Laporan T03 — sesi dan tenant aktif

18 November 2026, Asia/Jakarta. Branch `feat/tenant-session-scope`, di atas T02 `ccd67d1` dan commit prasyarat `9773203`. Berhenti pada T03.

## Ringkasan

Sesi sekarang memakai ID acak 256 bit dan baris server yang menyimpan user, tenant aktif, waktu, ancestry rotasi, revokasi, versi otorisasi dan hash User-Agent. Login, switch dan perubahan membership memakai transaksi IMMEDIATE; ID lama tidak mendapat grace window. Resolver benar-benar dipanggil pada 13 surface T03, dibuktikan spy per surface, bukan hanya marker. Frontend mempunyai pemilih workspace serta penanganan terpisah untuk 401/409/403.

Query resource bisnis, URL media, job dan room/event WebSocket tidak diubah. Guard aktivasi multi-tenant produksi tetap dipertahankan karena T05/T06 dan tahap isolasi lain belum selesai. Test HTTP/browser mengaktifkan config tenant hanya di fixture, setelah bootstrap flag 0. T03 tidak mengizinkan operasional banyak tenant pada query lama.

## Prasyarat dan bukti terpisah

[PREREQUISITES.md](PREREQUISITES.md) mencatat seluruh 27 verifier lama, pemisahan static/data, Actions dan ADR sebelum implementasi sesi dimulai. Commit prasyarat: `9773203946c997018b50b426e841b41a5c66fecf`.

- [Actions T02 run 44161855892](https://github.com/itsnevu/wa/actions/runs/44161855892): success pada ccd67d1. Required check inventory, strict=true, sudah dipasang pada main; [bukti API](evidence/actions-prerequisite.txt).
- [Assertion static/data](evidence/static-boundary.txt): lulus untuk overlap dua arah, media dan symlink.
- [27 verifier sebelum implementasi](evidence/verify-prereq-final/summary.json): 25 pass, 2 merah akibat F0-W01 yang sama. Output setiap command disimpan.
- ADR 0002 mewajibkan rebase + regenerasi ketika baseline berkonflik, tanpa menaikkan budget pending.

## File

| File | Perubahan |
|---|---|
| src/sessionMigration.js, schemaMigrations.js, schema-fingerprints.json | Migrasi eksplisit versi 2; hapus token sesi lama; tambahkan model sesi, platform_role minimal dan auth_version; trigger invalidasi |
| src/sessionStore.js | ID acak, rotasi/revokasi atomik, lookup authoritative, metadata UA, pruning dan helper mutasi membership untuk T04 |
| src/auth.js, db.js | Auth membaca model sesi baru; prepared statements sesi disesuaikan; query resource lain tetap |
| src/tenantScope.js | Kontrak kode status, mode session/tenant/platform, middleware scoped dan seam spy resolver |
| src/sessionRoutes.js, routes.js | /me, switch, sesi perangkat, logout dan platform/session; resolver pada akun/users yang keluar dari pending T03 |
| src/httpSurface.js | Tenant resolver pada verifyClient handshake, sebelum upgrade diterima; room/event tidak diubah |
| public/index.html | Pemilih workspace, tombol switch, penanganan login/pilih tenant/kode 403 dan membership dicabut saat reload |
| tests/tenant-t03.test.mjs | 26 test T03, termasuk spy semua 13 surface, status, rotasi, perangkat, UA, handshake, cleanup dan migrasi |
| tests/tenant-fixture.mjs, tenant-t01.test.mjs, tenant-prerequisites.test.mjs | Fixture ID sesi/auth_version baru; versi skema 2 dan kontrak null tenant 409 |
| tests/route-inventory.allowlist.mjs, route-inventory.baseline.json | Hapus hanya sembilan pending T03; jumlah PR lain tetap |
| docs/t01/route-inventory.md | Inventaris hidup diregenerasi |
| scripts/retire-scoped-routes.mjs | Hanya menghapus exemption untuk rute yang kini bermarker; menolak penambahan/budget naik |
| scripts/check-t03-baseline.mjs | Jalankan suite lengkap pada source prasyarat yang immutable |
| scripts/verify-tenant-sessions-browser.mjs | Browser nyata, 401/409/403, reselection dan screenshot |
| package.json, .github/workflows/tenant-route-inventory.yml | npm test T03 dan gate sesi di job inventory yang sudah required |

File prasyarat, perubahan harness dan bukti regresi sebelumnya dilaporkan terpisah. PHASE-0-PLAN.md milik pengguna tetap tidak disentuh/di-commit. Database asli tidak dimigrasikan.

## Merah lalu hijau

| Bukti | Command / hasil |
|---|---|
| [Red awal](evidence/red.txt) | node --test tests/tenant-t03.test.mjs, SHA 9773203, exit 1; **0/24 pass** sebelum implementasi |
| [Red suite lengkap pada baseline](evidence/red-complete-baseline.txt) | node scripts/check-t03-baseline.mjs, source SHA penuh 9773203946c997018b50b426e841b41a5c66fecf; inner exit 1, **0/26 pass** |
| [Green gabungan](evidence/green.txt) | node --test T01 + review + inventory + static + T03; exit 0, **44/44 pass** |
| [Browser](evidence/browser.txt) | node scripts/verify-tenant-sessions-browser.mjs; exit 0 |
| [Seluruh verifier pasca-T03](evidence/verify-after/summary.json) | **28 skrip**, 26 exit 0; hanya verify-hardening dan verify-ai-final exit 1 karena F0-W01 |

Seluruh kasus yang diminta sudah tercakup dalam 24 test merah awal. Dua test tambahan menguatkan rotasi membership/grace boundary dan migrasi v1→v2; keduanya kemudian juga dijalankan pada source baseline. Output mencatat SHA baseline, command dan exit code; hasil working tree T03 tidak disalahartikan sebagai source commit prasyarat. Assertion tidak dihapus untuk menghijaukan hasil.

F0-W01 tetap merah pada assertion regex bentuk sumber reconnect di langkah 7 hardening, bukan kegagalan baru kontrak sesi. verify-ai-final ikut merah karena menjalankan hardening. Sebelas langkah hardening lainnya lulus, termasuk otorisasi objek dan shutdown. Tidak mengklaim seluruh regresi historis hijau. Run pertama/prasyarat antara juga disimpan, termasuk kegagalan harness yang sudah dibetulkan.

## Tabel kontrak

Kontrak lengkap dan perilaku lifecycle: [STATUS-CONTRACT.md](STATUS-CONTRACT.md).

| Kondisi | Respons | Bukti |
|---|---|---|
| Tanpa sesi / revoked / expired / ID lama | 401 SESSION_INVALID | PASS |
| Sesi valid, tenant null, rute tenant | 409 TENANT_NOT_SELECTED | PASS |
| Bukan membership / input switch array atau object | 403 TENANT_FORBIDDEN | PASS; switch gagal tidak merotasi sesi |
| Membership dicabut saat aktif | 403 TENANT_FORBIDDEN + select_tenant | PASS; ID lama dicabut, pengganti null, UI memilih ulang |
| Tenant suspended | 403 TENANT_SUSPENDED | PASS |
| Sesi perangkat akun lain | 404 SESSION_NOT_FOUND | PASS |
| Platform admin tanpa tenant pada platform/session | 200 | PASS; /me 200, rute tenant 409 |

404 di atas dibuktikan untuk resource sesi akun lain. Penolakan 404 pesan/nomor/produk milik tenant lain tetap T05/T06; T03 tidak mengubah query tersebut.

| Pemeriksaan lain | Hasil |
|---|---|
| Spy pada 12 endpoint HTTP T03 + upgrade /ws | PASS, setiap surface memanggil resolver |
| Login/health/static tidak memanggil resolver | PASS |
| Fixation cookie sebelum login | PASS, tidak dipromosikan |
| Rotasi login/switch/role/membership | PASS, ID lama mati; rotated_from server-side |
| GRACE_MS=0 pada timestamp rotasi dan +1 ms | PASS |
| Cookie dipakai dari UA berbeda | PASS, sesi valid dan hash terakhir tersimpan |
| Logout, daftar perangkat dan pencabutan perangkat lain | PASS |
| /me dengan tenant null | PASS, daftar membership dan role tersedia |
| /ws tanpa sesi / tanpa tenant / tenant valid | PASS, 401 / 409 / 101 |
| Sesi expired benar-benar dihapus | PASS |
| Sesi token lama v1 tidak dimigrasikan diam-diam | PASS, seluruh sesi lama dihapus dan login ulang wajib |
| Login → /me → pilih tenant → buka inbox | PASS, tidak ada 409 tak terduga |
| Flag mati | PASS, default tenant dan UI legacy tetap bekerja |

## Inventaris

| Status | Surface |
|---|---:|
| Total | 78 |
| Publik | 3 |
| Ter-scope | 13 |
| Pending | 62 |
| Pending T03 | **0** |
| Pending T05 / T06 / T07 / T08 / T13 | 18 / 34 / 1 / 4 / 5 |

Empat surface baru adalah switch, daftar sesi, cabut sesi dan identitas platform. /me dan logout merupakan rute lama. Sembilan surface T03 lama sekarang bermarker dan menjalankan resolver; tidak ada angka pending PR lain yang dinaikkan. Gate monotonic tetap aktif, termasuk fallback ke parent commit pada initial branch push dengan before SHA nol.

## Screenshot

- [Pemilih tenant desktop 1366×900](evidence/tenant-picker-desktop.png)
- [Pemilih tenant 360×780](evidence/tenant-picker-360px.png)

Screenshot dari Chrome headless nyata dengan fixture A/B, bukan mockup. Uji browser juga memastikan tidak ada overflow horizontal pada 360px dan pencabutan membership saat reload membuka picker, tidak menimpa state itu dengan layar login.

## Risiko dan rollback

- Guard MULTITENANT_ENABLED=1 pada startup produksi masih menolak aktivasi sampai isolasi resource siap. Mode tenant T03 diuji dengan config fixture; jangan menganggap 13 scope sesi membuktikan seluruh aplikasi aman multi-tenant.
- Room, isi event dan broadcast WebSocket masih implementasi lama T09. Handshake hanya memastikan user memiliki tenant aktif yang valid saat masuk.
- Platform role minimal tidak mempromosikan admin lama, dan endpoint platform/session tidak membaca isi tenant. Konsol platform dan audit akses isi tetap T04.
- Helper membership adalah primitive internal; T04 harus memvalidasi hak operator sebelum memanggilnya. Perangkat lain diinvalidasi dan harus login ulang; caller menerima pengganti dalam transaksi yang sama.
- UA hash adalah metadata, bukan binding perangkat. Cookie valid dari UA lain memang diizinkan sesuai kontrak.
- Cleanup berjalan pada lookup/login; revoked rows disimpan maksimal 24 jam untuk jejak. Migrasi versi 2 membuang seluruh sesi lama dan membutuhkan re-login.
- F0-W01 tetap terbuka. Database produksi/workspace asli dan sesi Baileys tidak dimigrasikan pada pekerjaan ini.

Rollback perilaku: pertahankan MULTITENANT_ENABLED=0. Skema v2 dan invalidasi cookie lama tetap berlaku; login otomatis memilih default tenant dan frontend tidak menampilkan picker. Ini sudah diuji oleh test dan seluruh verifier lama. Rollback binary/skema v1 membutuhkan maintenance window, penghentian penulis, karantina DB/WAL/SHM terbaru dan restore snapshot sebelum migrasi; perubahan sejak snapshot harus direkonsiliasi. Kosongkan tabel sessions pada snapshot yang direstore sebelum traffic dibuka agar token lama yang pernah dicabut tidak hidup kembali. Jangan mengaktifkan penerimaan token lama atau menonaktifkan gate inventaris untuk rollback.
