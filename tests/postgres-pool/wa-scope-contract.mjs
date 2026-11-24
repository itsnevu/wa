import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import {createPostgresTenantAuth,sessionTokenHash} from '../../src/postgresTenantAuth.js';
import {ingestPostgresMessage,mediaSql,mediaStorageKey,openPostgresMedia,registerPostgresMedia,routeSql,ruleSql} from '../../src/postgresWaData.js';

export async function verifyWaScope({admin,proxy,tenants}) {
  const [a,b]=tenants;
  const id='00000000-0000-4000-8000-000000000001';
  const pool=new pg.Pool({...proxy,user:'app_login',max:5,connectionTimeoutMillis:5000});
  const stats={};
  const auth=createPostgresTenantAuth(pool,stats);
  const tempRoot=path.resolve(os.tmpdir());
  const root=await mkdtemp(path.join(tempRoot,'wa-media-scope-'));
  try {
    await admin.query(await readFile(new URL('./wa-scope.sql',import.meta.url),'utf8'));
    for(const [tenant,owner,jid,reply] of [[a,101,'a@s.whatsapp.net','A'],[b,102,'b@s.whatsapp.net','B']]){
      await admin.query('INSERT INTO tenant_data.wa_numbers VALUES($1::uuid,4,$2::bigint)',[tenant,owner]);
      await admin.query('INSERT INTO tenant_data.wa_chats VALUES($1::uuid,4,7,$2::text)',[tenant,jid]);
      await admin.query('INSERT INTO tenant_data.wa_rules VALUES($1::uuid,4,1,$2::text,$3::text,0,true)',[tenant,'hello',reply]);
    }
    const matchRule=(rules,body)=>rules.find(rule=>rule.pattern===body)?.id;
    const input={chatId:7,waId:'same-message',body:'hello',fromMe:false,ts:1000,event:'notify'};
    const ingest=(tenant,number,overrides={})=>auth.withTenantJob(tenant,tx=>
      ingestPostgresMessage(tx,number,{...input,...overrides},matchRule));
    const parallel=await Promise.all(Array.from({length:12},()=>ingest(a,4)));
    const created=parallel.filter(result=>!result.duplicate);
    assert.equal(created.length,1);
    assert.deepEqual(created[0].reply,{tenantId:a,numberId:4,jid:'a@s.whatsapp.net',text:'A'});
    const other=await ingest(b,4);
    assert.deepEqual(other.reply,{tenantId:b,numberId:4,jid:'b@s.whatsapp.net',text:'B'});
    assert.equal((await ingest(a,4,{waId:'history',event:'append'})).reply,null);
    await assert.rejects(ingest(a,5),{status:404});
    const old=await admin.query('SELECT jid FROM tenant_data.wa_chats WHERE number_id=4 AND id=7');
    assert.equal(old.rowCount,2);
    assert.throws(()=>mediaStorageKey(a,'../'+id),{status:404});
    assert.equal(await auth.withTenantJob(a,tx=>registerPostgresMedia(tx,4,created[0].messageId,id)),mediaStorageKey(a,id));
    await assert.rejects(auth.withTenantJob(b,tx=>registerPostgresMedia(tx,4,created[0].messageId,id)),{code:'23503'});
    await assert.rejects(admin.query('INSERT INTO tenant_data.wa_media VALUES($1::uuid,$2::uuid,4,$3::bigint,$4::text)',
      [b,id,other.messageId,mediaStorageKey(a,id)]),{code:'23514'});
    await mkdir(path.join(root,a));
    await writeFile(path.join(root,a,id),'private fixture');
    for(const [session,tenant,user] of [['wa-a',a,101],['wa-b',b,102]]){
      await admin.query(`INSERT INTO tenant_auth.sessions(token_hash,user_id,tenant_id,expires_at)
        VALUES($1::text,$2::bigint,$3::uuid,clock_timestamp()+interval '1 hour')`,[sessionTokenHash(session),user,tenant]);
    }
    const read=(session,tenant)=>auth.withTenantRead({headers:{cookie:'sid='+session}},tenant,tx=>openPostgresMedia(tx,id,root));
    assert.equal(await readFile(await read('wa-a',a),'utf8'),'private fixture');
    await assert.rejects(read('wa-b',b),{status:404});
    await auth.withTenantJob(a,async({client})=>{
      await client.query('SET LOCAL enable_seqscan=off');
      for(const [sql,params,index] of [[routeSql,[a,4,7],/wa_chats_pkey/],
        [ruleSql,[a,4],/wa_rules_active/],[mediaSql,[a,id],/wa_media_pkey/]]){
        const {rows}=await client.query('EXPLAIN '+sql,params);
        const plan=rows.map(row=>row['QUERY PLAN']).join(' ');
        assert.match(plan,index);assert.doesNotMatch(plan,/\bSort\b/);
      }
    });
    assert.equal(stats.contextViolations,0);
    return {duplicatesSuppressed:11,routingBacktestRows:2,tenantMediaDenied:404,contextViolations:0};
  }finally{
    await pool.end();
    assert.equal(path.dirname(path.resolve(root)),tempRoot);
    assert.ok(path.basename(root).startsWith('wa-media-scope-'));
    await rm(root,{recursive:true,force:true});
  }
}
