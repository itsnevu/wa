// Driver.js is served locally so guides do not depend on a CDN.
const moduleGuides = {
  ai: [
    [null, 'Otomasi AI', 'Atur asisten per nomor, uji jawabannya, dan kelola produk serta pesanan.'],
    ['#aiNumberTrigger, #aiNumber', 'Pilih nomor', 'Pengaturan, anggaran, produk, dan log terpisah untuk setiap nomor WhatsApp.'],
    ['#aiSettingsForm', 'Pengaturan asisten', 'Pilih provider dan model, tulis prompt, atur batas dan eskalasi, lalu simpan. AI hanya aktif jika sakelar dinyalakan dan pengaturan disimpan.'],
    ['#aiUsage', 'Pemakaian token', 'Hijau berarti di bawah ambang, kuning mendekati batas, dan merah mencapai anggaran. Lanjutkan AI menaikkan anggaran 20%.'],
    ['#aiTestForm', 'Konsol uji', 'Uji jawaban tanpa mengirim ke WhatsApp atau membuat pesanan. Token uji tetap tercatat.'],
    ['.ai-products', 'Katalog produk', 'Tambah, edit, nonaktifkan, atau hapus produk yang dapat digunakan AI.'],
    ['.ai-orders', 'Pesanan', 'Periksa pesanan yang dibuat AI dan perbarui status penanganannya.'],
    ['.ai-logs', 'Log jawaban', 'Lihat 50 permintaan terakhir beserta jawaban, token, dan error untuk evaluasi.'],
  ],
  dashboard: [
    [null, 'Ringkasan workspace', 'Lihat kondisi nomor WhatsApp dan akses modul yang sering digunakan dari sini.'],
    ['.dashboard-welcome', 'Ringkasan hari ini', 'Bagian ini menampilkan akun yang sedang digunakan dan tanggal hari ini.'],
    ['.stat-grid', 'Kondisi nomor', 'Periksa jumlah nomor, nomor online, dan nomor yang belum terhubung sebelum mulai melayani pelanggan.'],
    ['.dashboard-inbox', 'Buka percakapan', 'Gunakan tombol Buka kotak masuk untuk melihat dan membalas chat pelanggan.'],
    ['.quick-actions', 'Akses cepat', 'Buka pengelolaan nomor, template balasan, atau label pelanggan.'],
    ['#page table', 'Status koneksi', 'Lihat nomor mana yang online. Jika belum terhubung, buka modul Nomor untuk menghubungkannya.'],
  ],
  chats: [
    [null, 'Kotak masuk pelanggan', 'Pilih nomor WhatsApp, buka percakapan, lalu balas pelanggan. Panduan ini menjelaskan kontrol yang sedang terlihat.'],
    ['.mobile-number-picker', 'Pilih nomor WhatsApp', 'Pilih nomor bisnis yang percakapannya ingin Anda kelola.'],
    ['#nums', 'Nomor WhatsApp', 'Klik nomor untuk membuka inbox-nya. Titik status menunjukkan koneksi; ikon pensil mengubah nama nomor di dashboard.'],
    ['#btnNum', 'Tambah nomor', 'Daftarkan nomor WhatsApp bisnis baru dari tombol ini.'],
    ['#search', 'Pencarian percakapan', 'Ketik untuk mencari percakapan pada nomor yang sedang dipilih.'],
    ['.inbox-filters', 'Antrean chat', 'Semua menampilkan seluruh antrean. Belum dibaca untuk pesan baru, Milik saya untuk chat yang ditugaskan kepada Anda, dan Belum ditugaskan untuk chat yang belum diambil CS.'],
    ['.inbox-status-filter', 'Status penanganan', 'Filter chat berdasarkan Baru, Diproses, atau Selesai. Status membantu membedakan pelanggan yang masih perlu ditangani.'],
    ['#chats', 'Daftar percakapan', 'Klik chat untuk membukanya. Angka gelap menunjukkan pesan belum dibaca; mulai 100 pesan ditulis 99+.'],
    ['[data-rename-chat]', 'Ubah nama pelanggan', 'Ikon pensil mengganti nama percakapan di dashboard agar pelanggan lebih mudah dikenali.'],
    ['[data-pin-chat]', 'Sematkan percakapan', 'Ikon pin membuat pelanggan penting tetap di bagian atas daftar. Klik lagi untuk melepas pin.'],
    ['#title', 'Pelanggan yang dibuka', 'Nama dan nomor pelanggan ditampilkan di header. Klik nama untuk mengubah nama kontak di dashboard.'],
    ['#conversationStatusTrigger, #conversationStatus', 'Ubah status chat', 'Tandai Baru, Diproses, atau Selesai sesuai progres pelayanan pelanggan.'],
    ['#chips', 'Label pelanggan', 'Label seperti Pelanggan Baru atau Prioritas tampil di sini dengan warna yang dipilih.'],
    ['#takeChat', 'Ambil tanggung jawab', 'Tugaskan chat kepada diri Anda. Percakapan kemudian masuk filter Milik saya.'],
    ['#releaseChat', 'Lepas penugasan', 'Kembalikan chat ke antrean Belum ditugaskan agar CS lain dapat mengambilnya.'],
    ['#labelPick', 'Pasang label', 'Pilih label untuk mengelompokkan pelanggan. Buat label dan warnanya di modul Label.'],
    ['#exportChat', 'Unduh riwayat', 'Unduh riwayat percakapan yang sedang dibuka sebagai file CSV.'],
    ['#msgs', 'Riwayat pesan', 'Baca percakapan di sini. Menu pada pesan menyediakan tindakan seperti kutip dan reaksi.'],
    ['#tplPick', 'Gunakan template', 'Pilih balasan yang sudah disiapkan. Isi template masuk ke kolom pesan agar bisa diperiksa sebelum dikirim.'],
    ['#btnFile', 'Kirim lampiran', 'Pilih foto, video, audio, atau dokumen untuk dikirim kepada pelanggan.'],
    ['#input', 'Tulis balasan', 'Ketik pesan di sini. Enter mengirim dan Shift+Enter menambah baris. Periksa tujuan serta isi pesan sebelum mengirim.'],
    ['#btnSend', 'Kirim pesan', 'Kirim balasan ke percakapan yang sedang dibuka. Tombol aktif setelah chat dipilih dan isi pesan tersedia.'],
    ['#mMore', 'Tindakan chat di ponsel', 'Pada layar kecil, tindakan tambahan percakapan dikumpulkan di menu ini.'],
  ],
  numbers: [
    [null, 'Kelola nomor WhatsApp', 'Kelola koneksi nomor bisnis yang dapat diakses akun Anda.'],
    ['#pageAction', 'Tambah nomor', 'Daftarkan nomor bisnis baru. Setelah itu hubungkan akun WhatsApp dengan QR yang tersedia.'],
    ['#page table', 'Daftar nomor', 'Periksa nama, nomor, status koneksi, dan kuota pengiriman harian.'],
    ['#page [data-qr]', 'Hubungkan WhatsApp', 'Tampilkan QR untuk dipindai melalui menu Perangkat tertaut pada WhatsApp di HP.'],
    ['#page [data-number-del]', 'Hapus nomor', 'Menghapus nomor beserta data dashboard terkait memerlukan konfirmasi. Periksa nomor yang dipilih sebelum menyetujui.'],
  ],
  rules: [
    [null, 'Balasan otomatis berbasis aturan', 'Rules membalas pesan masuk berdasarkan kata kunci. Pilih nomor terlebih dahulu untuk melihat aturannya.'],
    ['#rulesNumberTrigger, #rulesNumber', 'Pilih nomor', 'Setiap nomor memiliki aturan sendiri. Ganti nomor untuk mengelola aturan pada inbox yang sesuai.'],
    ['#rulesTable', 'Daftar aturan', 'Aturan untuk nomor terpilih ditampilkan di sini. Jika belum ada nomor dipilih, pilih nomor lalu buka Panduan lagi untuk melihat penjelasan form.'],
    ['#rp', 'Kata kunci', 'Masukkan teks yang ingin dideteksi dari pesan pelanggan, misalnya jam buka.'],
    ['#rr', 'Isi balasan', 'Tulis jawaban otomatis yang akan dikirim saat kata kunci cocok.'],
    ['#rmTrigger, #rm', 'Cara mencocokkan', 'Mengandung mencari kata di dalam pesan; persis mencocokkan seluruh teks; regex memakai pola khusus.'],
    ['#radd', 'Simpan aturan', 'Tambahkan aturan setelah kata kunci, balasan, dan tipe pencocokan terisi.'],
    ['#page [data-toggle]', 'Aktif atau nonaktif', 'Nonaktifkan sementara tanpa menghapus aturan.'],
  ],
  templates: [
    [null, 'Template balasan', 'Simpan jawaban yang sering digunakan agar CS tidak perlu mengetik ulang.'],
    ['#page table', 'Template tersimpan', 'Lihat judul dan isi balasan yang tersedia. Gunakan ikon tempat sampah untuk menghapus template.'],
    ['#templateTitle', 'Judul template', 'Beri nama singkat yang mudah dicari, misalnya Salam pembuka atau Cara pembayaran.'],
    ['#templateBody', 'Isi balasan', 'Tulis pesan lengkap. Kolom akan memanjang saat teks membutuhkan baris tambahan.'],
    ['#templateForm button[type=submit], #templateForm button', 'Tambah template', 'Simpan template. Untuk memakainya, buka Chat lalu klik ikon template di samping kolom pesan.'],
  ],
  labels: [
    [null, 'Label pelanggan', 'Kelompokkan pelanggan dengan nama dan warna, misalnya Prioritas atau Pelanggan Baru.'],
    ['.labels-library', 'Label yang tersedia', 'Lihat nama dan warna label yang sudah dibuat. Ikon tempat sampah menghapus label.'],
    ['#labelName', 'Nama label', 'Gunakan nama yang menjelaskan kelompok pelanggan atau kebutuhan tindak lanjut.'],
    ['.label-palette', 'Pilih warna', 'Pilih warna dari palet atau gunakan warna khusus agar kelompok mudah dibedakan.'],
    ['.label-preview-area', 'Pratinjau label', 'Periksa nama dan warna sebelum menyimpan. Warna ini juga dipakai pada badge label di header chat.'],
    ['.label-create-actions', 'Simpan dan gunakan', 'Buat label, lalu buka percakapan dan pilih ikon label untuk memasangnya ke pelanggan.'],
  ],
  agents: [
    [null, 'Kelola agen', 'Modul admin untuk menambahkan akun CS yang akan menggunakan dashboard.'],
    ['#page table', 'Daftar pengguna', 'Lihat akun yang terdaftar dan perannya. Periksa akun sebelum menghapus akses.'],
    ['#page form', 'Tambah akun CS', 'Isi username dan password sesuai ketentuan, lalu simpan. Gunakan password berbeda untuk setiap agen.'],
    ['#pageAction', 'Mulai tambah agen', 'Tombol ini membawa fokus ke form penambahan agen.'],
  ],
  notifications: [
    [null, 'Notifikasi chat', 'Temukan pemberitahuan pesan pada percakapan yang ditugaskan kepada Anda.'],
    ['#page', 'Daftar notifikasi', 'Klik pemberitahuan untuk membuka nomor dan chat terkait. Membuka halaman ini menandai notifikasi sebagai dibaca.'],
  ],
  search: [
    [null, 'Cari isi pesan', 'Cari pesan pada nomor WhatsApp yang dapat diakses akun Anda.'],
    ['#messageSearchTerm', 'Kata pencarian', 'Ketik setidaknya dua karakter dari isi pesan yang ingin ditemukan.'],
    ['#messageSearchForm button', 'Jalankan pencarian', 'Klik untuk menampilkan pesan yang cocok.'],
    ['#messageSearchResults', 'Hasil pencarian', 'Setelah mencari, hasil berisi percakapan, cuplikan pesan, dan tanggal. Klik nama chat untuk membukanya.'],
  ],
  monitor: [
    [null, 'Monitor koneksi', 'Modul admin untuk memeriksa kesehatan koneksi nomor dan aktivitas workspace.'],
    ['#pageAction', 'Perbarui data', 'Ambil status koneksi dan log aktivitas terbaru.'],
    ['#page table', 'Status nomor', 'Periksa status, waktu terakhir terlihat, dan percobaan koneksi untuk menemukan nomor yang perlu ditangani.'],
    ['#page .card:last-child', 'Log aktivitas', 'Lihat waktu, pengguna, nomor, dan detail tindakan yang tercatat.'],
  ],
  account: [
    [null, 'Pengaturan akun', 'Kelola username, password, dan sesi login akun Anda.'],
    ['#usernameForm', 'Ganti username', 'Isi username baru lalu klik Simpan username. Nama ini digunakan saat login berikutnya.'],
    ['#passwordForm', 'Ganti password', 'Masukkan password lama dan password baru yang memenuhi batas minimum yang ditampilkan.'],
    ['#logoutAll', 'Keluar dari semua perangkat', 'Akhiri seluruh sesi akun ini, termasuk sesi Anda sekarang. Gunakan jika perangkat tidak lagi aman atau tidak dipakai.'],
  ],
  backups: [
    [null, 'Backup data', 'Modul admin untuk membuat, mengunduh, dan mengelola salinan cadangan.'],
    ['#pageAction', 'Buat backup', 'Buat salinan cadangan baru dari data dashboard. Tunggu proses selesai sebelum mengunduh.'],
    ['#page table', 'Daftar cadangan', 'Periksa nama file, ukuran, dan tanggal untuk memilih backup yang dibutuhkan.'],
    ['#page a[download]', 'Unduh backup', 'Simpan salinan ke perangkat Anda dan simpan file di tempat yang aman.'],
    ['#page [data-backup-del]', 'Hapus cadangan', 'Hapus file backup yang sudah tidak dibutuhkan. Periksa tanggal dan nama sebelum mengonfirmasi.'],
  ],
};

