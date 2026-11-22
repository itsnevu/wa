import { createHash } from 'node:crypto';

const LAST_LEGACY_VERSION = 8;
const LEDGER_DDL = `CREATE TABLE schema_ddl_hash (
  version INTEGER PRIMARY KEY,
  hash TEXT NOT NULL CHECK(length(hash) = 64),
  grandfathered INTEGER NOT NULL CHECK(grandfathered IN (0, 1) AND (version <= 8 OR grandfathered = 0)),
  created_at INTEGER NOT NULL
)`;

export function schemaDdlHash(db) {
  const definitions = db.prepare(`
    SELECT type, name, tbl_name, sql FROM sqlite_master
    WHERE name NOT GLOB 'sqlite_*' AND name != 'schema_ddl_hash'
    ORDER BY type, name
  `).all().map(({ type, name, tbl_name, sql }) => [
    type, name, tbl_name, sql?.replace(/\s+/g, ' ').trim() ?? null,
  ]);
  return createHash('sha256').update(JSON.stringify(definitions)).digest('hex');
}

function ledgerExists(db) {
  const entry = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'schema_ddl_hash'").get();
  if (entry && entry.sql !== LEDGER_DDL) {
    throw Error('Invalid schema_ddl_hash table; startup refused. Restore a verified backup.');
  }
  return Boolean(entry);
}

export function recordSchemaDdl(db, version, grandfathered = false) {
  const hash = schemaDdlHash(db);
  if (!ledgerExists(db)) db.exec(LEDGER_DDL);
  // A re-run migration (e.g. after restoring an older backup) supersedes a stale ledger row.
  db.prepare(`INSERT INTO schema_ddl_hash (version, hash, grandfathered, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(version) DO UPDATE SET hash = excluded.hash, grandfathered = excluded.grandfathered, created_at = excluded.created_at`)
    .run(version, hash, Number(grandfathered), Date.now());
  return { version, hash };
}

export function verifySchemaDdl(db, version, { upgrading = false } = {}) {
  const enrolled = ledgerExists(db);
  if (!enrolled && version <= LAST_LEGACY_VERSION) {
    const status = recordSchemaDdl(db, version, true);
    console.warn(`[schema] DDL version ${version} grandfathered; recorded hash ${status.hash}`);
    return status;
  }

  const recorded = enrolled
    ? db.prepare('SELECT hash, grandfathered FROM schema_ddl_hash WHERE version = ?').get(version)
    : undefined;
  const hash = schemaDdlHash(db);
  if (recorded?.grandfathered) {
    console.warn(`[schema] DDL version ${version} grandfathered; recorded hash ${recorded.hash}; current hash ${hash}`);
  }
  if (recorded?.hash !== hash && (!recorded?.grandfathered || upgrading)) {
    throw Error(`Schema DDL hash mismatch for version ${version}; recorded hash ${recorded?.hash ?? '(missing)'}; current hash ${hash}. Restore a verified backup or rerun the migration on a copy.`);
  }
  return { version, hash };
}
