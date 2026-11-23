import assert from 'node:assert/strict';
import test from 'node:test';
import {setup} from '../scripts/phase-harness.mjs';
import {ensureSchema} from '../src/schemaMigrations.js';
import {migrateNumberOwnerAssignment} from '../src/numberOwnerAssignmentMigration.js';

test('number 4 owner assignment opens read and send guards only for the chosen agent',async()=>{
  process.env.ALLOW_AUTO_MIGRATE='1';
  const h=await setup('owner-assignment');
  try {
    const owner=await h.agent('fixture-owner');
    const other=await h.agent('fixture-other-agent');
    h.db.transaction(()=>{
      h.db.exec("UPDATE tenant_members SET role='agent' WHERE tenant_id='default' AND role='owner'");
      h.db.prepare("UPDATE tenant_members SET role='owner' WHERE tenant_id='default' AND user_id=?").run(owner.id);
      h.db.exec(`ALTER TABLE numbers DROP COLUMN owner_assignment;
        DELETE FROM schema_migrations WHERE version=11;
        DELETE FROM schema_ddl_hash WHERE version=11;
        INSERT INTO numbers(id,phone,name,created_at) VALUES(4,'fixture','fixture',0);
        INSERT INTO chats(id,number_id,jid) VALUES(4,4,'fixture@s.whatsapp.net');
        INSERT INTO messages(id,number_id,chat_id,ts,body) VALUES(4,4,4,1,'fixture message');
        INSERT INTO media_records(uuid,message_id,number_id,storage_path,created_at) VALUES('fixture',4,4,'fixture.bin',0);
        INSERT INTO tenants(id,name,created_at) VALUES('B','Other tenant',0);
        INSERT INTO numbers(id,phone,name,created_at,tenant_id) VALUES(5,'foreign','foreign',0,'B');
        INSERT INTO chats(id,number_id,jid,tenant_id) VALUES(5,5,'foreign@s.whatsapp.net','B')`);
    })();
    owner.cookie=await h.login('fixture-owner');
    const admin=await h.login();
    const read=(cookie,id=4)=>h.request(`/chats/${id}/messages`,'GET',undefined,cookie);
    // Empty text reaches validation only after authorization and never sends a message.
    const send=cookie=>h.request('/chats/4/send','POST',{text:''},cookie);
    const snapshot=()=>['chats','messages','media_records'].map(table=>h.db.prepare(`SELECT * FROM ${table}`).all());
    const before=snapshot();
    assert.equal((await read(owner.cookie)).status,403);
    assert.equal((await send(owner.cookie)).status,403);
    assert.equal((await send(other.cookie)).status,403);
    assert.equal((await read(admin)).status,200);
    const result=await ensureSchema(h.db,h.config);
    assert.equal(result.version,11);
    const get=()=>h.db.prepare('SELECT owner_id,owner_assignment FROM numbers WHERE id=4').get();
    assert.deepEqual(get(),{owner_id:owner.id,owner_assignment:'derived'});
    assert.equal((await read(owner.cookie)).status,200);
    assert.equal((await read(admin)).status,200);
    assert.equal((await read(owner.cookie,5)).status,404);
    assert.equal((await read(admin,5)).status,404);
    const allowed=await send(owner.cookie);
    assert.equal(allowed.status,400);
    assert.deepEqual(await allowed.json(),{error:'text kosong'});
    assert.equal((await send(other.cookie)).status,403);
    assert.deepEqual(snapshot(),before);
    assert.deepEqual(h.db.pragma('foreign_key_check'),[]);
    assert.deepEqual(await ensureSchema(h.db,{...h.config,allowAutoMigrate:false}),result);
    const rerun=h.db.transaction(()=>migrateNumberOwnerAssignment(h.db));
    rerun.immediate();
    assert.deepEqual(get(),{owner_id:owner.id,owner_assignment:'derived'});
    h.db.prepare("UPDATE numbers SET owner_id=?,owner_assignment='manual' WHERE id=4").run(other.id);
    rerun.immediate();
    assert.deepEqual(get(),{owner_id:other.id,owner_assignment:'manual'});
    h.db.exec("UPDATE numbers SET owner_id=NULL,owner_assignment=NULL WHERE id=4; DROP INDEX tenant_one_owner");
    h.db.prepare("UPDATE tenant_members SET role='owner' WHERE tenant_id='default' AND user_id=?").run(other.id);
    rerun.immediate();
    assert.deepEqual(get(),{owner_id:null,owner_assignment:null});
  } finally { await h.close(); }
});
