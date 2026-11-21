import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import Database from 'better-sqlite3';
import { twoTenants } from './tenant-fixture.mjs';
import { schemaFingerprint } from '../src/schemaFingerprint.js';
import { ensureSchema } from '../src/schemaMigrations.js';
import { dealReasons } from '../src/dealReasons.js';

const fixture = twoTenants();
Object.assign(process.env, { DATA_DIR: fixture.dir, ALLOW_AUTO_MIGRATE: '1', MULTITENANT_ENABLED: '0' });
const { db } = await import('../src/db.js');
const { classifyChat, queueDealDetection, sweepSilentClosings } = await import('../src/dealDetection.js');
const { classifyMessages } = await import('../src/dealClassifier.js');
const { runDealClassifier, classifierDropCounts, testPatterns, shutdown } = await import('../src/regexRunner.js');
test.after(() => { shutdown(); db.close(); fixture.close(); });

function message(chat, session, tenant, body, kind = 'text') {
  return Number(db.prepare('INSERT INTO messages(chat_id,number_id,tenant_id,body,kind,ts) VALUES(?,?,?,?,?,?)')
    .run(chat, session, tenant, body, kind, Date.now()).lastInsertRowid);
}
function chat(id, session, tenant) {
  db.prepare('INSERT INTO chats(id,number_id,tenant_id,jid) VALUES(?,?,?,?)').run(id, session, tenant, id + '@s.whatsapp.net');
}
const getDeal = id => db.prepare('SELECT * FROM deals WHERE chat_id=?').get(id);
const getRuns = id => db.prepare('SELECT * FROM classifier_runs WHERE chat_id=? ORDER BY id').all(id);

test('current fingerprint, foundation tables and backup', () => {
  const current = db.prepare('SELECT * FROM schema_migrations ORDER BY version DESC LIMIT 1').get();
  assert.equal(current.version, 8);
  assert.equal(current.fingerprint, schemaFingerprint(db));
  assert.equal(db.prepare('SELECT count(*) AS n FROM schema_migrations WHERE version=5').get().n, 1);
  for (const table of ['deals','deal_events','deal_evidence','deal_verifications','dp_payments','classifier_runs']) {
    assert.ok(db.pragma(`table_info(${table})`).length, table);
  }
  const backups = path.join(fixture.dir, 'migration-backups');
  const backup = new Database(path.join(backups, fs.readdirSync(backups)[0]), { readonly: true });
  try { assert.equal(backup.pragma('table_info(deals)').length, 0); }
  finally { backup.close(); }
});

test('v5 database upgrades with a v5 backup and existing messages intact', async () => {
  const dir = path.join(fixture.dir, 'upgrade');
  fs.mkdirSync(dir);
  const file = path.join(dir, 'app.db');
  await db.backup(file);
  const copy = new Database(file);
  try {
    copy.exec(`DROP TRIGGER deal_analytics_insert; DROP TRIGGER deal_analytics_dimensions; DROP TRIGGER deal_analytics_answered;
      DROP INDEX deal_analytics_opened; DROP INDEX deal_verification_by_decision; DROP INDEX deal_analytics_messages;
      ALTER TABLE messages DROP COLUMN analytics_source;
      DROP TABLE deal_event_types;
      ALTER TABLE tenants DROP COLUMN analytics_timezone; DROP TABLE deal_job_notices; DROP INDEX deals_review_queue; DROP INDEX deal_events_history;
      DROP TABLE deal_verifications; DROP TABLE dp_payments; DROP TABLE deal_events;
      DROP TABLE deal_evidence; DROP TABLE deals; DROP TABLE classifier_runs;
      DROP INDEX deal_messages_cursor; DELETE FROM schema_migrations WHERE version>=6;`);
    const v5 = schemaFingerprint(copy);
    assert.equal(v5, copy.prepare('SELECT fingerprint FROM schema_migrations WHERE version=5').get().fingerprint);
    await ensureSchema(copy, { dataDir: dir, allowAutoMigrate: true, migrationBackupKeep: 2 });
    const backups = path.join(dir, 'migration-backups');
    const backup = new Database(path.join(backups, fs.readdirSync(backups)[0]), { readonly: true });
    try {
      assert.equal(schemaFingerprint(backup), v5);
      assert.deepEqual(copy.prepare('SELECT id,tenant_id,body FROM messages ORDER BY id').all(),
        backup.prepare('SELECT id,tenant_id,body FROM messages ORDER BY id').all());
    } finally { backup.close(); }
  } finally { copy.close(); }
});

