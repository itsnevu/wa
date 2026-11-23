import assert from 'node:assert/strict';
import {once} from 'node:events';
import fs from 'node:fs';
import test from 'node:test';
import {twoTenants} from './tenant-fixture.mjs';

const fixture = twoTenants();
Object.assign(process.env, {DATA_DIR:fixture.dir, MULTITENANT_ENABLED:'0'});
const {createHttpSurface} = await import('../src/httpSurface.js');
const {db} = await import('../src/db.js');
db.prepare(`INSERT INTO sessions(id,user_id,expires_at,active_tenant_id,auth_version)
  SELECT 'session-fixture-agent', id, 9999999999999, 'A', auth_version FROM users WHERE id=11`).run();
const {configureTenantScope} = await import('../src/tenantScope.js');
configureTenantScope(db, true);
const {server,wss}=createHttpSurface();
const listening=once(server,'listening');
server.listen(0,'127.0.0.1');
await listening;
const base=`http://127.0.0.1:${server.address().port}/api/chats`;
const get=(id,query='')=>fetch(`${base}/${id}/messages${query}`,{headers:{cookie:'sid=session-A'}});
const insert=db.prepare("INSERT INTO messages(tenant_id,number_id,chat_id,body,ts) VALUES ('A',10,10,?,?)");
db.transaction(()=>{
  for(let i=0;i<500;i++)insert.run('fixture-page',100);
})();
const expected=db.prepare("SELECT id FROM messages WHERE tenant_id='A' AND chat_id=10 ORDER BY ts DESC,id DESC").pluck().all();
const byPage=rows=>rows.map(row=>row.id);

test.after(async()=>{
  wss.close();
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
  db.close();
  await fixture.closeAsync();
});

test('foreign chat is hidden even when the scoped user has no membership',async()=>{
  assert.equal((await get(20)).status,404);
  const {withTenantRead,readChatMessages}=await import('../src/chatMessageRead.js');
  const result=await withTenantRead('A',tx=>readChatMessages(tx,{tenantId:'A',userId:999,chatId:20,before:{ts:1000}}));
  assert.equal(result.status,404);
});

test('same-tenant chat with unauthorized number still returns 403',async()=>{
  const agent=await fetch(`${base}/10/messages`,{
    headers:{cookie:'sid=session-fixture-agent'},
  });
  assert.equal(agent.status,403);
});

test('full page and last page retain every ID across duplicate timestamps',async()=>{
  // One more row at the tie makes the 500/501 boundary cross the same timestamp.
  const newId=Number(insert.run('fixture-tie',100).lastInsertRowid);
  try{
    const first=await(await get(10)).json();
    const all=[newId,...expected];
    assert.equal(first.messages.length,500);
    assert.equal(first.hasMore,true);
    assert.equal(first.nextCursor,`100_${all[499]}`);
    const last=await(await get(10,`?before=${first.nextCursor}`)).json();
    assert.equal(last.hasMore,false);
    assert.equal(last.nextCursor,null);
    assert.deepEqual([...byPage(last.messages),...byPage(first.messages)],[...all].reverse());
    const legacy=await(await get(10,'?before=100')).json();
    assert.equal(legacy.hasMore,false);
    assert.deepEqual(byPage(legacy.messages),[all.at(-1)]);
  }finally{db.prepare('DELETE FROM messages WHERE id=?').run(newId);}
});

test('exactly 500 older rows does not advertise a next page',async()=>{
  const response=await get(10,`?before=100_${expected[0]}`);
  assert.equal(response.status,200);
  const page=await response.json();
  assert.equal(page.messages.length,500);
  assert.equal(page.hasMore,false);
  assert.equal(page.nextCursor,null);
});

test('malformed cursor is rejected',async()=>{
  for(const query of ['?before=1.5','?before=100_no','?before=1&before=2','?before=','?before=9007199254740993_1']){
    assert.equal((await get(10,query)).status,400);
  }
});

