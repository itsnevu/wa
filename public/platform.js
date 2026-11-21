(() => {
  const panel = document.getElementById('platformPanel');
  let grant, countdown;

  function frame(title, action) {
    clearInterval(countdown);
    panel.classList.remove('hidden');
    panel.innerHTML = `<header><h1 id="platformTitle">${title}</h1><button type="button" id="platformBack"></button></header>
      <p id="platformStatus" role="status"></p><div id="platformBody"></div>`;
    const back = panel.querySelector('#platformBack');
    back.textContent = action.label;
    back.onclick = run(action.handle);
    return panel.querySelector('#platformBody');
  }

  function run(handler) {
    return async event => {
      event?.preventDefault();
      const button = event?.currentTarget;
      if (button instanceof HTMLButtonElement) button.disabled = true;
      try { await handler(event); }
      catch (error) {
        if (grant && ['GRANT_EXPIRED', 'TENANT_NOT_SELECTED', 'TENANT_SUSPENDED'].includes(error.code)) { grant = null; await list(); }
        const status = panel.querySelector('#platformStatus');
        if (status) status.textContent = error.message;
      } finally { if (button instanceof HTMLButtonElement) button.disabled = false; }
    };
  }

  function button(parent, label, handler) {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = label;
    element.onclick = run(handler);
    parent.append(element);
    return element;
  }

  function showGrant(parent, tenantId) {
    if (!grant || (tenantId && grant.tenant_id !== tenantId)) return;
    const banner = document.createElement('div');
    banner.className = 'platform-grant';
    parent.prepend(banner);
    const update = () => {
      const seconds = Math.max(0, Math.ceil((grant.expires_at - Date.now()) / 1000));
      banner.textContent = `${grant.capabilities.includes('content.write') ? 'Akses tulis aktif' : 'HANYA BACA'} · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} tersisa`;
      if (!seconds) {
        clearInterval(countdown);
        grant = null;
        parent.replaceChildren(banner);
        call('GET', '/me').catch(() => {}).finally(() => run(list)());
      }
    };
    countdown = setInterval(update, 1000);
    update();
  }

  async function list() {
    const body = frame('Konsol platform', {label:'Keluar', handle:async () => { await call('POST', '/logout'); location.reload(); }});
    body.innerHTML = `<form id="platformSearch" class="platform-card platform-grid">
      <label>Cari workspace<input name="q" type="search"></label>
      <label>Status<select name="status"><option value="">Semua workspace</option><option value="active">Aktif</option><option value="suspended">Ditangguhkan</option><option value="deleted">Dihapus</option></select></label>
      <button>Temukan</button></form><div id="platformTenants" class="platform-card"></div>
      <form id="platformCreate" class="platform-card"><h2>Buat workspace</h2><div class="platform-grid">
      <label>Nama<input name="name" maxlength="120" required></label>
      <label>Slug<input name="slug" maxlength="63" required></label>
      <label>Email pemilik<input name="owner_email" type="email" required></label><button class="primary">Buat</button></div></form>`;
    const search = body.querySelector('#platformSearch');
    const results = body.querySelector('#platformTenants');
    async function load(cursor) {
      const query = new URLSearchParams(new FormData(search));
      if (cursor) query.set('cursor', cursor);
      const result = await call('GET', `/platform/tenants?${query}`);
      if (!cursor) results.replaceChildren();
      for (const tenant of result.items) {
        const row = document.createElement('p');
        button(row, tenant.name, () => detail(tenant.id));
        row.append(` ${tenant.slug} · ${tenant.deleted_at ? 'dihapus' : tenant.status} · ${tenant.member_count} anggota`);
        results.append(row);
      }
      if (!result.items.length) results.textContent = 'Workspace tidak ditemukan.';
      if (result.next_cursor) button(results, 'Muat berikutnya', async event => { const control = event.currentTarget; await load(result.next_cursor); control.remove(); });
    }
    search.onsubmit = run(() => load());
    body.querySelector('#platformCreate').onsubmit = run(async event => {
      const input = Object.fromEntries(new FormData(event.target));
      const result = await call('POST', '/platform/tenants', input);
      await detail(result.tenant.id);
      if (result.invitation) {
        const label = document.createElement('label');
        label.textContent = `Bagikan tautan aktivasi satu kali ke ${result.invitation.email}`;
        const link = document.createElement('input');
        link.readOnly = true;
        link.value = `${location.origin}/#owner-invite=${result.invitation.token}`;
        label.append(link);
        panel.querySelector('#platformBody').prepend(label);
      }
    });
    if (grant) button(body, 'Kembali ke workspace dengan akses aktif', () => detail(grant.tenant_id));
    showGrant(body);
    await load();
  }

  async function detail(id) {
    const path = `/platform/tenants/${encodeURIComponent(id)}`;
    const {tenant, members} = await call('GET', path);
    const body = frame('Detail workspace', {label:'Daftar workspace', handle:list});
    body.innerHTML = '<div class="platform-card"><h2></h2><p></p><div class="platform-actions"></div></div><div id="platformContent"></div>';
    body.querySelector('h2').textContent = tenant.name;
    body.querySelector('p').textContent = `${tenant.slug} · ${tenant.deleted_at ? 'dihapus' : tenant.status} · ${members.length} anggota`;
    const actions = body.querySelector('.platform-actions');
    button(actions, 'Audit', () => audit(`${path}/audit`, () => detail(id)));
    if (tenant.deleted_at) return;
    const suspend = tenant.status === 'active';
    button(actions, suspend ? 'Tangguhkan' : 'Aktifkan kembali', async () => {
      await call('POST', `${path}/${suspend ? 'suspend' : 'reactivate'}`, {});
      if (suspend && grant?.tenant_id === id) grant = null;
      await detail(id);
    });
    if (!suspend) return;
    const active = grant?.tenant_id === id;
    const content = body.querySelector('#platformContent');
    content.innerHTML = `<form class="platform-card platform-grid"><label>Alasan akses<input name="reason" minlength="5" maxlength="200" required></label>
      <label>Durasi dalam menit<input name="ttl_minutes" type="number" min="1" max="480" placeholder="60"></label>
      <button class="primary">${active ? 'Aktifkan akses tulis' : 'Minta akses baca'}</button></form><div id="platformChats"></div>`;
    content.querySelector('form').onsubmit = run(async event => {
      const input = Object.fromEntries(new FormData(event.target));
      if (input.ttl_minutes) input.ttl_minutes = Number(input.ttl_minutes);
      else delete input.ttl_minutes;
      grant = (await call('POST', `${path}/${active ? 'elevate' : 'enter'}`, input)).grant;
      await detail(id);
    });
    if (active) {
      showGrant(body, id);
      button(actions, 'Akhiri akses', async () => { await call('POST', `${path}/leave`, {}); grant = null; await detail(id); });
      button(actions, 'Buka percakapan', async () => {
        const {chats} = await call('GET', `${path}/access`);
        const target = content.querySelector('#platformChats');
        target.replaceChildren();
        for (const chat of chats) button(target, chat.name || `Percakapan ${chat.id}`, async () => {
          const result = await call('GET', `${path}/access?chat_id=${chat.id}`);
          target.replaceChildren();
          const items = document.createElement('ul');
          for (const message of result.messages) { const item = document.createElement('li'); item.textContent = message.body; items.append(item); }
          target.append(items);
          button(target, 'Ekspor JSON', async () => {
            const data = await call('POST', `${path}/export-access`, {chat_id:chat.id});
            const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type:'application/json'}));
            const link = document.createElement('a'); link.href = url; link.download = `percakapan-${chat.id}.json`; link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          });
        });
        if (!chats.length) target.textContent = 'Belum ada percakapan.';
      });
    }
  }

  async function audit(path, close) {
    const body = frame('Audit workspace', {label:'Kembali', handle:close});
    showGrant(body);
    async function load(cursor) {
      const result = await call('GET', path + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''));
      const list = document.createElement('ul');
      for (const row of result.items) {
        const item = document.createElement('li');
        item.textContent = `${new Date(row.at).toLocaleString('id-ID')} · ${row.action} · ${row.reason || ''}`;
        list.append(item);
      }
      body.append(list);
      if (!result.items.length && !cursor) body.append('Belum ada aktivitas tercatat.');
      if (result.next_cursor) button(body, 'Muat berikutnya', async event => { const control = event.currentTarget; await load(result.next_cursor); control.remove(); });
    }
    await load();
  }

  window.showPlatform = activeGrant => { grant = activeGrant; return run(list)(); };
  window.showOwnerAudit = () => {
    const app = document.getElementById('app');
    app.classList.add('hidden');
    return run(() => audit('/tenant/audit', () => { panel.classList.add('hidden'); app.classList.remove('hidden'); }))();
  };
})();
