import { Router } from 'express';
import { db, q, DEFAULT_STOP_REPLY } from '../db.js';
import { config } from '../config.js';
import { requireAuth, requireAdmin, canAccessNumber } from '../auth.js';
import * as limits from '../limits.js';
import { runTurn, systemPrompt } from './agent.js';
import { parseProfile, profileError, estimateTokens, PROFILE_FIELDS } from './profile.js';
import { makeClient } from './client.js';

export const aiApi = Router();
aiApi.use(requireAuth);
function ownNumber(req,res,next) {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || !canAccessNumber(req.user,id)) return res.status(403).json({error:'tidak punya akses'});
  if (!q.numberById.get(id)) return res.status(404).json({error:'nomor tidak ada'});
  req.numberId=id; next();
}
function settings(id) {
  db.prepare('INSERT OR IGNORE INTO ai_settings(number_id, stop_reply) VALUES (?, ?)').run(id, DEFAULT_STOP_REPLY);
  return q.aiSettings.get(id);
}
function publicSettings(s) {
  // Provider/URL/kunci/model diatur operator lewat env; tidak ditampilkan ke pengguna dashboard.
  const {api_key,provider,base_url,model,business_profile,...safe}=s; return {...safe,business_profile:parseProfile(business_profile)};
}
function positive(value) { return Number.isSafeInteger(value) && value>0 && value<=1e12; }

aiApi.get('/numbers/:id/ai',ownNumber,(req,res)=>res.json(publicSettings(settings(req.numberId))));
aiApi.patch('/numbers/:id/ai',requireAdmin,ownNumber,(req,res)=>{
  const old=settings(req.numberId), patch=req.body || {};
  const fields=['enabled','business_profile','system_prompt','max_per_hour','min_gap_sec','daily_tokens','warn_percent','stop_reply','escalate_keywords','ai_paused_minutes'];
  if (Object.keys(patch).some(key=>!fields.includes(key))) return res.status(400).json({error:'pengaturan tidak dikenal'});
  const s={...old,...patch};
  if (![true,false,0,1].includes(s.enabled)) return res.status(400).json({error:'enabled tidak valid'});
  for (const key of ['max_per_hour','min_gap_sec','daily_tokens','warn_percent','ai_paused_minutes']) {
    if (!positive(s[key]) || (key==='warn_percent' && s[key]>100)) return res.status(400).json({error:`${key} tidak valid`});
  }
  for (const key of ['system_prompt','stop_reply','escalate_keywords']) {
    if (typeof s[key]!=='string' || s[key].length>16000) return res.status(400).json({error:`${key} tidak valid`});
  }
  if (patch.business_profile!==undefined) {
    const err=profileError(patch.business_profile);
    if (err) return res.status(400).json({error:err});
    s.business_profile=JSON.stringify(parseProfile(patch.business_profile));
  }
  s.enabled=Number(Boolean(s.enabled));
  db.prepare(`UPDATE ai_settings SET ${fields.map(f=>`${f} = @${f}`).join(',')} WHERE number_id=@number_id`).run({...s,number_id:req.numberId});
  res.json(publicSettings(q.aiSettings.get(req.numberId)));
});
aiApi.get('/numbers/:id/ai/usage',ownNumber,(req,res)=>{
  const s=settings(req.numberId);
  const alerts=db.prepare('SELECT level FROM ai_alerts WHERE number_id=? AND day=?').all(req.numberId,limits.aiDay()).map(a=>a.level);
  const products=q.searchProducts.all(req.numberId,'%','%').slice(0,8);
  res.json({...limits.aiUsage(req.numberId),context_tokens:estimateTokens(systemPrompt(s,products)),budget:s.daily_tokens,pct:limits.aiPercent(req.numberId,s.daily_tokens),warn_percent:s.warn_percent,alerts});
});
aiApi.get('/numbers/:id/ai/logs',ownNumber,(req,res)=>{
  res.json(db.prepare('SELECT * FROM ai_logs WHERE number_id=? ORDER BY id DESC LIMIT 50').all(req.numberId));
});
aiApi.post('/numbers/:id/ai/test',ownNumber,async(req,res)=>{
  const text=req.body?.text;
  if (typeof text!=='string' || !text.trim() || text.length>8000) return res.status(400).json({error:'teks wajib 1–8000 karakter'});
  const s=settings(req.numberId);
  try {
    const out=await runTurn({numberId:req.numberId,chat:null,jid:null,text:text.trim(),dryRun:true});
    q.aiUsageBump.run(req.numberId,limits.aiDay(),out.tokens,0);
    q.insertAiLog.run(req.numberId,null,text,out.reply || null,out.tokens,config.aiModel,null,Date.now());
    res.json(out);
  } catch(err) {
    q.insertAiLog.run(req.numberId,null,text,null,0,config.aiModel,err.message,Date.now());
    res.status(502).json({error:'Model tidak dapat menjawab. Hubungi admin Raqio bila berlanjut.'});
  }
});
aiApi.post('/numbers/:id/ai/resume',requireAdmin,ownNumber,(req,res)=>{
  const s=settings(req.numberId);
  db.transaction(()=>{
    db.prepare("DELETE FROM ai_notice WHERE number_id=? AND day=? AND kind='stop'").run(req.numberId,limits.aiDay());
    db.prepare('UPDATE ai_settings SET daily_tokens=? WHERE number_id=?').run(Math.ceil(s.daily_tokens*1.2),req.numberId);
    db.prepare("DELETE FROM ai_alerts WHERE number_id=? AND day=? AND level='stop'").run(req.numberId,limits.aiDay());
    db.prepare("UPDATE chats SET state='active',ai_paused_until=NULL WHERE number_id=? AND state='pending'").run(req.numberId);
  })();
  res.json({ok:true,daily_tokens:q.aiSettings.get(req.numberId).daily_tokens});
});
aiApi.get('/ai/alerts',(req,res)=>{
  const alerts=db.prepare('SELECT a.*,n.name FROM ai_alerts a JOIN numbers n ON n.id=a.number_id WHERE day=? ORDER BY a.id DESC').all(limits.aiDay());
  res.json(alerts.filter(a=>canAccessNumber(req.user,a.number_id)));
});

