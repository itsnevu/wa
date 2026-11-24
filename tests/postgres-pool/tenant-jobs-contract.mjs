import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {createPostgresTenantAuth} from '../../src/postgresTenantAuth.js';
import {aiHistorySql,claimDealSql,claimPostgresDealJobs,controlReadiness,discoverJobTenants,
  readPostgresAiHistory,retentionSql,retainPostgresTenantMessages,withPostgresControl} from '../../src/postgresTenantJobs.js';

export async function verifyTenantJobs({admin,proxy,tenants}) {
  const [a,b]=tenants;
  await admin.query(await readFile(new URL('./tenant-jobs.sql',import.meta.url),'utf8'));
  await admin.query('INSERT INTO tenant_ops.active_tenants VALUES($1::uuid),($2::uuid)',[a,b]);
  await admin.query("INSERT INTO tenant_ops.readiness VALUES(true,11,3,'{}',900,2)");
  await admin.query("INSERT INTO tenant_data.deal_work VALUES($1::uuid,1,'pending'),($2::uuid,1,'pending')",[a,b]);
  const control=new pg.Pool({...proxy,user:'control_login',max:2,connectionTimeoutMillis:5000});
  const worker=new pg.Pool({...proxy,user:'app_login',max:3,connectionTimeoutMillis:5000});
  const stats={},app=createPostgresTenantAuth(worker,stats);
  const denied={code:'42501'};
  try {
    await assert.rejects(control.query('SELECT * FROM tenant_ops.readiness'),denied);
    await assert.rejects(withPostgresControl(control,db=>db.query('SELECT body FROM tenant_data.wa_messages')),denied);
    await assert.rejects(withPostgresControl(control,db=>db.query('SELECT token_hash FROM tenant_auth.sessions')),denied);
    assert.deepEqual(await withPostgresControl(control,db=>controlReadiness(db,11,1000)),{
      status:200,body:{ready:true,schema_version:11,metrics:{queue_depth:3,drops_by_reason:{},
        oldest_pending_job_age_ms:100,running_jobs:2}},
    });
    assert.equal((await withPostgresControl(control,db=>controlReadiness(db,12))).status,503);
    assert.deepEqual(await withPostgresControl(control,discoverJobTenants),[a,b]);
    const legacy=await admin.query('SELECT id FROM tenant_data.deal_work WHERE id=1');
    assert.equal(legacy.rowCount,2);
    for(const [tenant,count] of [[a,2],[b,1]]){
      assert.deepEqual(await app.withTenantJob(tenant,tx=>readPostgresAiHistory(tx,4,7)),
        Array.from({length:count},()=>({role:'user',content:'hello'})));
      await app.withTenantJob(tenant,async({client})=>{
        await client.query('SET LOCAL enable_seqscan=off');
        for(const [sql,args,index] of [[aiHistorySql,[tenant,4,7],/wa_history/],
          [claimDealSql,[tenant,1],/deal_work_(pending|pkey)/],
          [retentionSql,[tenant,2000],/wa_retention/]]){
          const {rows}=await client.query('EXPLAIN '+sql,args);
          const plan=rows.map(row=>row['QUERY PLAN']).join(' ');
          assert.match(plan,index);
          assert.doesNotMatch(plan,/\bSort\b/);
        }
      });
    }
    const claimed=await Promise.all(Array.from({length:3},()=>app.withTenantJob(a,tx=>claimPostgresDealJobs(tx,1))));
    assert.deepEqual(claimed.flat(),[{id:'1',tenant_id:a}]);
    assert.deepEqual((await admin.query('SELECT state FROM tenant_data.deal_work WHERE tenant_id=$1::uuid',[b])).rows,[{state:'pending'}]);
    assert.equal(await app.withTenantJob(a,tx=>retainPostgresTenantMessages(tx,2000)),2);
    assert.deepEqual(await app.withTenantJob(a,tx=>readPostgresAiHistory(tx,4,7)),[]);
    assert.equal((await app.withTenantJob(b,tx=>readPostgresAiHistory(tx,4,7))).length,1);
    assert.equal((await admin.query('SELECT id FROM tenant_data.wa_media WHERE tenant_id=$1::uuid',[a])).rowCount,0);
    assert.equal(stats.contextViolations,0);
    return {controlDeniedBusinessAndAuth:true,discoveredTenants:2,claims:1,
      rowsRetainedInOtherTenant:1,unscopedClaimBacktest:legacy.rowCount,contextViolations:0};
  } finally {
    await Promise.all([worker.end(),control.end()]);
  }
}
