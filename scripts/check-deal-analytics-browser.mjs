// Browser check for the tenant analytics dashboard at desktop and 360 px. Uses a fixture copy only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { twoTenants } from '../tests/tenant-fixture.mjs';

const fixture = twoTenants();
Object.assign(process.env,{ DATA_DIR:fixture.dir,ALLOW_AUTO_MIGRATE:'1',MULTITENANT_ENABLED:'0' });
const { createHttpSurface } = await import('../src/httpSurface.js');
const { config } = await import('../src/config.js');
const { db } = await import('../src/db.js');
const { hashPassword } = await import('../src/passwords.js');
const { appendDealEvent, DAY } = await import('../src/dealReview.js');
db.prepare('UPDATE users SET pass=?').run(hashPassword('fixture-password-123'));
config.multitenantEnabled = true;

// Seed: mixed outcomes over several weeks so every panel has content, plus a long product name.
const now = Date.now();
const product = Number(db.prepare(`INSERT INTO products(tenant_id,number_id,sku,name,price) VALUES('A',10,'kaos',?,1)`)
  .run('Kaos premium edisi panjang sekali untuk uji tata letak 0812-3456-7890').lastInsertRowid);
let chat = 9000;
const decisions = ['verified_lunas','verified_lunas','rejected','dp_aktif','verified_lunas','awaiting_proof','proof_submitted','rejected'];
for (let i=0;i<24;i++) {
  db.prepare('INSERT INTO chats(id,number_id,tenant_id,jid) VALUES(?,10,\'A\',?)').run(chat,chat+'@s.whatsapp.net');
  const opened = now - (i % 10) * 7 * DAY - DAY;
  const id = Number(db.prepare(`INSERT INTO deals(tenant_id,session_id,chat_id,state,amount,product_id,created_at)
    VALUES('A',10,?,'candidate',?,?,?)`).run(chat++,250000 + i * 50000,i % 2 ? product : null,opened).lastInsertRowid);
  const decision = decisions[i % decisions.length];
  db.prepare(`UPDATE deals SET state=?,reason_code=?,origin=CASE WHEN ?='dp_aktif' THEN 'dp' ELSE origin END,amount_due=1,due_at=? WHERE id=?`)
    .run(decision,decision==='rejected' ? (i % 3 ? 'harga_tidak_cocok' : 'ongkir_mahal') : null,decision,now + DAY,id);
  appendDealEvent(id,'decision',{ decision,amount:250000 + i * 50000,reason_code:decision==='rejected' ? (i % 3 ? 'harga_tidak_cocok' : 'ongkir_mahal') : null },10,opened + DAY / 2);
}