test('unsubstantiated paid suggestion stays awaiting proof, same range does not duplicate', async () => {
  chat(31, 10, 'A');
  const id = message(31, 10, 'A', 'Sudah saya bayar Rp 500.000 via transfer');
  let calls = 0;
  const classify = async batch => { calls++; return classifyMessages(batch); };
  await Promise.all([classifyChat(31, 'A', classify), classifyChat(31, 'A', classify)]);
  const deal = getDeal(31);
  assert.deepEqual([deal.state, deal.suggested_status, deal.amount], ['awaiting_proof','verified_lunas',500000]);
  assert.equal(getRuns(31).length, 1);
  await classifyChat(31, 'A', classify);
  assert.equal(calls, 2);
  const proof = message(31, 10, 'A', 'Ini bukti transfer', 'image');
  await classifyChat(31, 'A', async batch => {
    assert.deepEqual(batch.map(row => row.id), [proof]);
    return classifyMessages(batch);
  });
  assert.notEqual(id, proof);
  assert.equal(getDeal(31).state, 'awaiting_proof');
  assert.equal(getDeal(31).suggested_status, 'proof_submitted');
  assert.equal(getRuns(31).at(-1).status, 'priority');
  assert.equal(db.prepare('SELECT message_id FROM deal_evidence WHERE deal_id=?').get(deal.id).message_id, proof);
});

test('silent sweep combines separate signals once, without any WS client', async () => {
  chat(32, 20, 'B');
  message(32, 20, 'B', 'Total 350rb');
  message(32, 20, 'B', 'Metode QRIS');
  assert.equal(await sweepSilentClosings(), 1);
  assert.equal(await sweepSilentClosings(), 0);
  assert.equal(getDeal(32).state, 'awaiting_proof');
  assert.equal(getDeal(32).method, 'qris');
});

test('hung classifier terminates while next queued job and regex work', async () => {
  const fake = new EventEmitter();
  let killed = false;
  fake.unref = () => {};
  fake.postMessage = () => {};
  fake.terminate = async () => { killed = true; };
  shutdown();
  const stalled = runDealClassifier([{ id: 1, body: 'tes' }], { timeoutMs: 30, createWorker: () => fake });
  const healthy = runDealClassifier([{ id: 2, body: 'Rp 500000 QRIS' }]);
  const timedOut = assert.rejects(stalled, { code: 'timeout' });
  assert.deepEqual(await testPatterns([{ id: 7, pattern: 'abc' }], 'ABC', 500), [7]);
  await timedOut;
  assert.ok(killed);
  assert.equal((await healthy).nominal, 500000);
  assert.ok(classifierDropCounts().timeout >= 1);
});

test('ingest handoff returns before storing the classifier result', async () => {
  chat(33, 10, 'A');
  message(33, 10, 'A', 'Sudah bayar via QRIS');
  queueDealDetection(33, 'A');
  queueDealDetection(33, 'A');
  assert.equal(getDeal(33), undefined);
  for (let i = 0; i < 100 && !getDeal(33); i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(getDeal(33)?.state, 'awaiting_proof');
  assert.equal(getRuns(33).length, 1);
});

test('tenant boundaries, fixed reasons, required notes and append-only events', async () => {
  const deal = getDeal(31);
  const previous = getRuns(31).length;
  await classifyChat(31, 'B', () => { throw Error('out-of-scope classifier ran'); });
  assert.equal(getRuns(31).length, previous);
  assert.throws(() => db.prepare("INSERT INTO deals(tenant_id,session_id,chat_id,state,created_at) VALUES('B',10,31,'candidate',0)").run(), /tenant relationship/);
  assert.throws(() => db.prepare("UPDATE deals SET state='rejected' WHERE id=?").run(deal.id), /CHECK/);
  assert.throws(() => db.prepare("UPDATE deals SET state='rejected',reason_code='lain_lain' WHERE id=?").run(deal.id), /verification note/);
  const verify = db.prepare(`INSERT INTO deal_verifications(deal_id,decision,reason_code,note,"by",at)
    VALUES(?,'rejected','lain_lain',?,?,0)`);
  assert.throws(() => verify.run(deal.id, null, 10), /CHECK/);
  assert.throws(() => verify.run(deal.id, 'Terlalu pendek? valid', 20), /tenant relationship/);
  verify.run(deal.id, 'Alasan catatan valid', 10);
  db.prepare("UPDATE deals SET state='rejected',reason_code='lain_lain' WHERE id=?").run(deal.id);
  const event = db.prepare("INSERT INTO deal_events(deal_id,type,payload_json,actor,at) VALUES(?,'review','{}','10',0)").run(deal.id);
  assert.throws(() => db.prepare('UPDATE deal_events SET at=1 WHERE id=?').run(event.lastInsertRowid), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM deal_events WHERE id=?').run(event.lastInsertRowid), /append-only/);
  assert.equal(dealReasons.duplikat.reopenable, false);
  assert.equal(dealReasons.salah_nomor.reopenable, false);
  assert.equal(Object.keys(dealReasons).length, 21);
});
