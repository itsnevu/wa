// Maintainer-only generator; review JSON diff. Never called by application startup.
import fs from 'node:fs';
import Database from 'better-sqlite3';
import {bootstrapLegacy} from '../src/legacySchema.js';
import {schemaFingerprint} from '../src/schemaFingerprint.js';
import {migrateTenantSchemaLocked} from '../src/tenantMigration.js';
const db=new Database(':memory:');
const legacy={empty:schemaFingerprint(db)};
bootstrapLegacy(db,{adminUser:'schema-fixture',adminPass:'schema-fixture-password'});
legacy.full=schemaFingerprint(db);
const missing=new Database(':memory:');
missing.exec(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='media_records'").all().map(r=>r.sql+';').join('\n'));
legacy.preMedia=schemaFingerprint(missing); missing.close();
db.transaction(()=>migrateTenantSchemaLocked(db,{backup:'schema-fixture'})).immediate();
const t01=schemaFingerprint(db);
db.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL, fingerprint TEXT NOT NULL, applied_at INTEGER NOT NULL)');
const current=schemaFingerprint(db);
fs.writeFileSync('src/schema-fingerprints.json',JSON.stringify({legacy,t01,current},null,2)+'\n');
db.close();
