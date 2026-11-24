import assert from 'node:assert/strict';
import {once} from 'node:events';
import {request as httpRequest} from 'node:http';
import {readFile} from 'node:fs/promises';
import express from 'express';
import pg from 'pg';
import * as guard from '../../src/loginGuard.js';
import {config} from '../../src/config.js';
import {cookieId,writeSessionCookie} from '../../src/sessionStore.js';
import {consumePostgresQuota,lookupMembership,sessionTokenHash} from '../../src/postgresTenantAuth.js';
import {createPostgresTransactions} from '../../src/database/transactions.js';

const denied=error=>error.code==='42501';
const expired=error=>error.status===401;
const cookie=token=>({headers:{cookie:`sid=${token}`}});

export async function verifyTenantAuth({admin,proxy,tenants}) {
  await admin.query(await readFile(new URL('./tenant-auth.sql',import.meta.url),'utf8'));
  const [a,b,c,d]=tenants;
  await admin.query("INSERT INTO tenant_data.tenants(id) SELECT unnest($1::uuid[])",[[a,b,c,d]]);
  await admin.query(`INSERT INTO tenant_auth.tenant_members VALUES
    (101,$1::uuid,'agent'),(103,$1::uuid,'agent'),(101,$2::uuid,'agent'),(102,$2::uuid,'agent'),
    (102,$3::uuid,'agent'),(102,$4::uuid,'agent')`,[a,b,c,d]);
  const issue=(token,user,tenant)=>admin.query(`INSERT INTO tenant_auth.sessions(token_hash,user_id,tenant_id,expires_at)
    VALUES($1::text,$2::bigint,$3::uuid,clock_timestamp()+interval '1 hour')`,[sessionTokenHash(token),user,tenant]);
  for(const session of [['alpha',101,a],['beta',102,b],['none',101,null],['race',101,a],['switch',101,a],
    ['role-change',101,a],['suspend',102,c],['delete',102,d]])await issue(...session);
  const stats={};
  const pool=new pg.Pool({...proxy,user:'app_login',max:5,connectionTimeoutMillis:5000});
  const auth=createPostgresTransactions(pool,undefined,stats);
  let server;
  try {
    const application=express();
    application.use(express.json());
    const hosts=new Map([['alpha.fixture.test',a],['beta.fixture.test',b]]);
    const resolveHost=req=>hosts.get(req.hostname);
    application.get('/resource',async(req,res)=>{
      const body=await auth.withTenantRead(req,resolveHost(req),async({client,tenantId})=>{
        const {rows}=await client.query('SELECT id FROM tenant_data.tenants ORDER BY id');
        assert.deepEqual(rows,[{id:tenantId}]);
        return {tenantId};
      });
      res.json(body);
    });
    application.post('/auth/switch',async(req,res)=>{
      const key=sessionTokenHash(cookieId(req)??'missing');
      if(guard.blocked(key,req.ip))return res.sendStatus(429);
      const target=hosts.get(req.body?.host);
      try {
        if(!target)return res.sendStatus(404);
        const replacement=await auth.rotate(req,resolveHost(req),target);
        guard.reset(key,req.ip);
        writeSessionCookie(res,replacement);
        res.json({ok:true});
      } catch(error) {
        if(error.status===401)guard.fail(key,req.ip);
        throw error;
      }
    });
    application.use((error,_request,res,_next)=>res.status(error.status||500).json({code:error.code||'ERROR'}));
    server=application.listen(0,'127.0.0.1');
    await once(server,'listening');
    const base=`http://127.0.0.1:${server.address().port}`;
    const request=(token,host='alpha.fixture.test',path='/resource',options={})=>new Promise((resolve,reject)=>{
      const req=httpRequest(base+path,{
        method:options.method,headers:{host,cookie:`sid=${token}`,'content-type':'application/json',
          ...(options.body ? {'content-length':Buffer.byteLength(options.body)} : {})},signal:AbortSignal.timeout(5000),
      },response=>{
        const chunks=[];
        response.on('data',data=>chunks.push(data));
        response.on('error',reject);
        response.on('end',()=>resolve(new Response(Buffer.concat(chunks),{
          status:response.statusCode,headers:{'set-cookie':response.headers['set-cookie']?.[0]??''},
        })));
      });
      req.on('error',reject);
      req.end(options.body);
    });
    const switchRequest=(token,host='beta.fixture.test')=>request(token,'alpha.fixture.test','/auth/switch',{
      method:'POST',body:JSON.stringify({host}),
    });
    const status=async(token,host)=>{const response=await request(token,host);await response.arrayBuffer();return response.status;};

    await assert.rejects(pool.query('SELECT token_hash FROM tenant_auth.sessions'),denied);
    await assert.rejects(pool.query('SELECT id FROM tenant_data.tenants'),denied);
    await assert.rejects(auth.withAuth(db=>db.query('SELECT id FROM tenant_data.tenants')),denied);
    await assert.rejects(auth.withAuth(db=>db.query("SELECT tenant_auth.set_member_role(101,$1::uuid,'owner')",[a])),denied);
    await assert.rejects(auth.withTenantRead(cookie('alpha'),a,({client})=>client.query('SELECT token_hash FROM tenant_auth.sessions')),denied);
    await assert.rejects(auth.withAuth(db=>lookupMembership(db,101,null)),/requires user_id and tenant_id/);
    await assert.rejects(auth.withAuth(db=>lookupMembership(db,undefined,a)),/requires user_id and tenant_id/);
    assert.equal(await auth.withAuth(db=>lookupMembership(db,102,a)),undefined);
    assert.equal(await status('none'),401);
    assert.equal(await status('alpha','beta.fixture.test'),404);
    assert.equal(await status('alpha'),200);
    assert.equal(await status('missing'),401);
    const disallowed=await request('beta','beta.fixture.test','/auth/switch',{
      method:'POST',body:JSON.stringify({host:'alpha.fixture.test'}),
    });
    assert.equal(disallowed.status,401);
    assert.equal(await status('beta','beta.fixture.test'),200);

    const raced=await Promise.allSettled([auth.rotate(cookie('race'),a),auth.rotate(cookie('race'),a)]);
    const winners=raced.filter(x=>x.status==='fulfilled');
    assert.equal(winners.length,1);
    assert.ok(expired(raced.find(x=>x.status==='rejected').reason));
    assert.equal(await status('race'),401);
    assert.equal(await status(winners[0].value.id),200);
    const live=await admin.query(`SELECT token_hash FROM tenant_auth.sessions WHERE token_hash=ANY($1::text[])
      AND expires_at>clock_timestamp()`,[[sessionTokenHash('race'),sessionTokenHash(winners[0].value.id)]]);
    assert.deepEqual(live.rows,[{token_hash:sessionTokenHash(winners[0].value.id)}]);

    const moved=await switchRequest('switch');
    assert.equal(moved.status,200);
    const replacement=moved.headers.get('set-cookie').match(/^sid=([^;]+)/)[1];
    assert.notEqual(replacement,'switch');
    assert.match(replacement,/^[A-Za-z0-9_-]{43}$/);
    assert.equal(Buffer.from(replacement,'base64url').length,32);
    assert.equal(await status('switch'),401);
    assert.equal(await status(replacement,'beta.fixture.test'),200);
    assert.equal(await status(replacement),404);
    assert.deepEqual((await admin.query('SELECT tenant_id,user_id,prior_tenant FROM tenant_data.session_audit')).rows,
      [{tenant_id:b,user_id:'101',prior_tenant:a}]);
    await moved.arrayBuffer();

    const reservations=await Promise.all(Array.from({length:12},()=>auth.withTenantWrite(cookie('alpha'),a,
      tx=>consumePostgresQuota(tx,4,'2026-11-24',3))));
    assert.equal(reservations.filter(Boolean).length,3);
    assert.equal(await auth.withTenantWrite(cookie('beta'),b,tx=>consumePostgresQuota(tx,4,'2026-11-24',3)),true);
    const quota=await admin.query('SELECT tenant_id,used FROM tenant_data.send_quota ORDER BY tenant_id');
    assert.deepEqual(quota.rows,[{tenant_id:a,used:3},{tenant_id:b,used:1}]);

    await admin.query("SELECT tenant_auth.set_member_role(101,$1::uuid,'owner')",[a]);
    assert.equal(await status('role-change'),401);
    assert.equal(await status(replacement,'beta.fixture.test'),200);
    await issue('revocable',101,a);
    await admin.query('SELECT tenant_auth.set_member_role(101,$1::uuid,NULL)',[a]);
    assert.equal(await status('revocable'),401);
    // Emulate an already-claimed session whose membership disappeared before business authorization.
    await issue('stale-membership',101,a);
    assert.equal(await status('stale-membership'),401);
    assert.equal((await admin.query(`SELECT 1 FROM tenant_auth.sessions WHERE token_hash=$1::text
      AND expires_at>clock_timestamp()`,[sessionTokenHash('stale-membership')])).rowCount,0);
    await admin.query('SELECT tenant_data.close_tenant($1::uuid,false)',[c]);
    await admin.query('SELECT tenant_data.close_tenant($1::uuid,true)',[d]);
    assert.equal((await admin.query(`SELECT 1 FROM tenant_auth.sessions WHERE token_hash=ANY($1::text[])
      AND expires_at>clock_timestamp()`,[['suspend','delete'].map(sessionTokenHash)])).rowCount,0);

    const requests=Array.from({length:100},(_,i)=>i%2?['beta',b]:[replacement,b]);
    // Include both tenants even after the revocation test.
    await admin.query("INSERT INTO tenant_auth.tenant_members VALUES(101,$1::uuid,'agent')",[a]);
    await issue('alpha-load',101,a);
    for(let i=0;i<requests.length;i+=2)requests[i]=['alpha-load',a];
    await Promise.all(requests.map(([token,tenantId])=>auth.withTenantRead(cookie(token),tenantId,async({client})=>{
      assert.deepEqual((await client.query('SELECT id FROM tenant_data.tenants')).rows,[{id:tenantId}]);
    })));
    assert.equal(stats.contextViolations,0);
    for(let i=0;i<config.loginMax;i++)assert.equal((await switchRequest('unrecognized')).status,401);
    assert.equal((await switchRequest('unrecognized')).status,429);

    const directRead=()=>pool.query('SELECT token_hash FROM tenant_auth.sessions LIMIT 1');
    // Negative control for a legacy login with direct grants instead of an explicit transaction role.
    await admin.query(`GRANT USAGE ON SCHEMA tenant_auth TO app_login;
      GRANT SELECT(token_hash) ON tenant_auth.sessions TO app_login`);
    try {
      await assert.rejects(assert.rejects(directRead(),denied),{code:'ERR_ASSERTION'});
    } finally {
      await admin.query(`REVOKE SELECT(token_hash) ON tenant_auth.sessions FROM app_login;
        REVOKE USAGE ON SCHEMA tenant_auth FROM app_login`);
    }
    await assert.rejects(directRead(),denied);
    return {parallelRotationWinners:1,quotaReservations:[3,1],alternatingAuthRequests:100,
      contextViolations:stats.contextViolations,checkouts:stats.checkouts,lookupWithoutKeys:'rejected',rateLimit:429,
      directGrantBacktest:true};
  } finally {
    if(server?.listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    await pool.end();
  }
}
