import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { twoTenants } from './tenant-fixture.mjs';

// Tugas 5A gerbang 2: delete semantics for deals, evidence snapshots and verifier deletion (tests 1-10).
const fixture = twoTenants();
Object.assign(process.env,{ DATA_DIR:fixture.dir,ALLOW_AUTO_MIGRATE:'1',MULTITENANT_ENABLED:'0' });
const { config } = await import('../src/config.js');
config.multitenantEnabled = true;
const { db } = await import('../src/db.js');
const { hashPassword } = await import('../src/passwords.js');
const { createHttpSurface } = await import('../src/httpSurface.js');
db.prepare('UPDATE users SET pass=?').run(hashPassword('delete-fixture-password'));
const h = createHttpSurface();
await new Promise(resolve=>h.server.listen(0,'127.0.0.1',resolve));
const base = `http://127.0.0.1:${h.server.address().port}/api`;
test.after(async()=>{ h.wss.close(); h.server.closeAllConnections(); await new Promise(r=>h.server.close(r)); db.close(); fixture.close(); });

async function request(url,{ cookie,method='GET',body }={}) {
  const r = await fetch(base+url,{ method,headers:{ 'Content-Type':'application/json',...(cookie?{cookie}:{}) },body:body===undefined?undefined:JSON.stringify(body) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status:r.status,json,text,type:r.headers.get('content-type') };
}
const login = async username => {
  const r = await fetch(base+'/login',{ method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify({ username,password:'delete-fixture-password' }) });
  assert.equal(r.status,200,username); return r.headers.get('set-cookie').split(';')[0];
};
const owner = await login('A-0');
let nextChat = 6000;
const chat = (number=10,tenant='A') => {
  const id = nextChat++;
  db.prepare('INSERT INTO chats(id,number_id,tenant_id,jid) VALUES(?,?,?,?)').run(id,number,tenant,`${id}@s.whatsapp.net`);
  return id;
};
const deal = (chatId,state='candidate',number=10,tenant='A') => Number(db.prepare(`INSERT INTO deals(tenant_id,session_id,chat_id,state,origin,reason_code,amount_due,due_at,created_at)
  VALUES(?,?,?,?,?,?,?,?,1)`).run(tenant,number,chatId,state,['dp_aktif','dp_termin','dp_hangus'].includes(state)?'dp':'direct',
  state==='rejected'?'harga_tidak_cocok':null,state==='dp_aktif'?1:null,state==='dp_aktif'?1:null).lastInsertRowid);
const event = (dealId,type,actor=null) => db.prepare("INSERT INTO deal_events(deal_id,type,payload_json,actor,at) VALUES(?,?,'{}',?,2)").run(dealId,type,actor);
const exists = id => Boolean(db.prepare('SELECT 1 FROM deals WHERE id=?').get(id));
const JSON_409 = r => { assert.equal(r.status,409,r.text); assert.match(r.type,/json/); assert.equal(typeof r.json?.error,'string'); assert.equal(r.json.code,'DEAL_DECIDED'); };

test('1. hapus chat dengan deal kandidat ber-event sla_escalated -> berhasil', async () => {
  const c = chat(); const d = deal(c); event(d,'sla_escalated'); event(d,'analytics_unanswered');
  const r = await request(`/chats/${c}`,{ cookie:owner,method:'DELETE' });
  assert.equal(r.status,200,r.text);
  assert.equal(exists(d),false);
  assert.equal(db.prepare('SELECT count(*) n FROM deal_events WHERE deal_id=?').get(d).n,0);
});

test('2. hapus chat dengan deal rejected -> 409 JSON', async () => {
  const c = chat(); const d = deal(c,'rejected'); event(d,'decision','10');
  JSON_409(await request(`/chats/${c}`,{ cookie:owner,method:'DELETE' }));
  assert.equal(exists(d),true);
});

test('3. hapus chat dengan deal verified_lunas -> 409 JSON (state saja sudah cukup)', async () => {
  const c = chat(); const d = deal(c,'verified_lunas');
  JSON_409(await request(`/chats/${c}`,{ cookie:owner,method:'DELETE' }));
  assert.equal(exists(d),true);
});

test('4. hapus nomor dengan deal belum diputuskan -> berhasil, sesi ikut dibersihkan', async () => {
  const c = chat(11); const d = deal(c,'awaiting_proof',11); event(d,'sla_escalated');
  const session = path.join(fixture.dir,'sessions','11');
  fs.mkdirSync(session,{ recursive:true }); fs.writeFileSync(path.join(session,'creds.json'),'{}');
  const r = await request('/numbers/11',{ cookie:owner,method:'DELETE' });
  assert.equal(r.status,200,r.text);
  assert.equal(Boolean(db.prepare('SELECT 1 FROM numbers WHERE id=11').get()),false);
  assert.equal(exists(d),false);
  assert.equal(fs.existsSync(session),false);
});

test('5. disconnect gagal -> baris tetap terhapus, kegagalan tercatat', async () => {
  db.prepare("INSERT INTO numbers(id,phone,name,owner_id,created_at,tenant_id) VALUES(12,'620005','A-number-5',10,0,'A')").run();
  const session = path.join(fixture.dir,'sessions','12');
  fs.mkdirSync(session,{ recursive:true }); fs.writeFileSync(path.join(session,'creds.json'),'{}');
  // Another process holding the directory as its cwd makes the cleanup fail (EPERM/EBUSY on Windows).
  const { spawn } = await import('node:child_process');
  const holder = spawn(process.execPath,['-e','setTimeout(()=>{},10000)'],{ cwd:session,stdio:'ignore' });
  await new Promise(r=>setTimeout(r,300));
  const logged = []; const original = console.error; console.error = (...a) => logged.push(a.join(' '));
  try {
    const r = await request('/numbers/12',{ cookie:owner,method:'DELETE' });
    assert.equal(r.status,200,r.text);
  } finally { console.error = original; holder.kill(); await new Promise(r=>holder.once('exit',r)); }
  assert.equal(Boolean(db.prepare('SELECT 1 FROM numbers WHERE id=12').get()),false);
  assert.ok(logged.some(line=>line.includes('[number.delete]') && line.includes('12')),logged.join('\n'));
});

test('5b. sesi yatim dibersihkan oleh job, sesi nomor aktif dipertahankan', async () => {
  const { cleanOrphanSessions } = await import('../src/wa.js');
  const sessions = path.join(fixture.dir,'sessions');
  fs.mkdirSync(path.join(sessions,'9999'),{ recursive:true });
  fs.mkdirSync(path.join(sessions,'10'),{ recursive:true });
  assert.ok(cleanOrphanSessions() >= 1);
  assert.equal(fs.existsSync(path.join(sessions,'9999')),false);
  assert.equal(fs.existsSync(path.join(sessions,'10')),true);
});

test('6. hapus nomor yang tidak ada -> 404 JSON', async () => {
  const r = await request('/numbers/987654',{ cookie:owner,method:'DELETE' });
  assert.equal(r.status,404); assert.match(r.type,/json/); assert.equal(typeof r.json?.error,'string');
});

// Every deal_events type written anywhere in src/ must be registered.
function typesInSource() {
  const found = new Set();
  for (const file of fs.readdirSync('src').filter(f=>f.endsWith('.js')).map(f=>path.join('src',f))) {
    const src = fs.readFileSync(file,'utf8');
    for (const m of src.matchAll(/appendDealEvent\([^,]+,\s*'([a-z_]+)'/g)) found.add(m[1]);
    for (const m of src.matchAll(/INSERT INTO deal_events\([^)]*\)\s*SELECT[^']*'([a-z_]+)'/g)) found.add(m[1]);
    // DP reminder notices are re-recorded as deal events via appendDealEvent(entry.deal_id,entry.kind,...).
    for (const m of src.matchAll(/notify\([^,]+,`[a-z_0-9]+:\$\{[^}]+\}`,[^,]+,'(dp_[a-z_0-9]+)'/g)) found.add(m[1]);
  }
  return found;
}

test('7. setiap tipe event terdaftar di deal_event_types; perilaku hapus per tipe', async () => {
  const registry = new Map(db.prepare('SELECT type,is_system FROM deal_event_types').all().map(r=>[r.type,r.is_system]));
  const used = typesInSource();
  assert.ok(used.size >= 15,'scanner found '+[...used]);
  const missing = [...used].filter(t=>!registry.has(t));
  assert.deepEqual(missing,[],'tipe event belum terdaftar di deal_event_types');
  assert.throws(()=>db.prepare("INSERT INTO deal_event_types(type,is_system) VALUES('decision',0)").run(),/UNIQUE|constraint/i);
  for (const [type] of registry) {
    const c = chat(); const d = deal(c); event(d,type,type==='decision'?'10':null);
    const r = await request(`/chats/${c}`,{ cookie:owner,method:'DELETE' });
    if (type==='decision') { JSON_409(r); assert.equal(exists(d),true,type); }
    else { assert.equal(r.status,200,`${type}: ${r.text}`); assert.equal(exists(d),false,type); }
  }
});

test('8. purge pesan tidak menghapus deal_evidence; message_id jadi NULL, snapshot utuh', () => {
  const c = chat(); db.prepare("UPDATE chats SET name='Budi Pelanggan' WHERE id=?").run(c);
  const d = deal(c,'proof_submitted');
  const m = Number(db.prepare("INSERT INTO messages(number_id,chat_id,tenant_id,from_me,body,kind,ts) VALUES(10,?,'A',0,'Sudah transfer ya','image',1234)").run(c).lastInsertRowid);
  db.prepare("INSERT INTO deal_evidence(deal_id,message_id,kind) VALUES(?,?,'payment_attachment')").run(d,m);
  const before = db.prepare('SELECT * FROM deal_evidence WHERE deal_id=?').get(d);
  assert.deepEqual([before.snapshot_sender_name,before.snapshot_body,before.snapshot_at],['Budi Pelanggan','Sudah transfer ya',1234]);
  db.prepare('DELETE FROM messages WHERE ts < ?').run(2000); // same statement shape as the retention job
  const after = db.prepare('SELECT * FROM deal_evidence WHERE deal_id=?').get(d);
  assert.equal(after.message_id,null);
  assert.deepEqual([after.snapshot_sender_name,after.snapshot_body,after.snapshot_at],['Budi Pelanggan','Sudah transfer ya',1234]);
});

test('9. hapus user yang pernah memverifikasi -> berhasil, actor_label tetap', async () => {
  db.prepare("INSERT INTO tenant_members(tenant_id,user_id,role,created_at) VALUES('A',11,'agent',0) ON CONFLICT DO NOTHING").run();
  const c = chat(); const d = deal(c,'verified_lunas');
  db.prepare(`INSERT INTO deal_verifications(deal_id,decision,"by",at) VALUES(?,'verified_lunas',11,5)`).run(d);
  assert.equal(db.prepare('SELECT actor_label FROM deal_verifications WHERE deal_id=?').get(d).actor_label,'A-1');
  const r = await request('/users/11',{ cookie:owner,method:'DELETE' });
  assert.equal(r.status,200,r.text);
  const row = db.prepare('SELECT "by",actor_label FROM deal_verifications WHERE deal_id=?').get(d);
  assert.deepEqual([row.by,row.actor_label],[null,'A-1']);
});

test('10. tidak ada kode yang membaca open_min/close_min', () => {
  const hits = [];
  for (const dir of ['src','public']) for (const f of fs.readdirSync(dir,{ recursive:true })) {
    const file = path.join(dir,String(f));
    if (!/\.(m?js|html)$/.test(file) || !fs.statSync(file).isFile()) continue;
    fs.readFileSync(file,'utf8').split('\n').forEach((line,i)=>{ if (/open_min|close_min/.test(line)) hits.push(`${file}:${i+1}`); });
  }
  assert.deepEqual(hits,[]);
});
