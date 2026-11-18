import test from 'node:test';
import assert from 'node:assert/strict';
import {twoTenants} from './tenant-fixture.mjs';
const fixture=twoTenants();Object.assign(process.env,{DATA_DIR:fixture.dir,ALLOW_AUTO_MIGRATE:'1',MULTITENANT_ENABLED:'0'});
const {createHttpSurface}=await import('../src/httpSurface.js');const {db}=await import('../src/db.js');const {config}=await import('../src/config.js');
const {hashPassword}=await import('../src/passwords.js');const store=await import('../src/sessionStore.js');
db.prepare('UPDATE users SET pass=?').run(hashPassword('fixture-password-123'));config.multitenantEnabled=true;
const h=createHttpSurface();await new Promise(r=>h.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${h.server.address().port}/api`;
test.after(async()=>{h.wss.close();h.server.closeAllConnections();await new Promise(r=>h.server.close(r));db.close();fixture.close();});
test('exactly one membership auto-selects; zero returns NO_MEMBERSHIP with a valid /me session',async()=>{
  for(const [username,status]of [['A-0',200],['platform-fixture',409]]){
    const r=await fetch(base+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password:'fixture-password-123'})});
    assert.equal(r.status,status);const body=await r.json();if(status===409)assert.equal(body.reason,'NO_MEMBERSHIP');
    const me=await(await fetch(base+'/me',{headers:{cookie:r.headers.get('set-cookie').split(';')[0]}})).json();
    assert.equal(me.active_tenant_id,status===200?'A':null);
  }
});
test('revoking another membership keeps session; revoking active one clears only that tenant',()=>{
  db.prepare("INSERT INTO tenant_members(tenant_id,user_id,role,created_at) VALUES('B',10,'agent',0)").run();
  const a=store.createSession(10,{headers:{}},{tenantId:'A'});
  const same=store.changeMembership({tenantId:'B',userId:10,role:null,sessionId:a.id});assert.equal(same.id,a.id);
  assert.equal(store.readSession({headers:{cookie:'sid='+a.id}}).active_tenant_id,'A');
  const blank=store.changeMembership({tenantId:'A',userId:10,role:null,sessionId:a.id});assert.notEqual(blank.id,a.id);assert.equal(blank.active_tenant_id,null);
  assert.throws(()=>store.readSession({headers:{cookie:'sid='+a.id}}),e=>e.code==='SESSION_INVALID');
  assert.equal(store.readSession({headers:{cookie:'sid='+blank.id}}).active_tenant_id,null);
});
