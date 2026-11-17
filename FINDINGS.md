# Temuan Fase 0

## T01 — 18 November 2026

- T01-W01 — Fondasi tenant ditambahkan: 21 tabel resource ber-tenant_id NOT NULL/FK, membership banyak tenant per user, satu owner maksimal, resolver sesi/membership/status. Migrasi pada salinan database lokal mempertahankan 535 pesan dan seluruh jumlah baris; nol tenant_id kosong. Bukti dan matriks: [laporan T01](docs/t01/REPORT.md), keputusan: [ADR 0002](docs/adr/0002-tenant-foundation-sqlite.md).
- T01-W02 — Isolasi aplikasi belum lengkap: rute, query, worker, socket, direktori, onboarding dan backup tenant menunggu T02–T15. Flag default 0; flag 1 sengaja menggagalkan startup sebelum membuka database sampai tahap isolasi selesai. DEFAULT 'default' hanya kompatibilitas writer lama dan harus dicabut/dilindungi sebelum aktivasi.
- T01-W03 — Snapshot database lokal memiliki 20 tabel resource; bootstrap kode saat ini membuat media_records dan mendaftarkan 79 media sebelum T01. Test final tetap mewajibkan 21 tabel dan menjaga jumlah 20 tabel asli. Database asli belum dimigrasikan dalam sesi ini.
- T01-W04 — Suite T01 7/7 hijau; regresi inbox, aturan AI dan path media hijau. Red awal tersedia untuk tiga test sebelum implementasi; suite lengkap juga terbukti merah 0/7 pada source SHA baseline. Test ketahanan tambahan ditulis sesudah implementasi awal; riwayat ini dinyatakan terbuka pada laporan.
- T01-W05 — Bearer cookie B sendiri mengautentikasi B; test sesi tertukar T01 memeriksa principal A + cookie B, bukan ketahanan pencurian cookie. Session binding/rotation dan browser E2E tetap menunggu T03/T15. Tidak ada klaim seluruh matriks endpoint/E2E sudah hijau.

Tanggal: 17 November 2026. Kode fitur belum diubah.

- F0-W01 — `scripts/verify-hardening.mjs:344` gagal pada assertion regex bentuk sumber reconnect di `public/index.html`. Suite mencatat 11 PASS dan 1 FAIL. Ini membuktikan baseline test merah; belum membuktikan reconnect runtime rusak. Perlu test perilaku browser sebelum memutuskan perubahan.
- F0-W02 — WA Suite sudah memakai SQLite WAL dan indeks unik `(number_id, wa_id)`. Pertahankan ini; jangan membuat dedupe berbasis hash isi.
- F0-W03 — `sendText` menambah hitungan harian sebelum `sock.sendMessage`; pesan keluar tidak mempunyai status queued/accepted/delivered/read yang durable. Cakupan perbaikan ledger/status ada di rencana.
- F0-W04 — `config.js` memiliki default `ADMIN_PASS=admin123`, lebih pendek daripada minimum password ubah/buat akun. Evaluasi fail-fast bootstrap tanpa mengubah akun yang sudah ada. Di luar perbaikan langsung Fase 0.
- F0-W05 — Kredensial Baileys disimpan melalui multi-file auth, bukan database. Persyaratan enkripsi memerlukan storage adapter/migrasi seluruh key material; enkripsi kolom database saja tidak menutup temuan.
- F0-W06 — Retensi sekarang menghapus baris pesan langsung; backup media opsional dan backup ZIP tidak terenkripsi. Rencana memisahkan soft delete, GC, cap dan enkripsi/restore.
- F0-W07 — File `.env.example` sempat berisi API key pada commit lokal yang ditolak GitHub. Key dihapus dari commit sebelum push sebelumnya. Rotasi key tetap tindakan operator yang belum dibuktikan.
- F0-W08 — Kecocokan timestamp kuota memakai UTC sementara backup memakai zona proses. Tetapkan zona bisnis eksplisit pada ledger agar batas hari dapat diuji dan dipahami operator.

## PR 01 — 18 November 2026

- P01-W01 — Filename yang direferensikan oleh lebih dari satu nomor tidak mempunyai ownership tunggal. Ditutup dalam scope otorisasi media: semua role ditolak sampai pengelola menyelesaikan ambiguitas. Audit read-only sumber lokal dan snapshot menemukan nol kasus. Regression red/green tersedia di `docs/pr01/evidence/red-edge.txt` dan `green-edge.txt`.
- P01-W02 — Satu eksekusi hardening media mengalami `TypeError: fetch failed`; run langkah itu sendiri kemudian lolos. Fixture menggunakan port pilihan OS menggantikan port acak; run final langkah 2/3 lolos. Penyebab jaringan awal belum dipastikan dan tidak diklaim sebagai bug produk yang sudah didiagnosis.
- F0-W01 tetap terbuka untuk PR 02. F0-W04 dan F0-W07 tidak diperbaiki. Kuota, status pengiriman, retensi, kredensial Baileys dan backup tetap menunggu batch yang ditentukan. Laporan PR 01 tidak menyatakan baseline keseluruhan hijau.
