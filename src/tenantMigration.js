import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const TENANT_TABLES = Object.freeze([
  'activity', 'numbers', 'send_count', 'chats', 'messages', 'notifications',
  'rules', 'templates', 'labels', 'chat_labels', 'ai_settings', 'ai_usage',
  'ai_notice', 'ai_alerts', 'ai_seen', 'ai_logs', 'products', 'orders',
  'contacts', 'contacts_v2', 'media_records',
]);
const ident = value => `"${value.replaceAll('"', '""')}"`;
const exists = (db, table) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
export function tenantMigrationDone(db) {
  return exists(db, 'tenant_migrations') && Boolean(db.prepare("SELECT 1 FROM tenant_migrations WHERE id='T01'").get());
}

// SQLite backup API includes committed WAL pages. Never copy only the .db file.
export function migrationBackupStats(backupDir) {
  if(!fs.existsSync(backupDir)) return {backupCount:0,backupBytes:0};
  const files=fs.readdirSync(backupDir).filter(n=>/^pre-t01-[a-f0-9-]+\.sqlite$/.test(n)).map(n=>fs.lstatSync(path.join(backupDir,n))).filter(s=>s.isFile());
  return {backupCount:files.length,backupBytes:files.reduce((n,s)=>n+s.size,0)};
}
export async function backupBeforeTenantMigration(db, backupDir, keep=5) {
  if (db.inTransaction) throw new Error('T01 backup requires an independent connection outside a transaction');
  fs.mkdirSync(backupDir, { recursive: true });
  const file = path.resolve(backupDir, `pre-t01-${randomUUID()}.sqlite`);
  await db.backup(file);
  fs.chmodSync(file, 0o600);
  const files=fs.readdirSync(backupDir).filter(n=>/^pre-t01-[a-f0-9-]+\.sqlite$/.test(n)).map(name=>({name,stat:fs.lstatSync(path.join(backupDir,name))})).filter(f=>f.stat.isFile()).sort((a,b)=>b.stat.mtimeMs-a.stat.mtimeMs || b.name.localeCompare(a.name));
  // Always preserve the snapshot just created, including timestamp ties.
  const retained=[path.basename(file),...files.map(f=>f.name).filter(n=>n!==path.basename(file))].slice(0,Math.max(1,keep));
  for(const f of files) if(!retained.includes(f.name)) fs.unlinkSync(path.join(backupDir,f.name));
  return file;
}

export async function migrateTenantSchema(db, { backupDir }) {
  if (db.inTransaction) throw new Error('T01 requires an independent migration transaction');
  if (tenantMigrationDone(db)) return { skipped: true };
  const backup = await backupBeforeTenantMigration(db, backupDir);
  const fk = db.pragma('foreign_keys', { simple: true });
  db.pragma('foreign_keys = OFF');
  try {
    return db.transaction(() => migrateTenantSchemaLocked(db,{backup})).immediate();
  } finally { db.pragma(`foreign_keys = ${fk ? 'ON' : 'OFF'}`); }
}

