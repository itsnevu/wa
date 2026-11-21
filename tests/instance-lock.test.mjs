import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';

// G3: migration and server run under a single per-data-directory lock taken in src/db.js.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'instance-lock-'));
const env = { ...process.env, DATA_DIR: dir, ALLOW_AUTO_MIGRATE: '1', MULTITENANT_ENABLED: '0', ADMIN_USER: 'lock-admin', ADMIN_PASS: 'lock-password-123' };
const lockFile = path.join(dir, 'app.db.lock');
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const openDb = (extra = '') => spawnSync(process.execPath, ['--input-type=module', '-e', `const {db}=await import('./src/db.js'); ${extra} db.close();`],
  { env, encoding: 'utf8', windowsHide: true });

test('kunci: instance kedua dan migrasi ditolak selama pemegang hidup; dilepas saat pemegang berhenti', async () => {
  assert.equal(openDb().status, 0, 'first open creates and migrates the database');
  assert.equal(fs.existsSync(lockFile), false, 'lock released on normal exit');
  const holder = spawn(process.execPath, ['--input-type=module', '-e', "const {db}=await import('./src/db.js'); console.log('HOLDING'); setTimeout(()=>{},15000);"],
    { env, windowsHide: true });
  await new Promise((resolve, reject) => {
    holder.stdout.on('data', d => { if (String(d).includes('HOLDING')) resolve(); });
    holder.once('exit', code => reject(Error('holder exited early ' + code)));
  });
  try {
    const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    assert.equal(lock.pid, holder.pid); assert.equal(lock.role, 'server');
    const second = openDb();
    assert.notEqual(second.status, 0);
    assert.match(second.stderr, /sedang dipegang instance lain \(pid \d+, server/);
    const migrate = spawnSync(process.execPath, ['scripts/migrate-schema.mjs'], { env, encoding: 'utf8', windowsHide: true });
    assert.notEqual(migrate.status, 0); assert.match(migrate.stderr, /INSTANCE_LOCKED|sedang dipegang instance lain/);
  } finally {
    holder.kill(); await new Promise(r => holder.once('exit', r));
  }
  // A killed holder cannot run its exit hook: its lock is stale and must be taken over.
  assert.equal(fs.existsSync(lockFile), true, 'killed process leaves a stale lock');
  const after = openDb();
  assert.equal(after.status, 0, after.stderr);
  assert.equal(fs.existsSync(lockFile), false);
});

test('kunci basi dari pid yang tidak ada diambil alih', () => {
  fs.writeFileSync(lockFile, JSON.stringify({ pid: 999999, role: 'server', started_at: 'x' }));
  const r = openDb();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.existsSync(lockFile), false);
});
