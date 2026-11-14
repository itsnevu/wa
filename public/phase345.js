(() => {
  document.querySelectorAll('.rail button').forEach(button => {
    if (!button.title) button.title = button.getAttribute('aria-label') || button.textContent.trim();
  });
  const search = document.querySelector('#search');
  const results = document.createElement('div');
  results.id = 'phase345SearchResults';
  results.hidden = true;
  search.parentElement.appendChild(results);
  let version = 0;
  search.placeholder = 'Cari isi pesan';
  search.oninput = async () => {
    const current = ++version;
    const term = search.value.trim();
    results.hidden = !term;
    if (!term) { results.replaceChildren(); await loadChats(); return; }
    if (term.length < 2) { results.textContent = 'Ketik minimal 2 karakter'; return; }
    results.innerHTML = skeleton();
    try {
      const rows = await call('GET', '/search?q=' + encodeURIComponent(term));
      if (current !== version) return;
      results.innerHTML = rows.map(m => `<button type="button" class="ghost" style="display:block;width:100%;text-align:left" data-message="${m.id}">${esc(chatLabel(m))}<br><small>${esc(m.body.slice(0, 160))}</small></button>`).join('') || 'Tidak ada pesan';
      results.querySelectorAll('[data-message]').forEach(button => {
        button.onclick = async () => {
          const message = rows.find(m => m.id === Number(button.dataset.message));
          ++version;
          search.value = '';
          results.hidden = true;
          try {
            document.querySelector('#mineOnly').checked = false;
            await pickNumber(message.number_id);
            await openChat(message.chat_id);
          } catch (err) { results.hidden = false; results.textContent = err.message; toast(err.message); }
        };
      });
    } catch (err) { if (current === version) results.textContent = err.message; }
  };

  // Reuse existing controls and notification panel without duplicate IDs.
  async function pollNotifications() {
    if (!state.me) return;
    try {
      const rows = await call('GET', '/notifications');
      const count = rows.filter(n => !n.read_at).length;
      document.querySelector('#notificationBadge').textContent = count ? String(count) : '';
    } catch (err) { console.error('[notifikasi]', err.message); }
  }
  setInterval(pollNotifications, 20000);
  pollNotifications();
})();
