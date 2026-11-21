import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {setup} from './phase-harness.mjs';
const h = await setup('ai4');
const originalFetch = globalThis.fetch;
try {
  const {runTurn} = await import('../src/ai/agent.js');
  const aiGuard = await import('../src/ai/guard.js');
  const notice = await import('../src/ai/notice.js');
  const limits = await import('../src/limits.js');
  const n = h.number();
  const id = Number(h.q.insertChat.run(n,'62@s.whatsapp.net','AI fixture',Date.now()).lastInsertRowid);
  const chat = h.q.chatById.get(id);
  h.db.prepare('INSERT INTO ai_settings(number_id,enabled,min_gap_sec,max_per_hour) VALUES (?,1,1,100)').run(n);
  h.db.prepare('INSERT INTO products(number_id,sku,name,price,stock) VALUES (?,?,?,?,?)').run(n,'AI-SKU','Kopi',100,5);
  let calls = 0;
  globalThis.fetch = async (_url,opts) => {
    const data = JSON.parse(opts.body); calls++;
    assert.equal(data.model,h.config.aiModel); assert.ok(data.messages[0].content.includes('Kamu asisten CS'));
    if (calls === 1) return Response.json({choices:[{message:{role:'assistant',tool_calls:[{id:'call-1',type:'function',function:{name:'cari_produk',arguments:'{"q":"Kopi"}'}}]}}],usage:{total_tokens:3}});
    assert.ok(data.messages.some(m => m.role==='tool' && m.content.includes('AI-SKU')));
    return Response.json({choices:[{message:{role:'assistant',content:'Kopi tersedia.'}}],usage:{total_tokens:5}});
  };
  const out = await runTurn({numberId:n,chat,jid:chat.jid,text:'Ada kopi?'});
  assert.equal(out.reply,'Kopi tersedia.'); assert.equal(out.tokens,8); assert.equal(calls,2);
  const handlers=new Map(), sent=[];
  const sock={ev:{on:(name,fn) => handlers.set(name,fn)},sendPresenceUpdate:async()=>{},sendMessage:async(jid,payload)=>{sent.push({jid,payload});return {key:{id:'mock-'+sent.length}};}};
  const context=vm.createContext({recordHealth() {}, queueDealDetection() {},path,fs,console,q:h.q,config:h.config,limits,aiGuard,notice,runTurn,
    setTimeout:(fn)=>setTimeout(fn,0),clearTimeout,P:()=>({}),QRCode:{},
    makeWASocket:()=>sock,useMultiFileAuthState:async()=>({state:{},saveCreds(){}}),
    fetchLatestBaileysVersion:async()=>({version:[1,0,0]}),Browsers:{ubuntu:()=>[]},DisconnectReason:{loggedOut:401},
    testPatterns:async()=>[],
  });
  new vm.Script(fs.readFileSync('src/wa.js','utf8').replace(/^import[\s\S]*?;\r?$/gm,'').replace(/^export /gm,'')).runInContext(context);
  h.config.ratePerMinute=100; h.config.warmupEnabled=false; h.config.delayMin=0; h.config.delayMax=0;
  await context.connect(n);
  const adminId=h.q.userByName.get('harness-admin').id;
  await context.sendText(n,chat.jid,'Saya bantu',adminId);
  assert.ok(h.q.chatById.get(id).ai_paused_until > Date.now());
  const before=calls;
  await context.handleAiMessage({numberId:n,chat,jid:chat.jid,body:'Tes',waId:'paused'});
  assert.equal(calls,before);
  h.q.pauseAiChat.run(null,id);
  globalThis.fetch=async()=>{calls++; return new Response('',{status:500});};
  await context.handleAiMessage({numberId:n,chat,jid:chat.jid,body:'Error test',waId:'error'});
  assert.equal(h.q.chatById.get(id).state,'pending');
  // stop_reply kosong -> teks default tetap terkirim (perbaikan B).
  assert.equal(sent.length,2); assert.equal(sent[1].payload.text,'Baik, saya sambungkan ke agen kami. Mohon tunggu sebentar ya.');
  assert.ok(!sent.some(s=>s.payload.text.includes('500')));
  assert.equal(h.db.prepare('SELECT error FROM ai_logs ORDER BY id DESC LIMIT 1').get().error,'model 500');
  // Rules remain scheduled even with AI disabled and the complete upsert handler runs.
  h.db.prepare('UPDATE ai_settings SET enabled=0').run();
  h.q.insertRule.run(n,'contains','harga','Harga rule',0);
  await handlers.get('messages.upsert')({type:'notify',messages:[{key:{id:'rule-independent',remoteJid:chat.jid,fromMe:false},message:{conversation:'harga'}}]});
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.ok(h.q.messageByWaId.get(n,'rule-independent'));
  assert.ok(sent.some(s=>s.payload.text==='Harga rule'));
  console.log('PASS ai4: real tool loop, fallback, agent pause, paused skip, model error escalation, no error text, independent incoming save/rules; exit 0');
} finally { globalThis.fetch=originalFetch; await h.close(); }
