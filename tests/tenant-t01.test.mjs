import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { twoTenants } from './tenant-fixture.mjs';

function legacy() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY, role TEXT);
    CREATE TABLE sessions(token TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id),expires_at INTEGER);
    CREATE TABLE numbers(id INTEGER PRIMARY KEY,phone TEXT UNIQUE);
    CREATE TABLE chats(id INTEGER PRIMARY KEY,number_id INTEGER REFERENCES numbers(id));
    CREATE TABLE messages(id INTEGER PRIMARY KEY,number_id INTEGER REFERENCES numbers(id),chat_id INTEGER REFERENCES chats(id));
    CREATE INDEX message_chat ON messages(chat_id);
    CREATE TABLE labels(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE);
    INSERT INTO users VALUES(1,'admin'),(2,'agent'),(3,'admin');
    INSERT INTO numbers VALUES(1,'62001'); INSERT INTO chats VALUES(1,1);
    INSERT INTO messages VALUES(1,1,1); INSERT INTO labels VALUES(1,'new');
    INSERT INTO labels VALUES(100,'deleted'); DELETE FROM labels WHERE id=100;`);
  return db;
}

test('expand/backfill/contract preserves rows, indexes, FKs; backup first; idempotent', async () => {
  const { migrateTenantSchema } = await import('../src/tenantMigration.js');
  const db = legacy(); const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-t01-'));
  try {
    const report = await migrateTenantSchema(db, { backupDir: dir });
    assert.ok(fs.existsSync(report.backup));
    const backup = new Database(report.backup, { readonly: true });
    assert.equal(backup.prepare('PRAGMA table_info(numbers)').all().some(c => c.name === 'tenant_id'), false);
    backup.close();
    for (const t of report.tables) {
      assert.equal(t.before, t.after); assert.equal(t.unscoped, 0);
      assert.equal(db.prepare(`PRAGMA table_info("${t.name}")`).all().find(c => c.name === 'tenant_id').notnull, 1);
    }
    assert.equal(db.prepare('SELECT count(*) n FROM tenant_members WHERE role=\'owner\'').get().n, 1);
    assert.equal(db.prepare('SELECT count(*) n FROM tenant_members').get().n, 3);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='message_chat'").get());
    assert.equal(db.prepare("INSERT INTO labels(name) VALUES('after-migration')").run().lastInsertRowid,101);
    assert.throws(() => db.prepare('INSERT INTO numbers(id,phone,tenant_id) VALUES(2,?,NULL)').run('x'));
    db.prepare("INSERT INTO tenants(id,name,status,created_at) VALUES('B','B','active',0)").run();
    db.prepare("INSERT INTO numbers(id,phone,tenant_id) VALUES(2,'62001','B')").run();
    assert.throws(() => db.prepare("INSERT INTO messages(id,number_id,chat_id,tenant_id) VALUES(2,2,1,'B')").run());
    assert.equal((await migrateTenantSchema(db, { backupDir: dir })).skipped, true);
    console.log('MIGRATION_MATRIX', JSON.stringify(report.tables));
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('backup failure leaves schema unchanged', async () => {
  const { migrateTenantSchema } = await import('../src/tenantMigration.js');
  const db = legacy();
  try {
    await assert.rejects(migrateTenantSchema(db, { backupDir: '\0' }));
    assert.equal(db.prepare('PRAGMA table_info(numbers)').all().some(c => c.name === 'tenant_id'), false);
    db.exec('BEGIN');
    await assert.rejects(migrateTenantSchema(db, { backupDir: os.tmpdir() }),/independent migration transaction/);
    db.exec('ROLLBACK');
  } finally { db.close(); }
});

test('resolver matrix: authoritative session, membership, status, spoofing, revocation', async () => {
  const { migrateTenantSchema } = await import('../src/tenantMigration.js');
  const { resolveTenantScope } = await import('../src/tenantScope.js');
  const db = legacy(); const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-scope-'));
  try {
    await migrateTenantSchema(db, { backupDir: dir });
    db.exec(`INSERT INTO tenants VALUES('B','B','active',0);
      INSERT INTO tenant_members(tenant_id,user_id,role,created_at) VALUES('B',2,'owner',0);
      INSERT INTO sessions(token,user_id,expires_at,active_tenant_id) VALUES('a',1,9999999999999,'default'),('b',2,9999999999999,'B'),('p',3,9999999999999,NULL);
      DELETE FROM tenant_members WHERE user_id=3;`);
    const scope = req => resolveTenantScope(req, { database: db, enabled: true });
    const req = (token, extra = {}) => ({ headers: { cookie: `sid=${token}` }, ...extra });
    const denied = (request, status) => assert.throws(() => scope(request), e => e.status === status);
    assert.equal(scope(req('a')).tenantId, 'default');
    assert.equal(scope(req('b')).tenantId, 'B');
    denied(req('a', { body: { tenant_id: 'B' } }),403);
    denied(req('a', { params: { tenant_id: 'B' } }),403);
    denied(req('a', { query: { tenant_id: ['default','B'] } }),403);
    denied(req('b', { user: { id: 1 } }),401);
    denied({ headers: {} },401); denied(req('unknown'),401);
    denied(req('p'),403);
    db.exec("DELETE FROM tenant_members WHERE tenant_id='default' AND user_id=1");
    denied(req('a'),403);
    db.exec("UPDATE tenants SET status='suspended' WHERE id='B'");
    denied(req('b'),403);
    db.exec("UPDATE sessions SET expires_at=0 WHERE token='b'"); denied(req('b'),401);
    console.log('SCOPE_MATRIX: A/A PASS; B/B PASS; body/URL/query spoof PASS; swapped identity PASS; anonymous PASS; platform-only PASS; revoked PASS; suspended PASS; expired PASS');
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('failed verification rolls all schema changes back and restores FK enforcement', async () => {
  const { migrateTenantSchema } = await import('../src/tenantMigration.js');
  const db = legacy(); const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-failure-'));
  try {
    db.pragma('foreign_keys = OFF'); db.exec('INSERT INTO chats VALUES(2,999)'); db.pragma('foreign_keys = ON');
    await assert.rejects(migrateTenantSchema(db, { backupDir: dir }), /foreign key verification/);
    assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='tenants'").get(), undefined);
    assert.equal(db.prepare('PRAGMA table_info(chats)').all().some(c => c.name === 'tenant_id'), false);
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
    assert.equal(db.prepare('SELECT count(*) n FROM chats').get().n, 2);
    assert.equal(fs.readdirSync(dir).length, 1);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('production database COPY: all resource counts preserved, zero unscoped rows', async () => {
  const { TENANT_TABLES } = await import('../src/tenantMigration.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-production-copy-'));
  const source = new Database(path.resolve('data/app.db'), { readonly: true, fileMustExist: true });
  let copy;
  try {
    const file = path.join(dir, 'app.db');
    await source.backup(file); source.close();
    copy = new Database(file);
    const before = Object.fromEntries(TENANT_TABLES.filter(name => copy.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name))
      .map(name => [name,copy.prepare(`SELECT count(*) n FROM "${name}"`).get().n]));
    copy.close();
    // Match deployment: legacy bootstrap first creates tables absent in older DBs.
    const boot = spawnSync(process.execPath, ['--input-type=module', '-e', "const {db}=await import('./src/db.js'); db.close()"], {
      env: { ...process.env, DATA_DIR: dir, MULTITENANT_ENABLED: '0' }, encoding: 'utf8',
    });
    assert.equal(boot.status,0,boot.stderr);
    copy = new Database(file);
    const report = JSON.parse(copy.prepare("SELECT report_json FROM tenant_migrations WHERE id='T01'").get().report_json);
    assert.equal(report.tables.length, TENANT_TABLES.length);
    for (const t of report.tables) {
      assert.equal(t.before,t.after); assert.equal(t.unscoped,0);
      if (Object.hasOwn(before,t.name)) assert.equal(t.after,before[t.name],`original row count: ${t.name}`);
      assert.equal(copy.prepare(`PRAGMA table_info("${t.name}")`).all().find(c => c.name === 'tenant_id').notnull,1);
    }
    assert.deepEqual(copy.pragma('foreign_key_check'), []);
    assert.equal(copy.pragma('integrity_check', { simple: true }), 'ok');
    console.log('PRODUCTION_COPY_MATRIX', JSON.stringify(report.tables));
  } finally { if (source.open) source.close(); copy?.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fresh bootstrap, legacy writes, restart, and activation fail closed before DB creation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-bootstrap-'));
  const env = { ...process.env, DATA_DIR: dir, MULTITENANT_ENABLED: '0', ADMIN_PASS: 'fixture-password-123' };
  const run = code => spawnSync(process.execPath, ['--input-type=module', '-e', code], { env, encoding: 'utf8' });
  try {
    let result = run(`const {db,q}=await import('./src/db.js');
      const n=q.insertNumber.run('628000','fixture',null,0).lastInsertRowid;
      const c=q.insertChat.run(n,'fixture@s.whatsapp.net','fixture',0).lastInsertRowid;
      q.insertMessage.run(n,c,0,'fixture',0,null,'text',null,null,'fixture');
      q.insertLabel.run('fixture','#000000'); q.insertTemplate.run(null,'fixture','fixture');
      if(db.prepare('SELECT tenant_id FROM messages').get().tenant_id!=='default') throw Error('legacy write');
      db.close();`);
    assert.equal(result.status,0,result.stderr);
    result = run(`const {db}=await import('./src/db.js');
      if(db.prepare('SELECT count(*) n FROM messages').get().n!==1) throw Error('restart data');
      if(db.pragma('foreign_key_check').length) throw Error('FK'); db.close();`);
    assert.equal(result.status,0,result.stderr);
    env.MULTITENANT_ENABLED='1'; env.DATA_DIR=path.join(dir,'blocked');
    result = run("await import('./src/db.js')");
    assert.notEqual(result.status,0); assert.match(result.stderr,/foundation only/);
    assert.equal(fs.existsSync(env.DATA_DIR),false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('complete A/B fixture: every resource scoped; tenant-local keys; cross-tenant relations rejected', async () => {
  const { TENANT_TABLES } = await import('../src/tenantMigration.js');
  const { resolveTenantScope } = await import('../src/tenantScope.js');
  const h=twoTenants();
  try {
    for(const table of TENANT_TABLES) {
      for(const tenant of ['A','B']) assert.ok(h.db.prepare(`SELECT count(*) n FROM "${table}" WHERE tenant_id=?`).get(tenant).n>0,`${tenant}/${table}`);
      assert.throws(()=>h.db.prepare(`UPDATE "${table}" SET tenant_id='B' WHERE tenant_id='A'`).run(),/tenant/);
    }
    assert.throws(()=>h.db.prepare("UPDATE messages SET chat_id=20 WHERE id=10").run(),/tenant relationship/);
    assert.throws(()=>h.db.prepare("INSERT INTO chat_labels(chat_id,label_id,tenant_id) VALUES(10,20,'A')").run(),/tenant relationship/);
    assert.throws(()=>h.db.prepare("INSERT INTO tenant_members(tenant_id,user_id,role,created_at) VALUES('A',20,'owner',0)").run(),/UNIQUE/);
    h.db.prepare("INSERT INTO tenant_members(tenant_id,user_id,role,created_at) VALUES('B',10,'agent',0)").run();
    const req={headers:{cookie:'sid=session-A'}};
    assert.equal(resolveTenantScope(req,{database:h.db,enabled:true}).tenantId,'A');
    h.db.prepare("UPDATE sessions SET active_tenant_id='B' WHERE token='session-A'").run();
    assert.equal(resolveTenantScope(req,{database:h.db,enabled:true}).tenantId,'B');
    assert.throws(()=>resolveTenantScope({headers:{cookie:'sid=session-P'}},{database:h.db,enabled:true}),e=>e.status===403);
    assert.deepEqual(h.db.pragma('foreign_key_check'),[]);
    console.log('FULL_FIXTURE_MATRIX: A/B each owner+agent+2 numbers; all 21 resource tables PASS; shared keys PASS; immutable scope PASS; cross-tenant references PASS; multi-membership PASS; P denied PASS');
  }finally{h.close();}
});
