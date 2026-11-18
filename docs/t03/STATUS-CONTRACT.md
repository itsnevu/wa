# Kontrak sesi dan tenant T03

Keputusan prasyarat T04: GRACE_MS tetap 0. Tab berbagi cookie browser; setelah switch, request yang sudah membawa ID lama dapat mendapat 401 dan tab lain perlu dimuat ulang. Batasan multi-tab ini diterima; tidak ada grace window tersembunyi. Login memilih tenant otomatis bila tepat satu membership; login biasa tanpa membership menghasilkan 409 dengan reason NO_MEMBERSHIP (sesi tetap dibuat agar /me/pemilihan bekerja). Platform admin tanpa tenant tetap dapat login dan memakai rute platform. Pencabutan membership tenant lain tidak merotasi/mematikan sesi aktif yang berbeda.

18 November 2026. Cookie `sid` hanya berisi referensi acak 256 bit. User, role, tenant aktif dan otorisasi selalu diambil dari database. Possession ID sesi tetap sensitif; T03 tidak mengklaim cookie terikat secara kriptografis ke perangkat atau kebal pencurian cookie. Perubahan User-Agent sengaja diizinkan dan hash pengamatan terakhir dicatat.

| Kondisi | HTTP | code | Tindakan frontend |
|---|---:|---|---|
| Tidak ada row sesi, dicabut, masa berlaku habis, atau versi otorisasi usang | 401 | SESSION_INVALID | Tampilkan login |
| Sesi valid, tenant aktif null, pada rute tenant | 409 | TENANT_NOT_SELECTED | Tampilkan pemilih workspace |
| Tenant aktif bukan membership / switch bukan anggota / input bukan string | 403 | TENANT_FORBIDDEN | Tampilkan kode; jika select_tenant=true, muat daftar membership dan pilih ulang |
| Tenant aktif/switch target suspended | 403 | TENANT_SUSPENDED | Tampilkan kode apa adanya |
| ID sesi perangkat milik user lain atau tidak ada | 404 | SESSION_NOT_FOUND | Tidak membocorkan keberadaan perangkat |
| User bukan platform admin pada rute platform | 403 | PLATFORM_FORBIDDEN | Tampilkan kode |
| Platform admin sah tanpa tenant pada rute platform | 200 | — | Diizinkan tanpa membership tenant |

404 untuk resource bisnis tenant lain tetap pekerjaan T05/T06. Pada T03, pembuktian 404 dilakukan pada resource sesi milik akun lain; query inbox/pesan/media/produk tidak diubah.

`resolveTenantScope` adalah sumber kebenaran dengan tiga mode internal: tenant (default), session, dan platform. Middleware yang diberi scoped() memanggil tenantResolver.resolve yang menunjuk fungsi tersebut, sehingga spy dapat membuktikan eksekusinya. Session mode mengizinkan active_tenant_id null; platform mode memerlukan platform_role=platform_admin; tenant mode memvalidasi membership dan status terbaru. GET /api/me berscope sesi, bukan publik anonim, dan tetap 200 saat tenant null. Login, health dan aset static tidak memanggil resolver tenant.

| Endpoint | Scope | Hasil |
|---|---|---|
| GET /api/me | session | user tanpa password, tenants dengan role/status, active_tenant_id, tenant_mode, passMin |
| POST /api/tenant/switch | session | Validasi membership/status di transaksi yang sama dengan rotasi; Set-Cookie baru dan active_tenant_id |
| POST /api/logout | session | revoked_at diisi, cookie dihapus |
| GET /api/sessions | session | Hanya sesi aktif milik user saat ini, penanda current dan metadata perangkat |
| DELETE /api/sessions/:id | session | Hanya milik user saat ini; 404 untuk milik user lain; ID langsung tidak berlaku |
| GET /api/platform/session | platform | Identitas operasional saja; tidak membaca data tenant atau membuat konsol T04 |
| Upgrade /ws | tenant saat flag aktif | Tolak 401/409/403 sebelum 101; room dan filtering event tetap T09 |

Password/logout-all/ubah akun memakai session mode; tiga rute users memakai tenant mode dengan handler lama. Tidak ada role admin global yang otomatis diberi platform_role. Kolom platform_role minimal ditambahkan agar kontrak platform bisa diuji; pengelolaan role/konsol tetap T04.

Login dan switch membuat ID baru serta mencabut ID yang dipresentasikan dalam satu transaksi IMMEDIATE. Login tanpa cookie merupakan perangkat baru, sehingga tidak mencabut perangkat lain. GRACE_MS=0: ID lama ditolak pada timestamp rotasi maupun +1 ms. Tidak ada jendela dua ID valid untuk satu rantai rotasi. rotated_from hanya menunjuk ID yang pernah mempunyai row server, bukan cookie asing yang diberikan klien.

Perubahan role/membership melalui changeMembership/changeMembershipRole berlangsung satu transaksi: mutasi, invalidasi seluruh perangkat user, dan penggantian sesi caller. Perangkat lain harus login lagi. Trigger role langsung mencabut sesi; trigger membership mengubah auth_version dalam transaksi perubahan, sehingga ID lama tidak bisa dipakai sebagai otorisasi. Pada penghapusan membership aktif melalui SQL langsung, request pertama mendeteksi ketiadaan membership, mencabut ID lama, memberikan ID baru tanpa tenant, lalu membalas 403 TENANT_FORBIDDEN + select_tenant=true. Ini membedakan pencabutan membership dari pencabutan sesi yang memang harus 401. T04 harus memakai helper transaksional, tidak mendistribusikan sesi pengganti ke operator yang mengubah user lain.

Setiap lookup sesi dan login memangkas row kedaluwarsa; row revoked dipertahankan maksimal 24 jam untuk jejak rotasi lalu dipangkas pada akses berikutnya. Sistem yang idle tidak menambah sesi; tidak diperlukan timer untuk menjamin pertumbuhan dibatasi TTL pada aktivitas berikutnya. last_seen_at dan ua_hash diperbarui server-side. Cookie menggunakan HttpOnly, SameSite=Lax, Path=/ dan Secure bila konfigurasi mengaktifkannya.

Migrasi schema version 1 -> 2 memakai fingerprint tetap, backup dan IMMEDIATE dari runner. Seluruh sesi token lama dibuang, tidak dipromosikan menjadi sesi sah. Semua user harus login ulang setelah migrasi. Rollback flag 0 mempertahankan schema v2 dan model sesi aman, tetapi login memilih default tenant dan UI legacy tidak meminta pemilihan tenant. Guard startup MULTITENANT_ENABLED=1 pada aplikasi produksi tetap aktif sampai isolasi resource tahap berikutnya selesai; test HTTP/browser mengaktifkan config dalam fixture tersendiri. T03 bukan izin menjalankan banyak tenant operasional pada query lama.
