(() => {
  const paths = {
    logout:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
    refresh:'<path d="M20 7v5h-5"/><path d="M20 12a8 8 0 1 0-2.34 5.66"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
    save:'<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2Z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/>',
    download:'<path d="M12 4v10m-4-4 4 4 4-4M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/>',
    backup:'<path d="M12 4v10m-4-4 4 4 4-4M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/><path d="M4 3h3M17 3h3"/>',
    read:'<path d="m3 12 4 4 8-8m-3 8 8-8"/>',
    qr:'<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><rect x="3" y="15" width="6" height="6" rx="1"/><path d="M15 15h3v3h3m-6 0v3h3m3-6v-3M12 3v3M3 12h3"/>'
  };
  const actions = {
    'Keluar dari semua perangkat':['logout','Keluar dari semua perangkat'],
    'Perbarui':['refresh','Perbarui'],
    'Tambah':['plus','Tambah'],
    '+ Nomor':['plus','Tambah nomor WhatsApp'],
    'Cari':['search','Cari pesan'],
    'Simpan':['save','Simpan perubahan'],
    'Simpan username':['save','Simpan username'],
    'Unduh':['download','Unduh backup'],
    'Buat backup sekarang':['backup','Buat backup sekarang'],
    'Tandai dibaca':['read','Tandai semua notifikasi dibaca'],
    'QR':['qr','Tampilkan kode QR']
  };
  function enhance() {
    document.querySelectorAll('#page button, #page a[download], #pageAction, #btnNum, #panel button').forEach(button => {
      if (button.querySelector('svg') || button.classList.contains('empty-action')) return;
      const action = actions[button.textContent.trim()];
      if (!action) return;
      const [name, label] = action;
      const contextualLabel = label === 'Tambah' ? `Tambah ${document.querySelector('#pageTitle').textContent.toLocaleLowerCase('id')}` : label;
      button.setAttribute('aria-label', contextualLabel);
      button.title = contextualLabel;
      const withText = name === 'save' || name === 'logout';
      button.classList.add(withText ? 'save-action' : 'icon-action');
      button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name]}</svg>${withText ? `<span>${name === 'save' ? 'Simpan' : label}</span>` : ''}`;
    });
  }
  enhance();
  new MutationObserver(enhance).observe(document.body, { childList:true, subtree:true });
})();
