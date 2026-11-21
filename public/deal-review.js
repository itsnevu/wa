(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const amount = n => n == null ? 'Belum diketahui' : 'Rp ' + Number(n).toLocaleString('id-ID');
  const time = n => n ? new Date(n).toLocaleString('id-ID') : 'Belum ditentukan';
  const age = n => n == null ? '—' : n >= 3600000 ? Math.floor(n/3600000) + ' jam' : Math.floor(n/60000) + ' menit';
  const label = s => String(s).replaceAll('_',' ').replace(/^./,c => c.toUpperCase());
  const paymentInputs = (card, initial) => `
    ${initial ? `<label>Total tagihan (Rp)<input name="amount" type="number" min="1" required value="${esc(card.amount)}"></label>` : ''}
    <label>${initial ? 'DP diterima' : 'Cicilan diterima'} (Rp)<input name="paid_amount" type="number" min="1" required></label>
    ${initial ? '<label>Sisa tagihan (Rp)<input name="amount_due" type="number" min="1" required></label><label>Jatuh tempo (waktu perangkat)<input name="due_at" type="datetime-local" required></label>' : ''}
    <label>Metode<input name="method" maxlength="80" value="${esc(card.method)}" required></label>`;

  window.renderDealReview = async (root, call, active) => {
    let tab = 'review', offset = 0;
    let generation = 0;
    async function load() {
      const token = ++generation;
      let data;
      try { data = await call('GET',`/deals/review?tab=${tab}&offset=${offset}`); }
      catch (err) { if (active() && token === generation) root.textContent = err.message; return; }
      if (!active() || token !== generation) return;
      root.innerHTML = `<section class="deal-review">
        <nav class="deal-tabs" aria-label="Antrean deal">${[['review','Verifikasi'],['dp','Penagihan DP'],...(data.owner ? [['audit','Audit sampel']] : [])].map(([key,title]) =>
          `<button data-tab="${key}" aria-pressed="${key===tab}">${title}</button>`).join('')}</nav>
        <p class="deal-feedback" role="status"></p>
        ${tab === 'audit' ? `<div class="card"><button data-sample>Ambil sampel 5% hari ini</button>
          ${data.audit_stats.length ? `<ul>${data.audit_stats.map(r=>`<li>Admin ${esc(r.admin_id)} · ${esc(r.classifier_version || 'Tanpa classifier')} · ${Number(r.false_positive)}/${Number(r.audited)} false positive</li>`).join('')}</ul>` : ''}</div>` : ''}
        ${data.notices.length && tab === 'review' ? `<details class="card"><summary>Digest dan eskalasi pemilik</summary><ul>
          ${data.notices.map(n=> n.kind==='digest'
            ? `<li>${esc(time(n.at))} · ${Number(n.payload.review_count)} menunggu · tertua ${esc(age(n.payload.oldest_age_ms))}
              ${n.payload.reasons.length ? `<ul>${n.payload.reasons.map(r=>`<li>Admin ${esc(r.admin_id)} · ${esc(label(r.reason_code))} · ${Number(r.total)}</li>`).join('')}</ul>` : ''}</li>`
            : `<li>${esc(time(n.at))} · Deal #${Number(n.payload.deal_id)} dieskalasi ke pemilik.</li>`).join('')}</ul></details>` : ''}
        <div class="deal-cards">${data.cards.map(card => {
          const proofs = card.messages.filter(m => !m.from_me && m.has_media && ['image','doc'].includes(m.kind));
          return `<article class="card deal-card" data-deal="${card.id}">
            <header><h3>#${card.id} · ${esc(card.session_name)}</h3><span class="deal-sla ${card.overdue && tab==='review' ? 'is-overdue' : ''}">${tab==='review' ? (card.overdue ? 'Lewat SLA' : 'Dalam SLA') : esc(label(card.state))} · ${age(card.age_ms)}</span></header>
            <dl><dt>Nominal</dt><dd>${amount(card.amount)}</dd><dt>Metode</dt><dd>${esc(card.method || 'Belum diketahui')}</dd>
              <dt>Produk / jumlah</dt><dd>${esc(card.product || '—')} / ${esc(card.qty ?? '—')}</dd>
              <dt>Bukti gambar</dt><dd>${proofs.some(m=>m.kind==='image' && m.is_evidence) ? 'Ada' : proofs.some(m=>m.kind==='image') ? 'Ada lampiran untuk diperiksa' : 'Belum ada'}</dd>
              <dt>Keyakinan</dt><dd>${card.confidence==null ? '—' : Math.round(card.confidence*100)+'%'}</dd>
              <dt>Alasan model</dt><dd>${esc(card.model_reason || '—')}</dd>
              ${card.recorded_proof ? `<dt>Nominal bukti</dt><dd>${amount(card.recorded_proof.amount)} ${card.recorded_proof.amount!==card.amount ? '<strong>· Selisih</strong>' : ''}</dd>` : ''}
              ${tab==='dp' ? `<dt>Terbayar / sisa</dt><dd>${amount(card.paid_amount)} / ${amount(card.amount_due)}</dd><dt>Jatuh tempo</dt><dd>${esc(time(card.due_at))}</dd>` : ''}
            </dl>
            <ol class="deal-messages" aria-label="Potongan pesan relevan">${card.messages.map(m=>`<li><small>${m.from_me ? 'Tim' : 'Klien'}</small>
              <span>${esc(m.body || label(m.kind))}</span>
              ${proofs.includes(m) ? `<button type="button" data-proof-view="${m.id}">Buka bukti #${m.id}</button>` : ''}</li>`).join('')}</ol>
            ${data.can_decide ? `<div class="deal-actions">${tab==='review' ? `
              <button class="primary" data-action="paid" ${card.state!=='proof_submitted' || !card.recorded_proof ? 'disabled' : ''}>Lunas</button>
              <button data-action="dp">DP</button><button data-action="reject">Bukan closing</button><button data-action="info">Butuh info</button>
              ${proofs.length ? '<button data-action="proof">Catat bukti</button>' : ''}
            ` : tab==='dp' ? '<button class="primary" data-action="installment">Catat cicilan</button>' :
              '<button data-action="audit_confirm">Tepat</button><button data-action="audit_false">False positive</button>'}</div>` : ''}
            </article>`;
        }).join('') || '<p class="empty">Antrean ini kosong.</p>'}</div>
        <nav class="deal-tabs" aria-label="Halaman antrean">${offset ? '<button data-prev>Sebelumnya</button>' : ''}${data.has_more ? '<button data-next>Berikutnya</button>' : ''}</nav>
        <dialog class="deal-dialog"><header><h3></h3><form method="dialog"><button>Tutup</button></form></header><div data-evidence-view hidden></div><form data-decision-form></form></dialog>
      </section>`;
      const feedback = root.querySelector('.deal-feedback');
      const dialog = root.querySelector('.deal-dialog');
      const form = dialog.querySelector('[data-decision-form]');
      const preview = dialog.querySelector('[data-evidence-view]');
      const heading = dialog.querySelector('h3');
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
          const status = dialog.open ? form.querySelector('[data-error]') || feedback : feedback;
          status.textContent = err.message;
        } finally { button.disabled = false; }
      };
      root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab=b.dataset.tab; offset=0; load(); });
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
          if (action === 'info' || (action === 'paid' && card.amount===card.recorded_proof.amount)) {
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
              : action === 'audit_false' ? note(10) : '<p>Konfirmasi keputusan awal sesuai dengan bukti.</p>';
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
            } else refresh(endpoint,body,submitter);
          };
          dialog.showModal();
        });
      });
    }
    await load();
  };
})();
