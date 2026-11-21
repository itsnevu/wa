import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {setup} from './phase-harness.mjs';
const h = await setup('ai3');
try {
  const guard = await import('../src/ai/guard.js');
  const notice = await import('../src/ai/notice.js');
  const limits = await import('../src/limits.js');
  const n = h.number();
  const id = Number(h.q.insertChat.run(n,'62@s.whatsapp.net','Fixture',Date.now()).lastInsertRowid);
  const chat = h.q.chatById.get(id);
  const input = {numberId:n,chat,jid:chat.jid,body:'halo',waId:'guard-fixture'};
  const reason = (expected,extra={}) => assert.equal(guard.check({...input,...extra}).reason,expected);
  reason('self',{fromMe:true,jid:'group@g.us'}); reason('group',{jid:'group@g.us'}); reason('off');
  h.db.prepare("INSERT INTO ai_settings(number_id,enabled,stop_reply,escalate_keywords) VALUES (?,1,'Menunggu agen','manusia')").run(n);
  reason('paused',{chat:{...chat,ai_paused_until:Date.now()+10000}});
  h.q.aiSeenPut.run(input.waId,Date.now()); reason('dup'); h.db.prepare('DELETE FROM ai_seen').run();
  const hour = new Date().getHours(); h.config.businessStart=(hour+1)%24; h.config.businessEnd=(hour+2)%24;
  reason('hours',{body:'manusia'}); h.config.businessStart=0; h.config.businessEnd=0;
  reason('keyword',{body:'Mau MANUSIA'});
  limits.bumpAi(n,200000); reason('budget');
  h.db.prepare('UPDATE ai_usage SET tokens=0').run();
  // Rate = jendela 60 menit per chat dari ai_logs, bukan hitungan harian.
  h.db.prepare('UPDATE ai_usage SET replies=500').run(); reason('ok');
  const at30 = Date.now() - 30*60000;
  for (let i=0;i<6;i++) h.q.insertAiLog.run(n,id,'p','r',1,'mock',null,at30);
  reason('rate');
  h.db.prepare('UPDATE ai_logs SET at=?').run(Date.now() - 61*60000); reason('ok');
  h.db.prepare('DELETE FROM ai_logs').run();
  // State: pending -> skip, open/active -> lanjut.
  reason('state',{chat:{...chat,state:'pending'}}); reason('ok',{chat:{...chat,state:'open'}}); reason('ok',{chat:{...chat,state:'active'}});
  h.q.insertAiLog.run(n,id,'prompt','reply',1,'mock',null,Date.now()); reason('gap');
  h.db.prepare('DELETE FROM ai_logs').run(); reason('ok');
  const events=[]; globalThis.__broadcast = e => events.push(e);
  const s = h.q.aiSettings.get(n);
  assert.deepEqual([1,2,3].map(() => notice.stopNotice(n,chat,s)),['Menunggu agen',null,null]);
  assert.equal(h.q.chatById.get(id).state,'pending');
  notice.warnOnce(n,'warn'); notice.warnOnce(n,'warn');
  assert.equal(events.filter(e => e.type==='ai.alert').length,1);
  assert.equal(h.db.prepare('SELECT count(*) n FROM ai_notice').get().n,1);
  assert.equal(limits.aiPercent(n,200000),0);
  // stop_reply kosong -> fallback teks default pada objek s dari guard.
  h.db.prepare("UPDATE ai_settings SET stop_reply=''").run();
  h.db.prepare("UPDATE chats SET state='active'").run();
  assert.equal(guard.check({...input,chat:h.q.chatById.get(id),body:'manusia'}).s.stop_reply,'Baik, saya sambungkan ke agen kami. Mohon tunggu sebentar ya.');

  // Jalur wa.js nyata (socket mock): eskalasi tanpa reply mengirim satu pesan penyerahan.
  const {runTurn} = await import('../src/ai/agent.js');
  const sent=[]; const handlers=new Map();
  const sock={ev:{on:(k,fn)=>handlers.set(k,fn)},sendPresenceUpdate:async()=>{},sendMessage:async(jid,payload)=>{sent.push(payload);return {key:{id:'m'+sent.length}};}};
  const ctx=vm.createContext({recordHealth() {}, queueDealDetection() {},path,fs,console,q:h.q,config:h.config,limits,aiGuard:guard,notice,runTurn,
    setTimeout:(fn)=>setTimeout(fn,0),clearTimeout,P:()=>({}),QRCode:{},makeWASocket:()=>sock,
    useMultiFileAuthState:async()=>({state:{},saveCreds(){}}),fetchLatestBaileysVersion:async()=>({version:[1,0,0]}),
    Browsers:{ubuntu:()=>[]},DisconnectReason:{loggedOut:401},testPatterns:async()=>[]});
  new vm.Script(fs.readFileSync('src/wa.js','utf8').replace(/^import[\s\S]*?;\r?$/gm,'').replace(/^export /gm,'')).runInContext(ctx);
  Object.assign(h.config,{ratePerMinute:100,warmupEnabled:false,delayMin:0,delayMax:0});
  await ctx.connect(n);
  const id2=Number(h.q.insertChat.run(n,'63@s.whatsapp.net','Esk',Date.now()).lastInsertRowid);
  h.db.prepare("UPDATE ai_settings SET model='m',escalate_keywords='',min_gap_sec=1").run();
  const realFetch=globalThis.fetch;
  globalThis.fetch=async()=>Response.json({choices:[{message:{role:'assistant',tool_calls:[{id:'c1',type:'function',function:{name:'eskalasi',arguments:'{"alasan":"minta manusia"}'}}]}}],usage:{total_tokens:2}});
  try { await ctx.handleAiMessage({numberId:n,chat:h.q.chatById.get(id2),jid:'63@s.whatsapp.net',body:'mau orang',waId:'esk-1'}); }
  finally { globalThis.fetch=realFetch; }
  assert.deepEqual(sent.map(p=>p.text),['Baik, saya sambungkan ke agen kami. Mohon tunggu sebentar ya.']);
  assert.equal(h.q.chatById.get(id2).state,'pending');
  // Pesan berikutnya setelah eskalasi tidak dibalas AI.
  assert.equal(guard.check({...input,chat:h.q.chatById.get(id2),waId:'esk-2'}).reason,'state');

  // Assign ke agen mengisi ai_paused_until.
  h.db.prepare('UPDATE ai_settings SET ai_paused_minutes=45').run();
  const adminId=h.q.userByName.get('harness-admin').id;
  const t0=Date.now();
  const r=await h.request('/chats/'+id+'/assign','PATCH',{user_id:adminId},h.admin); assert.equal(r.status,200);
  const until=h.q.chatById.get(id).ai_paused_until; assert.ok(until>=t0+45*60000 && until<=Date.now()+45*60000+1000);
  console.log('PASS ai3b: state skip, 60-min rate window, default stop_reply, escalation sends one handoff, assign pauses AI; exit 0');
  console.log('PASS ai3: 11 ordered guard reasons, stop x3 returns one reply, warn x2 emits one alert; exit 0');
} finally { delete globalThis.__broadcast; await h.close(); }
