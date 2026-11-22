import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { gracefulShutdown, trackJob, runningJobs } from '../src/shutdown.js';
import { ensureSchema, SCHEMA_VERSION } from '../src/schemaMigrations.js';
import { buildV7 } from './v7-fixture.mjs';
import { barrier, waitFor } from './lib/wait.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-h2-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('H2.1 shutdown tidak memotong request yang sedang berjalan, menunggu job, lalu menutup database', async () => {
  const release = barrier();
  const server = http.createServer(async (_req, res) => { await release.wait(); res.end('done'); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const db = new Database(path.join(tmp, 'shutdown.db')); db.pragma('journal_mode = WAL'); db.exec('CREATE TABLE t(x)');
  const jobGate = barrier(); trackJob(jobGate.wait());
  const pending = fetch(`http://127.0.0.1:${server.address().port}/`).then(r => r.text());
  await waitFor(() => new Promise(r => server.getConnections((_e, n) => r(n > 0))), { label: 'request accepted by server' });
  const exits = []; const log = [];
  const done = gracefulShutdown({ server, db, exit: code => exits.push(code), log: (...m) => log.push(m.join(' ')), timeoutMs: 5000 });
  assert.equal(exits.length, 0, 'does not exit while a request is running');
  release.release();
  assert.equal(await pending, 'done', 'in-flight request completed');
  assert.equal(db.open, true, 'database still open while a job runs');
  assert.equal(runningJobs(), 1);
  jobGate.release();
  await done;
  assert.deepEqual(exits, [0]);
  assert.equal(db.open, false, 'database closed after checkpoint');
  assert.ok(log.includes('[shutdown] selesai'), log.join('\n'));
});

test('H2.2 batas waktu paksa keluar dengan kode 1 bila job menggantung', async () => {
  const server = http.createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r));
  trackJob(new Promise(() => {})); // never settles
  const exits = [];
  void gracefulShutdown({ server, exit: code => exits.push(code), log: () => {}, timeoutMs: 50 });
  await new Promise(r => setTimeout(r, 120));
  assert.deepEqual(exits, [1]);
});

async function v7Copy(name) {
  const dir = path.join(tmp, name); fs.mkdirSync(dir);
  const { file } = buildV7(dir);
  return { dir, db: new Database(file) };
}

test('H2.3 backup gagal -> migrasi batal dan versi tidak berubah', async () => {
  const { dir, db } = await v7Copy('backup-fails');
  fs.writeFileSync(path.join(dir, 'migration-backups'), 'not a directory'); // backup target cannot be created
  await assert.rejects(ensureSchema(db, { dataDir: dir, allowAutoMigrate: true }));
  assert.equal(db.prepare('SELECT max(version) v FROM schema_migrations').get().v, 7);
  db.close();
});

test('H2.4 integrity_check gagal -> seluruh migrasi di-rollback', async () => {
  const { dir, db } = await v7Copy('integrity-fails');
  await assert.rejects(ensureSchema(db, { dataDir: dir, allowAutoMigrate: true, integrityCheck: () => 'row 1 missing from index' }),
    /integrity_check failed \(row 1 missing from index\); rolled back/);
  assert.equal(db.prepare('SELECT max(version) v FROM schema_migrations').get().v, 7);
  assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='tenant_business_hours'").get().n, 0, 'v9 objects rolled back');
  // With a healthy check the same copy migrates.
  await ensureSchema(db, { dataDir: dir, allowAutoMigrate: true });
  assert.equal(db.prepare('SELECT max(version) v FROM schema_migrations').get().v, SCHEMA_VERSION);
  db.close();
});