function visibleGuideElement(selector) {
  if (!selector) return null;
  return [...document.querySelectorAll(selector)].find(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
}

function moduleGuideSteps(name) {
  return (moduleGuides[name] || []).flatMap(([selector, title, description]) => {
    const element = visibleGuideElement(selector);
    if (selector && !element) return [];
    return [{ ...(element ? {element} : {}), popover:{ title, description } }];
  });
}

let activeModuleGuide = null;
let guideLoading = false;
let guideGeneration = 0;
document.addEventListener('wa:pagechange', () => {
  guideGeneration++;
  activeModuleGuide?.destroy();
  activeModuleGuide = null;
});

async function startModuleGuide(trigger) {
  if (guideLoading) return;
  const generation = guideGeneration;
  const page = currentPage;
  guideLoading = true;
  trigger.setAttribute('aria-busy', 'true');
  try {
    const {driver} = await import('/vendor/driver/driver.js.mjs');
    if (generation !== guideGeneration || page !== currentPage) return;
    activeModuleGuide?.destroy();
    const steps = moduleGuideSteps(page);
    if (!steps.length) return;
    activeModuleGuide = driver({
      steps, showProgress:true, progressText:'{{current}} dari {{total}}',
      nextBtnText:'Lanjut', prevBtnText:'Kembali', doneBtnText:'Selesai', closeBtnLabel:'Tutup panduan',
      allowClose:true, overlayClickBehavior:'none', disableActiveInteraction:true,
      animate:!matchMedia('(prefers-reduced-motion: reduce)').matches,
      popoverClass:'raqio-guide', stagePadding:6, stageRadius:10,
      onDestroyed:() => { activeModuleGuide = null; if (trigger.isConnected && trigger.getClientRects().length) trigger.focus(); },
    });
    activeModuleGuide.drive();
  } catch { toast('Panduan belum dapat dimuat. Coba muat ulang halaman.'); }
  finally { guideLoading = false; trigger.removeAttribute('aria-busy'); }
}

document.querySelectorAll('[data-module-guide]').forEach(button => {
  button.onclick = () => startModuleGuide(button);
});
