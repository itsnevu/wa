import assert from 'node:assert/strict';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import express from 'express';
import {twoTenants} from '../tenant-fixture.mjs';
import {config} from '../../src/config.js';
import * as sqlite from '../../src/chatMessageRead.js';
import * as postgres from '../../src/postgresChatMessageRead.js';
import {configureTenantScope,requireTenantScope} from '../../src/tenantScope.js';

const ids={owner:101,other:102,admin:103,chat:101,foreign:102};
const before={ts:2000,id:10000};

function seedRows(a,b) {
  return {
    tenants:[[a,'active',null],[b,'active',null]],
    users:[[ids.owner,'agent'],[ids.other,'agent'],[ids.admin,'admin']],
    members:[ids.owner,ids.other,ids.admin].map(id=>[a,id]),
    numbers:[[a,101,ids.owner],[b,102,null]],
    chats:[[a,101,101],[b,102,102]],
    labels:[[a,101,'Kontrak','blue']],
    messages:Array.from({length:501},(_,i)=>[a,1000+i,101,101,i%2,'isi '+i,1000]),
  };
}

function seedSqlite(db,s) {
  db.transaction(()=>{
    for(const row of s.tenants)db.prepare("INSERT INTO tenants(id,status,deleted_at,name,created_at) VALUES(?,?,?,'fixture',0)").run(...row);
    for(const [id,role] of s.users)db.prepare("INSERT INTO users(id,role,username,pass,created_at) VALUES(?,?,?,'fixture',0)").run(id,role,'stage-'+id);
    for(const row of s.members)db.prepare("INSERT INTO tenant_members(tenant_id,user_id,role,created_at) VALUES(?,?,'agent',0)").run(...row);
    for(const row of s.numbers)db.prepare("INSERT INTO numbers(tenant_id,id,owner_id,phone,name,created_at) VALUES(?,?,?,'fixture','fixture',0)").run(...row);
    for(const row of s.chats)db.prepare("INSERT INTO chats(tenant_id,id,number_id,jid) VALUES(?,?,?,'fixture@s.whatsapp.net')").run(...row);
    for(const row of s.labels)db.prepare("INSERT INTO labels(tenant_id,id,name,color) VALUES(?,?,?,?)").run(...row);
    db.prepare('INSERT INTO chat_labels(tenant_id,chat_id,label_id) VALUES(?,101,101)').run(s.tenants[0][0]);
    const insert=db.prepare('INSERT INTO messages(tenant_id,id,number_id,chat_id,from_me,body,ts) VALUES(?,?,?,?,?,?,?)');
    for(const row of s.messages)insert.run(...row);
  }).immediate();
}

async function seedPostgres(db,s) {
  for(const row of s.tenants)await db.query('INSERT INTO app.tenants VALUES($1::uuid,$2::text,$3::bigint)',row);
  for(const row of s.users)await db.query('INSERT INTO app.users VALUES($1::bigint,$2::text)',row);
  for(const row of s.members)await db.query('INSERT INTO app.tenant_members VALUES($1::uuid,$2::bigint)',row);
  for(const row of s.numbers)await db.query('INSERT INTO app.numbers VALUES($1::uuid,$2::bigint,$3::bigint)',row);
  for(const row of s.chats)await db.query('INSERT INTO app.chats VALUES($1::uuid,$2::bigint,$3::bigint)',row);
  for(const row of s.labels)await db.query('INSERT INTO app.labels VALUES($1::uuid,$2::bigint,$3::text,$4::text)',row);
  await db.query('INSERT INTO app.chat_labels VALUES($1::uuid,101,101)',[s.tenants[0][0]]);
  await db.query(`INSERT INTO app.messages(tenant_id,id,number_id,chat_id,from_me,body,ts)
    SELECT $1::uuid,1000+i,101,101,i%2=1,'isi '||i,1000 FROM generate_series(0,500) AS i`,[s.tenants[0][0]]);
}

