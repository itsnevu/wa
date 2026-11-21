import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { bootstrapLegacy } from '../src/legacySchema.js';
import { migrateTenantSchemaLocked } from '../src/tenantMigration.js';
import { migrateSessionSchema } from '../src/sessionMigration.js';
import { migrateMembershipFix } from '../src/membershipFixMigration.js';
import { migratePlatformSchema } from '../src/platformMigration.js';
import { migrateSessionHealth } from '../src/sessionHealthMigration.js';
import { migrateDeals } from '../src/dealMigration.js';
import { migrateDealReview } from '../src/dealReviewMigration.js';
import { schemaFingerprint } from '../src/schemaFingerprint.js';

const known = JSON.parse(fs.readFileSync(new URL('../src/schema-fingerprints.json', import.meta.url), 'utf8'));
const DAY = 86400000;

// A genuine v7 database built by the same migration chain as scripts/build-schema-fingerprints.mjs,
// filled with v7-era deals. Returns ids of interesting rows.
export function buildV7(dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v7-fixture-'))) {
  const file = path.join(dir, 'app.db');
  const db = new Database(file);
  bootstrapLegacy(db, { adminUser: 'v7-admin', adminPass: 'v7-admin-password' });
  db.transaction(() => migrateTenantSchemaLocked(db, { backup: 'v7-fixture' })).immediate();
  db.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL, fingerprint TEXT NOT NULL, applied_at INTEGER NOT NULL)');
  db.prepare('INSERT INTO schema_migrations VALUES(1,?,?,0)').run('T01', known.v1);
  const steps = [[migrateSessionSchema,'T03 sessions'],[migrateMembershipFix,'T04 prerequisites'],[migratePlatformSchema,'T04 platform'],
    [migrateSessionHealth,'Session sync health'],[migrateDeals,'Deal foundation'],[migrateDealReview,'Deal review']];
  steps.forEach(([migrate,name],i) => {
    db.transaction(() => migrate(db)).immediate();
    db.prepare('INSERT INTO schema_migrations VALUES(?,?,?,0)').run(i + 2, name, known['v' + (i + 2)]);
  });
  if (schemaFingerprint(db) !== known.v7) throw Error('v7 fixture fingerprint mismatch');

  const T = Date.UTC(2026, 1, 2), ids = {};
  db.pragma('foreign_keys = ON');
  db.transaction(() => {
    const run = (sql, ...a) => Number(db.prepare(sql).run(...a).lastInsertRowid);
    run("INSERT INTO tenants(id,name,status,created_at) VALUES('T','Toko','active',0)");
    run("INSERT INTO users(id,username,pass,role,created_at) VALUES(500,'verifier','x','admin',0),(501,'agent','x','agent',0)");
    run("INSERT INTO tenant_members(tenant_id,user_id,role,created_at) VALUES('T',500,'owner',0),('T',501,'agent',0)");
    run("INSERT INTO numbers(id,phone,name,owner_id,created_at,tenant_id) VALUES(50,'62500','Toko utama',500,0,'T')");
    const chat = (id, name) => run("INSERT INTO chats(id,number_id,tenant_id,jid,name) VALUES(?,50,'T',?,?)", id, id + '@s.whatsapp.net', name);
    const deal = (key, chatId, state, extra = {}) => {
      ids[key] = run(`INSERT INTO deals(tenant_id,session_id,chat_id,state,origin,amount,paid_amount,amount_due,due_at,reason_code,created_at,decided_at)
        VALUES('T',50,?,?,?,1000000,?,?,?,?,?,?)`, chatId, state, extra.origin ?? 'direct', extra.paid ?? 0, extra.due ?? null,
        extra.dueAt ?? null, extra.reason ?? null, T, T + DAY);
    };
    const verify = (key, decision, reason = null) => run(`INSERT INTO deal_verifications(deal_id,decision,reason_code,"by",at) VALUES(?,?,?,500,?)`, ids[key], decision, reason, T + DAY);
    const decision = (key, payload) => run(`INSERT INTO deal_events(deal_id,type,payload_json,actor,at) VALUES(?,'decision',?,'500',?)`, ids[key], JSON.stringify(payload), T + DAY);

    chat(7001, 'Pembeli lunas'); deal('verified', 7001, 'verified_lunas');
    verify('verified', 'verified_lunas'); decision('verified', { from: 'proof_submitted', decision: 'verified_lunas', amount: 1000000 });
    ids.proofMessage = run("INSERT INTO messages(number_id,chat_id,tenant_id,from_me,body,kind,ts) VALUES(50,7001,'T',0,'Bukti transfer','image',?)", T);
    run("INSERT INTO deal_evidence(deal_id,message_id,kind) VALUES(?,?,'payment_attachment')", ids.verified, ids.proofMessage);

    chat(7002, 'Status lama'); deal('bareLunas', 7002, 'verified_lunas');                         // no decision recorded
    chat(7003, 'Ditolak lama'); deal('bareRejected', 7003, 'rejected', { reason: 'harga_tidak_cocok' });
    chat(7004, 'Pembeli DP'); deal('dp', 7004, 'dp_aktif', { origin: 'dp', paid: 500000, due: 500000, dueAt: T + 9 * DAY });
    run("INSERT INTO dp_payments(deal_id,amount,method,at) VALUES(?,500000,'transfer',?)", ids.dp, T + DAY);
    verify('dp', 'dp_aktif'); decision('dp', { from: 'candidate', decision: 'dp_aktif', amount: 1000000 });
    chat(7005, 'Belum diputuskan'); deal('undecided', 7005, 'candidate');
    run("INSERT INTO deal_events(deal_id,type,payload_json,actor,at) VALUES(?,'sla_escalated','{}',NULL,?)", ids.undecided, T + DAY);
  })();
  db.close();
  return { dir, file, ids, T };
}
