import assert from 'node:assert/strict';
import pg from 'pg';
import {createPostgresTenantAuth} from '../../src/postgresTenantAuth.js';

export async function verifyOperationPolicy({proxy,tenants}) {
  const [tenant]=tenants;
  const pool=new pg.Pool({...proxy,user:'app_login',max:2,connectionTimeoutMillis:5000});
  const stats={},auth=createPostgresTenantAuth(pool,stats);
  const req={headers:{cookie:'sid=alpha-load'}};
  const read=fn=>auth.withTenantRead(req,tenant,fn);
  try{
    const outside=await pool.query("SELECT current_setting('statement_timeout') AS statement");
    assert.equal(outside.rows[0].statement,'0');
    const pinned=await read(async({client})=>(await client.query(`SELECT current_setting('statement_timeout') AS statement,
      current_setting('idle_in_transaction_session_timeout') AS idle`)).rows[0]);
    assert.deepEqual(pinned,{statement:'2s',idle:'5s'});
    const attempts={};
    for(const code of ['40001','57P01','08006']){
      attempts[code]=0;
      const result=await read(async()=>{
        if(++attempts[code]<3)throw Object.assign(new Error('fixture transient failure'),{code});
        return tenant;
      });
      assert.equal(result,tenant);
    }
    let exhausted=0;
    await assert.rejects(read(async()=>{
      exhausted++;
      throw Object.assign(new Error('fixture repeated failure'),{code:'40001'});
    }),{code:'40001'});
    assert.equal(exhausted,3);
    await assert.rejects(read(({client})=>client.query('SELECT pg_sleep(3)')),{code:'57014'});
    assert.equal(stats.retries,8);
    let writeAttempts=0;
    await assert.rejects(auth.withTenantWrite(req,tenant,async()=>{
      writeAttempts++;
      throw Object.assign(new Error('fixture write failure'),{code:'40001'});
    }),{code:'40001'});
    assert.equal(writeAttempts,1);
    assert.equal(stats.contextViolations,0);
    return {pinned,prePolicyBacktest:outside.rows[0],attempts,retries:stats.retries,writeAttempts,contextViolations:0};
  }finally{await pool.end();}
}
