(function () {
  const states = {
    healthy: 'Sehat', idle: 'Siaga', degraded: 'Terganggu',
    stale: 'Terputus', syncing: 'Menyinkronkan', unknown: 'Tidak diketahui',
  };
  const steps = {
    close: 'Tutup socket', reconnect: 'Siapkan koneksi', open: 'Tunggu WhatsApp tersambung',
    drain: 'Kirim antrean', history: 'Riwayat tambahan', evaluate: 'Periksa status sesi',
  };
  const outcomes = { ok: 'Selesai', failed: 'Gagal', skipped: 'Dilewati', unsupported: 'Tidak didukung', unconfirmed: 'Belum terkonfirmasi' };
  const formatTime = value => value ? new Date(value).toLocaleString('id-ID') : 'Tidak diketahui';

  window.mountSessionHealth = (root, call) => {
    const buttons = [...root.querySelectorAll('[data-session-health]')];
    if (!buttons.length) return;
    const dialog = document.getElementById('sessionHealthDialog');
    const detail = dialog.querySelector('[data-health-detail]');
    const summary = dialog.querySelector('[data-health-summary]');
    const sync = dialog.querySelector('[data-health-sync]');
    const confirm = dialog.querySelector('[data-health-confirm]');
    const reason = confirm.querySelector('input');
    const error = dialog.querySelector('[data-health-error]');
    const title = dialog.querySelector('h2');
    const escape = value => String(value).replace(/[&<>"']/g, char => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
    ));
    let selected;
    let pending;
    let rows = new Map();
    let loading = false;

    function render() {
      for (const button of buttons) {
        const state = rows.get(Number(button.dataset.sessionHealth))?.state || 'unknown';
        button.dataset.healthState = state;
        button.textContent = states[state];
      }
      if (!dialog.open || selected === undefined) return;
      const health = rows.get(selected);
      const state = health?.state || 'unknown';
      const syncing = state === 'syncing' || pending === selected;
      sync.hidden = !health?.can_resync;
      sync.disabled = syncing;
      if (syncing) confirm.hidden = true;
      const drops = Object.entries(health?.drop_count || {}).map(([key, count]) => `${escape(key)} (${Number(count)})`).join(', ');
      const gap = health?.gap_suspect ? health.last_disconnect_at && health.last_connect_at > health.last_disconnect_at
        ? `Ada kemungkinan pesan terlewat antara ${formatTime(health.last_disconnect_at)} dan ${formatTime(health.last_connect_at)}.`
        : 'Ada kemungkinan pesan terlewat. Waktu awal atau akhir gangguan belum diketahui.' : '';
      const progress = syncing
        ? '<p>' + (steps[health?.sync_step] || 'Menunggu status dari server') + '…</p>' : '';
      detail.innerHTML = `<p><strong data-health-state="${state}">${states[state]}</strong></p>${progress}
        <dl><dt>Pesan masuk terakhir</dt><dd>${formatTime(health?.last_inbound_at)}</dd>
        <dt>Terakhir tersambung</dt><dd>${formatTime(health?.last_connect_at)}</dd>
        <dt>Terakhir terputus</dt><dd>${formatTime(health?.last_disconnect_at)}</dd>
        <dt>Terputus dalam 1 jam</dt><dd>${health?.disconnects_last_hour ?? 'Tidak diketahui'}</dd>
        <dt>Pesan menunggu di antrean</dt><dd>${health?.queue_depth ?? 'Tidak diketahui'}</dd>
        <dt>Drop per alasan</dt><dd>${drops || (health?.last_event_at ? '0 tercatat' : 'Tidak diketahui')}</dd></dl>
        ${gap ? `<p class="session-health-warning">${escape(gap)}</p>` : ''}`;
      const result = health?.last_sync_result;
      summary.hidden = !result || syncing;
      if (!result || syncing) return;
      const history = result.steps.find(item => item.step === 'history');
      const count = result.new_messages;
      const message = count === 0
        ? history?.observation_completed
          ? '0 pesan baru — server WhatsApp tidak mengirim riwayat tambahan yang belum tersimpan selama pemeriksaan.'
          : '0 pesan baru tercatat. Pemeriksaan riwayat belum selesai.'
        : `${Number(count)} pesan baru masuk saat sinkronisasi.`;
      const descriptions = result.steps.map(item => {
        let detail = item.detail;
        if (item.step === 'drain' && item.attempted != null) detail = `${Number(item.attempted)} dicoba, ${Number(item.failed)} gagal`;
        if (item.step === 'history' && item.received != null) detail = `${Number(item.received)} pesan diterima dalam respons`;
        if (item.step === 'evaluate' && item.state) detail = states[item.state];
        return `<li>${steps[item.step]} · ${outcomes[item.status]}${detail ? ` — ${escape(detail)}` : ''}</li>`;
      });
      summary.innerHTML = `<h3>Hasil sinkronisasi</h3><p>${message}</p><ul>${descriptions.join('')}</ul>`;
    }

    async function refresh() {
      if (loading) return;
      loading = true;
      try {
        const data = await call('GET', '/sessions/health');
        rows = new Map(data.map(health => [health.id, health]));
      } catch {
        rows.clear();
      } finally {
        loading = false;
        if (buttons[0].isConnected) render();
      }
    }

    for (const button of buttons) {
      button.onclick = () => {
        selected = Number(button.dataset.sessionHealth);
        title.textContent = `Status sinkronisasi · ${button.dataset.sessionName}`;
        confirm.hidden = true;
        error.textContent = '';
        dialog.showModal();
        render();
        refresh();
      };
    }
    sync.onclick = () => { error.textContent = ''; reason.value = ''; confirm.hidden = false; reason.focus(); };
    confirm.querySelector('[data-health-cancel]').onclick = () => { confirm.hidden = true; sync.focus(); };
    confirm.onsubmit = async event => {
      event.preventDefault();
      if (pending !== undefined || !rows.get(selected)?.can_resync || rows.get(selected)?.state === 'syncing') return;
      const id = selected;
      pending = id;
      confirm.hidden = true;
      render();
      refresh();
      try {
        const result = await call('POST', `/sessions/${id}/resync`, { reason: reason.value.trim() });
        if (rows.has(id)) rows.get(id).last_sync_result = result;
      } catch (err) {
        if (selected === id) error.textContent = err.message;
      } finally {
        pending = undefined;
        await refresh();
        if (buttons[0].isConnected) render();
      }
    };
    refresh();
    const poll = setInterval(() => {
      if (!buttons[0].isConnected) {
        clearInterval(poll);
        if (dialog.open && !document.querySelector('[data-session-health]')) dialog.close();
      } else if (!document.hidden) refresh();
    }, 1500);
  };
})();
