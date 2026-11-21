import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import Database from 'better-sqlite3';
import {twoTenants} from './tenant-fixture.mjs';

const fixture=twoTenants();
Object.assign(process.env,{DATA_DIR:fixture.dir,ALLOW_AUTO_MIGRATE:'1',MULTITENANT_ENABLED:'0'});
const {createHttpSurface}=await import('../src/httpSurface.js');
const {db}=await import('../src/db.js');
const {config}=await import('../src/config.js');
const {hashPassword}=await import('../src/passwords.js');
const scope=await import('../src/tenantScope.js');
db.prepare('UPDATE users SET pass=?').run(hashPassword('fixture-password-123'));
config.multitenantEnabled=true;
const h=createHttpSurface();await new Promise(r=>h.server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${h.server.address().port}`;
const request=async(path,{cookie,body,method='GET',ua='fixture-A'}={})=>{
  const r=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json','User-Agent':ua,...(cookie?{cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0],setCookie:r.headers.get('set-cookie')};
};
const login=async(name='A-0',cookie)=>{const r=await request('/login',{method:'POST',body:{username:name,password:'fixture-password-123'},cookie});assert.equal(r.status,200);if(config.multitenantEnabled)db.prepare('UPDATE sessions SET active_tenant_id=NULL WHERE id=?').run(r.cookie.slice(4));return r;};
const select=async(cookie,tenant_id='A')=>{const r=await request('/tenant/switch',{cookie,method:'POST',body:{tenant_id}});assert.equal(r.status,200,JSON.stringify(r));return r;};
const selected=async()=>select((await login()).cookie);
const code=(r,status,value)=>{assert.equal(r.status,status,JSON.stringify(r.data));assert.equal(r.data.code,value);};
test.beforeEach(()=>{
  db.exec("DELETE FROM sessions; UPDATE tenants SET status='active';");
  db.prepare("INSERT OR IGNORE INTO tenant_members(tenant_id,user_id,role,created_at) VALUES('A',10,'owner',0)").run();
  db.prepare("UPDATE tenant_members SET role='owner' WHERE tenant_id='A' AND user_id=10").run();
});
test.after(async()=>{h.wss.close();h.server.closeAllConnections();await new Promise(r=>h.server.close(r));db.close();fixture.close();});

test('01 scoped routes invoke real resolver (spy), including /me and switch',async()=>{
  assert.ok(scope.tenantResolver,'spyable real resolver');
  const original=scope.tenantResolver.resolve;let calls=0;
  scope.tenantResolver.resolve=(...args)=>{calls++;return original(...args);};
  try{
    for(const [method,path,body] of [
      ['GET','/me'],['POST','/tenant/switch',{tenant_id:'A'}],['POST','/logout'],
      ['POST','/password',{}],['POST','/logout-all'],['PATCH','/me',{username:'x'}],
      ['GET','/users'],['POST','/users',{}],['DELETE','/users/999999'],
      ['GET','/sessions'],['DELETE','/sessions/unknown'],['GET','/platform/session'],
    ]){const a=await selected();calls=0;await request(path,{method,body,cookie:a.cookie});assert.ok(calls>0,`${method} ${path} did not invoke resolver`);}
    const a=await selected();calls=0;assert.equal(await handshake(a.cookie),101);assert.ok(calls>0,'UPGRADE /ws did not invoke resolver');
  }finally{scope.tenantResolver.resolve=original;}
});
test('02 public health/login/static never invoke tenant resolver',async()=>{
  assert.ok(scope.tenantResolver);const original=scope.tenantResolver.resolve;let calls=0;scope.tenantResolver.resolve=(...args)=>{calls++;return original(...args);};
  try{await request('/health');await login();assert.equal((await fetch(base+'/')).status,200);assert.equal(calls,0);}finally{scope.tenantResolver.resolve=original;}
});
test('03 contract: missing, revoked and expired sessions => 401 SESSION_INVALID',async()=>{
  code(await request('/me'),401,'SESSION_INVALID');
  const a=await login();await request('/logout',{method:'POST',cookie:a.cookie});code(await request('/me',{cookie:a.cookie}),401,'SESSION_INVALID');
});
test('04 contract: valid null tenant => 409 TENANT_NOT_SELECTED',async()=>{code(await request('/users',{cookie:(await login()).cookie}),409,'TENANT_NOT_SELECTED');});
test('05 contract: non-member active tenant => 403 TENANT_FORBIDDEN and reselection',async()=>{
  const a=await selected();db.exec("DELETE FROM tenant_members WHERE tenant_id='A' AND user_id=10");
  const r=await request('/users',{cookie:a.cookie});code(r,403,'TENANT_FORBIDDEN');assert.equal(r.data.select_tenant,true);
});
test('06 contract: suspended tenant => 403 TENANT_SUSPENDED',async()=>{const a=await selected();db.exec("UPDATE tenants SET status='suspended' WHERE id='A'");code(await request('/users',{cookie:a.cookie}),403,'TENANT_SUSPENDED');});
test('07 contract: other users session resource => 404',async()=>{const a=await login();const b=await login('B-0');assert.equal((await request('/sessions/'+b.cookie.slice(4),{method:'DELETE',cookie:a.cookie})).status,404);});
test('08 contract: platform admin without tenant can use platform route',async()=>{
  db.prepare("UPDATE users SET platform_role='admin' WHERE id=1").run();const p=await login('platform-fixture');
  assert.equal((await request('/platform/session',{cookie:p.cookie})).status,200);assert.equal((await request('/me',{cookie:p.cookie})).status,200);code(await request('/users',{cookie:p.cookie}),409,'TENANT_NOT_SELECTED');
});
test('09 fixation: pre-login cookie is never promoted',async()=>{
  const fake='sid='+'a'.repeat(64);const a=await login('A-0',fake);assert.notEqual(a.cookie,fake);code(await request('/me',{cookie:fake}),401,'SESSION_INVALID');
});
test('10 login rotation atomically kills presented ID; GRACE_MS=0 boundaries',async()=>{
  const store=await import('../src/sessionStore.js');assert.equal(store.GRACE_MS,0);
  const a=await login();const next=await login('A-0',a.cookie);assert.notEqual(next.cookie,a.cookie);
  code(await request('/me',{cookie:a.cookie}),401,'SESSION_INVALID');assert.equal((await request('/me',{cookie:next.cookie})).status,200);
  const row=db.prepare('SELECT * FROM sessions WHERE id=?').get(a.cookie.slice(4));assert.ok(row.revoked_at!==null);assert.equal(db.prepare('SELECT rotated_from FROM sessions WHERE id=?').get(next.cookie.slice(4)).rotated_from,row.id);
  code(await request('/me',{cookie:a.cookie}),401,'SESSION_INVALID');
});
test('11 tenant switch rotates, revokes old ID, and selects membership',async()=>{
  const a=await login();const next=await select(a.cookie);assert.notEqual(next.cookie,a.cookie);code(await request('/me',{cookie:a.cookie}),401,'SESSION_INVALID');assert.equal((await request('/me',{cookie:next.cookie})).data.active_tenant_id,'A');
});
test('12 role change uses atomic rotation and invalidates old IDs',async()=>{
  const store=await import('../src/sessionStore.js');const a=await selected();
  const next=store.changeMembershipRole({tenantId:'A',userId:10,role:'tenant_admin',sessionId:a.cookie.slice(4)});
  assert.ok(next.id);code(await request('/me',{cookie:a.cookie}),401,'SESSION_INVALID');assert.equal((await request('/me',{cookie:'sid='+next.id})).status,200);
});
test('13 user-agent changes remain valid and ua_hash is observed server-side',async()=>{
  const a=await login();assert.equal((await request('/me',{cookie:a.cookie,ua:'another-device-UA'})).status,200);
  const row=db.prepare('SELECT ua_hash FROM sessions WHERE id=?').get(a.cookie.slice(4));assert.equal(row.ua_hash,createHash('sha256').update('another-device-UA').digest('hex'));
});
test('14 logout revokes the row, clears cookie and next request is 401',async()=>{
  const a=await login();const out=await request('/logout',{method:'POST',cookie:a.cookie});assert.equal(out.status,200);assert.match(out.setCookie,/Max-Age=0/);assert.ok(db.prepare('SELECT revoked_at FROM sessions WHERE id=?').get(a.cookie.slice(4)).revoked_at!==null);code(await request('/me',{cookie:a.cookie}),401,'SESSION_INVALID');
});
test('15 list and revoke another device; own/foreign account boundary',async()=>{
  const a=await login();const other=await login();const list=await request('/sessions',{cookie:a.cookie});assert.equal(list.status,200);assert.equal(list.data.sessions.length,2);
  const target=list.data.sessions.find(s=>!s.current);assert.ok(target);assert.equal((await request('/sessions/'+target.id,{method:'DELETE',cookie:a.cookie})).status,200);code(await request('/me',{cookie:other.cookie}),401,'SESSION_INVALID');assert.equal((await request('/me',{cookie:a.cookie})).status,200);
});
test('16 switch to non-membership =>403 and session unchanged',async()=>{
  const a=await login();code(await request('/tenant/switch',{method:'POST',cookie:a.cookie,body:{tenant_id:'B'}}),403,'TENANT_FORBIDDEN');assert.equal((await request('/me',{cookie:a.cookie})).status,200);
});
test('17 array/object tenant_id are forbidden without rotation',async()=>{
  const a=await login();for(const tenant_id of [['A'],{id:'A'}])code(await request('/tenant/switch',{method:'POST',cookie:a.cookie,body:{tenant_id}}),403,'TENANT_FORBIDDEN');assert.equal((await request('/me',{cookie:a.cookie})).status,200);
});
test('18 /me works with null active tenant and lists memberships/roles',async()=>{const a=await login();const r=await request('/me',{cookie:a.cookie});assert.equal(r.status,200);assert.equal(r.data.active_tenant_id,null);assert.equal(r.data.tenants[0].id,'A');assert.equal(r.data.tenants[0].role,'owner');});
async function handshake(cookie){return new Promise(resolve=>{const socket=new WebSocket(base.replace('http:','ws:')+'/ws',{headers:cookie?{cookie}:{}});socket.on('open',()=>{socket.close();resolve(101);});socket.on('unexpected-response',(_req,res)=>{res.resume();socket.terminate();resolve(res.statusCode);});socket.on('error',()=>{});});}
test('19 /ws rejects absent session',async()=>{assert.equal(await handshake(),401);});
test('20 /ws rejects null tenant',async()=>{assert.equal(await handshake((await login()).cookie),409);});
test('21 /ws accepts a current valid tenant',async()=>{assert.equal(await handshake((await selected()).cookie),101);});
test('22 expired rows are actually deleted',async()=>{
  const a=await login();db.prepare('UPDATE sessions SET expires_at=0 WHERE id=?').run(a.cookie.slice(4));code(await request('/me',{cookie:a.cookie}),401,'SESSION_INVALID');assert.equal(db.prepare('SELECT 1 FROM sessions WHERE id=?').get(a.cookie.slice(4)),undefined);
});
test('23 login -> me -> select tenant -> inbox has no unexpected 409',async()=>{
  const a=await login();assert.equal((await request('/me',{cookie:a.cookie})).status,200);const next=await select(a.cookie);assert.equal((await request('/numbers',{cookie:next.cookie})).status,200);
});
test('24 feature flag off keeps legacy default tenant workflow',async()=>{
  config.multitenantEnabled=false;
  try{const a=await login();const me=await request('/me',{cookie:a.cookie});assert.equal(me.status,200);assert.equal(me.data.tenant_mode,false);assert.equal((await request('/numbers',{cookie:a.cookie})).status,200);}finally{config.multitenantEnabled=true;}
});
test('25 membership add/remove rotates atomically, and grace boundaries reject old IDs',async()=>{
  const store=await import('../src/sessionStore.js');const a=await selected();const other=await login();
  const added=store.changeMembership({tenantId:'B',userId:10,role:'agent',sessionId:a.cookie.slice(4)});
  for(const old of [a,other])code(await request('/me',{cookie:old.cookie}),401,'SESSION_INVALID');
  for(const offset of [0,1])assert.throws(()=>store.readSession({headers:{cookie:a.cookie}},{now:added.created_at+offset}),e=>e.code==='SESSION_INVALID');
  assert.equal(store.readSession({headers:{cookie:'sid='+added.id}},{now:added.created_at}).user_id,10);
  const removed=store.changeMembership({tenantId:'A',userId:10,role:null,sessionId:added.id});
  code(await request('/me',{cookie:'sid='+added.id}),401,'SESSION_INVALID');
  assert.equal((await request('/me',{cookie:'sid='+removed.id})).data.active_tenant_id,null);
  db.prepare("DELETE FROM tenant_members WHERE tenant_id='B' AND user_id=10").run();
});
test('26 migration v1 -> v2 refuses implicit startup and invalidates every legacy token',async()=>{
  const {bootstrapLegacy}=await import('../src/legacySchema.js');
  const {migrateTenantSchemaLocked}=await import('../src/tenantMigration.js');
  const {ensureSchema,VERSION_TABLE}=await import('../src/schemaMigrations.js');
  const known=(await import('../src/schema-fingerprints.json',{with:{type:'json'}})).default;
  const copy=new Database(':memory:');
  try{
    bootstrapLegacy(copy,{adminUser:'migration-fixture',adminPass:'fixture-password-123'});
    copy.transaction(()=>migrateTenantSchemaLocked(copy,{backup:'fixture'})).immediate();copy.exec(VERSION_TABLE);
    copy.prepare('INSERT INTO schema_migrations VALUES(1,?,?,?)').run('T01',known.v1,0);
    copy.prepare('INSERT INTO sessions(token,user_id,expires_at,active_tenant_id) VALUES(?,?,?,?)').run('legacy-token',1,9999999999999,'default');
    const settings={dataDir:fixture.dir,migrationBackupKeep:5};
    await assert.rejects(ensureSchema(copy,settings),/ALLOW_AUTO_MIGRATE/);
    await ensureSchema(copy,{...settings,allowAutoMigrate:true});
    assert.equal(copy.prepare('SELECT count(*) n FROM sessions').get().n,0);
    assert.equal(copy.prepare('PRAGMA table_info(sessions)').all().some(c=>c.name==='token'),false);
    assert.equal(copy.prepare('SELECT MAX(version) v FROM schema_migrations').get().v,8);
    assert.deepEqual(copy.pragma('foreign_key_check'),[]);
  }finally{copy.close();}
});
