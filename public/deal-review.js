(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const amount = n => n == null ? 'Belum diketahui' : 'Rp ' + Number(n).toLocaleString('id-ID');
  const time = n => n ? new Date(n).toLocaleString('id-ID') : 'Belum ditentukan';
  const age = n => n == null ? 'Belum diketahui' : n >= 3600000 ? Math.floor(n/3600000) + ' jam' : Math.floor(n/60000) + ' menit';
  const label = s => String(s).replaceAll('_',' ').replace(/^./,c => c.toUpperCase());
  const methodLabel = method => ({dana:'DANA',tunai:'Tunai',transfer:'Transfer',qris:'QRIS',cod:'COD',gopay:'GoPay',ovo:'OVO',shopeepay:'ShopeePay'})[String(method).toLowerCase()] ?? method ?? 'Belum diketahui';
  const paymentInputs = (card, initial) => `
    ${initial ? `<label>Total tagihan (Rp)<input name="amount" type="number" min="1" required value="${esc(card.amount)}"></label>` : ''}
    <label>${initial ? 'DP diterima' : 'Cicilan diterima'} (Rp)<input name="paid_amount" type="number" min="1" required></label>
    ${initial ? '<label>Sisa tagihan (Rp)<input name="amount_due" type="number" min="1" required></label><label>Jatuh tempo (waktu perangkat)<input name="due_at" type="datetime-local" required></label>' : ''}
    <label>Metode<input name="method" maxlength="80" value="${esc(card.method)}" required></label>`;

  window.renderDealReview = async (root, call, active) => {
    let tab = 'review', offset = 0;
    let generation = 0, selectedId = null, detailOpen = false;
    async function load({ openSettings = false } = {}) {
      const token = ++generation;
      let data;
      try { data = await call('GET',`/deals/review?tab=${tab}&offset=${offset}`); }
      catch (err) { if (active() && token === generation) root.textContent = err.message; return; }
      if (!active() || token !== generation) return;
      root.innerHTML = `<section class="deal-review">
        <div class="deal-toolbar"><nav class="deal-tabs" aria-label="Antrean deal">${[['review','Verifikasi'],['dp','Penagihan DP'],['rejected','Ditolak'],...(data.owner ? [['audit','Audit sampel']] : [])].map(([key,title]) =>
          `<button data-tab="${key}" aria-pressed="${key===tab}">${title}</button>`).join('')}</nav>
          ${data.can_decide ? `<button type="button" data-open-settings aria-haspopup="dialog" aria-label="Pengaturan deal" title="Pengaturan deal">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M9.5 3h5l.6 2.5 2 .9 2.3-1 2.5 4.3-1.8 1.7v2.2l1.8 1.7-2.5 4.3-2.3-1-2 .9-.6 2.5h-5l-.6-2.5-2-.9-2.3 1-2.5-4.3 1.8-1.7v-2.2L2.1 9.7l2.5-4.3 2.3 1 2-.9z"/>
              <circle cx="12" cy="12.5" r="3"/>
            </svg>
          </button>` : ''}
        </div>
        <p class="deal-feedback" role="status"></p>
        <div class="deal-tools">
        ${tab === 'audit' ? `<div class="card"><button data-sample>Ambil sampel 5% hari ini</button>
          ${data.audit_stats.length ? `<ul>${data.audit_stats.map(r=>`<li>Admin ${esc(r.admin_id)} · ${esc(r.classifier_version || 'Tanpa classifier')} · ${Number(r.false_positive)}/${Number(r.audited)} false positive</li>`).join('')}</ul>` : ''}</div>` : ''}
        ${data.notices.length && tab === 'review' ? `<details><summary>Digest dan eskalasi</summary><ul>
          ${data.notices.map(n=> n.kind==='digest'
            ? `<li>${esc(time(n.at))} · ${Number(n.payload.review_count)} menunggu · tertua ${esc(age(n.payload.oldest_age_ms))}
              ${n.payload.reasons.length ? `<ul>${n.payload.reasons.map(r=>`<li>Admin ${esc(r.admin_id)} · ${esc(label(r.reason_code))} · ${Number(r.total)}</li>`).join('')}</ul>` : ''}</li>`
            : `<li>${esc(time(n.at))} · Deal #${Number(n.payload.deal_id)} dieskalasi ke pemilik.</li>`).join('')}</ul></details>` : ''}
        </div>
        ${tab === 'rejected' ? (data.cards.length ? `<div class="deal-history"><table aria-label="Riwayat deal ditolak">
          <thead><tr><th scope="col">Deal</th><th scope="col">Nominal</th><th scope="col">Alasan</th><th scope="col">Waktu</th></tr></thead>
          <tbody>${data.cards.map(row => `<tr><td>#${row.id} · ${esc(row.session_name)}</td><td>${amount(row.amount)}</td>
            <td>${row.reason_code ? esc(label(row.reason_code)) : 'Belum dicatat'}${row.note ? `<small>${esc(row.note)}</small>` : ''}</td>
            <td>${esc(time(row.decided_at))}</td></tr>`).join('')}</tbody>
        </table></div>` : '<p class="empty">Belum ada deal ditolak.</p>') : `<div class="${tab === 'review' && data.cards.length ? 'deal-workspace' : ''}">
        ${tab === 'review' && data.cards.length ? `<nav class="deal-queue" aria-label="Antrean verifikasi">${data.cards.map(card =>
          `<button type="button" data-select-deal="${card.id}"><strong>#${card.id} · ${esc(card.session_name)}</strong><span>${amount(card.amount)}</span><small class="${card.overdue ? 'is-overdue' : ''}">${card.overdue ? 'Lewat SLA · ' : ''}${age(card.age_ms)}</small></button>`).join('')}</nav>` : ''}
        <div class="deal-cards">${data.cards.map(card => {
          const proofs = card.messages.filter(m => !m.from_me && m.has_media && ['image','doc'].includes(m.kind));
          const canMarkPaid = card.state==='proof_submitted' && !!card.recorded_proof;
          return `<article class="card deal-card" data-deal="${card.id}">
            ${tab==='review' ? '<button type="button" class="deal-back">Kembali ke antrean</button>' : ''}
            <header><h3>#${card.id} · ${esc(card.session_name)}</h3><span class="deal-sla ${card.overdue && tab==='review' ? 'is-overdue' : ''}">${tab==='review' ? (card.overdue ? 'Lewat SLA' : 'Dalam SLA') : esc(label(card.state))} · ${age(card.age_ms)}</span></header>
            <div class="deal-amount"><strong>${amount(card.amount)}</strong><span>${esc(methodLabel(card.method))}</span></div>
            ${card.needs_info ? '<span class="deal-needs-info">Butuh info</span>' : ''}
            <details class="deal-metadata" ${tab==='review' ? '' : 'open'}><summary>Detail</summary><dl>
              <dt>Produk / jumlah</dt><dd>${esc(card.product || 'Belum diketahui')} / ${esc(card.qty ?? 'Belum diketahui')}</dd>
              <dt>Bukti gambar</dt><dd>${proofs.some(m=>m.kind==='image' && m.is_evidence) ? 'Ada' : proofs.some(m=>m.kind==='image') ? 'Ada lampiran untuk diperiksa' : 'Belum ada'}</dd>
              <dt>Keyakinan</dt><dd>${card.confidence==null ? 'Belum diketahui' : Math.round(card.confidence*100)+'%'}</dd>
              <dt>Alasan model</dt><dd>${esc(card.model_reason || 'Belum diketahui')}</dd>
              ${card.recorded_proof ? `<dt>Nominal bukti</dt><dd>${amount(card.recorded_proof.amount)} ${card.recorded_proof.amount!==card.amount ? '<strong>· Selisih</strong>' : ''}</dd>` : ''}
              ${tab==='dp' ? `<dt>Terbayar / sisa</dt><dd>${amount(card.paid_amount)} / ${amount(card.amount_due)}</dd><dt>Jatuh tempo</dt><dd>${esc(time(card.due_at))}</dd>` : ''}
            </dl></details>
            <ol class="deal-messages" aria-label="Potongan pesan relevan">${card.messages.map(m=>`<li><small>${m.from_me ? 'Tim' : 'Klien'}</small>
              <span>${esc(m.body || label(m.kind))}</span>
              ${proofs.includes(m) ? data.proof_enabled
                ? `<button type="button" data-proof-view="${m.id}">Buka bukti #${m.id}</button>`
                : '<small class="deal-proof-status">Lampiran nonaktif</small>' : ''}</li>`).join('')}</ol>
            ${data.can_decide ? `<div class="deal-actions">${tab==='review' ? `
              <button ${canMarkPaid ? 'class="primary"' : 'disabled title="Catat bukti pembayaran terlebih dahulu"'} data-action="paid">Tandai lunas</button>
              ${proofs.length ? `<button ${canMarkPaid ? '' : 'class="primary"'} data-action="proof">Catat bukti</button>` : ''}
              <button data-action="dp">DP</button><button data-action="reject">Bukan closing</button><button data-action="info">Butuh info</button>
            ` : tab==='dp' ? '<button class="primary" data-action="installment">Catat cicilan</button>' :
              '<button data-action="audit_confirm">Tepat</button><button data-action="audit_false">False positive</button>'}</div><p class="deal-feedback" data-card-feedback role="status"></p>` : ''}
            </article>`;
        }).join('') || '<p class="empty">Antrean ini kosong.</p>'}</div></div>`}
        <nav class="deal-tabs" aria-label="Halaman antrean">${offset ? '<button data-prev>Sebelumnya</button>' : ''}${data.has_more ? '<button data-next>Berikutnya</button>' : ''}</nav>
        <dialog class="deal-dialog"><header><h3></h3><form method="dialog"><button>Tutup</button></form></header><div data-evidence-view hidden></div><form data-decision-form></form></dialog>
        ${data.can_decide ? `<dialog class="deal-dialog deal-settings" data-proof-settings aria-labelledby="deal-settings-title">
          <header><h3 id="deal-settings-title">Pengaturan deal</h3><form method="dialog"><button autofocus>Tutup</button></form></header>
          <div class="deal-setting-row"><span>Lampiran bukti pembayaran</span><button type="button" role="switch" aria-label="Lampiran bukti pembayaran" aria-checked="${Boolean(data.proof_enabled)}" data-toggle-proof>${data.proof_enabled ? 'Aktif' : 'Nonaktif'}</button></div>
          <p data-error role="alert"></p>
        </dialog>` : ''}
      </section>`;
      const feedback = root.querySelector('.deal-feedback');
      const dialog = root.querySelector('.deal-dialog');
      const form = dialog.querySelector('[data-decision-form]');
      const preview = dialog.querySelector('[data-evidence-view]');
      const heading = dialog.querySelector('h3');
      const workspace = root.querySelector('.deal-workspace');
      if (workspace) {
        const rows = [...workspace.querySelectorAll('[data-select-deal]')];
        const cards = workspace.querySelectorAll('[data-deal]');
        const select = () => {
          workspace.classList.toggle('is-detail-open',detailOpen);
          rows.forEach(row => row.setAttribute('aria-pressed',String(Number(row.dataset.selectDeal) === selectedId)));
          cards.forEach(card => { card.hidden = Number(card.dataset.deal) !== selectedId; });
        };
        if (!data.cards.some(card => card.id === selectedId)) selectedId = data.cards[0].id;
        rows.forEach(row => row.onclick = () => {
          selectedId = Number(row.dataset.selectDeal);
          detailOpen = true;
          select();
          const back = workspace.querySelector('[data-deal]:not([hidden]) .deal-back');
          if (back?.getClientRects().length) back.focus();
        });
        workspace.querySelectorAll('.deal-back').forEach(button => button.onclick = () => {
          detailOpen = false;
          select();
          workspace.querySelector('[aria-pressed="true"]')?.focus();
        });
        select();
      }
      const refresh = async (path, body, button, after) => {
        if (button.disabled) return;
        button.disabled = true;
        try {
          const result = await call('POST',path,body);
          dialog.close();
          await load();
          const status = root.querySelector('.deal-feedback');
          if (status) status.textContent = after?.(result) || 'Keputusan tersimpan.';
        } catch (err) {
          const status = (dialog.open ? form.querySelector('[data-error]') : button.closest('[data-deal]')?.querySelector('[data-card-feedback]')) || feedback;
          status.textContent = err.message;
        } finally { button.disabled = false; }
      };
      root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab=b.dataset.tab; offset=0; detailOpen=false; load(); });
      const settings = root.querySelector('[data-proof-settings]');
      if (settings) {
        const trigger = root.querySelector('[data-open-settings]');
        const toggle = settings.querySelector('[data-toggle-proof]');
        const error = settings.querySelector('[data-error]');
        trigger.onclick = () => settings.showModal();
        settings.onclose = () => trigger.focus();
        toggle.onclick = async () => {
          toggle.disabled = true;
          error.textContent = '';
          try {
            await call('POST','/deals/review/settings',{proof_enabled:!data.proof_enabled});
            if (active() && token === generation) await load({openSettings:settings.open});
          } catch (err) {
            error.textContent = err.message;
          } finally {
            toggle.disabled = false;
          }
        };
        if (openSettings) {
          settings.showModal();
          toggle.focus();
        }
      }
      root.querySelector('[data-prev]')?.addEventListener('click',() => { offset-=30; load(); });
      root.querySelector('[data-next]')?.addEventListener('click',() => { offset+=30; load(); });
      root.querySelector('[data-sample]')?.addEventListener('click',e => refresh('/deals/audit/sample',{},e.currentTarget,r =>
        r.already_sampled ? 'Sampel hari ini sudah diambil.' : `${r.sampled} deal ditandai untuk audit.`));
      root.querySelectorAll('[data-deal]').forEach(el => {
        const card = data.cards.find(c => c.id === Number(el.dataset.deal));
        const endpoint = `/deals/${card.id}/decision`;
        const proofs = card.messages.filter(m => !m.from_me && m.has_media && ['image','doc'].includes(m.kind));
        el.querySelectorAll('[data-proof-view]').forEach(b => b.onclick = async () => {
          const proof = proofs.find(m => m.id === Number(b.dataset.proofView));
          heading.textContent = 'Bukti pembayaran';
          form.hidden = true;
          preview.hidden = false;
          preview.textContent = 'Memuat bukti…';
          dialog.showModal();
          try {
            const { url } = await call('POST',`/deals/${card.id}/evidence/${proof.id}/url`,{});
            if (!dialog.open || preview.hidden) return;
            preview.innerHTML = proof.kind === 'image' ? `<img src="${esc(url)}" alt="Bukti pembayaran #${proof.id}">` :
              `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Buka dokumen bukti</a>`;
          } catch (err) { preview.textContent = err.message; }
        });
        el.querySelectorAll('[data-action]').forEach(b => b.onclick = () => {
          const action = b.dataset.action;
          if (action === 'paid' && card.amount===card.recorded_proof.amount) {
            refresh(endpoint,{action},b);
            return;
          }
          preview.hidden = true;
          form.hidden = false;
          heading.textContent = b.textContent;
          const proofSelect = required => `<label>Lampiran bukti<select name="message_id" ${required?'required':''}>
            <option value="">Pilih bukti</option>${proofs.map(m=>`<option value="${m.id}">#${m.id} · ${esc(label(m.kind))}</option>`).join('')}</select></label>`;
          const note = (min = 0) => `<label>Catatan<textarea name="note" ${min ? `required minlength="${min}"` : ''} maxlength="1500"></textarea></label>`;
          form.innerHTML = '<p data-error role="alert"></p>';
          if (action === 'reject') {
            const groups = new Map();
            for (const entry of Object.entries(data.reasons)) {
              const group = entry[1].group;
              if (!groups.has(group)) groups.set(group,[]);
              groups.get(group).push(entry);
            }
            for (const [group,reasons] of groups) {
              form.insertAdjacentHTML('beforeend',`<fieldset><legend>${esc(label(group))}</legend><div class="deal-reasons">
                ${reasons.map(([code])=>`<button type="${code==='lain_lain'?'button':'submit'}" name="reason_code" value="${code}">${esc(label(code))}</button>`).join('')}</div></fieldset>`);
            }
            form.insertAdjacentHTML('beforeend',`<div data-other hidden>${note(10)}<button type="submit" name="reason_code" value="lain_lain">Simpan Lain-lain</button></div>`);
            form.querySelector('[value="lain_lain"]').onclick = () => {
              form.querySelector('[data-other]').hidden = false;
              form.elements.note.focus();
            };
            form.querySelectorAll('button[type="submit"]').forEach(choice => {
              if (choice.value !== 'lain_lain') choice.formNoValidate = true;
            });
          } else {
            const fields = action === 'proof' ? `${proofSelect(true)}<label>Nominal tagihan (Rp)<input name="amount" required type="number" min="1" value="${esc(card.amount)}"></label><label>Nominal pada bukti (Rp)<input name="proof_amount" required type="number" min="1"></label>`
              : ['dp','installment'].includes(action) ? paymentInputs(card,action==='dp')+proofSelect(false)+(action==='installment'?note():'')
              : action === 'paid' ? `<p>Nominal tagihan ${amount(card.amount)} berbeda dari bukti ${amount(card.recorded_proof.amount)}. Jelaskan alasan override.</p>${note(1)}`
              : action === 'audit_false' ? note(10)
              : action === 'info' ? note() : '<p>Konfirmasi keputusan awal sesuai dengan bukti.</p>';
            form.insertAdjacentHTML('beforeend',fields+'<button class="primary" type="submit">Simpan</button>');
          }
          const requestId = action==='installment' ? Array.from(crypto.getRandomValues(new Uint8Array(16)), value=>value.toString(16).padStart(2,'0')).join('') : undefined;
          form.onsubmit = event => {
            event.preventDefault();
            const submitter = event.submitter || form.querySelector('button[type="submit"]');
            const values = Object.fromEntries(new FormData(form));
            const body = { action, ...values };
            for (const key of ['message_id','amount','proof_amount','paid_amount','amount_due']) {
              if (values[key] === '') delete body[key];
              else if (values[key] !== undefined) body[key]=Number(values[key]);
            }
            if (values.due_at) body.due_at = new Date(values.due_at).getTime();
            if (action==='reject') {
              body.reason_code = event.submitter?.value;
              if (!body.reason_code) {
                form.querySelector('[data-error]').textContent = 'Pilih alasan penolakan.';
                return;
              }
              if (body.reason_code !== 'lain_lain') delete body.note;
            }
            if (requestId) body.request_id = requestId;
            if (action.startsWith('audit_')) {
              refresh(`/deals/${card.id}/audit`,{ false_positive:action==='audit_false',note:body.note },submitter);
            } else refresh(endpoint,body,submitter,action === 'reject' ? () => 'Deal tersimpan di tab Ditolak.' : undefined);
          };
          dialog.showModal();
        });
      });
    }
    await load();
  };
})();
