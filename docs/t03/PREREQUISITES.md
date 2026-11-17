# Prasyarat sebelum T03

18 November 2026. Baseline T02 ccd67d18de315c62bd45daed1b93172c306d409b. Tidak ada implementasi sesi T03 pada tahap ini.

1. Seluruh **27 verify-*.mjs** dijalankan di snapshot repo + database sementara. [Run pertama](evidence/verify-before/summary.json) menyimpan semua kegagalan awal. Harness salinan dilengkapi dependency driver.js dan source yang belum di-commit; helper baseline menggunakan git -C agar bisa berjalan dari subdirektori; fixture migrasi kontak lama dinormalisasi lewat frozen bootstrap sebelum melewati pemeriksaan fingerprint. Assertion produk tidak dilemahkan. [Run prasyarat akhir](evidence/verify-prereq-final/summary.json): **25 exit 0, 2 exit 1**. Keduanya F0-W01: verify-hardening langkah 7 (regex bentuk sumber reconnect), dan verify-ai-final yang menjalankan hardening. Langkah hardening lainnya lulus. Semua output individual ada dalam direktori evidence tersebut.
2. src/staticBoundary.js menolak root static yang menjadi parent/child DATA_DIR atau direktori media, termasuk alias symlink dan parent yang belum ada. createHttpSurface memanggil assertion sebelum static dipasang. [Test](evidence/static-boundary.txt) lulus.
3. Branch T02 dipush sesuai instruksi menjalankan Actions. [Run 44161855892](https://github.com/itsnevu/wa/actions/runs/44161855892) **success**, head ccd67d1. Required status check `inventory`, strict=true, dipasang pada main; repo sebelumnya belum memiliki branch protection. [Bukti API teredaksi tanpa credential](evidence/actions-prerequisite.txt). Tidak ada perubahan kebijakan review lain yang dimatikan.
4. ADR 0002 sekarang mewajibkan **rebase + gabungkan pengurangan + regenerasi** untuk konflik baseline PR paralel; menaikkan jumlah atau mengembalikan key pending lama dilarang.

Database asli tidak dimigrasikan; tidak ada koneksi Baileys nyata. Run API memakai credential helper yang tersedia tanpa mencetak credential. Runner regresi menggunakan ALLOW_AUTO_MIGRATE=1 hanya pada fixture sementara.
