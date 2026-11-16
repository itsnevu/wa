(() => {
  const dialog = document.createElement('dialog');
  dialog.className = 'select-menu';
  dialog.setAttribute('aria-labelledby', 'selectMenuTitle');
  dialog.innerHTML = '<div class="select-menu-heading"><strong id="selectMenuTitle"></strong><button type="button" class="select-menu-close" aria-label="Tutup pilihan">×</button></div><input class="select-menu-search" type="search" placeholder="Cari nama atau nomor…" aria-label="Cari nomor WhatsApp" autocomplete="off" /><div class="select-menu-options" role="listbox"></div><p class="select-menu-empty" hidden>Tidak ada nomor yang cocok.</p>';
  document.body.append(dialog);
  const list = dialog.querySelector('.select-menu-options');
  const search = dialog.querySelector('input');
  let active = null;

  function renderOptions() {
    if (!active) return;
    const term = search.value.trim().toLocaleLowerCase('id');
    const options = [...active.select.options].filter(option => !option.disabled && (!active.skipPlaceholder || option.value) && option.textContent.toLocaleLowerCase('id').includes(term));
    list.replaceChildren();
    options.forEach(option => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'select-menu-option';
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', String(option.value === active.select.value));
      const text = document.createElement('span');
      text.textContent = option.textContent;
      const check = document.createElement('span');
      check.className = 'select-menu-check';
      check.setAttribute('aria-hidden', 'true');
      check.textContent = '✓';
      button.append(text, check);
      button.onclick = () => {
        const { select, sync } = active;
        select.value = option.value;
        sync();
        dialog.close();
        select.dispatchEvent(new Event('change', { bubbles:true }));
      };
      list.append(button);
    });
    const empty = dialog.querySelector('.select-menu-empty');
    empty.textContent = active.searchable ? 'Tidak ada pilihan yang cocok.' : 'Belum ada pilihan.';
    empty.hidden = options.length > 0;
  }

  dialog.querySelector('.select-menu-close').onclick = () => dialog.close();
  dialog.addEventListener('click', event => {
    const rect = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
  });
  dialog.addEventListener('close', () => {
    active?.trigger.setAttribute('aria-expanded', 'false');
    active?.trigger.focus();
    active = null;
  });
  search.oninput = renderOptions;
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      dialog.close();
      return;
    }
    const options = [...list.querySelectorAll('button')];
    const index = options.indexOf(document.activeElement);
    let next;
    if (event.key === 'ArrowDown') next = options[(index + 1) % options.length];
    if (event.key === 'ArrowUp') next = options[(index - 1 + options.length) % options.length];
    if (event.target !== search && event.key === 'Home') next = options[0];
    if (event.target !== search && event.key === 'End') next = options.at(-1);
    if (next) { event.preventDefault(); next.focus(); }
  });

  const enhanced = new WeakSet();
  const titles = { mobileNumber:'Pilih nomor WhatsApp', rulesNumber:'Pilih nomor WhatsApp', inboxStatus:'Status percakapan', conversationStatus:'Status percakapan', ndOwner:'Pilih agen', rm:'Tipe pencocokan' };
  function enhance(select) {
    if (enhanced.has(select) || !select.id) return;
    enhanced.add(select);
    const id = select.id;
    const title = titles[id] || select.getAttribute('aria-label') || 'Pilih opsi';
    const searchable = ['mobileNumber', 'rulesNumber', 'ndOwner'].includes(id) || select.options.length > 8;
    const skipPlaceholder = ['mobileNumber', 'rulesNumber'].includes(id);
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.id = `${id}Trigger`;
    trigger.className = 'select-trigger';
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.innerHTML = '<span></span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>';
    const sync = () => {
      const text = select.selectedOptions[0]?.textContent || 'Pilih opsi';
      trigger.querySelector('span').textContent = text;
      trigger.setAttribute('aria-label', `${title}: ${text}`);
      trigger.disabled = select.disabled;
      if (active?.select === select && dialog.open) renderOptions();
    };
    select.after(trigger);
    select.classList.add('enhanced-select');
    document.querySelector(`label[for="${id}"]`)?.setAttribute('for', trigger.id);
    new MutationObserver(sync).observe(select, { childList:true, subtree:true, attributes:true });
    select.addEventListener('change', sync);
    trigger.onclick = () => {
      active = { select, trigger, searchable, skipPlaceholder, sync };
      search.value = '';
      search.hidden = !searchable;
      search.placeholder = ['mobileNumber', 'rulesNumber'].includes(id) ? 'Cari nama atau nomor…' : 'Cari pilihan…';
      search.setAttribute('aria-label', `Cari: ${title}`);
      dialog.querySelector('strong').textContent = title;
      list.setAttribute('aria-label', title);
      renderOptions();
      const rect = trigger.getBoundingClientRect();
      const mobile = matchMedia('(max-width:820px)').matches;
      dialog.style.width = mobile ? '' : `${Math.min(Math.max(rect.width, 280), innerWidth - 24)}px`;
      dialog.style.left = mobile ? '' : `${Math.max(12, Math.min(rect.left, innerWidth - Math.max(rect.width, 280) - 12))}px`;
      dialog.style.top = mobile ? '' : `${Math.max(12, Math.min(rect.bottom + 8, innerHeight - 330))}px`;
      trigger.setAttribute('aria-expanded', 'true');
      dialog.showModal();
      (searchable ? search : list.querySelector('[aria-selected="true"]') || list.querySelector('button'))?.focus();
    };
    sync();
  }
  function scan() {
    if (active && !active.select.isConnected && dialog.open) dialog.close();
    document.querySelectorAll('select[id]').forEach(enhance);
  }
  scan();
  new MutationObserver(scan).observe(document.body, { childList:true, subtree:true });
  window.addEventListener('resize', () => { if (dialog.open) dialog.close(); });
})();
