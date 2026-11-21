# ADR 0001: akses lampiran melalui UUID dan signed URL yang memerlukan sesi

Tanggal: 18 November 2026. Status: diterapkan pada branch PR 01, menunggu review.

## Konteks

`/media/<nama-file>` sebelumnya hanya memerlukan login. Akses itu melewati pemeriksaan nomor yang digunakan endpoint percakapan. Nama file yang diketahui dapat dibuka pengguna lain. Media historis direferensikan oleh `messages.media_path`, tanpa registry media.

## Keputusan

- Tambahkan tabel `media_records(uuid, message_id UNIQUE, number_id, storage_path, created_at)` dan indeks lookup, tanpa menghapus kolom lama. `messages` tetap sumber hubungan percakapan. FK mengikuti penghapusan pesan; GC file tetap PR 05.
- Backfill dengan transaksi SQLite `BEGIN IMMEDIATE`, `INSERT OR IGNORE` dan UUID acak. Backfill hanya membuat baris untuk pesan dengan nomor yang cocok dengan chat; tidak mengoreksi baris bermasalah atau menimpa registry existing. UUID stabil sesudah restart. Pesan baru didaftarkan ketika URL diminta, dalam transaksi; backfill startup mencakup data lama.
- Penerbitan: `POST /api/chats/:chatId/media-url`, body `{media_path}`. Sesi wajib. Server melakukan join media → message → chat → number. `number_id` registry/pesan/chat wajib sama dan nama file harus sama dengan referensi pesan. Pemilik nomor atau admin dapat menerbitkan URL untuk dirinya.
- Unduhan: `GET|HEAD /media/:uuid?user=<id>&exp=<ms>&sig=<hex>`. HMAC-SHA256 atas `JSON.stringify([uuid,user_id,exp])`. Masa berlaku maksimum lima menit. Signature dibandingkan constant-time, duplikasi parameter ditolak, sesi wajib, dan ownership diperiksa ulang setiap akses. Admin memakai URL terbitan admin sendiri, tidak memakai URL pengguna lain.
- File yang direferensikan lintas nomor dikarantina untuk semua role. Tidak ada pengambilan pemilik secara otomatis. SQL audit mengeluarkan ID baris yang perlu ditinjau tanpa isi pesan atau nomor telepon.
- `MEDIA_SIGNED_URLS_ENABLED=0` secara default. Flag nonaktif menutup akses dengan 503 setelah pemeriksaan sesi; tidak mengaktifkan kembali static lama. Saat flag aktif, kunci environment minimal 32 karakter wajib tersedia sebelum database dibuka. Tidak ada kunci default atau kunci yang disimpan dalam repo. Operator menggunakan nilai acak dari pengelola rahasia; validasi panjang bukan ukuran entropi.
- File hanya dapat memakai basename datar yang kompatibel Windows. Gunakan `path.resolve` dan `path.relative` dengan batas separator, bukan pembandingan prefix string biasa. Tolak drive, UNC, ADS, reserved devices, encoding, separator, dot segment dan trailing dot/spasi; realpath dan pemeriksaan symlink mencegah escape melalui link. Folder media tidak boleh dapat ditulis oleh pengguna OS yang tidak dipercaya.
- Seluruh respons media menggunakan `Cache-Control: private, no-store`, `nosniff`, dan `Referrer-Policy: no-referrer`. Allowlist ekstensi raster/audio/video dapat inline. HTML, SVG, PDF dan tipe lain dipaksa sebagai `application/octet-stream`, `Content-Disposition: attachment`, dan CSP sandbox. MIME dari pengirim tidak dipercaya. Sniffing konten upload tetap PR 17.
- Frontend meminta URL per pengguna, termasuk untuk pesan realtime, dan memperbaruinya saat lampiran dibuka setelah expiry. URL tidak disimpan di localStorage atau cache service worker. Pesan gagal menggunakan Bahasa Indonesia. Tidak mengubah payload WebSocket menjadi URL milik satu pengguna yang disiarkan ke pengguna lain.

## Alternatif yang tidak dipilih

- Static handler dengan login saja: mempertahankan IDOR.
- Signed URL tanpa sesi: URL bocor dapat dipakai pihak lain dan pencabutan sesi tidak berlaku.
- Signature berdasarkan nama file saja: tidak mengikat identitas pengguna, ownership dan waktu.
- Menebak pemilik untuk file ambigu: berpotensi membocorkan file lintas nomor.
- Registry dan endpoint streaming dengan dependency baru: tidak diperlukan; crypto/fs/path bawaan dan Express/better-sqlite3 yang ada mencukupi.
- Mengaktifkan fitur melalui flag dengan fallback static: melewati seluruh perbaikan keamanan.

## Konsekuensi dan batas

Rotasi kunci membatalkan URL lama; viewer meminta URL baru. Salinan URL milik orang lain ditolak walaupun admin. Migrasi hanya menambah schema; rollback mempertahankan registry. File yang hilang memberi 404 generik. Flag default nonaktif membuat lampiran tidak tersedia sampai operator menyelesaikan backup, audit dan konfigurasi. Mekanisme ini membatasi akses server; file yang sudah diunduh tidak dapat ditarik kembali. Perubahan file oleh administrator OS yang berbahaya dan race filesystem setelah validasi berada di luar batas pengguna aplikasi; ACL direktori media tetap diperlukan. Single-host SQLite WAL dipertahankan; desain tidak menjamin multi-host SQLite.

## Bukti

Lihat `docs/pr01/REPORT.md`, output red/green dengan hash test identik, pengujian containment Windows, audit snapshot database, serta screenshot fixture browser.
