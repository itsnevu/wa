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
db.exec("UPDATE users SET platform_role='admin' WHERE id=1; UPDATE tenants SET name='Raqio Store' WHERE id='A';");
config.multitenantEnabled=true;
const h=createHttpSurface();await new Promise(r=>h.server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${h.server.address().port}`;
const evidence=path.resolve('docs/t04/evidence');fs.mkdirSync(evidence,{recursive:true});
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
  const login=async username=>{
    await evaluate("document.querySelector('#u').value="+JSON.stringify(username)+";document.querySelector('#p').value='fixture-password-123';document.querySelector('#login').requestSubmit()");
  };
  await login('platform-fixture');
  await wait("document.querySelector('#platformTenants button')");
  async function capture(prefix){
    for(const [name,width,height]of [['desktop',1366,900],['360px',360,780]]){
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width===360});
      assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'));
      const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
      fs.writeFileSync(path.join(evidence,prefix+'-'+name+'.png'),Buffer.from(shot.data,'base64'));
    }
  }
  await capture('platform');
  await evaluate("[...document.querySelectorAll('#platformTenants button')].find(b=>b.textContent==='Raqio Store').click()");
  await wait("document.querySelector('#platformContent form')");
  await evaluate("document.querySelector('#platformContent input').value='Browser audit verification';document.querySelector('#platformContent form').requestSubmit()");
  await wait("document.querySelector('.platform-grant')?.textContent.includes('HANYA BACA')");
  await capture('grant');
  await evaluate("call('POST','/logout').then(()=>location.reload())");
  await wait("!document.querySelector('#login').classList.contains('hidden')");
  await login('A-0');
  await wait("document.querySelector('#btnTenantAudit')");
  await evaluate("document.querySelector('#railMore').click()");
  await wait("[...document.querySelectorAll('#mSheet button')].some(b=>b.textContent.includes('Audit workspace'))");
  await evaluate("[...document.querySelectorAll('#mSheet button')].find(b=>b.textContent.includes('Audit workspace')).click()");
  await wait("document.querySelector('#platformPanel li')?.textContent.includes('grant_entered')");
  await capture('owner-audit');
  console.log('T04 UI verified at desktop and 360px');
}finally{
  ws?.close();if(browser&&browser.exitCode===null){browser.kill();await Promise.race([once(browser,'exit'),new Promise(r=>setTimeout(r,3000))]);}
  for(const socket of h.wss.clients)socket.terminate();h.wss.close();h.server.closeAllConnections();await new Promise(r=>h.server.close(r));
  db.close();fixture.db.close();fs.rmSync(fixture.dir,{recursive:true,force:true,maxRetries:10,retryDelay:200});
}
