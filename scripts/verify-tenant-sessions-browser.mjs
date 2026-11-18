import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {twoTenants} from '../tests/tenant-fixture.mjs';

const fixture=twoTenants();
Object.assign(process.env,{DATA_DIR:fixture.dir,ALLOW_AUTO_MIGRATE:'1',MULTITENANT_ENABLED:'0'});
const {createHttpSurface}=await import('../src/httpSurface.js');
const {config}=await import('../src/config.js');const {db}=await import('../src/db.js');
const {hashPassword}=await import('../src/passwords.js');
db.prepare('UPDATE users SET pass=?').run(hashPassword('fixture-password-123'));
db.prepare("INSERT INTO tenant_members(tenant_id,user_id,role,created_at) VALUES('B',10,'agent',0)").run();
db.prepare("UPDATE tenants SET name=? WHERE id=?").run('Raqio Store','A');
db.prepare("UPDATE tenants SET name=? WHERE id=?").run('Raqio Support','B');
config.multitenantEnabled=true;
const h=createHttpSurface();await new Promise(r=>h.server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${h.server.address().port}`;
const evidence=path.resolve('docs/t03/evidence');fs.mkdirSync(evidence,{recursive:true});
let browser,ws;const pending=new Map();
try{
  const executable=[process.env.MEDIA_TEST_BROWSER,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&fs.existsSync(p));
  assert.ok(executable,'A local Chrome/Edge executable is required');
  const profile=path.join(fixture.dir,'browser');
  browser=spawn(executable,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
  const portFile=path.join(profile,'DevToolsActivePort');
  for(let i=0;i<150&&!fs.existsSync(portFile);i++)await new Promise(r=>setTimeout(r,100));
  assert.ok(fs.existsSync(portFile));
  const port=fs.readFileSync(portFile,'utf8').split('\n')[0];
  const target=await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
  ws=new WebSocket(target.webSocketDebuggerUrl);await once(ws,'open');let seq=0;
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}}});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
  const wait=async expression=>{for(let i=0;i<150;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out: '+expression);};
  await send('Runtime.enable');await send('Page.enable');await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1366,height:900,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:origin});await wait("!document.querySelector('#login').classList.contains('hidden')");
  const login=async()=>{await evaluate("document.querySelector('#u').value='A-0';document.querySelector('#p').value='fixture-password-123';document.querySelector('#login').requestSubmit()");await wait("!document.querySelector('#tenantPicker').classList.contains('hidden') && document.querySelectorAll('#tenantChoices button').length===2");};
  await login();
  for(const [name,width,height]of [['desktop',1366,900],['360px',360,780]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width===360});
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'picker must fit viewport');
    const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    fs.writeFileSync(path.join(evidence,`tenant-picker-${name}.png`),Buffer.from(shot.data,'base64'));
  }
  assert.equal(await evaluate("call('GET','/users').catch(e=>e.code)"),'TENANT_NOT_SELECTED');
  assert.ok(await evaluate("!document.querySelector('#tenantPicker').classList.contains('hidden')"));
  assert.equal(await evaluate("call('POST','/tenant/switch',{tenant_id:{id:'A'}}).catch(e=>e.code)"),'TENANT_FORBIDDEN');
  assert.ok(await evaluate("document.querySelector('#sessionNotice').textContent.includes('TENANT_FORBIDDEN')"));
  await send('Network.deleteCookies',{name:'sid',url:origin});
  assert.equal(await evaluate("call('GET','/me').catch(e=>e.code)"),'SESSION_INVALID');
  assert.ok(await evaluate("!document.querySelector('#login').classList.contains('hidden')"));
  await login();await evaluate("document.querySelector('#tenantChoices button').click()");
  await wait("!!state.me && !document.querySelector('#app').classList.contains('hidden')");
  assert.equal(await evaluate("call('GET','/me').then(r=>r.active_tenant_id)"),'A');
  db.prepare("DELETE FROM tenant_members WHERE tenant_id='A' AND user_id=10").run();
  await send('Page.reload');
  await wait("!document.querySelector('#tenantPicker').classList.contains('hidden') && document.querySelectorAll('#tenantChoices button').length===1");
  assert.ok(await evaluate("document.querySelector('#sessionNotice').textContent.includes('TENANT_FORBIDDEN')"));
  console.log('PASS browser: login -> null tenant picker -> switch -> app; 401 login, 409 picker, 403 exact code; revoked membership on reload forces reselection; desktop + 360px screenshots; flag-enabled fixture only');
}finally{
  ws?.close();if(browser&&browser.exitCode===null){browser.kill();await Promise.race([once(browser,'exit'),new Promise(r=>setTimeout(r,3000))]);}
  for(const socket of h.wss.clients)socket.terminate();h.wss.close();h.server.closeAllConnections();await new Promise(r=>h.server.close(r));
  db.close();fixture.db.close();fs.rmSync(fixture.dir,{recursive:true,force:true,maxRetries:10,retryDelay:200});
}