export function migrateTenantSchemaLocked(db,{backup}) {
if(!db.inTransaction) throw Error('T01 requires BEGIN IMMEDIATE');
const tables = TENANT_TABLES.filter(t => exists(db, t));
      // BEGIN IMMEDIATE prevents another writer between backfill and contraction.
      if (tenantMigrationDone(db)) return { skipped: true };
      const before = Object.fromEntries(tables.map(t => [t, db.prepare(`SELECT count(*) n FROM ${ident(t)}`).get().n]));
      db.exec(`CREATE TABLE tenants (
        id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
        created_at INTEGER NOT NULL
      );
      CREATE TABLE tenant_members (
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('owner','tenant_admin','agent')),
        created_at INTEGER NOT NULL, PRIMARY KEY(tenant_id,user_id)
      );
      CREATE UNIQUE INDEX tenant_one_owner ON tenant_members(tenant_id) WHERE role='owner';
      CREATE INDEX tenant_members_user ON tenant_members(user_id,tenant_id);
      CREATE TABLE tenant_migrations(id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL, report_json TEXT NOT NULL);`);
      db.prepare("INSERT INTO tenants VALUES('default','Default','active',?)").run(Date.now());
      const owner = db.prepare("SELECT id FROM users ORDER BY CASE WHEN role='admin' THEN 0 ELSE 1 END,id LIMIT 1").get();
      db.prepare(`INSERT INTO tenant_members(tenant_id,user_id,role,created_at)
        SELECT 'default',id,CASE WHEN id=? THEN 'owner' WHEN role='admin' THEN 'tenant_admin' ELSE 'agent' END,? FROM users`)
        .run(owner?.id ?? -1, Date.now());
      db.exec('ALTER TABLE sessions ADD COLUMN active_tenant_id TEXT REFERENCES tenants(id)');
      db.exec("UPDATE sessions SET active_tenant_id='default'");
      // Expand nullable, backfill, verify, then rebuild with physical NOT NULL + FK.
      for (const table of tables) {
        db.exec(`ALTER TABLE ${ident(table)} ADD COLUMN tenant_id TEXT REFERENCES tenants(id)`);
        db.exec(`UPDATE ${ident(table)} SET tenant_id='default' WHERE tenant_id IS NULL`);
        if (db.prepare(`SELECT count(*) n FROM ${ident(table)} WHERE tenant_id IS NULL`).get().n) throw new Error(`T01 orphan: ${table}`);
      }
      for (const table of tables) {
        const original = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table).sql;
        const objects = db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name=? AND type IN ('index','trigger') AND sql IS NOT NULL").all(table);
        const tmp = `__t01_${table}`;
        let create = original.replace(/^(CREATE TABLE\s+(?:IF NOT EXISTS\s+)?)(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|\w+)/i, `$1${ident(tmp)}`)
          .replace(/tenant_id TEXT REFERENCES tenants\(id\)/, "tenant_id TEXT NOT NULL DEFAULT 'default' REFERENCES tenants(id)");
        // Global natural keys become tenant-local; numeric resource IDs remain global.
        create = create.replace(/\b(phone|name|sku|code)\s+(TEXT\s+(?:NOT NULL\s+)?)UNIQUE/gi, '$1 $2');
        if (table === 'contacts' || table === 'ai_seen') {
          create = create.replace(/\b(jid|wa_id) TEXT PRIMARY KEY/i, '$1 TEXT NOT NULL');
        }
        const sequence = exists(db, 'sqlite_sequence') ? db.prepare('SELECT seq FROM sqlite_sequence WHERE name=?').get(table)?.seq : undefined;
        db.exec(create);
        const columns = db.prepare(`PRAGMA table_info(${ident(table)})`).all().map(c => ident(c.name)).join(',');
        db.exec(`INSERT INTO ${ident(tmp)} (${columns}) SELECT ${columns} FROM ${ident(table)}`);
        db.exec(`DROP TABLE ${ident(table)}`);
        db.exec(`ALTER TABLE ${ident(tmp)} RENAME TO ${ident(table)}`);
        if (sequence !== undefined) {
          const updated = db.prepare('UPDATE sqlite_sequence SET seq=max(seq,?) WHERE name=?').run(sequence, table);
          if (!updated.changes) db.prepare('INSERT INTO sqlite_sequence(name,seq) VALUES(?,?)').run(table, sequence);
        }
        for (const object of objects) db.exec(object.sql);
        db.exec(`CREATE INDEX ${ident(`idx_${table}_tenant`)} ON ${ident(table)}(tenant_id)`);
        const key = { numbers: 'phone', labels: 'name', products: 'sku', orders: 'code', contacts: 'jid', ai_seen: 'wa_id' }[table];
        if (key) db.exec(`CREATE UNIQUE INDEX ${ident(`uq_${table}_tenant_key`)} ON ${ident(table)}(tenant_id,${ident(key)})`);
      }
      // Reject cross-tenant links, including legacy contacts_v2.number_id without FK.
      for (const table of tables) {
        const refs = db.prepare(`PRAGMA foreign_key_list(${ident(table)})`).all().filter(r => tables.includes(r.table));
        if (table === 'contacts_v2') refs.push({ from: 'number_id', table: 'numbers', to: 'id' });
        for (const ref of refs) {
          const predicate = `NEW.${ident(ref.from)} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${ident(ref.table)} p WHERE p.${ident(ref.to)}=NEW.${ident(ref.from)} AND p.tenant_id=NEW.tenant_id)`;
          for (const event of ['INSERT', 'UPDATE']) db.exec(`CREATE TRIGGER ${ident(`tenant_${table}_${ref.from}_${event}`)} BEFORE ${event} ON ${ident(table)} WHEN ${predicate} BEGIN SELECT RAISE(ABORT,'tenant relationship mismatch'); END`);
        }
        // Moving resources between tenants must be an explicit future migration.
        db.exec(`CREATE TRIGGER ${ident(`tenant_${table}_immutable`)} BEFORE UPDATE OF tenant_id ON ${ident(table)} WHEN NEW.tenant_id IS NOT OLD.tenant_id BEGIN SELECT RAISE(ABORT,'tenant is immutable'); END`);
      }
      const report = { backup, defaultOwnerId:owner?.id ?? null, tables: tables.map(name => ({ name, before: before[name],
        after: db.prepare(`SELECT count(*) n FROM ${ident(name)}`).get().n,
        unscoped: db.prepare(`SELECT count(*) n FROM ${ident(name)} WHERE tenant_id IS NULL`).get().n })) };
      if (report.tables.some(t => t.before !== t.after || t.unscoped)) throw new Error('T01 row verification failed');
      if (db.pragma('foreign_key_check').length) throw new Error('T01 foreign key verification failed');
      db.prepare("INSERT INTO tenant_migrations VALUES('T01',?,?)").run(Date.now(), JSON.stringify(report));
      return report;

}
