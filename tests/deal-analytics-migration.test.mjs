import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import test from 'node:test';
import Database from 'better-sqlite3';
import { buildV7 } from './v7-fixture.mjs';
import { schemaFingerprint } from '../src/schemaFingerprint.js';

// Tests 11 and 12: a genuine v7 database with data migrates to v8 once, a second run changes nothing,
// and the automatic pre-migration backup restores to a valid v7 database that a server can start from.
const known = JSON.parse(fs.readFileSync(new URL('../src/schema-fingerprints.json',import.meta.url),'utf8'));
const DAY = 86400000;
const { dir, file, ids, T } = buildV7();
const tables = ['deals','deal_events','deal_evidence','deal_verifications','dp_payments','messages','chats','tenants'];
const counts = db => Object.fromEntries(tables.map(t=>[t,db.prepare(`SELECT count(*) AS n FROM ${t}`).get().n]));
const snapshot = db => ({ fingerprint:schemaFingerprint(db), counts:counts(db),
  versions:db.prepare('SELECT version,fingerprint FROM schema_migrations ORDER BY version').all() });
const before = (() => { const d = new Database(file,{ readonly:true }); try { return counts(d); } finally { d.close(); } })();

Object.assign(process.env,{ DATA_DIR:dir,ALLOW_AUTO_MIGRATE:'1',MULTITENANT_ENABLED:'0' });
const started = performance.now();
const { db } = await import('../src/db.js');
const migrationMs = performance.now()-started;
const { config } = await import('../src/config.js');
const { ensureSchema } = await import('../src/schemaMigrations.js');
const A = await import('../src/dealAnalytics.js');
const scratch = [];
test.after(()=>{ db.close(); for (const d of [dir,...scratch]) fs.rmSync(d,{ recursive:true,force:true }); });
const owner = { tenantId:'T',role:'owner',userId:500 };
const range = { from:T-DAY,to:T+20*DAY,now:T+20*DAY };

test('11a. v7 -> v8 pada salinan berisi data: versi, fingerprint, backup, baris terdampak', () => {
  const after = counts(db);
  const delta = Object.fromEntries(tables.map(t=>[t,after[t]-before[t]]));
  console.log('MIGRATION v7->v8', JSON.stringify({ ms:Math.round(migrationMs),before,after,delta }));
  assert.deepEqual(db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(r=>r.version),[1,2,3,4,5,6,7,8]);
  assert.equal(schemaFingerprint(db),known.current);
  assert.equal(db.pragma('integrity_check',{ simple:true }),'ok');
  assert.deepEqual(db.pragma('foreign_key_check'),[]);
  for (const t of ['deals','deal_evidence','deal_verifications','dp_payments','messages','chats']) assert.equal(delta[t],0,t+' rows unchanged');
  assert.equal(delta.deal_events,5*3,'opened + dimensions + baseline per existing deal');
  assert.ok(fs.readdirSync(path.join(dir,'migration-backups')).some(f=>f.endsWith('.sqlite')));
});

test('11b. migrasi dijalankan kedua kali: tidak ada perubahan schema maupun data', async () => {
  const first = snapshot(db);
  await ensureSchema(db,config);
  await ensureSchema(db,config);
  assert.deepEqual(snapshot(db),first);
});

test('11c. backfill: snapshot bukti, label verifier, dan metrik hanya dari keputusan tercatat', () => {
  const ev = db.prepare('SELECT * FROM deal_evidence WHERE deal_id=?').get(ids.verified);
  assert.deepEqual([ev.message_id,ev.snapshot_sender_name,ev.snapshot_body,ev.snapshot_at],[ids.proofMessage,'Pembeli lunas','Bukti transfer',T]);
  assert.deepEqual(db.prepare('SELECT DISTINCT actor_label FROM deal_verifications').all().map(r=>r.actor_label),['verifier']);
  const s = A.tenantDealAnalytics(owner,range).summary;
  assert.equal(s.counts.verified_lunas,1,'bare verified_lunas without verification is not counted');
  assert.equal(s.counts.rejected,0,'bare rejected without verification is not counted');
  assert.equal(s.counts.unverified_legacy,2);
  assert.equal(s.counts.dp_aktif,1);
  assert.deepEqual([s.closing_rate.numerator,s.closing_rate.n],[1,1]);
  assert.deepEqual(A.tenantDealAnalytics(owner,range).summary,s,'replay stable');
});

test('11d. aturan hapus setelah migrasi: belum diputuskan (dengan sla_escalated) ikut terhapus, sudah diputuskan ditolak', () => {
  db.prepare('DELETE FROM chats WHERE id=7005').run();
  assert.equal(db.prepare('SELECT count(*) AS n FROM deals WHERE id=?').get(ids.undecided).n,0);
  for (const chatId of [7001,7002,7003,7004]) {
    assert.throws(()=>db.prepare('DELETE FROM chats WHERE id=?').run(chatId),/DEAL_DECIDED/,'chat '+chatId);
  }
  assert.throws(()=>db.prepare("DELETE FROM deal_events WHERE type='analytics_opened'").run(),/append-only/);
});

