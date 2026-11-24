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
  const low = m => m.n > 0 && m.low_sample ? '<span class="da-low" title="Sampel kecil, angka belum stabil">n &lt; 10</span>' : '';

  const rate = (title,m,help,formula) => `<article class="card da-kpi" title="${esc(formula)}"><h3>${title}</h3>
    <strong>${pct(m) ?? EMPTY}</strong><small>${m.numerator} dari ${m.n} ${help}</small>${low(m)}</article>`;
  const count = (title,value,n,help) => `<article class="card da-kpi"><h3>${title}</h3>
    <strong>${Number(value).toLocaleString('id-ID')}</strong><small>n=${n} · ${help}</small></article>`;
  const compact = n => 'Rp ' + Number(n).toLocaleString('id-ID',{ notation:'compact',maximumFractionDigits:1 });
  const money = (title,value,n,help) => `<article class="card da-kpi"><h3>${title}</h3>
    <strong ${n ? `title="${rupiah(value)}"` : ''}>${n ? compact(value) : EMPTY}</strong><small>n=${n} · ${help}</small></article>`;
  const bars = (rows,max) => `<ul class="da-bars">${rows.map(([name,value,text]) => `<li><span title="${esc(name)}">${esc(name)}</span>
    <span class="da-bar" aria-hidden="true"><i style="width:${max ? Math.round(value / max * 100) : 0}%"></i></span><b>${esc(text ?? value)}</b></li>`).join('')}</ul>`;
  const aging = (title,d) => `<tr><td>${title}</td><td>${d.n}</td><td>${dur(d.average)}</td><td>${dur(d.p90)}</td></tr>`;
  const share = (part,total) => total ? Math.round(part / total * 100) : 0;

  // One whole split into a few parts: a segmented bar (easier to read than a pie) + a legend that always
  // shows name, count and share, so colour is never the only carrier of meaning.
  function segmented(title,parts,{ note='',empty='Belum ada data.' }={}) {
    const total = parts.reduce((n,p) => n + p.value,0);
    if (!total) return `<article class="card da-seg"><h3>${title}</h3><p class="da-empty">${empty}</p>${note}</article>`;
    const shown = parts.filter(p => p.value > 0);
    const describe = p => `${p.label}: ${p.value} (${share(p.value,total)}%)`;
    return `<article class="card da-seg"><h3>${title}</h3>
      <div class="da-segbar" role="img" aria-label="${esc(title + ' · ' + shown.map(describe).join(', '))}">
        ${shown.map(p => `<span class="da-seg-${p.slot}" style="flex-grow:${p.value}" title="${esc(describe(p))}">${share(p.value,total) >= 12 ? share(p.value,total) + '%' : ''}</span>`).join('')}
      </div>
      <ul class="da-legend">${parts.map(p => `<li><i class="da-seg-${p.slot}" aria-hidden="true"></i><span>${esc(p.label)}</span>
        <b>${p.value}</b><small>${share(p.value,total)}%</small></li>`).join('')}</ul>${note}</article>`;
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
    if (!rows.length) return `<p>${EMPTY}</p>`;
    const name = g => field === 'handler' ? HANDLER[g.key] || g.label : g.label;
    return `<div class="da-scroll"><table><thead><tr><th>${{ product:'Produk',number:'Nomor',agent:'Agen',handler:'Penangan' }[field]}</th>
      <th>n</th><th>Lunas</th><th>Closing</th><th>Bruto</th><th>Neto</th></tr></thead><tbody>${rows.map(g => `<tr>
      <td>${esc(name(g))}</td><td>${g.n}</td><td>${g.counts.verified_lunas}</td>
      <td>${pct(g.closing_rate) ?? 'Belum ada'} <small>(n=${g.closing_rate.n})</small>${g.closing_rate.n && g.closing_rate.low_sample ? ' <span class="da-low">n&lt;10</span>' : ''}</td>
      <td>${rupiah(g.revenue.gross)}</td><td>${rupiah(g.revenue.net)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  window.renderDealAnalytics = async (root, call, active) => {
    let weeks = 12, field = 'product', generation = 0;
    async function load() {
      const token = ++generation;
      const to = Date.now() + 1, from = to - weeks * 7 * DAY;
      let data;
      try { data = await call('GET',`/deals/analytics?from=${from}&to=${to}`); }
      catch (err) { if (active() && token === generation) root.innerHTML = `<div class="card"><p>${esc(err.message)}</p></div>`; return; }
      if (!active() || token !== generation) return;
      const s = data.summary, f = s.funnel, h = data.hours;
      const trendMax = Math.max(1,...data.weekly.map(w => w.counts.verified_lunas));
      const labelEvery = Math.max(1,Math.ceil(data.weekly.length / (innerWidth < 600 ? 4 : 6)));
      const DAYS = ['Senin','Selasa','Rabu','Kamis','Jumat','Sabtu','Minggu'];
      const dayText = d => d.closed ? 'tutup' : (d.open_min === 0 && d.close_min === 1440 ? '24 jam' : `${hhmm(d.open_min)}–${hhmm(d.close_min % 1440)}`);
      const schedule = h.days.every(d => dayText(d) === dayText(h.days[0])) ? `setiap hari ${dayText(h.days[0])}` : 'per hari (lihat pengaturan)';
      const toMin = v => { const [hh,mm] = String(v).split(':').map(Number); return hh*60 + mm; };
      const reasonRows = Object.entries(s.reasons).sort((a,b) => b[1] - a[1]);
      root.innerHTML = `<section class="deal-analytics" aria-label="Analytics closing dan DP">
        <div class="da-toolbar">
          <label>Periode<select data-weeks>${[4,12,26,52].map(w => `<option value="${w}" ${w===weeks?'selected':''}>${w} minggu</option>`).join('')}</select></label>
          <a class="btn" href="/api/deals/analytics/export?from=${from}&to=${to}" download>Ekspor CSV</a>
        </div>
        <p class="da-note">Deal yang dibuka dalam periode · zona waktu ${esc(h.timezone)} · jam operasional ${schedule}.
          Arahkan kursor ke angka untuk melihat rumusnya.</p>
        ${s.n === 0 ? `<article class="card da-story da-empty-state"><h3>Belum ada deal di periode ini</h3>
          <p>Dashboard terisi otomatis begitu sistem mendeteksi percakapan yang mengarah ke pembelian, lalu tim memverifikasinya di menu <b>Verifikasi deal</b>.</p>
          <p>Coba pilih periode yang lebih panjang, atau kembali lagi setelah ada transaksi.</p></article>` : `
        ${story(s)}
        <div class="da-grid da-grid-seg">
          ${segmented('Hasil deal yang sudah selesai',[
            { label:'Lunas',value:s.counts.verified_lunas,slot:1 },{ label:'Ditolak',value:s.counts.rejected,slot:2 },
            { label:'Tidak terjawab',value:s.counts.qualified_unanswered,slot:3 },{ label:'DP hangus',value:s.counts.dp_hangus,slot:4 }],
            { note:`<p class="da-note">Bagian <b>Lunas</b> inilah closing rate. Deal yang masih berjalan tidak dihitung di sini.</p>`,empty:'Belum ada deal yang selesai.' })}
          ${segmented('Deal yang masih berjalan',[
            { label:'DP aktif',value:s.open_deals.dp_aktif,slot:1 },{ label:'Menunggu bukti',value:s.open_deals.awaiting_proof,slot:2 },
            { label:'Menunggu verifikasi tim',value:s.pending_verification.value,slot:3 }],{ empty:'Tidak ada deal yang sedang berjalan.' })}
          ${segmented('Cara pelanggan melunasi',[
            { label:'Langsung lunas',value:s.counts.settled_direct,slot:1 },{ label:'Lewat DP dulu',value:s.counts.settled_dp,slot:2 }],{ empty:'Belum ada deal lunas.' })}
        </div>`}
        <div class="da-kpis"${s.n === 0 ? ' hidden' : ''}>
          ${rate('Closing rate',s.closing_rate,'deal selesai berakhir lunas','lunas ÷ (lunas + ditolak + tak terjawab + DP hangus)')}
          ${rate('Porsi DP',s.dp_share,'deal berbayar memakai DP','deal pernah DP ÷ deal dengan uang masuk')}
          ${rate('DP terlunasi',s.dp_settle,'DP berakhir lunas','lunas asal DP ÷ (lunas asal DP + DP hangus)')}
          ${count('Deal terbuka',s.open_deals.value,s.open_deals.n,`${s.open_deals.dp_aktif} DP aktif + ${s.open_deals.awaiting_proof} menunggu bukti`)}
          ${count('Pending verifikasi',s.pending_verification.value,s.pending_verification.n,'di luar closing rate')}
          ${money('AOV bruto',s.aov.gross,s.aov.n,'per deal lunas')}
          ${money('Pendapatan bruto',s.revenue.gross,s.revenue.n,'sebelum refund')}
          ${money('Pendapatan neto',s.revenue.net,s.revenue.n,`refund ${rupiah(s.revenue.refund)}`)}
          ${money('Kas masuk',s.revenue.cash_in,s.revenue.n,s.revenue.amount_mismatch ? `${s.revenue.amount_mismatch} deal kas masuk < tagihan` : 'sesuai tagihan')}
        </div>
        <div class="da-grid"${s.n === 0 ? ' hidden' : ''}>
          <article class="card"><h3>Tren mingguan (deal lunas)</h3>
            <div class="da-trend" role="img" aria-label="Jumlah deal lunas per minggu">${data.weekly.map((w,i) => `<div title="Minggu ${esc(w.week)}: ${w.counts.verified_lunas} lunas, closing ${pct(w.closing_rate) ?? 'belum tersedia'} (n=${w.closing_rate.n})">
              <small>${w.counts.verified_lunas}</small><i style="height:${Math.round(w.counts.verified_lunas / trendMax * 100)}%"></i><small>${i % labelEvery === 0 ? esc(w.week.slice(5)) : '&nbsp;'}</small></div>`).join('')}</div>
            <p class="da-note">Minggu terakhir (${esc(data.weekly.at(-1).week)}): closing ${pct(data.weekly.at(-1).closing_rate) ?? 'belum tersedia'}
              (n=${data.weekly.at(-1).closing_rate.n}). Arahkan ke batang untuk rincian tiap minggu; rincian lengkap ada di CSV.</p></article>
          <article class="card"><h3>Funnel</h3>
            ${bars([['Inquiry',f.inquiry],['Qualified',f.qualified],['Kandidat',f.candidate],['Bukti / DP',f.proof],['Lunas',f.lunas]],f.inquiry)}
            <p class="da-note">${esc(s.funnel_note)}</p></article>
          <article class="card"><h3>Waktu & aging</h3><div class="da-scroll"><table>
            <thead><tr><th>Ukuran</th><th>n</th><th>Rata-rata</th><th>p90</th></tr></thead><tbody>
            ${aging('Time-to-close',s.time_to_close)}${aging('Antrean verifikasi',s.aging.review)}
            ${aging('DP aktif (umur)',s.aging.dp_active)}${aging('DP hangus (DP → hangus)',s.aging.dp_hangus)}
            </tbody></table></div></article>
          <article class="card"><h3>Alasan drop-off</h3>
            ${reasonRows.length ? bars(reasonRows.map(([code,n]) => [code === 'unknown' ? 'Belum diketahui' : label(code),n]),reasonRows[0][1]) : `<p>${EMPTY}</p>`}
            <p class="da-note">n=${s.counts.rejected} deal ditolak${s.counts.unverified_legacy ? ` · ${s.counts.unverified_legacy} status lama tanpa bukti keputusan tidak dihitung` : ''}.</p></article>
        </div>
        <article class="card"${s.n === 0 ? ' hidden' : ''}><h3 class="da-title">Rincian</h3>
          <nav class="da-tabs" aria-label="Rincian per dimensi">${[['product','Produk'],['number','Nomor'],['agent','Agen'],['handler','AI vs manusia']].map(([k,t]) =>
            `<button data-field="${k}" aria-pressed="${k===field}">${t}</button>`).join('')}</nav>
          ${groupTable(data.groups[field],field)}
          <p class="da-note">Atribusi yang tidak tercatat tampil sebagai “Belum tercatat” / “Belum diketahui”.</p></article>
        <details class="card"><summary>Jam operasional untuk “qualified tak terjawab”</summary>
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
      root.querySelector('[data-weeks]').onchange = e => { weeks = Number(e.target.value); load(); };
      root.querySelectorAll('[data-field]').forEach(b => b.onclick = () => { field = b.dataset.field; load(); });
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
