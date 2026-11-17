# Temuan Fase 0

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
