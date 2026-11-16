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

// Pengalaman mobile (<= 820px). Elemen baru berkelas m-only atau hanya aktif saat mobile,
// sehingga tampilan desktop tidak berubah.
(() => {
  const mq = matchMedia('(max-width: 820px)');
  const mobile = () => mq.matches;
  const body = document.body;
  const icon = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
  const ICON = {
    back: 'M15 18l-6-6 6-6',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
    menu: 'M4 6h16M4 12h16M4 18h16',
    pencil: 'm15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14Z',
    trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
    tag: 'M3 3h9l9 9-9 9-9-9ZM8 8h.01',
    download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
    release: 'M2 21v-2a7 7 0 0 1 14 0v2M17 11h6M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    take: 'M2 21v-2a7 7 0 0 1 14 0v2M19 8v6M16 11h6M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    copy: 'M8 8h12v12H8ZM16 8V4H4v12h4',
  };
  const currentChat = () => state.chats.find((c) => c.id === state.chatId);

  // ---------- Bottom sheet ----------
  const backdrop = document.createElement('div');
  backdrop.id = 'mSheetBackdrop';
  backdrop.hidden = true;
  body.appendChild(backdrop);
  let sheetReturn = null;

  function syncBackdrop() {
    backdrop.hidden = !(mobile() && document.querySelector('#mSheet, #bubbleMenu, #choiceMenu'));
  }

  function closeSheet(restore = true) {
    const sheet = document.getElementById('mSheet');
    if (!sheet) return;
    sheet.remove();
    syncBackdrop();
    if (restore) sheetReturn?.focus();
    sheetReturn = null;
  }

  function openSheet(label, items, trigger) {
    closeSheet(false);
    sheetReturn = trigger || null;
    const sheet = document.createElement('div');
    sheet.id = 'mSheet';
    sheet.className = 'm-sheet card';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', label);
    for (const item of items) {
      const b = document.createElement('button');
      b.type = 'button';
      if (item.danger) b.className = 'danger';
      b.innerHTML = item.svg || icon(item.icon);
      b.append(item.label);
      // Ditunda agar klik ini tidak langsung menutup menu yang dibuka oleh aksinya.
      b.onclick = () => { closeSheet(false); setTimeout(item.run, 0); };
      sheet.appendChild(b);
    }
    body.appendChild(sheet);
    syncBackdrop();
    sheet.querySelector('button')?.focus();
  }

  new MutationObserver(syncBackdrop).observe(body, { childList: true });
  backdrop.addEventListener('click', () => {
    closeSheet();
    document.querySelector('#bubbleMenu')?.remove();
    closeChoiceMenu(false);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

  // ---------- Daftar atau thread ----------
  function enterThread() {
    if (!mobile() || body.classList.contains('m-thread')) return;
    body.classList.add('m-thread');
    history.pushState({ mThread: true }, '');
  }
  function leaveThread() {
    closeSheet(false);
    document.querySelector('#bubbleMenu')?.remove();
    body.classList.remove('m-thread', 'm-typing');
  }
  const goBack = () => { if (history.state?.mThread) history.back(); else leaveThread(); };
  addEventListener('popstate', () => { if (body.classList.contains('m-thread')) leaveThread(); });

  const back = document.createElement('button');
  back.id = 'mBack';
  back.type = 'button';
  back.className = 'ghost m-only';
  back.title = 'Kembali ke daftar chat';
  back.setAttribute('aria-label', 'Kembali ke daftar chat');
  back.innerHTML = icon(ICON.back);
  back.onclick = goBack;
  $('#head').prepend(back);

  const more = document.createElement('button');
  more.id = 'mMore';
  more.type = 'button';
  more.className = 'ghost m-only';
  more.title = 'Aksi lain';
  more.setAttribute('aria-label', 'Aksi lain');
  more.setAttribute('aria-haspopup', 'dialog');
  more.innerHTML = icon(ICON.more);
  more.onclick = () => {
    const chat = currentChat();
    const items = [];
    if (chat) items.push({ label: 'Ubah nama kontak', icon: ICON.pencil, run: () => editContactName(chat) });
    items.push({ label: 'Pilih label', icon: ICON.tag, run: () => $('#labelPick').click() });
    items.push({ label: 'Ekspor CSV', icon: ICON.download, run: () => $('#exportChat').click() });
    if (chat?.assignee_id) items.push({ label: 'Lepas penugasan', icon: ICON.release, run: () => $('#releaseChat')?.click() });
    items.push({ label: 'Hapus nomor', icon: ICON.trash, danger: true, run: () => $('#headDelete').click() });
    openSheet('Aksi lain', items, more);
  };
  $('#head').appendChild(more);

  // Ambil chat menempel di bawah, di atas composer.
  const take = document.createElement('button');
  take.id = 'mTake';
  take.type = 'button';
  take.className = 'primary m-only hidden';
  take.innerHTML = icon(ICON.take) + 'Ambil chat';
  take.onclick = () => $('#takeChat').click();
  $('#composer').before(take);

  function syncTake() {
    const chat = currentChat();
    take.classList.toggle('hidden', !chat || chat.assignee_id === state.me?.id);
  }

  // ---------- Rail: 4 slot + Lainnya ----------
  for (const [id, label] of [['railChat', 'Chat'], ['railNumbers', 'Nomor'], ['railSearch', 'Cari'], ['railNotifications', 'Notifikasi']]) {
    const b = document.getElementById(id);
    b.classList.add('m-slot');
    b.dataset.label = label;
  }
  const railMore = document.createElement('button');
  railMore.id = 'railMore';
  railMore.type = 'button';
  railMore.className = 'm-slot m-only';
  railMore.dataset.label = 'Lainnya';
  railMore.title = 'Menu lainnya';
  railMore.setAttribute('aria-label', 'Menu lainnya');
  railMore.setAttribute('aria-haspopup', 'dialog');
  railMore.innerHTML = icon(ICON.menu);
  $('#btnOut').before(railMore);
  railMore.onclick = () => {
    const items = [...document.querySelectorAll('.rail > button')]
      .filter((b) => !b.classList.contains('m-slot') && !b.classList.contains('hidden'))
      .map((b) => ({
        label: b.getAttribute('aria-label') || b.title,
        svg: b.querySelector('svg')?.outerHTML || '',
        danger: b.id === 'btnOut',
        run: () => b.click(),
      }));
    openSheet('Menu lainnya', items, railMore);
  };
  $('#railChat').addEventListener('click', () => { if (mobile() && body.classList.contains('m-thread')) goBack(); });

  // ---------- Bungkus fungsi global ----------
  const baseOpenChat = window.openChat;
  window.openChat = async (id) => {
    enterThread();
    const out = await baseOpenChat(id);
    syncTake();
    return out;
  };
  const baseLoadChats = window.loadChats;
  window.loadChats = async (...args) => {
    const out = await baseLoadChats(...args);
    decorateChats();
    syncTake();
    if (!state.chatId && body.classList.contains('m-thread')) goBack();
    return out;
  };
  const baseUpdateHeader = window.updateHeader;
  window.updateHeader = (...args) => { const out = baseUpdateHeader(...args); syncTake(); return out; };

  // ---------- Geser baris chat ----------
  const SWIPE = 144;
  let openRow = null;
  let suppressRowClick = false;

  function setOffset(row, x) {
    row.querySelector('.chat-info').style.transform = x ? `translateX(${x}px)` : '';
    row.dataset.offset = String(x);
  }
  function closeRow(row) { if (row) setOffset(row, 0); if (openRow === row) openRow = null; }

  function decorateChats() {
    openRow = null;
    $('#chats').querySelectorAll('.chat').forEach((row) => {
      if (row.querySelector('.m-swipe')) return;
      const id = Number(row.dataset.id);
      const actions = document.createElement('div');
      actions.className = 'm-swipe m-only';
      actions.innerHTML = `<button type="button" class="m-rename" aria-label="Ubah nama kontak">${icon(ICON.pencil)}nama</button>`
        + `<button type="button" class="m-del" aria-label="Hapus chat">${icon(ICON.trash)}hapus</button>`;
      actions.querySelector('.m-rename').onclick = async (e) => {
        e.stopPropagation();
        closeRow(row);
        await window.openChat(id);
        const chat = state.chats.find((c) => c.id === id);
        if (chat && state.chatId === id) editContactName(chat);
      };
      actions.querySelector('.m-del').onclick = (e) => {
        e.stopPropagation();
        closeRow(row);
        row.querySelector('.row-del')?.click();
      };
      row.appendChild(actions);
    });
  }

  const chats = $('#chats');
  let drag = null;
  chats.addEventListener('pointerdown', (e) => {
    if (!mobile() || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const row = e.target.closest('.chat');
    if (!row || e.target.closest('.m-swipe')) return;
    drag = { row, x: e.clientX, y: e.clientY, base: Number(row.dataset.offset || 0), active: false, id: e.pointerId };
  });
  chats.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.active) {
      if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) { drag = null; return; }
      if (Math.abs(dx) < 8) return;
      drag.active = true;
      if (openRow && openRow !== drag.row) closeRow(openRow);
      drag.row.classList.add('dragging');
      drag.row.setPointerCapture?.(e.pointerId);
    }
    setOffset(drag.row, Math.max(-SWIPE, Math.min(0, drag.base + dx)));
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { row, active } = drag;
    drag = null;
    if (!active) return;
    row.classList.remove('dragging');
    const open = Number(row.dataset.offset) < -SWIPE / 2;
    setOffset(row, open ? -SWIPE : 0);
    openRow = open ? row : null;
    suppressRowClick = true;
    setTimeout(() => { suppressRowClick = false; }, 350);
  };
  chats.addEventListener('pointerup', endDrag);
  chats.addEventListener('pointercancel', endDrag);
  chats.addEventListener('click', (e) => {
    if (e.target.closest('.m-swipe')) return;
    if (suppressRowClick || (openRow && e.target.closest('.chat'))) {
      e.preventDefault();
      e.stopPropagation();
      suppressRowClick = false;
      closeRow(openRow);
    }
  }, true);

  // ---------- Tekan lama bubble ----------
  const msgs = $('#msgs');
  let press = null;
  let suppressBubbleClick = false;
  msgs.addEventListener('contextmenu', (e) => {
    if (mobile() && e.target.closest('.b')) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  msgs.addEventListener('pointerdown', (e) => {
    if (!mobile() || !e.isPrimary) return;
    const bubble = e.target.closest('.b');
    if (!bubble || e.target.closest('a, audio, video')) return;
    clearTimeout(press?.timer);
    press = { x: e.clientX, y: e.clientY, id: e.pointerId };
    press.timer = setTimeout(() => {
      press = null;
      suppressBubbleClick = true;
      setTimeout(() => { suppressBubbleClick = false; }, 600);
      navigator.vibrate?.(10);
      bubble.oncontextmenu?.({ preventDefault() {}, clientX: 0, clientY: 0 });
      const menu = document.querySelector('#bubbleMenu');
      if (!menu) return;
      menu.setAttribute('role', 'dialog');
      menu.setAttribute('aria-label', 'Aksi pesan');
      addCopy(menu, bubble);
      menu.querySelector('button:not(:disabled)')?.focus();
    }, 500);
  });
  const cancelPress = (e) => {
    if (!press || e.pointerId !== press.id) return;
    if (e.type === 'pointermove' && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 10) return;
    clearTimeout(press.timer);
    press = null;
  };
  ['pointermove', 'pointerup', 'pointercancel', 'pointerleave'].forEach((t) => msgs.addEventListener(t, cancelPress));
  msgs.addEventListener('scroll', () => { if (press) { clearTimeout(press.timer); press = null; } }, { passive: true });
  addEventListener('click', (e) => {
    if (!suppressBubbleClick || e.target.closest('#bubbleMenu')) return;
    e.preventDefault();
    e.stopPropagation();
    suppressBubbleClick = false;
  }, true);

  function addCopy(menu, bubble) {
    const text = [...bubble.children].filter((el) => el.tagName === 'DIV').map((el) => el.textContent).join('\n').trim();
    if (!text || !navigator.clipboard) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = icon(ICON.copy) + 'Salin';
    b.onclick = async () => {
      menu.remove();
      try { await navigator.clipboard.writeText(text); toast('Disalin'); } catch (err) { toast(err.message); }
    };
    menu.prepend(b);
  }

  // ---------- Composer dan keyboard ----------
  const input = $('#input');
  const card = () => $('.composer-card');
  input.addEventListener('focus', () => {
    if (!mobile()) return;
    body.classList.add('m-typing');
    setTimeout(() => card().scrollIntoView({ block: 'end' }), 300);
  });
  input.addEventListener('blur', () => body.classList.remove('m-typing'));
  window.visualViewport?.addEventListener('resize', () => {
    if (mobile() && document.activeElement === input) card().scrollIntoView({ block: 'end' });
  });

  mq.addEventListener('change', () => {
    closeSheet(false);
    syncBackdrop();
    if (!mobile()) body.classList.remove('m-thread', 'm-typing');
    else if (state.chatId) body.classList.add('m-thread');
  });

  decorateChats();
  syncTake();
})();