test('route calls the adapter only inside its tenant read wrapper',()=>{
  const text=fs.readFileSync(new URL('../src/routes.js',import.meta.url),'utf8');
  const route=text.match(/api\.get\('\/chats\/:chatId\/messages',[\s\S]*?\n\}\);/)?.[0] ?? '';
  assert.match(route,/requireTenantScope/);
  assert.match(route,/withTenantRead\(tenantId,\s*tx\s*=>\s*readChatMessages\(tx,/);
  assert.doesNotMatch(route,/\b(?:db|q)\s*\./);
});

test('371 ordered IDs match the reference and the final plan needs the chat index without sorting',async()=>{
  const {chatMessagePageSql}=await import('../src/chatMessageRead.js');
  const cursor=[100,expected[129]];
  const args=['A',10,...cursor];
  const reference=db.prepare(`SELECT id FROM messages WHERE tenant_id=? AND chat_id=? AND
    (ts < ? OR (ts=? AND id < ?)) ORDER BY ts,id`).pluck().all('A',10,cursor[0],...cursor);
  assert.equal(reference.length,371);
  const response=await get(10,`?before=${cursor.join('_')}`);
  assert.equal(response.status,200);
  assert.deepEqual(byPage((await response.json()).messages),reference);
  const verifyPlan=()=>{
    const detail=db.prepare('EXPLAIN QUERY PLAN '+chatMessagePageSql).all(...args).map(row=>row.detail).join('\n');
    assert.doesNotMatch(detail,/USE TEMP B-TREE.*ORDER BY/i);
    assert.match(detail,/idx_messages_chat/);
  };
  verifyPlan();
  db.exec('DROP INDEX idx_messages_chat');
  try { assert.throws(verifyPlan,/TEMP B-TREE/); }
  finally { db.exec('CREATE INDEX idx_messages_chat ON messages(chat_id, ts)'); }
});

test('membership revocation between statements cannot mix snapshots',async()=>{
  const {withTenantRead,readChatMessages}=await import('../src/chatMessageRead.js');
  const params={tenantId:'A',userId:10,chatId:10,before:{ts:1000}};
  const legacyRead=()=>db.prepare('SELECT body FROM messages WHERE chat_id=? ORDER BY ts DESC,id DESC LIMIT 1').pluck().get(10);
  assert.ok(db.prepare("SELECT 1 FROM tenant_members WHERE tenant_id='A' AND user_id=10").get());
  await withTenantRead('A',async tx=>{
    const first=await readChatMessages(tx,params);
    const original=legacyRead();
    db.transaction(()=>{
      db.prepare("DELETE FROM tenant_members WHERE tenant_id='A' AND user_id=10").run();
      insert.run('new-after-revocation',200);
    })();
    assert.notEqual(legacyRead(),original,'legacy unscoped read crosses snapshots');
    assert.deepEqual(await readChatMessages(tx,params),first);
    await assert.rejects(readChatMessages(tx,{...params,tenantId:'B'}),/Invalid tenant read scope/);
  });
  const next=await withTenantRead('A',tx=>readChatMessages(tx,params));
  assert.equal(next.status,403);
  await assert.rejects(readChatMessages({},params),/Invalid tenant read scope/);
});

test('dense 50,000-message chat traverses every ID exactly once',async()=>{
  const {withTenantRead,readChatMessages,parseMessageCursor}=await import('../src/chatMessageRead.js');
  const tenantId='B',chatId=20,userId=20;
  const add=db.prepare("INSERT INTO messages(tenant_id,number_id,chat_id,body,ts) VALUES ('B',20,20,'dense',?)");
  db.transaction(()=>{
    for(let i=0;i<49999;i++)add.run(100+Math.floor((i+17)/50));
  })();
  const reference=db.prepare("SELECT id FROM messages WHERE tenant_id='B' AND chat_id=20 ORDER BY ts DESC,id DESC").pluck().all();
  assert.equal(reference.length,50000);
  await withTenantRead(tenantId,async tx=>{
    let before={ts:2000};
    let offset=0;
    do{
      const page=await readChatMessages(tx,{tenantId,userId,chatId,before});
      assert.deepEqual(byPage(page.messages).reverse(),reference.slice(offset,offset+500));
      offset+=page.messages.length;
      assert.equal(page.hasMore,offset<reference.length);
      before=page.nextCursor===null ? null : parseMessageCursor(page.nextCursor);
    }while(before);
    assert.equal(offset,reference.length);
  });
});
