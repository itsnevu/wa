import assert from 'node:assert/strict';
import test from 'node:test';
import {twoTenants} from './tenant-fixture.mjs';
import {ensureSchema} from '../src/schemaMigrations.js';
import {migrateNumberMembership,numberMembershipGaps} from '../src/numberMembershipMigration.js';

test('v9 copy backfills verified number owners once and leaves unresolved rows alone', async()=>{
  const h=twoTenants();
  try {
    const db=h.db;
    db.exec(`DROP TABLE deal_evidence_settings;
      ALTER TABLE numbers DROP COLUMN owner_assignment;
      DELETE FROM schema_migrations WHERE version>=10;
      DELETE FROM schema_ddl_hash WHERE version>=10;
      DELETE FROM tenant_members WHERE (tenant_id='A' AND user_id IN (10,11)) OR (tenant_id='B' AND user_id=21)`);
    db.pragma('foreign_keys=OFF');
    db.exec("INSERT INTO numbers(id,phone,name,owner_id,created_at,tenant_id) VALUES (99,'bad','bad',999,0,'A')");
    assert.deepEqual(numberMembershipGaps(db),{missing:4,deterministic:3,unresolved:1});
    db.transaction(()=>migrateNumberMembership(db)).immediate();
    const roles=db.prepare("SELECT user_id,role FROM tenant_members WHERE tenant_id IN ('A','B') ORDER BY user_id").all();
    assert.deepEqual(roles,[{user_id:10,role:'owner'},{user_id:11,role:'agent'},{user_id:20,role:'owner'},{user_id:21,role:'agent'}]);
    assert.deepEqual(numberMembershipGaps(db),{missing:1,deterministic:0,unresolved:1});
    db.exec("DELETE FROM numbers WHERE id=99; DELETE FROM tenant_members WHERE tenant_id='B' AND user_id=21");
    db.pragma('foreign_keys=ON');
    const config={dataDir:h.dir,allowAutoMigrate:true,migrationBackupKeep:2};
    const upgraded=await ensureSchema(db,config);
    assert.equal(upgraded.version,12);
    assert.deepEqual(numberMembershipGaps(db),{missing:0,deterministic:0,unresolved:0});
    assert.deepEqual(await ensureSchema(db,{...config,allowAutoMigrate:false}),upgraded);
    const before=db.prepare("SELECT * FROM tenant_members ORDER BY tenant_id,user_id").all();
    db.transaction(()=>migrateNumberMembership(db)).immediate();
    assert.deepEqual(db.prepare("SELECT * FROM tenant_members ORDER BY tenant_id,user_id").all(),before);
  } finally { await h.closeAsync(); }
});
