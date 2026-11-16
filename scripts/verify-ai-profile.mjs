import assert from 'node:assert/strict';
import {setup} from './phase-harness.mjs';
// Profil bisnis: simpan/tampil, masuk prompt, estimasi token, draf AI profil & produk (token dihitung).
const h=await setup('ai-profile');
const originalFetch=globalThis.fetch;
try {
  const owner=await h.agent('prof-owner');
  const n=h.number(owner.id);
  const req=(suffix,method,body,cookie=h.admin)=>h.request(`/numbers/${n}${suffix}`,method,body,cookie);
  const profile={nama:'Kopi Senja',tentang:'Kedai kopi sejak 2020',jam:'08.00-21.00',produk:'Kopi susu 18rb',kebijakan:'Transfer BCA',faq:'COD bisa',gaya:'Panggil Kak'};
  assert.equal((await req('/ai','PATCH',{business_profile:{...profile,lain:'x'}})).status,400);
  assert.equal((await req('/ai','PATCH',{business_profile:{nama:'x'.repeat(121)}})).status,400);
  assert.equal((await req('/ai','PATCH',{business_profile:profile})).status,200);
  assert.deepEqual((await (await req('/ai','GET',undefined,owner.cookie)).json()).business_profile,profile);
  // Prompt sistem memuat profil.
  const {systemPrompt}=await import('../src/ai/agent.js');
  const prompt=systemPrompt(h.q.aiSettings.get(n),[]);
  for (const v of Object.values(profile)) assert.ok(prompt.includes(v),v);
  const usage=await (await req('/ai/usage','GET',undefined,owner.cookie)).json();
  assert.ok(usage.context_tokens>=Math.ceil(prompt.length/4)-1 && usage.context_tokens>20,String(usage.context_tokens));
  // Draf profil dengan AI: admin saja, isi kolom, token dihitung.
  let reply='';
  globalThis.fetch=async(url,opts)=>String(url).includes('/chat/completions')
    ? Response.json({choices:[{message:{role:'assistant',content:reply}}],usage:{total_tokens:40}}) : originalFetch(url,opts);
  reply='```json\n{"nama":"Roti Pagi","jam":"06.00-12.00","ngawur":"x"}\n```';
  assert.equal((await req('/ai/profile-draft','POST',{text:'roti'},owner.cookie)).status,403);
  const pd=await (await req('/ai/profile-draft','POST',{text:'kami jual roti pagi jam 6-12'})).json();
  assert.equal(pd.profile.nama,'Roti Pagi'); assert.equal(pd.profile.jam,'06.00-12.00'); assert.equal(pd.profile.ngawur,undefined); assert.equal(pd.tokens,40);
  assert.equal((await (await req('/ai','GET')).json()).business_profile.nama,'Kopi Senja','draf tidak menyimpan');
  // Draf produk: pemilik boleh, item tanpa harga dibuang, tidak tersimpan.
  reply='[{"sku":"ks 1","name":"Kopi Susu","price":18000,"stock":20},{"name":"Americano","price":"15000"},{"name":"Tanpa harga"}]';
  const dr=await (await req('/products/ai-draft','POST',{text:'kopi susu 18rb stok 20, americano 15rb'},owner.cookie)).json();
  assert.deepEqual(dr.products.map(p=>[p.sku,p.name,p.price,p.stock]),[['KS1','Kopi Susu',18000,20],['AMERICANO','Americano',15000,0]]);
  assert.equal(h.db.prepare('SELECT count(*) n FROM products').get().n,0);
  reply='bukan json';
  assert.equal((await req('/products/ai-draft','POST',{text:'x'},owner.cookie)).status,502);
  assert.equal((await req('/products/ai-draft','POST',{text:''},owner.cookie)).status,400);
  const used=await (await req('/ai/usage','GET')).json();
  assert.equal(used.tokens,120); assert.equal(used.replies,0);
  // Lampiran: foto -> image_url, PDF -> file, format lain / terlalu banyak ditolak, foto saja tanpa teks boleh.
  let sent=null;
  globalThis.fetch=async(url,opts)=>{ if(String(url).includes('/chat/completions')){ sent=JSON.parse(opts.body); return Response.json({choices:[{message:{role:'assistant',content:'[{"name":"Teh","price":5000}]'}}],usage:{total_tokens:9}}); } return originalFetch(url,opts); };
  const png='data:image/png;base64,iVBORw0KGgo=', pdf='data:application/pdf;base64,JVBERi0=';
  const withFiles=await req('/products/ai-draft','POST',{text:'',files:[{name:'menu.png',data:png},{name:'harga.pdf',data:pdf}]},owner.cookie);
  assert.equal(withFiles.status,200); assert.equal((await withFiles.json()).products[0].name,'Teh');
  const content=sent.messages[1].content;
  assert.deepEqual(content.map(p=>p.type),['text','image_url','file']);
  assert.equal(content[1].image_url.url,png); assert.deepEqual(content[2].file,{filename:'harga.pdf',file_data:pdf});
  assert.equal((await req('/products/ai-draft','POST',{text:'x',files:[{name:'a.exe',data:'data:application/x-msdownload;base64,AAAA'}]},owner.cookie)).status,400);
  assert.equal((await req('/products/ai-draft','POST',{text:'x',files:Array(6).fill({name:'a.png',data:png})},owner.cookie)).status,400);
  assert.equal((await req('/products/ai-draft','POST',{text:'',files:[]},owner.cookie)).status,400);
  // Teks saja tetap dikirim sebagai string biasa.
  await req('/products/ai-draft','POST',{text:'teh 5rb'},owner.cookie); assert.equal(typeof sent.messages[1].content,'string');
  console.log('PASS ai-profile attachments: image_url + file parts, image-only allowed, bad type/too many/empty 400; exit 0');
  console.log('PASS ai-profile: validation, save/read, prompt includes profile, context_tokens, profile draft admin-only no-save, product draft filtered no-save, bad JSON 502, tokens counted; exit 0');
} finally { globalThis.fetch=originalFetch; await h.close(); }
