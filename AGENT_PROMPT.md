# Kontrak kerja

Kamu mengerjakan repo wa-suite (Node 20, ESM, Express + ws + Baileys + better-sqlite3).
ATURAN: jangan scan seluruh repo. Baca HANYA file yang kamu ubah. Jangan refactor file
lain, jangan ganti nama fungsi yang sudah ada, jangan tambah dependency tanpa alasan.
Ikuti pola yang sudah ada persis: query SQL disiapkan di src/db.js (objek q),
handler di src/routes.js, logika WhatsApp di src/wa.js, UI di public/index.html.

Kontrak yang tidak boleh dilanggar:
- Setiap route non-login wajib lewat requireAuth; cek akses nomor pakai canAccessNumber.
- Semua pengiriman keluar lewat wa.sendText (jangan panggil sock.sendMessage langsung)
  supaya queue + delay + presence tetap jalan.
- Semua pesan masuk & keluar wajib masuk tabel messages lewat q.insertMessage.
- Jangan menambah tabel tanpa menambah statement-nya di src/db.js.
- Nomor dinormalisasi ke format 62 tanpa plus sebelum requestPairingCode.
- Broadcast realtime lewat emit() dari src/wa.js.

Tugas:
1. Unggah media (gambar/dokumen) di chat: kolom messages.media_path, endpoint
   POST /chats/:chatId/media (multipart, simpan ke data/media), render di UI.
2. Penjadwal follow-up: tabel followups (chat_id, body, run_at, sent), worker
   setInterval 30 detik di src/index.js yang memanggil wa.sendText.
3. Pencarian pesan: endpoint GET /search?q= dengan scope nomor milik user.
4. Statistik: GET /stats - jumlah chat, pesan masuk/keluar per hari untuk nomor sendiri.
5. Halaman login: tambah tombol uji koneksi yang memanggil /api/health.

Selesai = npm start jalan tanpa error, kelima fitur bisa dipakai, tidak ada file
di luar daftar yang berubah.
