import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {setup} from './phase-harness.mjs';
// Bagian C: rule auto-reply dan AI saling eksklusif, lewat handler messages.upsert asli.
const h = await setup('ai-rules');
const originalFetch = globalThis.fetch;
try {
  const guard = await import('../src/ai/guard.js');
  const notice = await import('../src/ai/notice.js');
  const limits = await import('../src/limits.js');
  const {runTurn} = await import('../src/ai/agent.js');
  const n = h.number();
  h.db.prepare("INSERT INTO ai_settings(number_id,enabled,model,min_gap_sec,max_per_hour) VALUES (?,1,'m',1,100)").run(n);
  let modelCalls = 0;
  globalThis.fetch = async () => { modelCalls++; return Response.json({choices:[{message:{role:'assistant',content:'Jawaban AI'}}],usage:{total_tokens:1}}); };
  const sent = [], handlers = new Map();
  const sock = {ev:{on:(k,fn)=>handlers.set(k,fn)},sendPresenceUpdate:async()=>{},sendMessage:async(jid,p)=>{sent.push({jid,text:p.text});return {key:{id:'out-'+sent.length}};}};
  const ctx = vm.createContext({recordHealth() {}, queueDealDetection() {},path,fs,console:{...console,error(){}},q:h.q,config:h.config,limits,aiGuard:guard,notice,runTurn,
    setTimeout:(fn)=>setTimeout(fn,0),clearTimeout,P:()=>({}),QRCode:{},makeWASocket:()=>sock,
    useMultiFileAuthState:async()=>({state:{},saveCreds(){}}),fetchLatestBaileysVersion:async()=>({version:[1,0,0]}),
    Browsers:{ubuntu:()=>[]},DisconnectReason:{loggedOut:401},testPatterns:async()=>[]});
  new vm.Script(fs.readFileSync('src/wa.js','utf8').replace(/^import[\s\S]*?;\r?$/gm,'').replace(/^export /gm,'')).runInContext(ctx);
  Object.assign(h.config,{ratePerMinute:100,warmupEnabled:false,delayMin:0,delayMax:0,businessStart:0,businessEnd:0});
  await ctx.connect(n);
  const settle = () => new Promise(r => setTimeout(r, 40));
  const incoming = async (id, jid, body) => { await handlers.get('messages.upsert')({type:'notify',messages:[{key:{id,remoteJid:jid,fromMe:false},message:{conversation:body}}]}); await settle(); };
  const sentTo = jid => sent.filter(s => s.jid === jid).map(s => s.text);

  // 4. Tanpa rule + AI aktif -> AI menjawab.
  await incoming('c4','64@s.whatsapp.net','halo');
  assert.deepEqual(sentTo('64@s.whatsapp.net'),['Jawaban AI']); assert.equal(modelCalls,1);

  h.q.insertRule.run(n,'contains','harga','Harga rule',0);
  // 1. Rule cocok + AI aktif -> tepat satu pesan (rule), tanpa panggilan model.
  await incoming('c1','61@s.whatsapp.net','berapa harga?');
  assert.deepEqual(sentTo('61@s.whatsapp.net'),['Harga rule']); assert.equal(modelCalls,1);
  // 2. Rule cocok tapi cooldown menahan -> tidak ada balasan, AI tetap tidak jalan.
  await incoming('c2','61@s.whatsapp.net','harga lagi?');
  assert.deepEqual(sentTo('61@s.whatsapp.net'),['Harga rule']); assert.equal(modelCalls,1);
  // 3. Rule tidak cocok + AI aktif -> AI menjawab.
  await incoming('c3','62@s.whatsapp.net','jam buka?');
  assert.deepEqual(sentTo('62@s.whatsapp.net'),['Jawaban AI']); assert.equal(modelCalls,2);
  console.log('PASS ai-rules: rule+AI one message no model call, rule cooldown blocks AI, no-match AI answers, no-rule AI answers; exit 0');
} finally { globalThis.fetch = originalFetch; await h.close(); }
