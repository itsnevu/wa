import fs from 'node:fs';
import path from 'node:path';
import { schemaFingerprint } from './schemaFingerprint.js';
import { bootstrapLegacy } from './legacySchema.js';
import { tenantMigrationDone, backupBeforeTenantMigration, migrationBackupStats } from './tenantMigration.js';

export const SCHEMA_VERSION=1;
export const VERSION_TABLE=`CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL, fingerprint TEXT NOT NULL, applied_at INTEGER NOT NULL)`;
const known=JSON.parse(fs.readFileSync(new URL('./schema-fingerprints.json',import.meta.url),'utf8'));
export async function ensureSchema(db,config) {
  const hasVersion=Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE name='schema_migrations' AND type='table'").get());
  const actual=schemaFingerprint(db);
  if(hasVersion) {
    const versions=db.prepare('SELECT * FROM schema_migrations ORDER BY version').all();
    if(versions.length!==1 || versions[0].version!==SCHEMA_VERSION) throw Error('Schema version mismatch; no migration registered for this version');
    if(actual!==known.current || versions[0].fingerprint!==known.current) throw Error('Schema fingerprint mismatch; startup refused');
    return;
  }
  if(!Object.values(known.legacy).includes(actual) && actual!==known.t01) throw Error('Schema fingerprint mismatch before migration; startup refused');
  if(!config.allowAutoMigrate) throw Error('Schema version 0 != 1; run ALLOW_AUTO_MIGRATE=1 node scripts/migrate-schema.mjs during maintenance');
  const dir=path.join(config.dataDir,'migration-backups');
  const backup=await backupBeforeTenantMigration(db,dir,config.migrationBackupKeep);
  const fk=db.pragma('foreign_keys',{simple:true}); db.pragma('foreign_keys = OFF');
  try {
    db.transaction(()=>{
      if(schemaFingerprint(db)!==actual) throw Error('Schema changed while waiting for BEGIN IMMEDIATE');
      if(!tenantMigrationDone(db)) bootstrapLegacy(db,config);
      // A single transaction owns legacy bootstrap, tenant rebuild and version record.
      if(!tenantMigrationDone(db)) migrateTenantSchemaLocked(db,{backup});
      db.exec(VERSION_TABLE);
      if(schemaFingerprint(db)!==known.current) throw Error('Unexpected migrated schema fingerprint');
      if(db.pragma('foreign_key_check').length) throw Error('Schema migration foreign key verification failed');
      db.prepare('INSERT INTO schema_migrations VALUES(?,?,?,?)').run(SCHEMA_VERSION,'T01',known.current,Date.now());
    }).immediate();
  } finally {db.pragma(`foreign_keys = ${fk?'ON':'OFF'}`);}
  console.log('[schema]',JSON.stringify({version:SCHEMA_VERSION,backup,...migrationBackupStats(dir)}));
}
// Imported separately so the public migration helper also remains independently testable.
import { migrateTenantSchemaLocked } from './tenantMigration.js';
