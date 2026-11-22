import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createHmac } from 'node:crypto';
import { twoTenants } from './tenant-fixture.mjs';
import { scanSource, scanTree, check, TENANT_TABLES } from '../scripts/check-tenant-scope.mjs';
// Fixture database only (never data/app.db).
const fixture = twoTenants();
Object.assign(process.env,{ DATA_DIR:fixture.dir,ALLOW_AUTO_MIGRATE:'1' });
const { config } = await import('../src/config.js');
const { db: fixtureDb } = await import('../src/db.js');
const { describeError, sendError } = await import('../src/apiErrors.js');
const { readiness } = await import('../src/readiness.js');
const { SCHEMA_VERSION } = await import('../src/schemaMigrations.js');
const { mediaSignatureValid } = await import('../src/media.js');
test.after(()=>{ fixtureDb.close(); fixture.close(); });

const allowlist = JSON.parse(fs.readFileSync('tests/tenant-scope.allowlist.json', 'utf8'));

test('H3.1 query tanpa scope menggagalkan pemeriksa; query ber-tenant dan daftar putih lolos', () => {
  const bad = scanSource('src/x.js', "const q = db.prepare(`SELECT * FROM chats WHERE id=?`);");
  assert.equal(bad.length, 1);
  assert.equal(check(bad, allowlist).violations.length, 1, 'new unscoped query is rejected');
  assert.equal(scanSource('src/x.js', "db.prepare(`SELECT * FROM chats WHERE tenant_id=? AND id=?`)").length, 0);
  // The real tree is clean against its reviewed allowlist, and every entry has a reason.
  const r = check(scanTree(), allowlist);
  assert.deepEqual([r.violations.length, r.stale.length, r.missingReason.length], [0, 0, 0]);
});

test('H3.1b daftar tabel ber-tenant sama dengan skema nyata', () => {
  const db = fixtureDb;
  {
    const live = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").pluck().all()
      .filter(n => db.prepare(`PRAGMA table_info("${n}")`).all().some(c => c.name === 'tenant_id'));
    assert.deepEqual([...live].sort(), [...TENANT_TABLES].sort());
  }
});

function fakeRes() {
  const r = { headers: {}, statusCode: 0, body: null };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.status = c => { r.statusCode = c; return r; };
  r.json = b => { r.body = b; return r; };
  return r;
}

test('H3.2 response error tanpa stack/SQL; BUSY -> 503 + Retry-After; log terstruktur tanpa rahasia', () => {
  const secret = 'MEDIA_SIGNING_KEY=super-secret-value-123';
  const err = Object.assign(Error(`no such column: x in SELECT pass FROM users -- ${secret}`), { name: 'SqliteError', code: 'SQLITE_ERROR' });
  const lines = []; const orig = console.error; console.error = l => lines.push(String(l));
  try {
    const res = fakeRes();
    sendError({ requestId: 'req-12345678', method: 'GET', originalUrl: '/api/x?sig=abcdef&token=t0k', tenantScope: { tenantId: 'A' } }, res, err);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(Object.keys(res.body).sort(), ['code', 'error', 'request_id']);
    assert.ok(!JSON.stringify(res.body).includes('SELECT') && !JSON.stringify(res.body).includes('stack'));
    const busy = fakeRes();
    sendError({ requestId: 'req-87654321', method: 'POST', originalUrl: '/api/y' }, busy, Object.assign(Error('database is locked'), { name: 'SqliteError', code: 'SQLITE_BUSY' }));
    assert.equal(busy.statusCode, 503); assert.equal(busy.headers['retry-after'], '2'); assert.equal(busy.body.code, 'BUSY');
  } finally { console.error = orig; }
  assert.equal(lines.length, 2);
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.request_id, 'req-12345678'); assert.equal(entry.tenant_id, 'A'); assert.equal(entry.path, '/api/x');
  for (const line of lines) for (const leak of [secret, 'SELECT pass', 'sig=abcdef', 't0k', 'stack']) assert.ok(!line.includes(leak), `log leaked ${leak}`);
  assert.equal(describeError(Error('x')).status, 500);
});

test('H3.3 /ready 503 saat database belum siap; 200 dengan metrik saat siap', () => {
  assert.deepEqual(readiness({ open: false }, { version: SCHEMA_VERSION }), { status: 503, body: { ready: false, reasons: ['database_closed'] } });
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE numbers(queue_depth INTEGER, drop_count_json TEXT); INSERT INTO numbers VALUES(3,'{"rate":2}'),(1,'{"rate":1,"cap":4}');
    CREATE TABLE deal_job_notices(at INTEGER, delivered_at INTEGER); INSERT INTO deal_job_notices VALUES(1000,NULL),(5000,NULL),(10,99);`);
  assert.deepEqual(readiness(db, { version: SCHEMA_VERSION - 1 }).body.reasons, ['schema_not_migrated']);
  const ok = readiness(db, { version: SCHEMA_VERSION }, 6000);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.metrics, { queue_depth: 4, drops_by_reason: { rate: 3, cap: 4 }, oldest_pending_job_age_ms: 5000, running_jobs: 0 });
  db.close();
});

test('H3.4 rotasi kunci HMAC media: kunci lama diterima hanya sampai batas waktunya', () => {
  const saved = { k: config.mediaSigningKey, p: config.mediaSigningKeyPrevious, u: config.mediaSigningKeyPreviousUntil };
  try {
    const sign = key => createHmac('sha256', key).update(JSON.stringify(['u1', 7, 123])).digest('hex');
    config.mediaSigningKey = 'n'.repeat(32); config.mediaSigningKeyPrevious = 'o'.repeat(32); config.mediaSigningKeyPreviousUntil = 2000;
    assert.equal(mediaSignatureValid(sign('n'.repeat(32)), 'u1', 7, 123, null, 1000), true, 'current key');
    assert.equal(mediaSignatureValid(sign('o'.repeat(32)), 'u1', 7, 123, null, 1000), true, 'previous key inside window');
    assert.equal(mediaSignatureValid(sign('o'.repeat(32)), 'u1', 7, 123, null, 2000), false, 'previous key expired');
    assert.equal(mediaSignatureValid(sign('x'.repeat(32)), 'u1', 7, 123, null, 1000), false, 'unknown key');
  } finally { Object.assign(config, { mediaSigningKey: saved.k, mediaSigningKeyPrevious: saved.p, mediaSigningKeyPreviousUntil: saved.u }); }
});
