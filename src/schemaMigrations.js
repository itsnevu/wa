import fs from 'node:fs';
import path from 'node:path';
import { schemaFingerprint } from './schemaFingerprint.js';
import { bootstrapLegacy } from './legacySchema.js';
import { tenantMigrationDone, backupBeforeTenantMigration, migrationBackupStats } from './tenantMigration.js';
import {migrateSessionSchema} from './sessionMigration.js';
import {migrateMembershipFix} from './membershipFixMigration.js';
import {migratePlatformSchema} from './platformMigration.js';

import {migrateSessionHealth} from './sessionHealthMigration.js';

import { migrateDeals } from './dealMigration.js';

export const SCHEMA_VERSION=6;
export const VERSION_TABLE=`CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL, fingerprint TEXT NOT NULL, applied_at INTEGER NOT NULL)`;
const known=JSON.parse(fs.readFileSync(new URL('./schema-fingerprints.json',import.meta.url),'utf8'));
export async function ensureSchema(db,config) {
  const hasVersion=Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE name='schema_migrations' AND type='table'").get());
  const actual=schemaFingerprint(db);
  let fromVersion=0;
  if(hasVersion) {
    const versions=db.prepare('SELECT * FROM schema_migrations ORDER BY version').all();
    fromVersion=versions.at(-1)?.version;
    if(![1,2,3,4,5,6].includes(fromVersion)||versions.length!==fromVersion||versions.some((r,i)=>r.version!==i+1))throw Error('Schema version mismatch; no migration registered for this version');
    const expected=fromVersion===1?known.v1:fromVersion===2?known.v2:fromVersion===3?known.v3:fromVersion===4?known.v4:fromVersion===5?known.v5:known.current;
    if(actual!==expected||versions.at(-1).fingerprint!==expected||versions[0].fingerprint!==known.v1)throw Error('Schema fingerprint mismatch; startup refused');
    if(fromVersion===SCHEMA_VERSION)return;
  }
  if(!hasVersion&&!Object.values(known.legacy).includes(actual) && actual!==known.t01) throw Error('Schema fingerprint mismatch before migration; startup refused');
  if(!config.allowAutoMigrate) throw Error(`Schema version ${fromVersion} != ${SCHEMA_VERSION}; run ALLOW_AUTO_MIGRATE=1 node scripts/migrate-schema.mjs during maintenance`);
  const dir=path.join(config.dataDir,'migration-backups');
  const backup=await backupBeforeTenantMigration(db,dir,config.migrationBackupKeep);
  const fk=db.pragma('foreign_keys',{simple:true}); db.pragma('foreign_keys = OFF');
  try {
    db.transaction(()=>{
      if(schemaFingerprint(db)!==actual) throw Error('Schema changed while waiting for BEGIN IMMEDIATE');
      if(!fromVersion&&!tenantMigrationDone(db)) bootstrapLegacy(db,config);
      // A single transaction owns legacy bootstrap, tenant rebuild and version record.
      if(!fromVersion&&!tenantMigrationDone(db)) migrateTenantSchemaLocked(db,{backup});
      if(!fromVersion){db.exec(VERSION_TABLE);db.prepare('INSERT INTO schema_migrations VALUES(?,?,?,?)').run(1,'T01',known.v1,Date.now());}
      if(fromVersion<2){migrateSessionSchema(db);db.prepare('INSERT INTO schema_migrations VALUES(?,?,?,?)').run(2,'T03 sessions',known.v2,Date.now());}
      if(fromVersion<3){migrateMembershipFix(db);db.prepare('INSERT INTO schema_migrations VALUES(?,?,?,?)').run(3,'T04 prerequisites',known.v3,Date.now());}
      if(fromVersion<4){migratePlatformSchema(db);db.prepare('INSERT INTO schema_migrations VALUES(?,?,?,?)').run(4,'T04 platform',known.v4,Date.now());}
      if(fromVersion<5){migrateSessionHealth(db);db.prepare('INSERT INTO schema_migrations VALUES(?,?,?,?)').run(5,'Session sync health',known.v5,Date.now());}
      migrateDeals(db);
      if(schemaFingerprint(db)!==known.current) throw Error('Unexpected migrated schema fingerprint');
      if(db.pragma('foreign_key_check').length) throw Error('Schema migration foreign key verification failed');
      db.prepare('INSERT INTO schema_migrations VALUES(?,?,?,?)').run(SCHEMA_VERSION,'Deal foundation',known.current,Date.now());
    }).immediate();
  } finally {db.pragma(`foreign_keys = ${fk?'ON':'OFF'}`);}
  console.log('[schema]',JSON.stringify({version:SCHEMA_VERSION,backup,...migrationBackupStats(dir)}));
}
// Imported separately so the public migration helper also remains independently testable.
import { migrateTenantSchemaLocked } from './tenantMigration.js';
