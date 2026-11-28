(() => {
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || local)) {
    navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('[pwa] SW gagal:', err));
  }

  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  let deferred = null;

  const btn = document.createElement('button');
  btn.id = 'railInstall';
  btn.type = 'button';
  btn.title = 'Pasang aplikasi';
  btn.setAttribute('aria-label', 'Pasang aplikasi');
  btn.className = 'hidden';
  btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v10m-4-4 4 4 4-4M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/></svg>';
  // #btnOut sekarang di dalam .rail-account, bukan anak langsung .rail: insertBefore di .rail melempar
  // NotFoundError dan menghentikan sisa skrip ini (tombol pasang tidak pernah muncul).
  const out = document.getElementById('btnOut');
  if (out) out.before(btn); else document.querySelector('.rail')?.append(btn);

  const hide = () => { deferred = null; btn.classList.add('hidden'); };

  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    if (standalone()) return;
    deferred = e;
    btn.classList.remove('hidden');
  });

  btn.addEventListener('click', async () => {
    if (!deferred) return;
    const ev = deferred;
    deferred = null;
    ev.prompt();
    const { outcome } = await ev.userChoice;
    if (outcome === 'accepted') hide();
    else btn.classList.add('hidden');
  });

  addEventListener('appinstalled', hide);
  matchMedia('(display-mode: standalone)').addEventListener('change', (e) => { if (e.matches) hide(); });
  if (standalone()) hide();
})();
