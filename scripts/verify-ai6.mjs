import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import express from 'express';
import {WebSocketServer} from 'ws';
import {setup} from './phase-harness.mjs';

const h=await setup('ai6');
const originalFetch=globalThis.fetch;
let server,browser,ws,wss;
const pending=new Map();
try {
  const n=h.number();
  const chat=Number(h.q.insertChat.run(n,'62@s.whatsapp.net','Pelanggan AI',Date.now()).lastInsertRowid);
  h.db.prepare("INSERT INTO ai_settings(number_id,enabled,model,daily_tokens,warn_percent) VALUES (?,1,'fixture',100,80)").run(n);
  h.db.prepare('INSERT INTO products(number_id,sku,name,price,stock) VALUES (?,?,?,?,?)').run(n,'BROWSER','Kopi fixture',15000,4);
  h.q.insertOrder.run(n,chat,'ORD-BROWSER','[{"sku":"BROWSER","qty":1}]',15000,Date.now());
  h.q.insertAiLog.run(n,chat,'Ada kopi?','Kopi tersedia.',4,'fixture',null,Date.now());
  globalThis.fetch=async(url,opts)=>String(url).includes('/chat/completions')
    ? Response.json({choices:[{message:{role:'assistant',content:'Jawaban uji browser'}}],usage:{total_tokens:5}})
    : originalFetch(url,opts);
  const {api}=await import('../src/routes.js');
  const app=express();app.use(express.json());app.use(express.static('public'));app.use('/api',api);
  server=app.listen(0,'127.0.0.1');await once(server,'listening');
  wss=new WebSocketServer({server,path:'/ws'});
  const origin=`http://127.0.0.1:${server.address().port}`;
  const executable=[process.env.AI_TEST_BROWSER,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>p && fs.existsSync(p));
  assert.ok(executable,'Chrome or Edge required for screenshot verification');
  const profile=path.join(h.temp,'browser-profile');
  browser=spawn(executable,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore',windowsHide:true});
  const portFile=path.join(profile,'DevToolsActivePort');
  for(let i=0;i<150 && !fs.existsSync(portFile);i++) await new Promise(r=>setTimeout(r,100));
  assert.ok(fs.existsSync(portFile),'browser debug port available');
  const debugPort=fs.readFileSync(portFile,'utf8').split('\n')[0];
  const target=await (await originalFetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`,{method:'PUT'})).json();
  ws=new WebSocket(target.webSocketDebuggerUrl);await once(ws,'open');
  let seq=0;const errors=[];
  ws.addEventListener('message',event=>{
    const msg=JSON.parse(event.data);
    if(msg.id) {const p=pending.get(msg.id);if(p){pending.delete(msg.id);msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);}}
    if(msg.method==='Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  });
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{
    const out=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if(out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description || out.exceptionDetails.text);
    return out.result.value;
  };
  const wait=async expression=>{
    for(let i=0;i<150;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}
    throw new Error('Timed out: '+expression);
  };
  await send('Runtime.enable');await send('Page.enable');await send('Network.enable');
  const [cookieName,cookieValue]=h.admin.split('=');
  await send('Network.setCookie',{name:cookieName,value:cookieValue,url:origin,path:'/'});
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:origin});
  await wait("typeof pages!=='undefined' && !!pages.ai && !!state.me && !document.querySelector('#app').classList.contains('hidden')");
  await evaluate("setPage('ai')");await wait("!!document.querySelector('#aiUsageBar') && document.querySelector('#aiUsageText').textContent.includes('100')");
  for(const selector of ['#aiSettingsForm','#aiSettingsForm [name=enabled]','#aiSettingsForm [name=system_prompt]','#aiSettingsForm [name=max_per_hour]','#aiSettingsForm [name=min_gap_sec]','#aiSettingsForm [name=daily_tokens]','#aiSettingsForm [name=warn_percent]','#aiSettingsForm [name=ai_paused_minutes]','#aiSettingsForm [name=stop_reply]','#aiSettingsForm [name=escalate_keywords]','#aiTestForm','.ai-products','.ai-orders','.ai-logs','#aiResume']) assert.ok(await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`),selector);
  const artifacts=path.resolve('artifacts/ai');fs.mkdirSync(artifacts,{recursive:true});
  async function shot(name,selector) {
    const rect=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.max(0,r.x+scrollX),y:Math.max(0,r.y+scrollY),width:r.width,height:r.height,scale:1};})()`);
    const out=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:rect});
    fs.writeFileSync(path.join(artifacts,`shot-ai-${name}.png`),Buffer.from(out.data,'base64'));
  }
  await shot('settings','#aiSettingsForm');await shot('products','.ai-products');await shot('orders','.ai-orders');await shot('logs','.ai-logs');
  assert.ok(await evaluate("document.querySelector('#aiUsage').classList.contains('healthy')"));await shot('usage-green','#aiUsage');
  h.q.aiUsageBump.run(n,(await import('../src/limits.js')).aiDay(),80,0);
  await evaluate(`refreshAiUsage(${n})`);assert.ok(await evaluate("document.querySelector('#aiUsage').classList.contains('warning')"));await shot('usage-yellow','#aiUsage');
  h.q.aiUsageBump.run(n,(await import('../src/limits.js')).aiDay(),20,0);
  await evaluate(`refreshAiUsage(${n})`);assert.ok(await evaluate("document.querySelector('#aiUsage').classList.contains('danger')"));await shot('usage-red','#aiUsage');
  h.q.addAlert.run(n,(await import('../src/limits.js')).aiDay(),'stop',Date.now());
  for(const client of wss.clients) client.send(JSON.stringify({type:'ai.alert',numberId:n,level:'stop'}));
  await wait("!!document.querySelector('#aiGlobalAlert')");await shot('alert','#aiGlobalAlert');
  await evaluate("setPage('chats')");await wait("!!document.querySelector('.ai-stopped')");await shot('number-badge','#nums');
  await evaluate("setPage('ai')");await wait("!!document.querySelector('#aiResume') && !!document.querySelector('#aiUsage.danger')");
  await evaluate("document.querySelector('#aiResume').click()");
  await wait("document.querySelector('#aiSettingsForm').elements.daily_tokens.value==='120'");
  assert.equal(h.q.aiSettings.get(n).daily_tokens,120);assert.equal(h.db.prepare("SELECT count(*) n FROM ai_alerts WHERE level='stop'").get().n,0);
  const messageCount=h.db.prepare('SELECT count(*) n FROM messages').get().n;
  await evaluate("document.querySelector('#aiTestText').value='Tes browser';document.querySelector('#aiTestForm').requestSubmit()");
  await wait("document.querySelector('#aiTestResult').textContent.includes('Jawaban uji browser')");
  assert.equal(h.db.prepare('SELECT count(*) n FROM messages').get().n,messageCount);await shot('console','#aiTestForm');
  await evaluate("const f=document.querySelector('#aiSettingsForm');f.elements.system_prompt.value='Prompt dari browser';f.requestSubmit()");
  await wait("document.querySelector('#aiSettingsResult').textContent.includes('disimpan')");
  assert.equal(h.q.aiSettings.get(n).system_prompt,'Prompt dari browser');
  await evaluate("const p=document.querySelector('#aiProductForm');p.elements.sku.value='UI-NEW';p.elements.name.value='Produk UI';p.elements.price.value='1000';p.elements.stock.value='3';p.requestSubmit()");
  await wait("document.querySelector('.ai-products').textContent.includes('UI-NEW')");
  assert.ok(h.q.productBySku.get(n,'UI-NEW'));
  await evaluate("const s=document.querySelector('[data-order-status]');s.value='completed';s.dispatchEvent(new Event('change'))");
  for(let i=0;i<40 && h.db.prepare('SELECT status FROM orders').get().status!=='completed';i++)await new Promise(r=>setTimeout(r,100));
  assert.equal(h.db.prepare('SELECT status FROM orders').get().status,'completed');
  // Check the narrow viewport for overflow and capture the complete settings UI.
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await new Promise(r=>setTimeout(r,200));
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'no mobile page overflow');await shot('mobile-settings','#aiSettingsForm');
  assert.deepEqual(errors,[]);
  console.log('PASS ai6: Chrome screenshots for settings/usage thresholds/event alert/number badge/console/products/orders/logs/mobile; save, product create, order status, test no send, resume endpoint; exit 0');
} finally {
  if(ws && ws.readyState===1) {
    try {ws.send(JSON.stringify({id:999999,method:'Browser.close'}));}catch{}
    ws.close();
  }
  if(browser) {
    await Promise.race([once(browser,'exit').catch(()=>{}),new Promise(r=>setTimeout(r,2500))]);
    if(browser.exitCode===null) browser.kill();
  }
  if(wss){for(const client of wss.clients)client.terminate();await new Promise(r=>wss.close(r));}
  if(server)await new Promise(r=>server.close(r));
  globalThis.fetch=originalFetch;
  // Chromium may need a moment to release its profile files on Windows.
  for(let i=0;i<20;i++) {try {await h.close();break;}catch(err){if(i===19)throw err;await new Promise(r=>setTimeout(r,100));}}
}