async function freePort() {
  const s = net.createServer(); s.listen(0,'127.0.0.1'); await new Promise(r=>s.once('listening',r));
  const { port } = s.address(); await new Promise(r=>s.close(r)); return port;
}
function startServer(dataDir,env) {
  return freePort().then(port => new Promise(resolve => {
    const child = spawn(process.execPath,['--regexp-interpret-all','src/index.js'],{
      env:{ ...process.env,DATA_DIR:dataDir,PORT:String(port),HOST:'127.0.0.1',ADMIN_USER:'',ADMIN_PASS:'',...env },windowsHide:true });
    let out = '';
    child.stdout.on('data',d=>{ out += d; }); child.stderr.on('data',d=>{ out += d; });
    const deadline = setTimeout(()=>{ child.kill(); resolve({ exited:null,out,port }); },20000);
    const poll = setInterval(async () => {
      try { const r = await fetch(`http://127.0.0.1:${port}/api/health`); if (r.ok) { clearInterval(poll); clearTimeout(deadline); child.kill(); resolve({ healthy:true,out,port }); } } catch {}
    },250);
    child.once('exit',code=>{ clearInterval(poll); clearTimeout(deadline); resolve({ exited:code,out,port }); });
  }));
}

test('12. rollback: backup otomatis dipulihkan sebagai v7 yang valid, server menolak tanpa izin migrasi lalu start setelah diizinkan', async () => {
  const backups = path.join(dir,'migration-backups');
  const backup = path.join(backups,fs.readdirSync(backups).find(f=>f.endsWith('.sqlite')));
  const restored = fs.mkdtempSync(path.join(os.tmpdir(),'v8-rollback-')); scratch.push(restored);
  fs.copyFileSync(backup,path.join(restored,'app.db'));
  const r = new Database(path.join(restored,'app.db'),{ readonly:true });
  try {
    assert.equal(schemaFingerprint(r),known.v7);
    assert.deepEqual(r.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(x=>x.version),[1,2,3,4,5,6,7]);
    assert.equal(r.pragma('integrity_check',{ simple:true }),'ok');
    assert.deepEqual(counts(r),before,'restored data equals pre-migration data');
  } finally { r.close(); }
  const refused = await startServer(restored,{ ALLOW_AUTO_MIGRATE:'0' });
  console.log('ROLLBACK start without ALLOW_AUTO_MIGRATE:', refused.exited, refused.out.match(/Schema version[^\n]*/)?.[0]);
  assert.notEqual(refused.exited,0); assert.equal(refused.healthy,undefined);
  assert.match(refused.out,/Schema version 7 != 8/);
  const startedOk = await startServer(restored,{ ALLOW_AUTO_MIGRATE:'1' });
  console.log('ROLLBACK start with ALLOW_AUTO_MIGRATE=1: healthy =',startedOk.healthy);
  assert.equal(startedOk.healthy,true,startedOk.out.slice(-800));
});

test('7. fingerprint tidak cocok (kolom berubah) -> server menolak start dengan pesan jelas', async () => {
  const tampered = fs.mkdtempSync(path.join(os.tmpdir(),'v8-tamper-')); scratch.push(tampered);
  await db.backup(path.join(tampered,'app.db'));
  const t = new Database(path.join(tampered,'app.db')); t.exec('ALTER TABLE deals ADD COLUMN tamper INTEGER'); t.close();
  const out = await startServer(tampered,{ ALLOW_AUTO_MIGRATE:'1' });
  console.log('TAMPERED column start:', out.exited, out.out.match(/Schema fingerprint mismatch[^\n]*/)?.[0]);
  assert.notEqual(out.exited,0); assert.match(out.out,/Schema fingerprint mismatch; startup refused/);
});

// Documents a limit of the fingerprint (tables/columns only): trigger and index drift is NOT refused.
// Kept as an explicit, passing record so the freeze manifest must cover it with a full DDL hash.
test('7b. batas fingerprint: perubahan indeks/trigger TIDAK terdeteksi saat start', async () => {
  const drift = fs.mkdtempSync(path.join(os.tmpdir(),'v8-drift-')); scratch.push(drift);
  await db.backup(path.join(drift,'app.db'));
  const t = new Database(path.join(drift,'app.db'));
  t.exec('CREATE INDEX drift_idx ON deals(amount); DROP TRIGGER deal_decided_delete_guard;'); t.close();
  const out = await startServer(drift,{ ALLOW_AUTO_MIGRATE:'1' });
  console.log('DRIFT index+trigger start: healthy =',out.healthy);
  assert.equal(out.healthy,true);
});
