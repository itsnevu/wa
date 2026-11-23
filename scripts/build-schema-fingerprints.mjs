// Maintainer-only generator; review JSON diff. Never called by application startup.
import fs from 'node:fs';
import Database from 'better-sqlite3';
import {bootstrapLegacy} from '../src/legacySchema.js';
import {schemaFingerprint} from '../src/schemaFingerprint.js';
import {schemaDdlHash} from '../src/schemaDdlHash.js';
import {migrateTenantSchemaLocked} from '../src/tenantMigration.js';
import {migrateSessionSchema} from '../src/sessionMigration.js';
import {migrateMembershipFix} from '../src/membershipFixMigration.js';
import {migratePlatformSchema} from '../src/platformMigration.js';
import {migrateSessionHealth} from '../src/sessionHealthMigration.js';
import {migrateDeals} from '../src/dealMigration.js';
import {migrateDealReview} from '../src/dealReviewMigration.js';
import {migrateDealAnalytics} from '../src/dealAnalyticsMigration.js';
import {migrateDealAnalyticsV9} from '../src/dealAnalyticsV9Migration.js';
import {migrateNumberMembership} from '../src/numberMembershipMigration.js';
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
const v1=schemaFingerprint(db);
db.transaction(()=>migrateSessionSchema(db)).immediate();
const v2=schemaFingerprint(db);migrateMembershipFix(db);
const v3=schemaFingerprint(db);db.transaction(()=>migratePlatformSchema(db)).immediate();
const v4=schemaFingerprint(db);
db.transaction(()=>migrateSessionHealth(db)).immediate();
const v5=schemaFingerprint(db);
db.transaction(()=>migrateDeals(db)).immediate();
const v6=schemaFingerprint(db);
db.transaction(()=>migrateDealReview(db)).immediate();
const v7=schemaFingerprint(db);
db.transaction(()=>migrateDealAnalytics(db)).immediate();
const ddl = {};
function versionFingerprint(version) {
  if (version >= 9) ddl[`v${version}`] = schemaDdlHash(db);
  return schemaFingerprint(db);
}
const v8=versionFingerprint(8);
db.transaction(()=>migrateDealAnalyticsV9(db,{businessStart:0,businessEnd:0})).immediate();
const v9=versionFingerprint(9);
db.transaction(()=>migrateNumberMembership(db)).immediate();
const current=versionFingerprint(10);
fs.writeFileSync('src/schema-fingerprints.json',JSON.stringify({
  legacy,t01,v1,v2,v3,v4,v5,v6,v7,v8,v9,current,...(Object.keys(ddl).length ? {ddl} : {}),
},null,2)+'\n');
db.close();
