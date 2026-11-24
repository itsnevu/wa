const aiSaveIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2Z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/></svg>';
const aiProfileFields=[
  ['nama','Nama bisnis',120,1,'Contoh: Kopi Senja'],
  ['tentang','Tentang bisnis',2000,3,'Apa yang dijual, sejak kapan, keunggulan, target pelanggan.'],
  ['jam','Jam operasional & lokasi',1000,2,'Senin–Sabtu 08.00–21.00, Jl. Merdeka 10 Bandung. Minggu libur.'],
  ['produk','Produk & layanan',4000,5,'Menu/produk utama, varian, ukuran, harga kisaran, layanan tambahan.'],
  ['kebijakan','Aturan & kebijakan (pembayaran, pengiriman, retur, garansi)',3000,4,'Transfer BCA/QRIS, kirim via GoSend area kota, retur 1x24 jam bila rusak.'],
  ['faq','Pertanyaan yang sering ditanyakan',3000,4,'T: Bisa COD? J: Bisa untuk area kota.'],
  ['gaya','Gaya bahasa',500,2,'Santai dan sopan, panggil pelanggan "Kak", boleh pakai emoji secukupnya.'],
];
const aiAttachHtml=prefix=>`<div class="ai-draft-actions"><input type="file" id="${prefix}Files" accept="image/*,application/pdf,.pdf,.txt,.csv,.md" multiple hidden /><button type="button" class="ghost" data-attach="${prefix}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 12-8.5 8.5a5 5 0 0 1-7-7L14 5a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 8"/></svg>Lampirkan file/foto</button><span class="ai-attach-hint">Foto, PDF, TXT, CSV · maks 5 file</span></div><ul class="ai-attach-list" id="${prefix}List"></ul>`;
function aiAttach(prefix) {
  const input=$('#'+prefix+'Files'), list=$('#'+prefix+'List'); let picked=[];
  const render=()=>{ list.innerHTML=picked.map((f,i)=>`<li><span>${esc(f.name)}</span><small>${Math.ceil(f.size/1024).toLocaleString('id-ID')} KB</small><button type="button" class="ghost" data-remove="${i}" aria-label="Hapus ${esc(f.name)}">×</button></li>`).join(''); list.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{ picked.splice(Number(b.dataset.remove),1); render(); }); };
  document.querySelector(`[data-attach="${prefix}"]`).onclick=()=>input.click();
  input.onchange=()=>{ picked=[...picked,...input.files].slice(0,5); input.value=''; render(); };
  const shrink=file=>new Promise((resolve,reject)=>{ const img=new Image(); const url=URL.createObjectURL(file); img.onload=()=>{ const k=Math.min(1,1600/Math.max(img.width,img.height)); const c=document.createElement('canvas'); c.width=Math.round(img.width*k); c.height=Math.round(img.height*k); c.getContext('2d').drawImage(img,0,0,c.width,c.height); URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg',0.85)); }; img.onerror=()=>{ URL.revokeObjectURL(url); reject(new Error(`${file.name} tidak bisa dibaca`)); }; img.src=url; });
  const asDataUrl=file=>new Promise((resolve,reject)=>{ const r=new FileReader(); r.onload=()=>resolve(r.result); r.onerror=()=>reject(new Error(`${file.name} tidak bisa dibaca`)); r.readAsDataURL(file); });
  return { count:()=>picked.length, clear:()=>{ picked=[]; render(); }, async collect(text) {
    const files=[]; let extra='';
    for (const f of picked) {
      if (f.type.startsWith('image/')) files.push({name:f.name,data:await shrink(f)});
      else if (f.type==='application/pdf' || /\.pdf$/i.test(f.name)) { if (f.size>5*1024*1024) throw new Error(`${f.name} lebih dari 5 MB`); files.push({name:f.name,data:(await asDataUrl(f)).replace(/^data:[^;]*;/,'data:application/pdf;')}); }
      else if (/\.(txt|csv|md)$/i.test(f.name) || f.type.startsWith('text/')) extra+=`\n\n--- ${f.name} ---\n${(await f.text()).slice(0,20000)}`;
      else throw new Error(`${f.name}: format tidak didukung (pakai foto, PDF, TXT, atau CSV)`);
    }
    return { text:(text+extra).trim(), files };
  } };
}
const aiTok=text=>Math.ceil(String(text||'').length/4);
let aiNumberId = null;
let aiLoadVersion = 0;
function aiColor(pct, warn) { return pct >= 100 ? 'danger' : pct >= warn ? 'warning' : 'healthy'; }
function aiDayKey() { return new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Jakarta'}); }
function aiDismissed() { try { return localStorage.getItem(`ai-alert-closed:${state.me.id}`) === aiDayKey(); } catch { return false; } }

async function refreshAiAlerts() {
  if (state.me?.role !== 'admin') return;
  const alerts = await call('GET','/ai/alerts');
  let banner = $('#aiGlobalAlert');
  if (!alerts.length || aiDismissed()) { banner?.remove(); return; }
  if (!banner) { banner=document.createElement('aside'); banner.id='aiGlobalAlert'; banner.setAttribute('role','status'); document.body.appendChild(banner); }
  const stopped=alerts.some(a=>a.level==='stop');
  banner.className=stopped ? 'ai-alert danger' : 'ai-alert warning';
  banner.innerHTML=`<div><strong>${stopped ? 'AI mencapai batas token' : 'Pemakaian AI mendekati batas'}</strong><p>${esc([...new Set(alerts.map(a=>a.name))].join(', '))}. Periksa pemakaian di modul Otomasi AI.</p></div><button type="button" class="ghost" data-ai-open>Buka AI</button><button type="button" class="ghost" data-ai-dismiss aria-label="Tutup peringatan untuk hari ini" title="Tutup hari ini"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>`;
  banner.querySelector('[data-ai-open]').onclick=()=>setPage('ai');
  banner.querySelector('[data-ai-dismiss]').onclick=()=>{ try {localStorage.setItem(`ai-alert-closed:${state.me.id}`,aiDayKey());}catch{} banner.remove(); };
}
function handleAiAlert(event) {
  refreshAiAlerts().catch(()=>{});
  loadNumbers().catch(()=>{});
  if (currentPage==='ai' && aiNumberId===event.numberId) refreshAiUsage(event.numberId).catch(()=>{});
}
async function refreshAiUsage(id) {
  const usage=await call('GET',`/numbers/${id}/ai/usage`);
  if (currentPage!=='ai' || id!==aiNumberId || !$('#aiUsage')) return;
  $('#aiUsage').className='ai-usage '+aiColor(usage.pct,usage.warn_percent);
  $('#aiUsageText').textContent=`${usage.tokens.toLocaleString('id-ID')} / ${usage.budget.toLocaleString('id-ID')} token`;
  $('#aiResumeAction').hidden=!usage.can_resume;
  $('#aiUsageBar').value=Math.min(100,usage.pct);
  $('#aiUsageBar').setAttribute('aria-valuetext',`${Math.round(usage.pct)} persen`);
  $('#aiUsageReplies').textContent=`${usage.replies} balasan tercatat hari ini · reset harian WIB`;
  if ($('#aiContextTokens')) $('#aiContextTokens').textContent=`Konteks bisnis (prompt + profil + produk) ≈ ${(usage.context_tokens||0).toLocaleString('id-ID')} token per balasan, sudah termasuk dalam pemakaian di atas.`;
}

pages.ai={title:'Otomasi AI',render:async root=>{
  const version=pageVersion;
  const numbers=await call('GET','/numbers');
  if (version!==pageVersion) return;
  root.innerHTML=`<section class="ai-page"><article class="card ai-intro"><div><h2>Asisten pelanggan AI</h2><p>Atur balasan otomatis, katalog produk, dan pesanan per nomor WhatsApp.</p></div><label>Nomor WhatsApp<select id="aiNumber"><option value="">Pilih nomor</option>${numbers.map(n=>`<option value="${n.id}">${esc(n.name)} · ${esc(n.phone)}</option>`).join('')}</select></label></article><div id="aiContent" class="empty">Pilih nomor untuk mengatur AI.</div></section>`;
  const preferred=[aiNumberId,state.numberId,numbers[0]?.id].find(id=>numbers.some(n=>n.id===id));
  $('#aiNumber').onchange=()=>loadAiNumber(Number($('#aiNumber').value)).catch(err=>toast(err.message));
  if (preferred) { $('#aiNumber').value=preferred; await loadAiNumber(preferred); }
}};
$('#railAi').onclick=()=>{ $('#panel').classList.add('hidden'); setPage('ai'); };

async function loadAiNumber(id) {
  aiNumberId=id || null;
  const generation=++aiLoadVersion;
  const root=$('#aiContent');
  if (!id) { root.className='empty'; root.textContent='Pilih nomor untuk mengatur AI.'; return; }
  root.className=''; root.innerHTML=skeleton('ai','Pengaturan otomasi AI');
  const base=`/numbers/${id}`;
  let result;
  try {
    result=await Promise.all([call('GET',base+'/ai'),call('GET',base+'/ai/logs'),call('GET',base+'/products'),call('GET',`/orders?number_id=${id}`)]);
  } catch (err) {
    if (currentPage==='ai' && generation===aiLoadVersion && root.isConnected) {
      root.className='empty';
      root.textContent='Gagal memuat pengaturan otomasi AI.';
      toast(err.message);
    }
    return;
  }
  const [s,logs,products,orders]=result;
  if (currentPage!=='ai' || generation!==aiLoadVersion) return;
  const numeric=(key,label,max='')=>`<label>${label}<input name="${key}" type="number" min="1" ${max ? `max="${max}"` : ''} step="1" value="${s[key]}" required /></label>`;
  root.innerHTML=`<div class="ai-grid"><form id="aiSettingsForm" class="card ai-settings"><div class="ai-section-heading"><h3>Pengaturan balasan</h3><label class="ai-toggle"><input name="enabled" type="checkbox" ${s.enabled ? 'checked' : ''} /> Aktifkan AI</label></div>
    <label>Prompt sistem<textarea name="system_prompt" rows="4" placeholder="Kamu asisten CS yang ramah dan singkat.">${esc(s.system_prompt)}</textarea></label>
    <fieldset class="ai-profile"><legend>Profil bisnis</legend><p>Ceritakan bisnis Anda secara detail. AI memakai informasi ini untuk menjawab pelanggan.</p>
    <details class="ai-draft"><summary>Isi dengan AI dari cerita bebas</summary><label>Cerita bisnis<textarea id="aiProfileRaw" rows="4" maxlength="8000" placeholder="Tempel atau ketik bebas: tentang bisnis, jam buka, produk, aturan pembayaran/pengiriman, dll. Bisa juga lampirkan foto brosur, menu, atau PDF."></textarea></label>${aiAttachHtml('aiProfile')}<button type="button" id="aiProfileDraft" class="primary ai-draft-go"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8Z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8Z"/></svg><span>Rapikan dengan AI</span></button><small>AI hanya mengisi kolom di bawah. Periksa lalu klik Simpan pengaturan. Token dihitung ke pemakaian.</small><p id="aiProfileDraftResult" role="status"></p></details>
    ${aiProfileFields.map(([key,label,max,rows,ph])=>`<label>${label}<textarea name="bp_${key}" rows="${rows}" maxlength="${max}" placeholder="${esc(ph)}">${esc(s.business_profile?.[key]||'')}</textarea></label>`).join('')}
    <small id="aiProfileEstimate"></small></fieldset>
    <div class="ai-fields">${numeric('max_per_hour','Batas balasan per chat per jam')}${numeric('min_gap_sec','Jeda balasan (detik)')}${numeric('daily_tokens','Anggaran token harian')}${numeric('warn_percent','Peringatan pada (%)',100)}${numeric('ai_paused_minutes','Jeda AI setelah agen membalas (menit)')}</div>
    <small>Batas balasan berlaku per chat dalam 60 menit terakhir.</small>
    <label>Balasan saat AI berhenti<textarea name="stop_reply" rows="2" placeholder="Kosongkan untuk eskalasi tanpa balasan">${esc(s.stop_reply)}</textarea></label>
    <label>Kata kunci eskalasi<input name="escalate_keywords" value="${esc(s.escalate_keywords)}" placeholder="agen, manusia, komplain" /><small>Pisahkan dengan koma.</small></label>
    <button class="primary save-action" type="submit">${aiSaveIcon}<span>Simpan pengaturan</span></button><p id="aiSettingsResult" role="status"></p></form>
    <div class="ai-side"><article id="aiUsage" class="card ai-usage healthy"><h3>Pemakaian hari ini</h3><strong id="aiUsageText">Memuat pemakaian…</strong><progress id="aiUsageBar" max="100" value="0" aria-label="Persentase pemakaian token"></progress><small id="aiUsageReplies"></small><small id="aiContextTokens"></small><div id="aiResumeAction" hidden><button type="button" id="aiResume" class="ghost"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 10 7-10 7Z"/></svg>Lanjutkan AI hari ini</button><small>Menaikkan anggaran agar AI bisa melanjutkan balasan hari ini.</small></div></article>
    <form id="aiTestForm" class="card ai-test"><h3>Konsol uji</h3><p>Uji model tanpa mengirim pesan WhatsApp atau membuat pesanan. Token uji tetap dihitung.</p><label>Pesan uji<textarea id="aiTestText" rows="3" maxlength="8000" required placeholder="Contoh: Ada produk kopi?"></textarea></label><button type="submit" class="primary"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 10 7-10 7Z"/></svg>Uji jawaban</button><output id="aiTestResult" aria-live="polite"></output></form></div></div>
    <article class="card ai-products"><div class="ai-section-heading"><h3>Produk</h3><span>${products.length} produk</span></div><table><thead><tr><th>SKU</th><th>Nama</th><th>Harga</th><th>Stok</th><th>Status</th><th>Aksi</th></tr></thead><tbody>${products.map(p=>`<tr><td>${esc(p.sku)}</td><td>${esc(p.name)}</td><td>${p.price.toLocaleString('id-ID')}</td><td>${p.stock}</td><td>${p.active ? 'Aktif' : 'Nonaktif'}</td><td><button type="button" data-product-edit="${p.id}" aria-label="Ubah produk"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14Z"/></svg></button><button type="button" class="ghost danger" data-product-delete="${p.id}" aria-label="Hapus produk">${trashIcon}</button></td></tr>`).join('') || '<tr><td colspan="6">Belum ada produk.</td></tr>'}</tbody></table>
    <details class="ai-draft ai-product-draft"><summary>Tambah produk dengan AI</summary><label>Daftar produk bebas<textarea id="aiProductRaw" rows="4" maxlength="8000" placeholder="Contoh: Kopi susu 18rb stok 20, Americano 15rb, Croissant coklat 22.000 atau lampirkan foto menu/price list"></textarea></label>${aiAttachHtml('aiProduct')}<button type="button" id="aiProductDraft" class="primary ai-draft-go"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8Z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8Z"/></svg><span>Buat draf dengan AI</span></button><div id="aiProductDrafts"></div><p id="aiProductDraftResult" role="status"></p></details>
    <form id="aiProductForm" class="ai-product-form"><h4 id="aiProductTitle">Tambah produk</h4><div class="ai-fields"><label>SKU<input name="sku" maxlength="80" required /></label><label>Nama produk<input name="name" maxlength="200" required /></label><label>Harga (IDR)<input name="price" type="number" min="0.01" step="0.01" required /></label><label>Stok<input name="stock" type="number" min="0" step="1" value="0" required /></label></div><label>Deskripsi<textarea name="description" rows="2"></textarea></label><label class="ai-toggle"><input name="active" type="checkbox" checked /> Produk aktif</label><div class="ai-actions"><button class="primary save-action" type="submit">${aiSaveIcon}Simpan produk</button><button type="button" id="aiProductCancel" class="ghost" hidden>Batal edit</button></div><p id="aiProductResult" role="status"></p></form></article>
    <article class="card ai-orders"><h3>Pesanan</h3><table><thead><tr><th>Kode</th><th>Waktu</th><th>Produk</th><th>Total</th><th>Status</th></tr></thead><tbody>${orders.map(o=>`<tr><td>${esc(o.code)}</td><td>${esc(new Date(o.created_at).toLocaleString('id-ID'))}</td><td>${esc(o.items_json)}</td><td>${o.total.toLocaleString('id-ID')}</td><td><select data-order-status="${o.id}" aria-label="Status pesanan ${esc(o.code)}">${['new','processing','completed','cancelled'].map(status=>`<option value="${status}" ${o.status===status ? 'selected' : ''}>${({new:'Baru',processing:'Diproses',completed:'Selesai',cancelled:'Dibatalkan'})[status]}</option>`).join('')}</select></td></tr>`).join('') || '<tr><td colspan="5">Belum ada pesanan.</td></tr>'}</tbody></table></article>
    <article class="card ai-logs"><h3>50 log terakhir</h3><table><thead><tr><th>Waktu</th><th>Prompt</th><th>Jawaban</th><th>Token</th><th>Error</th></tr></thead><tbody>${logs.map(l=>`<tr><td>${esc(new Date(l.at).toLocaleString('id-ID'))}</td><td>${esc((l.prompt || '').slice(0,160))}</td><td>${esc((l.reply || '').slice(0,300))}</td><td>${l.tokens}</td><td>${esc(l.error || 'Tidak ada')}</td></tr>`).join('') || '<tr><td colspan="5">Belum ada log.</td></tr>'}</tbody></table></article>`;
  $('#aiSettingsForm').onsubmit=async event=>{
    event.preventDefault(); const form=event.target,button=form.querySelector('[type=submit]'); button.disabled=true;
    const data=Object.fromEntries(new FormData(form)); data.enabled=form.elements.enabled.checked ? 1 : 0;
    data.business_profile={}; for (const [key] of aiProfileFields) { data.business_profile[key]=data['bp_'+key]||''; delete data['bp_'+key]; }
    for (const key of ['max_per_hour','min_gap_sec','daily_tokens','warn_percent','ai_paused_minutes']) data[key]=Number(data[key]);
    try { await call('PATCH',base+'/ai',data); $('#aiSettingsResult').textContent='Pengaturan disimpan.'; await refreshAiUsage(id); }
    catch(err) { $('#aiSettingsResult').textContent=err.message; } finally {button.disabled=false;}
  };
  $('#aiResume').onclick=async()=>{
    const button=$('#aiResume'); button.disabled=true;
    try { const out=await call('POST',base+'/ai/resume',{}); $('#aiSettingsForm').elements.daily_tokens.value=out.daily_tokens; await refreshAiUsage(id); await refreshAiAlerts(); await loadNumbers(); toast('AI dilanjutkan, anggaran token diperbarui.'); }
    catch(err) {toast(err.message);} finally {button.disabled=false;}
  };
  $('#aiTestForm').onsubmit=async event=>{
    event.preventDefault(); const button=event.target.querySelector('button'); button.disabled=true;
    $('#aiTestResult').textContent='Meminta jawaban model…';
    try {const out=await call('POST',base+'/ai/test',{text:$('#aiTestText').value}); if(currentPage!=='ai' || aiNumberId!==id) return; $('#aiTestResult').textContent=`${out.reply || (out.escalated ? 'Dialihkan ke agen.' : 'Tidak ada jawaban.')}\n${out.tokens} token`; await refreshAiUsage(id);}
    catch(err) {if($('#aiTestResult')) $('#aiTestResult').textContent=err.message;} finally {button.disabled=false;}
  };
  const profileEstimate=()=>{ const form=$('#aiSettingsForm'); if(!form) return; const text=aiProfileFields.map(([k])=>form.elements['bp_'+k].value).join('\n'); $('#aiProfileEstimate').textContent=`${text.length.toLocaleString('id-ID')} / 12.000 karakter · ≈ ${aiTok(text).toLocaleString('id-ID')} token tambahan per balasan`; };
  $('#aiSettingsForm').addEventListener('input',profileEstimate); profileEstimate();
  const profileFiles=aiAttach('aiProfile'), productFiles=aiAttach('aiProduct');
  $('#aiProfileDraft').onclick=async()=>{
    const button=$('#aiProfileDraft'), out=$('#aiProfileDraftResult'), text=$('#aiProfileRaw').value;
    if (!text.trim() && !profileFiles.count()) { out.textContent='Tulis cerita bisnis atau lampirkan file/foto dulu.'; return; }
    button.disabled=true; out.textContent='AI sedang merapikan…';
    try {
      const res=await call('POST',base+'/ai/profile-draft',await profileFiles.collect(text));
      if (aiNumberId!==id) return;
      const form=$('#aiSettingsForm'); let filled=0;
      for (const [k] of aiProfileFields) if (res.profile[k]) { form.elements['bp_'+k].value=res.profile[k]; filled++; }
      profileEstimate(); out.textContent=`${filled} kolom diisi (${res.tokens} token). Periksa, lalu klik Simpan pengaturan.`; await refreshAiUsage(id);
    } catch(err) { out.textContent=err.message; } finally { button.disabled=false; }
  };
  $('#aiProductDraft').onclick=async()=>{
    const button=$('#aiProductDraft'), out=$('#aiProductDraftResult'), box=$('#aiProductDrafts'), text=$('#aiProductRaw').value;
    if (!text.trim() && !productFiles.count()) { out.textContent='Tulis daftar produk atau lampirkan file/foto dulu.'; return; }
    button.disabled=true; out.textContent='AI sedang membaca daftar…'; box.innerHTML='';
    try {
      const res=await call('POST',base+'/products/ai-draft',await productFiles.collect(text));
      if (aiNumberId!==id) return;
      await refreshAiUsage(id);
      if (!res.products.length) { out.textContent=`Tidak ada produk berharga yang terbaca (${res.tokens} token).`; return; }
      box.innerHTML=`<table><thead><tr><th></th><th>SKU</th><th>Nama</th><th>Harga</th><th>Stok</th></tr></thead><tbody>${res.products.map((p,i)=>`<tr><td><input type="checkbox" data-draft="${i}" checked aria-label="Pilih ${esc(p.name)}" /></td><td>${esc(p.sku)}</td><td>${esc(p.name)}</td><td>${p.price.toLocaleString('id-ID')}</td><td>${p.stock}</td></tr>`).join('')}</tbody></table><button type="button" id="aiProductDraftSave" class="primary save-action">${aiSaveIcon}Simpan produk terpilih</button>`;
      out.textContent=`${res.products.length} produk terbaca (${res.tokens} token). Periksa sebelum menyimpan.`;
      $('#aiProductDraftSave').onclick=async()=>{
        const picked=[...box.querySelectorAll('[data-draft]:checked')].map(c=>res.products[Number(c.dataset.draft)]);
        let ok=0; const failed=[];
        for (const p of picked) { try { await call('POST',base+'/products',p); ok++; } catch(err) { failed.push(`${p.sku}: ${err.message}`); } }
        toast(`${ok} produk disimpan${failed.length ? ', gagal: '+failed.join('; ') : ''}`);
        if (ok) await loadAiNumber(id);
      };
    } catch(err) { out.textContent=err.message; } finally { button.disabled=false; }
  };
  let editingId=null;
  const productForm=$('#aiProductForm');
  root.querySelectorAll('[data-product-edit]').forEach(button=>button.onclick=()=>{
    const p=products.find(p=>p.id===Number(button.dataset.productEdit)); editingId=p.id;
    for (const key of ['sku','name','price','stock','description']) productForm.elements[key].value=p[key];
    productForm.elements.active.checked=Boolean(p.active); $('#aiProductTitle').textContent='Ubah produk'; $('#aiProductCancel').hidden=false; productForm.scrollIntoView({block:'center'}); productForm.elements.name.focus();
  });
  $('#aiProductCancel').onclick=()=>{ editingId=null; productForm.reset(); $('#aiProductTitle').textContent='Tambah produk'; $('#aiProductCancel').hidden=true; };
  productForm.onsubmit=async event=>{
    event.preventDefault(); const button=productForm.querySelector('[type=submit]'); button.disabled=true;
    const data=Object.fromEntries(new FormData(productForm)); data.price=Number(data.price); data.stock=Number(data.stock); data.active=Number(productForm.elements.active.checked);
    try { await call(editingId ? 'PATCH' : 'POST',base+'/products'+(editingId ? '/'+editingId : ''),data); await loadAiNumber(id); }
    catch(err) {$('#aiProductResult').textContent=err.message;} finally {button.disabled=false;}
  };
  root.querySelectorAll('[data-product-delete]').forEach(button=>button.onclick=async()=>{
    if (!await confirmDelete('Hapus produk ini dari katalog AI?')) return;
    try {await call('DELETE',base+'/products/'+button.dataset.productDelete);await loadAiNumber(id);} catch(err) {toast(err.message);}
  });
  root.querySelectorAll('[data-order-status]').forEach(select=>{
    let previous=select.value;
    select.onchange=async()=>{select.disabled=true;try {await call('PATCH',`/orders/${select.dataset.orderStatus}/status`,{status:select.value});previous=select.value;toast('Status pesanan disimpan');}catch(err){select.value=previous;toast(err.message);}finally{select.disabled=false;}};
  });
  await refreshAiUsage(id); enhanceTables();
}