function productInput(body,old={}) {
  const p={name:'',sku:'',price:0,stock:0,description:'',active:1,...old,...body};
  if (typeof p.sku!=='string' || !p.sku.trim() || p.sku.length>80 || typeof p.name!=='string' || !p.name.trim() || p.name.length>200) throw new Error('SKU dan nama wajib');
  if (typeof p.price!=='number' || !Number.isFinite(p.price) || p.price<=0 || p.price>1e12 || !Number.isSafeInteger(p.stock) || p.stock<0) throw new Error('harga harus positif dan stok bilangan bulat ≥ 0');
  if (typeof p.description!=='string' || p.description.length>8000 || ![true,false,0,1].includes(p.active)) throw new Error('deskripsi atau status tidak valid');
  return {sku:p.sku.trim(),name:p.name.trim(),price:p.price,stock:p.stock,description:p.description,active:Number(Boolean(p.active))};
}
// Draf dengan AI: teks bebas -> JSON terstruktur. Tidak menyimpan apa pun; token dihitung ke pemakaian harian.
async function aiJson(numberId,instruction,text) {
  const out=await makeClient()([{role:'system',content:instruction},{role:'user',content:text}]);
  const tokens=Math.max(0,Math.trunc(Number(out.tokens)||0));
  q.aiUsageBump.run(numberId,limits.aiDay(),tokens,0);
  const raw=String(out.message?.content||'').replace(/^\s*```(?:json)?\s*|\s*```\s*$/g,'');
  const start=raw.search(/[\[{]/);
  try { return {data:JSON.parse(raw.slice(start)),tokens}; } catch { throw Object.assign(new Error('AI tidak mengembalikan format yang bisa dibaca, coba lagi'),{tokens}); }
}
// Input draf: teks (termasuk isi file teks/CSV yang dibaca browser) + lampiran foto/PDF sebagai data URL.
// Foto dikirim sebagai image_url, PDF sebagai part "file" (format OpenRouter); model harus mendukung keduanya.
const DRAFT_FILE_RE=/^data:(image\/(?:jpeg|png|webp|gif)|application\/pdf);base64,[A-Za-z0-9+/]+=*$/;
function draftText(req,res) {
  const text=typeof req.body?.text==='string' ? req.body.text.trim() : '';
  const files=req.body?.files ?? [];
  const fail=(error)=>{ res.status(400).json({error}); return null; };
  if (!Array.isArray(files) || files.length>5) return fail('maksimal 5 lampiran');
  if (text.length>30000) return fail('teks maksimal 30.000 karakter');
  let total=0; const parts=[];
  for (const f of files) {
    const data=typeof f?.data==='string' ? f.data : '';
    const m=data.match(DRAFT_FILE_RE);
    if (!m) return fail('lampiran harus foto (JPG/PNG/WEBP/GIF) atau PDF');
    const size=Math.floor((data.length-data.indexOf(',')-1)*3/4);
    if (size>5*1024*1024) return fail('tiap lampiran maksimal 5 MB');
    total+=size;
    const name=String(f.name||'lampiran').replace(/[^\w.\- ]/g,'').slice(0,80) || 'lampiran';
    parts.push(m[1]==='application/pdf' ? {type:'file',file:{filename:name,file_data:data}} : {type:'image_url',image_url:{url:data}});
  }
  if (total>15*1024*1024) return fail('total lampiran maksimal 15 MB');
  if (!text && !parts.length) return fail('isi teks atau lampirkan file/foto');
  if (!parts.length) return text;
  return [{type:'text',text:text || 'Baca informasi dari lampiran berikut.'},...parts];
}
aiApi.post('/numbers/:id/ai/profile-draft',requireAdmin,ownNumber,async(req,res)=>{
  const text=draftText(req,res); if (!text) return;
  const keys=PROFILE_FIELDS.map(f=>`${f.key}: ${f.label} (maks ${f.max} karakter)`).join('\n');
  try {
    const {data,tokens}=await aiJson(req.numberId,`Kamu merapikan cerita pemilik bisnis menjadi profil untuk asisten CS. Balas HANYA objek JSON dengan kunci berikut (string, kosongkan bila tidak disebut; jangan mengarang):
${keys}`,text);
    const profile=parseProfile(data);
    for (const f of PROFILE_FIELDS) profile[f.key]=profile[f.key].slice(0,f.max);
    res.json({profile,tokens});
  } catch(err) { res.status(502).json({error:err.message.startsWith('AI tidak') ? err.message : 'Model tidak dapat menjawab. Hubungi admin Raqio bila berlanjut.'}); }
});
aiApi.post('/numbers/:id/products/ai-draft',ownNumber,async(req,res)=>{
  const text=draftText(req,res); if (!text) return;
  try {
    const {data,tokens}=await aiJson(req.numberId,'Ekstrak daftar produk dari teks pemilik bisnis. Balas HANYA array JSON, tiap item: {"sku": kode singkat huruf besar tanpa spasi, "name": nama, "price": angka rupiah tanpa titik, "stock": bilangan bulat (0 bila tidak disebut), "description": deskripsi singkat}. Jangan mengarang produk atau harga; lewati item tanpa harga.',text);
    const list=Array.isArray(data) ? data : Array.isArray(data?.products) ? data.products : [];
    const products=[];
    for (const it of list.slice(0,50)) {
      const name=String(it?.name||'').trim().slice(0,200), price=Number(it?.price);
      if (!name || !Number.isFinite(price) || price<=0) continue;
      const sku=(String(it?.sku||'').toUpperCase().replace(/[^A-Z0-9-]/g,'') || name.toUpperCase().replace(/[^A-Z0-9]+/g,'-')).slice(0,40);
      const stock=Number.isSafeInteger(Number(it?.stock)) && Number(it.stock)>=0 ? Number(it.stock) : 0;
      products.push({sku,name,price,stock,description:String(it?.description||'').slice(0,8000),active:1});
    }
    res.json({products,tokens});
  } catch(err) { res.status(502).json({error:err.message.startsWith('AI tidak') ? err.message : 'Model tidak dapat menjawab. Hubungi admin Raqio bila berlanjut.'}); }
});
aiApi.get('/numbers/:id/products',ownNumber,(req,res)=>res.json(db.prepare('SELECT * FROM products WHERE number_id=? ORDER BY name').all(req.numberId)));
aiApi.post('/numbers/:id/products',ownNumber,(req,res)=>{
  try {
    const p=productInput(req.body);
    const info=db.prepare('INSERT INTO products(number_id,sku,name,price,stock,description,active) VALUES (@numberId,@sku,@name,@price,@stock,@description,@active)').run({...p,numberId:req.numberId});
    res.status(201).json({id:Number(info.lastInsertRowid),...p});
  } catch(err) { res.status(400).json({error:err.code==='SQLITE_CONSTRAINT_UNIQUE' ? 'SKU sudah digunakan' : err.message}); }
});
aiApi.patch('/numbers/:id/products/:productId',ownNumber,(req,res)=>{
  const old=db.prepare('SELECT * FROM products WHERE id=? AND number_id=?').get(Number(req.params.productId),req.numberId);
  if (!old) return res.status(404).json({error:'produk tidak ada'});
  try {
    const p=productInput(req.body,old);
    db.prepare('UPDATE products SET sku=@sku,name=@name,price=@price,stock=@stock,description=@description,active=@active WHERE id=@id AND number_id=@numberId').run({...p,id:old.id,numberId:req.numberId});
    res.json({id:old.id,...p});
  } catch(err) { res.status(400).json({error:err.code==='SQLITE_CONSTRAINT_UNIQUE' ? 'SKU sudah digunakan' : err.message}); }
});
aiApi.delete('/numbers/:id/products/:productId',ownNumber,(req,res)=>{
  const info=db.prepare('DELETE FROM products WHERE id=? AND number_id=?').run(Number(req.params.productId),req.numberId);
  if (!info.changes) return res.status(404).json({error:'produk tidak ada'});
  res.json({ok:true});
});
aiApi.get('/orders',(req,res)=>{
  const numbers=(req.user.role==='admin' ? q.allNumbers.all() : q.numbersByOwner.all(req.user.id)).filter(n=>canAccessNumber(req.user,n.id));
  const ids=numbers.map(n=>n.id);
  if (!ids.length) return res.json([]);
  const numberId=req.query.number_id ? Number(req.query.number_id) : null;
  if (numberId && !canAccessNumber(req.user,numberId)) return res.status(403).json({error:'tidak punya akses'});
  res.json(db.prepare(`SELECT * FROM orders WHERE number_id IN (${ids.map(()=>'?').join(',')}) ${numberId ? 'AND number_id=?' : ''} ORDER BY id DESC LIMIT 200`).all(...ids,...(numberId ? [numberId] : [])));
});
aiApi.patch('/orders/:id/status',(req,res)=>{
  const order=db.prepare('SELECT * FROM orders WHERE id=?').get(Number(req.params.id));
  if (!order) return res.status(404).json({error:'pesanan tidak ada'});
  if (!canAccessNumber(req.user,order.number_id)) return res.status(403).json({error:'tidak punya akses'});
  const status=req.body?.status;
  if (!['new','processing','completed','cancelled'].includes(status)) return res.status(400).json({error:'status tidak valid'});
  db.prepare('UPDATE orders SET status=? WHERE id=?').run(status,order.id);
  res.json({ok:true,status});
});
