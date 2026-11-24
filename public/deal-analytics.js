(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const DAY = 86400000;
  const rupiah = n => n == null ? 'Belum ada' : 'Rp ' + Math.round(n).toLocaleString('id-ID');
  const pct = m => m.value == null ? null : (m.value * 100).toLocaleString('id-ID',{ maximumFractionDigits:1 }) + '%';
  const dur = ms => ms == null ? 'Belum ada' : ms >= DAY ? (ms / DAY).toLocaleString('id-ID',{ maximumFractionDigits:1 }) + ' hari'
    : ms >= 3600000 ? Math.round(ms / 3600000) + ' jam' : Math.round(ms / 60000) + ' menit';
  const hhmm = min => String(Math.floor(min / 60)).padStart(2,'0') + ':' + String(min % 60).padStart(2,'0');
  const label = s => String(s).replaceAll('_',' ').replace(/^./,c => c.toUpperCase());
  const HANDLER = { ai:'AI', human:'Manusia', mixed:'AI + manusia', unknown:'Belum diketahui' };
  const EMPTY = '<span class="da-empty">Data belum tersedia</span>';
  const low = m => m.n > 0 && m.low_sample ? '<span class="da-low" title="Sampel kecil, angka belum stabil">Sampel kecil</span>' : '';

  const rate = (title,m,help) => `<article class="card da-kpi"><h3>${title}</h3>
    <strong>${pct(m) ?? '—'}</strong><div class="da-caption"><small>${m.numerator} dari ${m.n} ${help}</small>${low(m)}</div></article>`;
  const count = (title,value,help) => `<article class="card da-kpi"><h3>${title}</h3>
    <strong>${Number(value).toLocaleString('id-ID')}</strong><small>${help}</small></article>`;
  const compact = n => 'Rp ' + Number(n).toLocaleString('id-ID',{ notation:'compact',maximumFractionDigits:1 });
  const money = (title,value,n,help) => `<article class="card da-kpi"><h3>${title}</h3>
    <strong ${!n || value == null ? 'class="da-no-value"' : `title="${rupiah(value)}"`}>${!n || value == null ? '—' : compact(value)}</strong><small>${!n || value == null ? 'Belum ada transaksi' : help}</small></article>`;
  const bars = (rows,max) => `<ul class="da-bars">${rows.map(([name,value,text]) => `<li><span title="${esc(name)}">${esc(name)}</span>
    <span class="da-bar" aria-hidden="true"><i style="width:${max ? Math.round(value / max * 100) : 0}%"></i></span><b>${esc(text ?? value)}</b></li>`).join('')}</ul>`;
  const aging = (title,d) => `<tr><td>${title}</td><td>${d.n}</td><td>${dur(d.average)}</td><td>${dur(d.p90)}</td></tr>`;
  const share = (part,total) => total ? Math.round(part / total * 100) : 0;

  function outcomeSlice(part, single) {
    const span = part.end - part.start;
    const gap = single ? 0 : Math.min(2.5 / (2 * Math.PI * 67.5), span / 2);
    return `<circle class="da-ring-${part.slot}" data-outcome-slice="${part.slot}" tabindex="0" aria-label="${esc(part.label)} ${Math.round(span * 100)}%" r="67.5" pathLength="100" transform="rotate(-90)" fill="none" stroke-width="65"
      stroke-dasharray="${100 * (span - gap)} 100" stroke-dashoffset="${-100 * (part.start + gap / 2)}" stroke="url(#da-ring-${part.slot})"/>`;
  }

  // One whole split into a few parts: a segmented bar (easier to read than a pie) + a legend that always
  // shows name, count and share, so colour is never the only carrier of meaning.
  function segmented(title,parts,{ note='',empty='Belum ada data.',donut=false }={}) {
    const total = parts.reduce((n,p) => n + p.value,0);
    if (!total && !donut) return `<article class="card da-seg"><h3>${title}</h3><p class="da-empty">${empty}</p>${note}</article>`;
    const shown = parts.filter(p => p.value > 0);
    if (donut) shown.sort((a,b) => b.value - a.value);
    const describe = p => `${p.label}: ${p.value} (${share(p.value,total)}%)`;
    const description = esc(title + ' · ' + shown.map(describe).join(', '));
    let cumulative = 0;
    const slices = donut ? shown.map(p => {
      const start = cumulative / total;
      cumulative += p.value;
      const end = cumulative / total;
      return { ...p, start, end };
    }) : [];
    const largest = Math.max(0,...slices.map(p => p.value));
    const chart = donut ? `<div class="da-outcome-plot" role="group" aria-describedby="da-outcome-description">
      <span id="da-outcome-description" class="da-visually-hidden">${total ? description : 'Belum ada deal yang selesai.'}</span>
      <svg class="da-outcome-donut" viewBox="-100 -100 200 200">
        <defs>${parts.map(p => `<radialGradient id="da-ring-${p.slot}" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="100"><stop offset=".35" stop-color="var(--da-ring-inner-${p.slot})"/><stop offset="1" stop-color="var(--da-ring-outer-${p.slot})"/></radialGradient>`).join('')}</defs>
        ${total ? '' : '<circle r="67.5" fill="none" stroke="#262626" opacity=".5" stroke-width="65"/>'}
        ${slices.map(p => outcomeSlice(p,slices.length === 1)).join('')}
      </svg><span class="da-ring-hole" aria-hidden="true"></span>
      </div>` :
      `<div class="da-segbar" role="img" aria-label="${description}">
        ${shown.map(p => `<span class="da-seg-${p.slot}" style="flex-grow:${p.value}" title="${esc(describe(p))}">${share(p.value,total) >= 12 ? share(p.value,total) + '%' : ''}</span>`).join('')}
      </div>`;
    return `<article class="da-seg ${donut ? 'da-chart-panel da-outcome-card' : 'card'}"><h3>${title}${donut ? ' <button type="button" class="da-info" aria-label="Bagian lunas menunjukkan closing rate dari deal yang sudah selesai." title="Bagian lunas menunjukkan closing rate dari deal yang sudah selesai.">ⓘ</button>' : ''}</h3>
      ${chart}
      ${donut && total ? `<div class="da-outcome-chips" aria-hidden="true">${slices.map(p => `<span data-outcome-chip="${p.slot}" class="da-glass da-outcome-chip ${p.value === largest ? 'is-largest' : ''}"><strong>${share(p.value,total)}%</strong><small>${esc(p.label)}</small></span>`).join('')}</div>` : ''}
      <ul class="da-legend${donut && !total ? ' da-legend-empty' : ''}">${parts.map(p => `<li class="${p.value ? '' : 'da-zero'}"><i class="da-seg-${p.slot}" aria-hidden="true"></i><span>${esc(p.label)}</span>
        <b>${p.value}</b><small>${share(p.value,total)}%</small></li>`).join('')}</ul>${donut ? '' : note}</article>`;
  }

  // Plain-language reading of the numbers, for people who do not want to interpret rates.
  function story(s) {
    const c = s.counts, done = s.closing_rate.n;
    const lines = [];
    if (done) {
      lines.push(`Dari <b>${done}</b> deal yang sudah ada hasilnya, <b>${c.verified_lunas} lunas (${share(c.verified_lunas,done)}%)</b>.`
        + ` Sisanya ${[[c.rejected,'ditolak'],[c.qualified_unanswered,'tidak terjawab'],[c.dp_hangus,'DP hangus']].filter(([n]) => n).map(([n,t]) => `${n} ${t}`).join(', ') || 'tidak ada'}.`);
    } else lines.push('Belum ada deal yang selesai di periode ini, jadi closing rate belum bisa dihitung.');
    const open = s.open_deals.value + s.pending_verification.value;
    if (open) lines.push(`Masih berjalan: <b>${open}</b> deal (${s.open_deals.dp_aktif} DP aktif, ${s.open_deals.awaiting_proof} menunggu bukti, ${s.pending_verification.value} menunggu verifikasi tim).`);
    if (s.revenue.n) lines.push(`Uang masuk dari deal lunas: <b>${rupiah(s.revenue.net)}</b>${s.revenue.refund ? ` setelah refund ${rupiah(s.revenue.refund)}` : ''}, rata-rata ${rupiah(s.aov.gross)} per deal.`);
    if (done && done < 10) lines.push('<span class="da-low">Sampel masih kecil</span> Angka persen bisa berubah banyak saat deal bertambah.');
    return `<article class="card da-story" aria-label="Ringkasan"><h3>Ringkasan</h3>${lines.map(l => `<p>${l}</p>`).join('')}</article>`;
  }

  function groupTable(rows,field) {
    const name = g => field === 'handler' ? HANDLER[g.key] || g.label : g.label;
    return `<div class="da-scroll"><table><thead><tr><th scope="col">${{ product:'Produk',number:'Nomor',agent:'Agen',handler:'Penangan' }[field]}</th>
      <th scope="col">Jumlah deal</th><th scope="col">Lunas</th><th scope="col">Closing</th><th scope="col">Bruto</th><th scope="col">Neto</th></tr></thead><tbody>${rows.length ? rows.map(g => `<tr>
      <td>${esc(name(g))}</td><td>${g.n}</td><td>${g.counts.verified_lunas}</td>
      <td>${pct(g.closing_rate) ?? 'Belum ada'}${g.closing_rate.n && g.closing_rate.low_sample ? ' <span class="da-low">Sampel kecil</span>' : ''}</td>
      <td>${rupiah(g.revenue.gross)}</td><td>${rupiah(g.revenue.net)}</td></tr>`).join('') : Array.from({length:3}, () => '<tr aria-hidden="true" class="da-skeleton">' + '<td><i></i></td>'.repeat(6) + '</tr>').join('')}</tbody></table></div>`;
  }

  window.renderDealAnalytics = async (root, call, active) => {
    let weeks = 12, field = 'product', generation = 0;
    async function load() {
      const token = ++generation;
      const to = Date.now() + 1, from = to - weeks * 7 * DAY;
      let data;
      try { data = await call('GET',`/deals/analytics?from=${from}&to=${to}`); }
      catch (err) {
        if (active() && token === generation) {
          root.innerHTML = `<div class="card da-load-error" role="alert"><p>${esc(err.message)}</p><button type="button" class="ghost">Coba lagi</button></div>`;
          root.querySelector('.da-load-error button').onclick = event => {
            event.currentTarget.disabled = true;
            load();
          };
        }
        return;
      }
      if (!active() || token !== generation) return;
      const s = data.summary, f = s.funnel, h = data.hours;
      const trendMax = Math.max(1,...data.weekly.map(w => w.counts.verified_lunas));
      const latestPaidWeek = data.weekly.findLastIndex(w => w.counts.verified_lunas > 0);
      const tickStep = Math.max(1,Math.ceil(trendMax / 4));
      const trendCeiling = tickStep * 4;
      const labelEvery = Math.max(1,Math.ceil(data.weekly.length / (innerWidth < 600 ? 4 : 6)));
      const DAYS = ['Senin','Selasa','Rabu','Kamis','Jumat','Sabtu','Minggu'];
      const dayText = d => d.closed ? 'tutup' : (d.open_min === 0 && d.close_min === 1440 ? '24 jam' : `${hhmm(d.open_min)}–${hhmm(d.close_min % 1440)}`);
      const schedule = h.days.every(d => dayText(d) === dayText(h.days[0])) ? `setiap hari ${dayText(h.days[0])}` : 'per hari (lihat pengaturan)';
      const toMin = v => { const [hh,mm] = String(v).split(':').map(Number); return hh*60 + mm; };
      const reasonRows = Object.entries(s.reasons).sort((a,b) => b[1] - a[1]);
      const periodPicker = `<div class="da-period" role="group" aria-label="Periode analitik">${[4,12,26,52].map(w =>
        `<button type="button" data-weeks="${w}" aria-pressed="${w===weeks}" aria-label="${w} minggu">${w} mgg</button>`).join('')}</div>`;
      const exportLink = `<a class="btn da-export" href="/api/deals/analytics/export?from=${from}&to=${to}" download>Ekspor CSV</a>`;
      const header = root.closest('#workspace')?.querySelector('header');
      if (header) {
        header.querySelector('.da-page-period')?.remove();
        header.querySelector('.da-export')?.remove();
        header.querySelector('#pageTitle').insertAdjacentHTML('afterend', `<span class="da-page-period">Periode ${weeks} minggu terakhir</span>`);
        header.insertAdjacentHTML('beforeend', exportLink);
      }
      root.innerHTML = `<section class="deal-analytics" aria-label="Analytics closing dan DP">
        ${header ? '' : exportLink}
        <div class="da-kpis da-kpis-primary" aria-label="Metrik utama">
          ${rate('Closing rate',s.closing_rate,'deal selesai berakhir lunas')}
          ${count('Deal terbuka',s.open_deals.value,`${s.open_deals.dp_aktif} DP aktif + ${s.open_deals.awaiting_proof} menunggu bukti`)}
          ${money('Pendapatan neto',s.revenue.net,s.revenue.n,`refund ${rupiah(s.revenue.refund)}`)}
          ${money('Kas masuk',s.revenue.cash_in,s.revenue.n,s.revenue.amount_mismatch ? `${s.revenue.amount_mismatch} deal kas masuk < tagihan` : 'sesuai tagihan')}
        </div>
        <section class="card da-overview-charts" aria-label="Grafik closing dan DP">
          <article class="da-chart-panel da-trend-card"><div class="da-panel-heading"><h3>Deal lunas per minggu</h3>${periodPicker}</div>
            ${data.weekly.some(w => w.counts.verified_lunas > 0) ? `
            <div class="da-trend-plot">
              <div class="da-trend-axis" aria-hidden="true">${[4,3,2,1,0].map(tick => `<span>${tick * tickStep}</span>`).join('')}</div>
              <div class="da-trend" aria-label="Jumlah deal lunas per minggu">${data.weekly.map((w,i) => {
                const description = `Minggu ${w.week}: ${w.counts.verified_lunas} lunas, closing ${pct(w.closing_rate) ?? 'belum tersedia'}`;
                return `<div class="da-trend-week" role="button" tabindex="0" aria-pressed="${i === latestPaidWeek}" aria-label="${esc(description)}" style="--da-height:${w.counts.verified_lunas / trendCeiling * 100}%">
                  <i aria-hidden="true"></i><small aria-hidden="true">${i % labelEvery === 0 ? esc(w.week.slice(5)) : ''}</small>
                  <span class="da-trend-value da-glass" aria-hidden="true"><strong>${w.counts.verified_lunas} lunas</strong><small>${esc(w.week)}</small></span></div>`;
              }).join('')}</div>
            </div>` : `<div class="da-trend-empty"><p>Belum ada deal lunas di periode ini</p><div class="da-empty-bars" aria-hidden="true">${data.weekly.slice(-7).map(w => `<span><i></i>${esc(w.week.slice(5))}</span>`).join('')}</div></div>`}</article>
          ${segmented('Hasil deal yang sudah selesai',[
            { label:'Lunas',value:s.counts.verified_lunas,slot:1 },{ label:'Ditolak',value:s.counts.rejected,slot:2 },
            { label:'Tidak terjawab',value:s.counts.qualified_unanswered,slot:3 },{ label:'DP hangus',value:s.counts.dp_hangus,slot:4 }],
            { donut:true, note:`<p class="da-note">Bagian <b>Lunas</b> inilah closing rate. Deal yang masih berjalan tidak dihitung di sini.</p>`,empty:'Belum ada deal yang selesai.' })}
        </section>
        <article class="card da-detail-card"><div class="da-panel-heading"><h3 class="da-title">Rincian deal</h3></div>
          <div class="da-detail-controls">
            <input type="search" data-detail-search aria-label="Cari rincian deal" placeholder="Cari di rincian…">
            <select data-detail-sort aria-label="Urutkan rincian deal"><option value="">Urutan awal</option><option value="name">Nama A–Z</option><option value="count">Deal terbanyak</option></select>
          </div>
          <nav class="da-tabs" aria-label="Rincian per dimensi">${[['product','Produk'],['number','Nomor'],['agent','Agen'],['handler','AI vs manusia']].map(([k,t]) =>
            `<button data-field="${k}" aria-pressed="${k===field}">${t}</button>`).join('')}</nav>
          ${groupTable(data.groups[field],field)}
          <p class="da-note">Atribusi yang tidak tercatat tampil sebagai “Belum tercatat” / “Belum diketahui”.</p></article>
        ${s.n ? `${story(s)}
        <details class="card da-more-metrics">
          <summary>Metrik tambahan</summary>
          <div class="da-kpis">
          ${rate('Porsi DP',s.dp_share,'deal berbayar memakai DP')}
          ${rate('DP terlunasi',s.dp_settle,'DP berakhir lunas')}
          ${count('Pending verifikasi',s.pending_verification.value,'di luar closing rate')}
          ${money('AOV bruto',s.aov.gross,s.aov.n,'per deal lunas')}
          ${money('Pendapatan bruto',s.revenue.gross,s.revenue.n,'sebelum refund')}
          </div>
        </details>
        <div class="da-grid da-grid-seg">
          ${segmented('Deal yang masih berjalan',[
            { label:'DP aktif',value:s.open_deals.dp_aktif,slot:1 },{ label:'Menunggu bukti',value:s.open_deals.awaiting_proof,slot:2 },
            { label:'Menunggu verifikasi tim',value:s.pending_verification.value,slot:3 }],{ empty:'Tidak ada deal yang sedang berjalan.' })}
          ${segmented('Cara pelanggan melunasi',[
            { label:'Langsung lunas',value:s.counts.settled_direct,slot:1 },{ label:'Lewat DP dulu',value:s.counts.settled_dp,slot:2 }],{ empty:'Belum ada deal lunas.' })}
        </div>
        <div class="da-grid">
          <article class="card"><h3>Funnel</h3>
            ${bars([['Inquiry',f.inquiry],['Qualified',f.qualified],['Kandidat',f.candidate],['Bukti / DP',f.proof],['Lunas',f.lunas]],f.inquiry)}
            <p class="da-note">${esc(s.funnel_note)}</p></article>
          <article class="card"><h3>Waktu & aging</h3><div class="da-scroll"><table>
            <thead><tr><th>Ukuran</th><th>Jumlah deal</th><th>Rata-rata</th><th>p90</th></tr></thead><tbody>
            ${aging('Time-to-close',s.time_to_close)}${aging('Antrean verifikasi',s.aging.review)}
            ${aging('DP aktif (umur)',s.aging.dp_active)}${aging('DP hangus (DP → hangus)',s.aging.dp_hangus)}
            </tbody></table></div></article>
          <article class="card"><h3>Alasan drop-off</h3>
            ${reasonRows.length ? bars(reasonRows.map(([code,n]) => [code === 'unknown' ? 'Belum diketahui' : label(code),n]),reasonRows[0][1]) : `<p>${EMPTY}</p>`}
            <p class="da-note">${s.counts.rejected} deal ditolak${s.counts.unverified_legacy ? ` · ${s.counts.unverified_legacy} status lama tanpa bukti keputusan tidak dihitung` : ''}.</p></article>
        </div>` : ''}
        <details class="card"><summary>Jam operasional</summary>
          <p class="da-note">Deal dihitung berdasarkan tanggal dibuka · zona waktu ${esc(h.timezone)}.</p>
          <form class="da-hours" data-hours>
            <label>Zona waktu (IANA)<input name="timezone" value="${esc(h.timezone)}" maxlength="64" required></label>
            <div class="da-week">${h.days.map(d => `<fieldset class="da-day"><legend>${DAYS[d.weekday]}</legend>
              <label>Buka<input type="time" name="open${d.weekday}" value="${hhmm(d.open_min % 1440)}" ${d.closed ? 'disabled' : ''}></label>
              <label>Tutup<input type="time" name="close${d.weekday}" value="${hhmm(d.close_min % 1440)}" ${d.closed ? 'disabled' : ''}></label>
              <label class="da-closed"><input type="checkbox" name="closed${d.weekday}" ${d.closed ? 'checked' : ''}> Tutup</label></fieldset>`).join('')}</div>
            <label>Hari libur (satu per baris: YYYY-MM-DD keterangan)<textarea name="holidays" rows="3">${esc(h.holidays.map(x => (x.day + ' ' + (x.label ?? '')).trim()).join('\n'))}</textarea></label>
            <button type="submit">Simpan jadwal</button>
          </form>
          <p class="da-note">Jam operasional: ${schedule}. Isi 00:00–00:00 untuk buka 24 jam.</p>
          <p class="da-note">Pesan masuk di luar jam buka atau di hari libur tidak menurunkan closing rate. Pesan di dalam jam yang tidak dibalas selama 4 jam operasional dihitung sekali per deal.</p>
          <p class="da-feedback" role="status"></p></details>
      </section>`;
      root.querySelectorAll('[data-weeks]').forEach(button => button.onclick = () => {
        const next = Number(button.dataset.weeks);
        if (next !== weeks) { weeks = next; load(); }
      });
      root.querySelectorAll('[data-field]').forEach(b => b.onclick = () => { field = b.dataset.field; load(); });
      const outcome = root.querySelector('.da-outcome-card');
      outcome?.querySelectorAll('[data-outcome-slice]').forEach(slice => {
        const show = () => { outcome.dataset.highlight = slice.dataset.outcomeSlice; };
        const hide = () => {
          if (outcome.dataset.highlight === slice.dataset.outcomeSlice) delete outcome.dataset.highlight;
        };
        slice.addEventListener('pointerenter', show);
        slice.addEventListener('pointerleave', () => { if (document.activeElement !== slice) hide(); });
        slice.addEventListener('focus', show);
        slice.addEventListener('blur', () => { if (!slice.matches(':hover')) hide(); });
      });
      const detail = root.querySelector('.da-detail-card');
      const detailBody = detail?.querySelector('tbody');
      if (detailBody && data.groups[field].length) {
        const rows = [...detailBody.rows];
        const search = detail.querySelector('[data-detail-search]');
        const sort = detail.querySelector('[data-detail-sort]');
        const empty = document.createElement('p');
        empty.className = 'da-note';
        empty.setAttribute('role','status');
        empty.hidden = true;
        detailBody.closest('.da-scroll').after(empty);
        const update = () => {
          const query = search.value.trim().toLocaleLowerCase('id-ID');
          const ordered = [...rows];
          if (sort.value === 'name') ordered.sort((a,b) => a.cells[0].textContent.localeCompare(b.cells[0].textContent,'id-ID'));
          if (sort.value === 'count') ordered.sort((a,b) => Number(b.cells[1]?.textContent || 0) - Number(a.cells[1]?.textContent || 0));
          for (const row of ordered) row.hidden = !row.cells[0].textContent.toLocaleLowerCase('id-ID').includes(query);
          detailBody.append(...ordered);
          empty.hidden = ordered.some(row => !row.hidden);
          empty.textContent = empty.hidden ? '' : 'Tidak ada rincian yang cocok.';
        };
        search.oninput = update;
        sort.onchange = update;
      }
      const trendWeeks = [...root.querySelectorAll('.da-trend-week')];
      const selectWeek = week => trendWeeks.forEach(item => item.setAttribute('aria-pressed',String(item===week)));
      trendWeeks.forEach(week => {
        week.onclick = () => selectWeek(week);
        week.onkeydown = e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectWeek(week); }
        };
      });
      root.querySelector('[data-hours]').onsubmit = async e => {
        e.preventDefault();
        const form = new FormData(e.target), feedback = root.querySelector('.da-feedback');
        try {
          const days = h.days.map(d => {
            const closed = form.get('closed' + d.weekday) === 'on';
            let open = toMin(form.get('open' + d.weekday) ?? hhmm(d.open_min % 1440)), close = toMin(form.get('close' + d.weekday) ?? hhmm(d.close_min % 1440));
            if (!closed && open === close) { open = 0; close = 1440; }
            return { weekday:d.weekday,open_min:open,close_min:close,closed };
          });
          const holidays = String(form.get('holidays') || '').split('\n').map(l => l.trim()).filter(Boolean)
            .map(l => { const [day,...rest] = l.split(/\s+/); return { day,label:rest.join(' ') || null }; });
          await call('PATCH','/deals/analytics/hours',{ timezone:String(form.get('timezone')).trim(),days,holidays });
          load();
        } catch (err) { feedback.textContent = err.message; }
      };
    }
    await load();
  };
})();
