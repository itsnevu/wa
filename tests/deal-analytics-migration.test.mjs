import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { setTimeout as pause } from 'node:timers/promises';
import test from 'node:test';
import Database from 'better-sqlite3';
import { buildV7 } from './v7-fixture.mjs';
import { schemaFingerprint } from '../src/schemaFingerprint.js';
import { schemaDdlHash } from '../src/schemaDdlHash.js';
import { childClose, stopFixtureChild } from './child-fixture.mjs';

// Tests 11 and 12: a genuine v7 database with data migrates to v8 once, a second run changes nothing,
// and the automatic pre-migration backup restores to a valid v7 database that a server can start from.
const known = JSON.parse(fs.readFileSync(new URL('../src/schema-fingerprints.json',import.meta.url),'utf8'));
const DAY = 86400000;
const removeFixture = dir => rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
const temp = os.tmpdir();
for (const entry of await fs.promises.readdir(temp, { withFileTypes: true })) {
  if (!entry.isDirectory() || !/^v8-drift-[a-zA-Z0-9]{6}$/.test(entry.name)) continue;
  const stale = path.join(temp, entry.name);
  const info = await fs.promises.lstat(stale).catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
  // The old flat fixtures had a sub-minute startup/teardown; avoid racing any live run.
  if (!info || Date.now() - info.mtimeMs < 300_000) continue;
  let holder;
  try { holder = JSON.parse(await fs.promises.readFile(path.join(stale, 'app.db.lock'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (Number.isSafeInteger(holder?.pid) && holder.pid > 0) {
    try { process.kill(holder.pid, 0); continue; }
    catch (error) { if (error.code !== 'ESRCH') continue; }
  }
  await removeFixture(stale);
}

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
test.after(async () => {
  if (db.open) {
    try { db.pragma('wal_checkpoint(TRUNCATE)'); }
    finally { db.close(); }
  }
  for (const d of [dir, ...scratch]) await removeFixture(d);
});
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
async function startServer(dataDir, env) {
  const port = await freePort();
  const child = spawn(process.execPath, ['--regexp-interpret-all', 'tests/migration-server-child.mjs'], {
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1', ADMIN_USER: '', ADMIN_PASS: '', ...env },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true,
  });
  const closed = childClose(child);
  let out = '';
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { out += d; });
  const polling = new AbortController();
  const ready = (async () => {
    for (let attempt = 0; attempt < 80 && !polling.signal.aborted; attempt++) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
          signal: AbortSignal.any([polling.signal, AbortSignal.timeout(200)]),
        });
        if (response.ok) return { healthy: true, health: await response.json() };
      } catch {}
      await pause(250, undefined, { signal: polling.signal }).catch(() => {});
    }
    return {};
  })();
  const status = await Promise.race([ready, closed.then(() => ({}))]);
  polling.abort();
  await ready;
  const { code, signal, error } = await stopFixtureChild(child, closed, () => {
    child.send('shutdown', () => {});
  });
  if (error) throw error;
  if (status.healthy) assert.deepEqual([code, signal], [0, null], out);
  for (const suffix of ['-wal', '-shm']) {
    assert.equal(fs.existsSync(path.join(dataDir, 'app.db' + suffix)), false, `leftover ${suffix}: ${out}`);
  }
  return { ...status, exited: code, out, port };
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

async function withDdlCopy(change, verify) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-v8-suite-')); scratch.push(root);
  const drift = fs.mkdtempSync(path.join(root, 'v8-drift-'));
  const file = path.join(drift, 'app.db');
  try {
    await db.backup(file);
    const copy = new Database(file);
    let hash;
    try {
      copy.exec(change);
      assert.equal(schemaFingerprint(copy), known.current);
      hash = schemaDdlHash(copy);
    } finally { copy.close(); }
    await verify(await startServer(drift, { ALLOW_AUTO_MIGRATE:'0' }), file, hash);
  } finally { await removeFixture(drift); }
  assert.deepEqual(await fs.promises.readdir(root), [], 'no v8-drift fixture remains after the child closes');
}

const storedHash = db.prepare('SELECT hash FROM schema_ddl_hash WHERE version=8').pluck().get();
function assertDdlRefusal(out, recorded, current) {
  assert.equal(out.exited, 1);
  assert.equal(out.healthy, undefined);
  assert.ok(out.out.includes(`Schema DDL hash mismatch for version 8; recorded hash ${recorded}; current hash ${current}`), out.out);
  assert.match(out.out, /Restore a verified backup or rerun the migration on a copy/);
  console.log(out.out.split('\n').find(line => line.startsWith('Error: Schema DDL hash mismatch')));
}

test('G4.1 catatan hash berbeda menolak startup dan memberi langkah pemulihan', async () => {
  const bad = '0'.repeat(64);
  await withDdlCopy(`UPDATE schema_ddl_hash SET hash='${bad}' WHERE version=8`,
    (out, _file, hash) => assertDdlRefusal(out, bad, hash));
});

test('G4.2 v8 lama dicatat grandfathered, dan drift sesudahnya memberi peringatan', async () => {
  await withDdlCopy('DROP TABLE schema_ddl_hash', async (out, file, hash) => {
    assert.equal(out.healthy, true, out.out);
    assert.match(out.out, /DDL version 8 grandfathered/);
    const copy = new Database(file);
    let updated;
    try {
      assert.deepEqual(copy.prepare('SELECT version, hash, grandfathered FROM schema_ddl_hash').all(), [
        { version: 8, hash, grandfathered: 1 },
      ]);
      copy.exec('CREATE INDEX g4_legacy_drift ON deals(amount)');
      updated = schemaDdlHash(copy);
    } finally { copy.close(); }
    const startup = await startServer(path.dirname(file), { ALLOW_AUTO_MIGRATE:'0' });
    assert.equal(startup.healthy, true, startup.out);
    assert.ok(startup.out.includes(`grandfathered; recorded hash ${hash}; current hash ${updated}`));
    console.log(startup.out.split('\n').find(line => line.includes('grandfathered')));
  });
});

test('G4.3 (7b) perubahan trigger pada versi ber-hash menolak startup', async () => {
  await withDdlCopy('DROP TRIGGER deal_decided_delete_guard',
    (out, _file, hash) => assertDdlRefusal(out, storedHash, hash));
});

test('G4.4 perubahan indeks pada versi ber-hash menolak startup', async () => {
  await withDdlCopy('CREATE INDEX g4_drift_idx ON deals(amount)',
    (out, _file, hash) => assertDdlRefusal(out, storedHash, hash));
});

test('G4.5 health memaparkan versi dan hash DDL aktif', async () => {
  await withDdlCopy('', (out, _file, hash) => {
    assert.deepEqual(out.health, { ok: true, schema_version: 8, schema_ddl_hash: hash });
    assert.equal(hash, storedHash);
    console.log('HEALTH', JSON.stringify(out.health));
  });
});
