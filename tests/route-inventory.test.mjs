import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {WebSocket} from 'ws';
import {execFileSync} from 'node:child_process';
import {observeRegistrations,inventory,validate,monotonicErrors,renderInventory,key} from './route-inventory-tools.mjs';
import {scoped} from '../src/routeScopeMarker.js';
import * as allowlist from './route-inventory.allowlist.mjs';

observeRegistrations();
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'t02-inventory-'));
Object.assign(process.env,{DATA_DIR:dir,ALLOW_AUTO_MIGRATE:'1',MULTITENANT_ENABLED:'0',ADMIN_USER:'inventory-fixture',ADMIN_PASS:'fixture-password-123'});
const {createHttpSurface}=await import('../src/httpSurface.js');
const {requireAuth}=await import('../src/auth.js');
const {config}=await import('../src/config.js');
const {db,schemaStatus}=await import('../src/db.js');
const baseline=JSON.parse(fs.readFileSync(new URL('./route-inventory.baseline.json',import.meta.url),'utf8'));
const surface=createHttpSurface();
if(process.env.INVENTORY_INJECT_UNSCOPED==='1')surface.app.get('/__unscoped_injected',(_q,r)=>r.end());
const read=()=>inventory(surface,{infrastructure:[requireAuth]});
test.after(()=>{surface.wss.close();db.close();fs.rmSync(dir,{recursive:true,force:true});});

test('all registered HTTP, USE and upgrade surfaces have scope or reviewed exemption',()=>{
  const result=validate(read(),allowlist,baseline);
  console.log('INVENTORY',JSON.stringify({total:result.rows.length,public:result.rows.filter(r=>r.status==='public').length,scoped:result.rows.filter(r=>r.status==='scoped').length,pending:result.counts}));
  assert.deepEqual(result.errors,[]);
  assert.equal(fs.readFileSync('docs/t01/route-inventory.md','utf8').replaceAll('\r\n','\n'),renderInventory(result));
  // Compare budgets/identities with PR base, never just an editable ceiling.
  const supplied=process.env.INVENTORY_BASE_REF;
  const ref=supplied&&!/^0+$/.test(supplied)?supplied:supplied?'HEAD^':'HEAD';
  execFileSync('git',['rev-parse','--verify',`${ref}^{commit}`],{stdio:'pipe'});
  let prior;
  try{prior=JSON.parse(execFileSync('git',['show',`${ref}:tests/route-inventory.baseline.json`],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));}
  catch(error){
    // Only the initial T02 introduction may have no baseline at its base commit.
    const history=execFileSync('git',['log','-1','--format=%H',ref,'--','tests/route-inventory.baseline.json'],{encoding:'utf8'}).trim();
    if(history)throw error;
  }
  if(prior)assert.deepEqual(monotonicErrors(baseline,prior),[]);
});