async function verifyStagingRoute(fixture,pool,tenantId) {
  const userId=ids.owner;
  fixture.db.prepare(`INSERT INTO sessions(id,user_id,expires_at,active_tenant_id,auth_version)
    SELECT 'staging-owner',id,9999999999999,?,auth_version FROM users WHERE id=?`).run(tenantId,userId);
  configureTenantScope(fixture.db,true);
  const app=express();
  app.get('/chats/:id/messages',requireTenantScope,async(req,res)=>{
    const {tenantId,userId}=req.tenantScope;
    const chatId=Number(req.params.id);
    const before=sqlite.parseMessageCursor(req.query.before);
    const page=await postgres.withTenantRead(pool,tenantId,tx=>postgres.readChatMessages(tx,{tenantId,userId,chatId,before}));
    if(page.status)return res.status(page.status).json({error:page.error});
    res.json(page);
  });
  const server=app.listen(0,'127.0.0.1');
  try{
    await once(server,'listening');
    const base=`http://127.0.0.1:${server.address().port}/chats`;
    const request=(id,query='',cookie='sid=staging-owner')=>fetch(`${base}/${id}/messages${query}`,{headers:{cookie}});
    assert.equal((await request(ids.chat,'','')).status,401);
    assert.equal((await request(ids.chat,'?tenant_id=foreign')).status,403);
    assert.equal((await request(ids.foreign)).status,404);
    const success=await request(ids.chat,'?before=2000_10000');
    assert.equal(success.status,200);
    assert.equal((await success.json()).nextCursor,'1000_1001');
  }finally{
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
  }
}

async function contract(read,tenantId,revoke) {
  const scoped=(userId,chatId=ids.chat,cursor=before)=>read({tenantId,userId,chatId,before:cursor});
  const first=await scoped(ids.owner);
  assert.equal(first.messages.length,500);
  assert.deepEqual([first.hasMore,first.nextCursor],[true,'1000_1001']);
  const last=await scoped(ids.owner,ids.chat,{ts:1000,id:1001});
  assert.deepEqual([last.messages.map(m=>m.id),last.hasMore,last.nextCursor],[[1000],false,null]);
  assert.deepEqual(await scoped(ids.admin),first);
  assert.deepEqual(await scoped(ids.owner,ids.foreign),{status:404,error:'chat tidak ada'});
  assert.deepEqual(await scoped(ids.other),{status:403,error:'tidak punya akses'});
  await revoke();
  assert.deepEqual(await scoped(ids.owner),{status:403,error:'tidak punya akses'});
  assert.deepEqual(await scoped(ids.owner,ids.foreign),{status:404,error:'chat tidak ada'});
  return {first,last};
}

export async function verifyChatReadContract({admin,scoped,tenants}) {
  const fixture=twoTenants();
  const previous=config.dataDir;
  const [a,b]=tenants;
  try{
    config.dataDir=fixture.dir;
    const data=seedRows(a,b);
    seedSqlite(fixture.db,data);
    await admin.query(await readFile(new URL('./chat-read.sql',import.meta.url),'utf8'));
    await seedPostgres(admin,data);
    assert.doesNotMatch(fixture.db.prepare('EXPLAIN QUERY PLAN '+sqlite.chatMessagePageSql)
      .all(a,ids.chat,before.ts,before.id).map(row=>row.detail).join(' '),/TEMP B-TREE/);
    await scoped.transaction(a,async client=>{
      const plan=await client.query('EXPLAIN '+postgres.postgresMessagePageSql,[a,ids.chat,before.ts,before.id]);
      assert.match(plan.rows.map(row=>row['QUERY PLAN']).join(' '),/Index Scan using chat_read_page/);
      const flags=await client.query(`SELECT relrowsecurity,relforcerowsecurity FROM pg_class
        WHERE relnamespace='app'::regnamespace AND relname IN ('tenants','tenant_members','numbers','chats','messages','labels','chat_labels')`);
      assert.equal(flags.rowCount,7);assert.ok(flags.rows.every(row=>row.relrowsecurity&&row.relforcerowsecurity));
    });
    await assert.rejects(admin.query(`INSERT INTO app.messages(tenant_id,id,number_id,chat_id,body,ts)
      VALUES($1,999,101,101,$1::text,0)`,[a]),error=>error.code==='42P08');
    await verifyStagingRoute(fixture,scoped,a);
    const sqliteResult=await contract(params=>sqlite.withTenantRead(params.tenantId,tx=>sqlite.readChatMessages(tx,params)),a,
      ()=>fixture.db.prepare('DELETE FROM tenant_members WHERE tenant_id=? AND user_id=?').run(a,ids.owner));
    const pgResult=await contract(params=>postgres.withTenantRead(scoped,params.tenantId,tx=>postgres.readChatMessages(tx,params)),a,
      ()=>admin.query('DELETE FROM app.tenant_members WHERE tenant_id=$1::uuid AND user_id=$2::bigint',[a,ids.owner]));
    assert.deepEqual(pgResult,sqliteResult);
    return {drivers:['SQLite','PostgreSQL'],matchedMessages:501,parameterBacktest:'42P08',runtimeCallSites:0,stagingCallSites:1};
  } finally {
    config.dataDir=previous;
    await fixture.closeAsync();
  }
}