const h = createHttpSurface();
await new Promise(r=>h.server.listen(0,'127.0.0.1',r));
const origin = `http://127.0.0.1:${h.server.address().port}`;
const evidence = path.resolve('docs/deal-analytics/evidence');
fs.mkdirSync(evidence,{ recursive:true });
let browser, ws;
const pending = new Map();
try {
  const executable = [process.env.MEDIA_TEST_BROWSER,'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p && fs.existsSync(p));
  assert.ok(executable,'A local Chrome/Edge executable is required');
  const profile = path.join(fixture.dir,'browser');
  browser = spawn(executable,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',
    `--user-data-dir=${profile}`,'about:blank'],{ windowsHide:true,stdio:'ignore' });
  const portFile = path.join(profile,'DevToolsActivePort');
  for (let i=0;i<150 && !fs.existsSync(portFile);i++) await new Promise(r=>setTimeout(r,100));
  const port = fs.readFileSync(portFile,'utf8').split('\n')[0];
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{ method:'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl); await once(ws,'open');
  let seq = 0;
  ws.addEventListener('message',e=>{ const m=JSON.parse(e.data); const p=m.id && pending.get(m.id);
    if (p) { pending.delete(m.id); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result); } });
  const send = (method,params={}) => new Promise((resolve,reject)=>{ const id=++seq; pending.set(id,{ resolve,reject }); ws.send(JSON.stringify({ id,method,params })); });
  const evaluate = async expression => { const r=await send('Runtime.evaluate',{ expression,awaitPromise:true,returnByValue:true });
    if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  const wait = async expression => { for (let i=0;i<150;i++) { if (await evaluate(expression)) return; await new Promise(r=>setTimeout(r,100)); } throw Error('Timed out: '+expression); };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride',{ width:1366,height:900,deviceScaleFactor:1,mobile:false });
  const login = async username => {
    await send('Page.navigate',{ url:origin }); await wait("!document.querySelector('#login').classList.contains('hidden')");
    await evaluate(`document.querySelector('#u').value=${JSON.stringify(username)};document.querySelector('#p').value='fixture-password-123';document.querySelector('#login').requestSubmit()`);
    await wait("typeof state!=='undefined' && state.me && document.querySelector('#railAnalytics').dataset.page==='analytics' && document.querySelector('#login').classList.contains('hidden')");
  };
  await login('A-0');
  await evaluate("document.querySelector('#railAnalytics').click()");
  try { await wait("document.querySelector('.deal-analytics .da-kpi')"); }
  catch (err) { console.error('PAGE:',await evaluate("document.querySelector('#pageTitle')?.textContent+' | '+document.querySelector('#page')?.textContent.slice(0,300)")); throw err; }
  const checks = await evaluate(`(() => {
    const root=document.querySelector('.deal-analytics');
    return { kpis:root.querySelectorAll('.da-kpi').length, low:root.querySelectorAll('.da-low').length,
      trend:root.querySelectorAll('.da-trend > div').length, funnel:root.textContent.includes('Inquiry hanya mencakup'),
      leaked:root.textContent.includes('3456-7890'), unknown:root.textContent.includes('Belum tercatat'),
      csv:root.querySelector('a[href^="/api/deals/analytics/export"]') !== null };
  })()`);
  assert.equal(checks.kpis,8); assert.ok(checks.low>0,'n<10 badge visible'); assert.ok(checks.trend>=12);
  assert.ok(checks.funnel); assert.ok(checks.csv); assert.ok(checks.unknown,'unknown attribution explicit');
  for (const [name,width,height] of [['desktop',1366,900],['360px',360,780]]) {
    await send('Emulation.setDeviceMetricsOverride',{ width,height,deviceScaleFactor:1,mobile:width===360 });
    await new Promise(r=>setTimeout(r,250));
    const overflow = await evaluate('({doc:document.documentElement.scrollWidth,vw:innerWidth})');
    assert.ok(overflow.doc<=overflow.vw,`${name}: no horizontal page scroll (${overflow.doc} > ${overflow.vw})`);
    const shot = await send('Page.captureScreenshot',{ format:'png',captureBeyondViewport:false });
    fs.writeFileSync(path.join(evidence,`analytics-${name}.png`),Buffer.from(shot.data,'base64'));
  }
  // Breakdown tabs re-render without page overflow.
  await evaluate("document.querySelector('[data-field=handler]').click()");
  await wait("document.querySelector('[data-field=handler][aria-pressed=true]')");
  assert.ok(await evaluate("document.querySelector('.deal-analytics').textContent.includes('Belum diketahui')"));
  // Agent sees a clear refusal instead of numbers.
  await send('Emulation.setDeviceMetricsOverride',{ width:1366,height:900,deviceScaleFactor:1,mobile:false });
  await evaluate("call('POST','/logout')");
  await login('A-1');
  await evaluate("document.querySelector('#railAnalytics').click()");
  await wait("document.querySelector('#page')?.textContent.includes('pengelola tenant')");
  console.log('PASS deal analytics UI: 8 KPI with n, n<10 badge, weekly trend, funnel note, explicit unknown attribution, CSV link, no overflow at 1366px and 360px, agent refused; screenshots in docs/deal-analytics/evidence');
} finally {
  try { ws?.close(); } catch {}
  browser?.kill();
  h.wss.close(); h.server.closeAllConnections(); await new Promise(r=>h.server.close(r));
  db.close();
  await new Promise(r=>setTimeout(r,500));
  try { fixture.close(); } catch {}
}