test('entrypoint delegates surface registration to the inspected factory',()=>{
  const source=fs.readFileSync('src/index.js','utf8');
  assert.match(source,/createHttpSurface\(\)/);
  assert.doesNotMatch(source,/\bapp\b|\bRouter\b|from\s+['"]express['"]|createServer\s*\(|\.use\s*\(|\.route\s*\(|server\.(?:on|once|addListener|prependListener)\s*\(\s*['"](?:request|upgrade)['"]/);
  // Also reject registrations through aliases such as api.get(), not just app.get().
  assert.doesNotMatch(source.replaceAll('q.allNumbers.all()','NUMBER_ROWS'),/\.\s*(?:get|post|put|patch|delete|head|options|all|use|route)\s*\(/);
});

test('HTTP construction preserves public static, login, health and auth responses',async()=>{
  const h=createHttpSurface();
  await new Promise(resolve=>h.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${h.server.address().port}`;
  try{
    const health=await fetch(base+'/api/health');assert.equal(health.status,200);
    assert.deepEqual(await health.json(),{ok:true,schema_version:schemaStatus.version,schema_ddl_hash:schemaStatus.hash});
    const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(login.status,400);
    assert.equal((await fetch(base+'/api/numbers')).status,401);
    assert.equal((await fetch(base+'/media/fixture')).status,401);
    const html=await fetch(base+'/');assert.equal(html.status,200);assert.match(await html.text(),/<html/i);
    const sw=await fetch(base+'/sw.js');assert.equal(sw.headers.get('cache-control'),'no-cache');
  }finally{h.wss.close();h.server.closeAllConnections();await new Promise(resolve=>h.server.close(resolve));}
});

test('WebSocket upgrade validates browser origin and the current session',async()=>{
  for(const trustProxy of [false,true]){
    const previous=config.trustProxy;
    config.trustProxy=trustProxy;
    let h;
    try{h=createHttpSurface();}finally{config.trustProxy=previous;}
    await new Promise(resolve=>h.server.listen(0,'127.0.0.1',resolve));
    const authority=`127.0.0.1:${h.server.address().port}`;
    const base=`http://${authority}`;
    const handshake=headers=>new Promise((resolve,reject)=>{
      const socket=new WebSocket(`ws://${authority}/ws`,{headers,handshakeTimeout:3000});
      socket.on('error',reject);
      socket.once('open',()=>{socket.terminate();resolve(101);});
      socket.once('unexpected-response',(_req,res)=>{
        res.resume();
        socket.terminate();
        resolve(res.statusCode);
      });
    });
    try{
      assert.equal(await handshake({}),401);
      const login=await fetch(base+'/api/login',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({username:'inventory-fixture',password:'fixture-password-123'}),
      });
      assert.equal(login.status,200);
      const cookie=login.headers.get('set-cookie').split(';')[0];
      assert.equal(await handshake({cookie}),101);
      assert.equal(await handshake({cookie,origin:base}),101);
      assert.equal(await handshake({cookie,origin:'null'}),403);
      assert.equal(await handshake({cookie,origin:'http://other.invalid'}),403);
      assert.equal(await handshake({cookie,origin:`https://${authority}`,'x-forwarded-proto':'https'}),trustProxy?101:403);
      const logout=await fetch(base+'/api/logout',{method:'POST',headers:{cookie}});
      assert.equal(logout.status,200);
      assert.equal(await handshake({cookie,origin:base}),401);
    }finally{h.wss.close();h.server.closeAllConnections();await new Promise(resolve=>h.server.close(resolve));}
  }
});

test('marker identity, method-specific scope, sibling prefixes and late middleware',()=>{
  const handler=(_q,r)=>r.end();assert.equal(scoped(handler),handler);
  const app=express();
  app.route('/method').get(handler).post((_q,r)=>r.end());
  const before=express.Router();before.get('/x',(_q,r)=>r.end());app.use('/early',before);
  app.use('/early',scoped((_q,_r,next)=>next()));
  app.use('/safe',scoped((_q,_r,next)=>next()));
  const safe=express.Router();safe.get('/x',(_q,r)=>r.end());app.use('/safe',safe);
  app.get('/unsafe',(_q,r)=>r.end());
  const rows=inventory({app});const byKey=new Map(rows.map(r=>[key(r),r]));
  assert.equal(byKey.get('GET /method').marked,true);assert.equal(byKey.get('POST /method').marked,false);
  assert.equal(byKey.get('GET /early/x').marked,false);assert.equal(byKey.get('GET /early/x').beforeResolver,true);
  assert.equal(byKey.get('GET /safe/x').marked,true);assert.equal(byKey.get('GET /unsafe').marked,false);
});

test('conflicting duplicates, invalid PR/reason, stale exemption, pending growth rejected',()=>{
  const row={method:'GET',path:'/x',file:'fixture',marked:false};
  assert.ok(validate([row,{...row,marked:true}],{publicRoutes:[],pending:[]},{pending:{},entries:[]}).errors.some(e=>e.includes('Conflicting route status')));
  const entry={method:'GET',path:'/x',pr:'T05',alasan:'legacy'};
  assert.ok(validate([row],{publicRoutes:[],pending:[entry,entry]},{pending:{T05:1},entries:['GET /x']}).errors.some(e=>e.includes('Conflicting duplicate allowlist')));
  assert.ok(validate([row],{publicRoutes:[],pending:[{...row,pr:'T99',alasan:''}]},{pending:{},entries:[]}).errors.some(e=>e.includes('Unknown pending PR')));
  assert.ok(validate([row],{publicRoutes:[],pending:[{...row,pr:'T05',alasan:''}]},{pending:{},entries:[]}).errors.some(e=>e.includes('Missing alasan')));
  assert.ok(validate([],{publicRoutes:[],pending:[{...row,pr:'T05',alasan:'old'}]},{pending:{},entries:[]}).errors.some(e=>e.includes('Stale allowlist')));
  assert.ok(monotonicErrors({pending:{T05:2},entries:['GET /x','GET /new']},{pending:{T05:1},entries:['GET /x']}).length===2);
  assert.deepEqual(monotonicErrors({pending:{T05:0},entries:[]},{pending:{T05:1},entries:['GET /x']}),[]);
  assert.ok(validate([],{publicRoutes:[],pending:[]},{pending:{},entries:['GET /removed']}).errors.some(e=>e.includes('Stale pending baseline')));
});

test('USE/static/media/upgrade cannot hide outside app.get',()=>{
  const rows=read();
  assert.ok(rows.some(r=>r.method==='USE'&&r.path==='/*'&&r.static));
  assert.equal(rows.filter(r=>r.method==='USE'&&r.path==='/media/*').length,2);
  assert.ok(rows.some(r=>r.method==='UPGRADE'&&r.path==='/ws'));
  const app=express();app.use('/hidden',(_q,r)=>r.end());
  app.use(express.static(os.tmpdir()));
  const hidden=inventory({app});
  const errors=validate(hidden,{publicRoutes:[{method:'USE',path:'/*',alasan:'assets'}],pending:[]},{pending:{},entries:[]}).errors;
  assert.ok(errors.includes('Missing tenant scope: USE /hidden/*'));assert.ok(errors.includes('Non-static public USE: USE /*'));
  const listener=()=>{};surface.server.prependListener('upgrade',listener);
  assert.ok(validate(read(),allowlist,baseline).errors.includes('Missing tenant scope: UPGRADE /*'));
  surface.server.removeListener('upgrade',listener);
});

test('nested fake router and route().stack per method are detected',()=>{
  const app=express();const outer=express.Router();const inner=express.Router();
  inner.route('/lost').get((_q,r)=>r.end()).post((_q,r)=>r.end());
  outer.use('/inner',inner);app.use('/outer',outer);
  const rows=inventory({app});
  assert.deepEqual(rows.map(r=>`${r.method} ${r.path}`),['GET /outer/inner/lost','POST /outer/inner/lost']);
  assert.equal(validate(rows,{publicRoutes:[],pending:[]},{pending:{},entries:[]}).errors.filter(e=>e.startsWith('Missing tenant scope')).length,2);
});

test('meta: inject unmarked route => fail; remove => green',()=>{
  assert.deepEqual(validate(read(),allowlist,baseline).errors,[]);
  const stack=surface.app._router?.stack??surface.app.router.stack;const count=stack.length;
  surface.app.get('/__unscoped_meta',(_q,r)=>r.end());
  const failed=validate(read(),allowlist,baseline);
  assert.ok(failed.errors.includes('Missing tenant scope: GET /__unscoped_meta'));
  console.log('META_FAIL_PROVEN',failed.errors.join('; '));
  stack.splice(count);
  assert.deepEqual(validate(read(),allowlist,baseline).errors,[]);
  console.log('META_REMOVED_GREEN');
});
