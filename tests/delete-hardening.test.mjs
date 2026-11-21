import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import express from 'express';
import { twoTenants } from './tenant-fixture.mjs';

// Tugas 5B G2: tenant-scoped deletes, delete audit, retention vs evidence, orphan-session job, error handler.
const fixture = twoTenants();
Object.assign(process.env,{ DATA_DIR:fixture.dir,ALLOW_AUTO_MIGRATE:'1',MULTITENANT_ENABLED:'0' });
const { config } = await import('../src/config.js');
config.multitenantEnabled = true;
const { db } = await import('../src/db.js');
const { hashPassword } = await import('../src/passwords.js');
const { createHttpSurface } = await import('../src/httpSurface.js');
const { apiErrorHandler,describeError,requestId } = await import('../src/apiErrors.js');
const wa = await import('../src/wa.js');
db.prepare('UPDATE users SET pass=?').run(hashPassword('g2-fixture-password'));
const h = createHttpSurface();
await new Promise(resolve=>h.server.listen(0,'127.0.0.1',resolve));
const base = `http://127.0.0.1:${h.server.address().port}/api`;
test.after(async()=>{ h.wss.close(); h.server.closeAllConnections(); await new Promise(r=>h.server.close(r)); db.close(); fixture.close(); });

async function request(url,{ cookie,method='GET',body,raw,headers={} }={}) {
  const r = await fetch(base+url,{ method,headers:{ 'Content-Type':'application/json',...headers,...(cookie?{cookie}:{}) },
    body:raw ?? (body===undefined?undefined:JSON.stringify(body)) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status:r.status,json,text,headers:r.headers };
}
const login = async username => {
  const r = await fetch(base+'/login',{ method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify({ username,password:'g2-fixture-password' }) });
  assert.equal(r.status,200,username); return r.headers.get('set-cookie').split(';')[0];
};
const ownerA = await login('A-0'), ownerB = await login('B-0');
const exists = (table,id) => Boolean(db.prepare(`SELECT 1 FROM ${table} WHERE id=?`).get(id));
const audits = action => db.prepare('SELECT * FROM platform_audit WHERE action=? ORDER BY id').all(action);
const noLeak = r => { assert.doesNotMatch(r.text,/SqliteError|SQLITE_|at .*\.js:\d+|SELECT |INSERT |DELETE FROM/); };

test('2.1 hapus lintas tenant -> 404; data dan sesi tenant asli utuh', async () => {
  const session = path.join(fixture.dir,'sessions','10');
  fs.mkdirSync(session,{ recursive:true }); fs.writeFileSync(path.join(session,'creds.json'),'{}');
  const before = db.prepare("SELECT count(*) n FROM messages WHERE tenant_id='A'").get().n;
  for (const url of ['/chats/10','/numbers/10','/users/11']) {
    const r = await request(url,{ cookie:ownerB,method:'DELETE' });
    assert.equal(r.status,404,url+' '+r.text); assert.match(r.headers.get('content-type'),/json/);
  }
  assert.ok(exists('chats',10) && exists('numbers',10) && exists('users',11));
  assert.equal(db.prepare("SELECT count(*) n FROM messages WHERE tenant_id='A'").get().n,before);
  assert.ok(fs.existsSync(path.join(session,'creds.json')),'session of tenant A untouched');
  assert.equal(audits('chat_deleted').length + audits('number_deleted').length + audits('user_deleted').length,0);
  fs.rmSync(session,{ recursive:true,force:true }); // later tests call restoreAll; no credentials may exist
});

test('2.1 pengguna yang juga anggota tenant lain tidak dihapus dari satu workspace', async () => {
  db.prepare("INSERT INTO tenant_members(tenant_id,user_id,role,created_at) VALUES('B',11,'agent',0)").run();
  const r = await request('/users/11',{ cookie:ownerA,method:'DELETE' });
  assert.equal(r.status,409); assert.equal(r.json.code,'USER_IN_OTHER_TENANT'); assert.ok(r.json.request_id);
  assert.ok(exists('users',11));
  db.prepare("DELETE FROM tenant_members WHERE tenant_id='B' AND user_id=11").run();
});

test('2.2 audit log untuk hapus chat, nomor, dan pengguna (aktor, entitas, ringkasan, alasan, append-only)', async () => {
  db.prepare("INSERT INTO messages(number_id,chat_id,tenant_id,body,ts) VALUES(11,11,'A','halo',1),(11,11,'A','lagi',2)").run();
  let r = await request('/chats/11',{ cookie:ownerA,method:'DELETE',body:{ reason:'Pelanggan minta data dihapus' } });
  assert.equal(r.status,200,r.text);
  const [chat] = audits('chat_deleted');
  assert.deepEqual([chat.actor_user_id,chat.tenant_id,chat.target_type,chat.target_id,chat.reason],[10,'A','chat','11','Pelanggan minta data dihapus']);
  assert.deepEqual(JSON.parse(chat.before_json),{ number_id:11,messages:3,deals:0 });

  r = await request('/numbers/11',{ cookie:ownerA,method:'DELETE' });
  assert.equal(r.status,200,r.text);
  const [number] = audits('number_deleted');
  assert.deepEqual([number.tenant_id,number.target_type,number.target_id,number.reason],['A','number','11','number_deleted']);
  assert.deepEqual(JSON.parse(number.before_json),{ name:'A-number-1',phone:'620001',chats:0,messages:0,deals:0 });

  db.prepare("INSERT INTO users(id,username,pass,role,created_at) VALUES(15,'A-temp','x','agent',0)").run();
  db.prepare("INSERT INTO tenant_members(tenant_id,user_id,role,created_at) VALUES('A',15,'agent',0)").run();
  r = await request('/users/15',{ cookie:ownerA,method:'DELETE',body:{ reason:'Resign' } });
  assert.equal(r.status,200,r.text);
  const [user] = audits('user_deleted');
  assert.deepEqual(JSON.parse(user.before_json),{ username:'A-temp',role:'agent',verifications:0 });
  assert.equal(user.reason,'Resign');

  assert.equal((await request('/chats/10',{ cookie:ownerA,method:'DELETE',body:{ reason:'x'.repeat(501) } })).status,400);
  assert.ok(exists('chats',10),'invalid reason deletes nothing');
  assert.throws(()=>db.prepare('UPDATE platform_audit SET reason=? WHERE id=?').run('ubah',chat.id),/append-only/);
  assert.throws(()=>db.prepare('DELETE FROM platform_audit WHERE id=?').run(chat.id),/append-only/);
  const owner = await request('/tenant/audit',{ cookie:ownerA });
  assert.equal(owner.status,200);
  assert.ok(['chat_deleted','number_deleted','user_deleted'].every(a=>JSON.stringify(owner.json).includes(a)),'owner sees delete audit');
});

test('2.2 hapus yang ditolak database tidak meninggalkan audit', async () => {
  db.prepare("INSERT INTO chats(id,number_id,tenant_id,jid) VALUES(7700,10,'A','7700@s.whatsapp.net')").run();
  db.prepare("INSERT INTO deals(tenant_id,session_id,chat_id,state,created_at) VALUES('A',10,7700,'verified_lunas',1)").run();
  const before = audits('chat_deleted').length;
  const r = await request('/chats/7700',{ cookie:ownerA,method:'DELETE' });
  assert.equal(r.status,409); assert.equal(r.json.code,'DEAL_DECIDED'); assert.ok(r.json.request_id); noLeak(r);
  assert.equal(audits('chat_deleted').length,before,'audit rolled back with the refused delete');
});

test('2.3 job retensi sungguhan: pesan lama terhapus, deal_evidence bertahan, message_id NULL, snapshot utuh', () => {
  db.prepare("INSERT INTO chats(id,number_id,tenant_id,jid,name) VALUES(7800,10,'A','7800@s.whatsapp.net','Rina')").run();
  const deal = Number(db.prepare("INSERT INTO deals(tenant_id,session_id,chat_id,state,created_at) VALUES('A',10,7800,'proof_submitted',1)").run().lastInsertRowid);
  const now = Date.UTC(2026,10,1);
  const old = Number(db.prepare("INSERT INTO messages(number_id,chat_id,tenant_id,body,kind,ts) VALUES(10,7800,'A','Bukti TF','image',?)").run(now-40*86400000).lastInsertRowid);
  const fresh = Number(db.prepare("INSERT INTO messages(number_id,chat_id,tenant_id,body,ts) VALUES(10,7800,'A','baru',?)").run(now-86400000).lastInsertRowid);
  db.prepare("INSERT INTO deal_evidence(deal_id,message_id,kind) VALUES(?,?,'payment_attachment')").run(deal,old);
  // Run the retention interval body exactly as written in src/index.js.
  const block = fs.readFileSync('src/index.js','utf8').match(/setInterval\(\(\) => \{[^]*?6 \* 3600000\)\.unref\(\);/);
  assert.ok(block,'retention job present in src/index.js');
  let callback; const logs = [];
  class FixedDate extends Date { static now() { return now; } }
  vm.runInContext(block[0],vm.createContext({ db,config,Date:FixedDate,console:{ log:(...a)=>logs.push(a.join(' ')),error:(...a)=>{ throw Error(a.join(' ')); } },
    setInterval(fn){ callback=fn; return { unref(){} }; } }));
  const prior = config.retentionDays; config.retentionDays = 30;
  try { callback(); } finally { config.retentionDays = prior; }
  assert.equal(exists('messages',old),false); assert.equal(exists('messages',fresh),true);
  const ev = db.prepare('SELECT * FROM deal_evidence WHERE deal_id=?').get(deal);
  assert.deepEqual([ev.message_id,ev.snapshot_sender_name,ev.snapshot_body,ev.snapshot_at],[null,'Rina','Bukti TF',now-40*86400000]);
  assert.ok(logs.some(l=>l.includes('[retensi]')));
});

test('2.4 job sesi yatim: menunggu restoreAll, bandingkan dengan database (bukan mtime), lewati nomor pairing', async () => {
  const sessions = path.join(fixture.dir,'sessions');
  const dir = id => path.join(sessions,String(id));
  for (const id of [10,9100,9200]) fs.mkdirSync(dir(id),{ recursive:true });
  const ancient = new Date('2020-01-01'); fs.utimesSync(dir(10),ancient,ancient); // old mtime, but the number exists
  db.prepare("INSERT INTO numbers(id,phone,name,status,owner_id,created_at,tenant_id) VALUES(9200,'629200','Sedang pairing','pairing',10,0,'A')").run();
  // 1. Before restoreAll has finished, nothing is removed.
  assert.equal(wa.cleanOrphanSessions(),0);
  assert.ok(fs.existsSync(dir(9100)),'orphan kept until restoreAll finished');
  // restoreAll only opens sockets for folders with creds.json; make sure there are none (no network in tests).
  assert.deepEqual(fs.readdirSync(sessions).filter(n=>fs.existsSync(path.join(sessions,n,'creds.json'))),[]);
  await wa.restoreAll();
  // 2. After restore: only the folder without a numbers row goes.
  assert.equal(wa.cleanOrphanSessions(),1);
  assert.equal(fs.existsSync(dir(9100)),false);
  assert.ok(fs.existsSync(dir(10)),'old mtime does not matter: number exists');
  assert.ok(fs.existsSync(dir(9200)),'number in pairing state untouched');
  // 3. Wiring: 30-minute job and a startup run after restoreAll.
  const src = fs.readFileSync('src/index.js','utf8');
  assert.match(src,/setInterval\(cleanOrphanSessionsJob, 30 \* 60 \* 1000\)\.unref\(\);/);
  assert.match(src,/await restoreAll\(\);\s*\r?\n\s*cleanOrphanSessionsJob\(\);/);
});

test('2.5 handler error terpusat: JSON, code, request id, tanpa stack atau SQL', async () => {
  const bad = await request('/chats/10',{ cookie:ownerA,method:'DELETE',raw:'{"reason":',headers:{ 'X-Request-Id':'client-req-0001' } });
  assert.equal(bad.status,400); assert.equal(bad.json.code,'BAD_REQUEST'); assert.equal(bad.json.request_id,'client-req-0001');
  assert.equal(bad.headers.get('x-request-id'),'client-req-0001'); noLeak(bad);
  const ok = await request('/health');
  assert.match(ok.headers.get('x-request-id'),/^[0-9a-f-]{36}$/);
  // Every route: an app with a throwing route behind the same handler.
  const app = express(); app.use(requestId);
  const boom = Object.assign(Error('UNIQUE constraint failed: users.username'),{ name:'SqliteError',code:'SQLITE_CONSTRAINT_UNIQUE' });
  app.get('/sqlite',()=>{ throw boom; });
  app.get('/busy',async()=>{ throw Object.assign(Error('database is locked'),{ name:'SqliteError',code:'SQLITE_BUSY' }); });
  app.get('/crash',()=>{ throw Error('secret internal detail at /src/x.js:1'); });
  app.use(apiErrorHandler);
  const server = app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
  const errors = []; const original = console.error; console.error = (...a)=>errors.push(a.join(' '));
  try {
    for (const [p,status,code] of [['/sqlite',409,'CONSTRAINT'],['/busy',400,'DATABASE'],['/crash',500,'INTERNAL']]) {
      const r = await fetch(`http://127.0.0.1:${server.address().port}${p}`); const text = await r.text(); const j = JSON.parse(text);
      assert.equal(r.status,status,p); assert.equal(j.code,code,p); assert.ok(j.request_id,p);
      assert.doesNotMatch(text,/UNIQUE constraint|users\.username|database is locked|secret internal|\.js:\d/,p);
    }
  } finally { console.error = original; await new Promise(r=>server.close(r)); }
  assert.ok(errors.some(e=>e.includes('SQLITE_CONSTRAINT_UNIQUE')),'detail goes to the server log only');
  assert.deepEqual(describeError(Object.assign(Error('DEAL_DECIDED: x'),{ code:'SQLITE_CONSTRAINT_TRIGGER' })).code,'DEAL_DECIDED');
});
