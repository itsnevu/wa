import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const run = (code, env) => spawnSync(process.execPath, ['--input-type=module', '-e', code], {
  env: {...process.env, MULTITENANT_ENABLED:'0', LOGIN_MAX:'5', LOGIN_IP_MAX:'30', LOGIN_LOCK_MIN:'15', ...env},
  encoding:'utf8',
  timeout:10000,
});

test('first admin requires a valid password, and existing database keeps its credentials', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-login-bootstrap-'));
  const credentials = 'fixture-admin-password';
  const boot = adminPass => run(`
    import assert from 'node:assert/strict';
    import {verifyPassword} from './src/passwords.js';
    const {db} = await import('./src/db.js');
    const rows = db.prepare('SELECT username, pass FROM users').all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].username, 'fixture-admin');
    assert.ok(verifyPassword('${credentials}', rows[0].pass));
    db.close();
  `, {DATA_DIR:dir, ALLOW_AUTO_MIGRATE:'1', ADMIN_USER:'fixture-admin', ADMIN_PASS:adminPass, PASS_MIN:'12'});
  try {
    for (const password of ['', 'admin123', ' '.repeat(12), 'a'.repeat(257)]) {
      const rejected = boot(password);
      assert.equal(rejected.status, 1, rejected.stderr);
      assert.match(rejected.stderr, /ADMIN_PASS wajib diisi/);
    }
    const initialized = boot(credentials);
    assert.equal(initialized.status, 0, initialized.stderr);
    const restarted = boot('');
    assert.equal(restarted.status, 0, restarted.stderr);
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('wa-login-bootstrap-'));
    fs.rmSync(dir, {recursive:true, force:true});
  }
});

test('invalid login thresholds fail before startup', () => {
  for (const [name, value] of [['LOGIN_MAX','invalid'], ['LOGIN_IP_MAX','0'], ['LOGIN_LOCK_MIN','1.5']]) {
    const rejected = run("await import('./src/config.js');", {[name]:value});
    assert.equal(rejected.status, 1, rejected.stderr);
    assert.match(rejected.stderr, new RegExp(`${name} harus berupa bilangan bulat positif`));
  }
});

test('login tracks both pair and IP budgets and expires each independently', async t => {
  Object.assign(process.env, {LOGIN_MAX:'2', LOGIN_IP_MAX:'4', LOGIN_LOCK_MIN:'1'});
  const guard = await import('../src/loginGuard.js');
  let now = 100000;
  t.mock.method(Date, 'now', () => now);
  const ip = '127.0.0.1';
  guard.fail('alice', ip);
  guard.fail('alice', ip);
  assert.equal(guard.blocked('alice', ip), true);
  assert.equal(guard.blocked('bob', ip), false);
  guard.reset('alice', ip);
  assert.equal(guard.blocked('alice', ip), false);
  now += 1000;
  guard.fail('bob', ip);
  guard.fail('charlie', ip);
  assert.equal(guard.blocked('dana', ip), true);
  assert.equal(guard.blocked('bob', '127.0.0.2'), false);
  now += 60000;
  assert.equal(guard.blocked('dana', ip), false);
  guard.fail('bob', ip);
  assert.equal(guard.blocked('bob', ip), false);
});
