import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { childClose, stopFixtureBrowser } from './child-fixture.mjs';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { twoTenants } from './tenant-fixture.mjs';
import { waitFor } from './lib/wait.mjs';

const fixture = twoTenants();
Object.assign(process.env,{ DATA_DIR:fixture.dir,ALLOW_AUTO_MIGRATE:'1',MULTITENANT_ENABLED:'0',
  MEDIA_SIGNED_URLS_ENABLED:'1',MEDIA_SIGNING_KEY:'fixture-signing-key-longer-than-32-chars' });
const { config } = await import('../src/config.js');
config.multitenantEnabled = true;
const { db } = await import('../src/db.js');
const { hashPassword } = await import('../src/passwords.js');
const { createHttpSurface } = await import('../src/httpSurface.js');
const { DAY } = await import('../src/dealReview.js');
const { runDealReviewJobs } = await import('../src/dealReviewJobs.js');
db.prepare('UPDATE users SET pass=?').run(hashPassword('review-fixture-password'));
const h = createHttpSurface();
await new Promise(resolve=>h.server.listen(0,'127.0.0.1',resolve));
const origin = `http://127.0.0.1:${h.server.address().port}`;
test.after(async () => {
  for (const socket of h.wss.clients) socket.terminate();
  h.wss.close();
  h.server.closeAllConnections();
  await new Promise(resolve=>h.server.close(resolve));
  db.close();
  await fixture.closeAsync();
});

async function request(url,cookie,body) {
  const response = await fetch(origin + '/api' + url,{
    method:body===undefined ? 'GET' : 'POST',
    headers:{ 'Content-Type':'application/json', ...(cookie ? { cookie } : {}) },
    body:body===undefined ? undefined : JSON.stringify(body),
  });
  return { response,status:response.status,data:await response.json() };
}
async function login(username) {
  const r = await request('/login',null,{ username,password:'review-fixture-password' });
  assert.equal(r.status,200);
  return r.response.headers.get('set-cookie').split(';')[0];
}
const owner = await login('A-0');
const agent = await login('A-1');
const other = await login('B-0');
const deal = (number=10,tenant='A',created=Date.now()) => Number(db.prepare(`INSERT INTO deals
  (tenant_id,session_id,chat_id,state,amount,method,created_at,due_sla_at,classifier_version)
  VALUES(?,?,?,'awaiting_proof',500000,'transfer',?,?,'fixture-v1')`)
  .run(tenant,number,number,created,created+DAY).lastInsertRowid);
const get = id => db.prepare('SELECT * FROM deals WHERE id=?').get(id);
const proof = Number(db.prepare(`INSERT INTO messages(number_id,chat_id,tenant_id,body,kind,media_path,ts)
  VALUES(10,10,'A','Bukti transfer','image','review.png',?)`).run(Date.now()).lastInsertRowid);
fs.writeFileSync(path.join(fixture.dir,'media','review.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVQYV2NgAAAAAgABSK+kcQAAAABJRU5ErkJggg==','base64'));
const send = (id,action,data={},cookie=owner) => request(`/deals/${id}/decision`,cookie,{ action,...data });

test('role/scoping and required reasons, proof and override', async () => {
  const id = deal();
  const idAgent = deal(11);
  const foreign = deal(20,'B');
  for(let i=0;i<8;i++) db.prepare(`INSERT INTO messages(number_id,chat_id,tenant_id,body,ts)
    VALUES(10,10,'A',?,?)`).run('Pesan lain '+i,Date.now());
  const view = await request('/deals/review',owner);
  assert.equal(view.status,200);
  const card = view.data.cards.find(card=>card.id===id);
  assert.ok(card.messages.length<=6 && card.messages.some(m=>m.id===proof));
  assert.ok(!view.data.cards.some(card=>card.id===foreign));
  const agentView = await request('/deals/review',agent);
  assert.equal(agentView.data.can_decide,false);
  assert.ok(agentView.data.cards.some(card=>card.id===idAgent));
  assert.equal((await send(idAgent,'info',{},agent)).status,403);
  assert.equal((await send(foreign,'info')).status,404);
  assert.equal((await send(id,'paid')).status,409);
  assert.equal((await send(id,'reject')).status,400);
  assert.equal((await send(id,'reject',{ reason_code:'lain_lain',note:'pendek' })).status,400);
  assert.equal((await send(idAgent,'reject',{ reason_code:'lain_lain',note:'Alasan yang valid' })).status,200);
  assert.equal((await send(id,'proof',{ message_id:20,proof_amount:300000 })).status,400);
  const media = await request(`/deals/${id}/evidence/${proof}/url`,owner,{});
  assert.equal(media.status,200);
  assert.equal((await fetch(origin+media.data.url,{headers:{cookie:owner}})).status,200);
  assert.equal((await fetch(origin+media.data.url,{headers:{cookie:other}})).status,403);
  assert.equal((await send(id,'proof',{ message_id:proof,proof_amount:300000 })).data.state,'proof_submitted');
  const mismatch = await send(id,'paid');
  assert.equal(mismatch.status,422);
  assert.equal(mismatch.data.code,'AMOUNT_MISMATCH');
  assert.equal((await send(id,'paid',{ note:'Override disetujui setelah pengecekan' })).data.state,'verified_lunas');
  assert.equal(get(id).origin,'direct');
  const verifications = db.prepare('SELECT decision FROM deal_verifications WHERE deal_id=? ORDER BY id').all(id);
  assert.deepEqual(verifications.map(row=>row.decision),['proof_submitted','verified_lunas']);
  const event = db.prepare("SELECT payload_json FROM deal_events WHERE deal_id=? AND type='decision' ORDER BY id DESC LIMIT 1").get(id);
  assert.equal(JSON.parse(event.payload_json).training_label,'verified_lunas');
});

test('DP deadline is required, two installments settle once and keep DP origin', async () => {
  const id = deal();
  const input = { paid_amount:100000,amount_due:400000,method:'transfer' };
  assert.equal((await send(id,'dp',input)).status,400);
  assert.equal((await send(id,'dp',{...input,due_at:Date.now()+DAY})).data.state,'dp_aktif');
  assert.ok(!(await request('/deals/review',owner)).data.cards.some(card=>card.id===id));
  assert.ok((await request('/deals/review?tab=dp',owner)).data.cards.some(card=>card.id===id));
  const installment = { paid_amount:200000,method:'transfer',note:'Cicilan dikonfirmasi',request_id:'payment-first' };
  assert.equal((await send(id,'installment',installment)).data.paid_amount,300000);
  assert.equal((await send(id,'installment',installment)).data.paid_amount,300000);
  assert.equal((await send(id,'installment',{ ...installment,request_id:'payment-second' })).data.state,'verified_lunas');
  assert.equal(get(id).origin,'dp');
  assert.equal(get(id).paid_amount,500000);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM dp_payments WHERE deal_id=?').get(id).n,3);
});

test('boot job logic escalates, digests, retries DP reminders and expires independently', async () => {
  const now = Date.now()+DAY;
  const review = deal(10,'A',now-25*3600000);
  const chasing = deal();
  const due = now+DAY-3600000;
  assert.equal((await send(chasing,'dp',{ paid_amount:100000,amount_due:400000,method:'transfer',due_at:due })).status,200);
  const reminders = [];
  const sendReminder = async (_session,_jid,text) => reminders.push(text);
  await runDealReviewJobs({ now:now+10,sendReminder:async()=>{throw Error('offline');} });
  assert.equal(get(review).assigned_to,10);
  assert.equal(reminders.length,0);
  await runDealReviewJobs({ now:now+20,sendReminder });
  assert.equal(reminders.length,1);
  await runDealReviewJobs({ now:due+DAY,sendReminder });
  assert.equal(reminders.length,2);
  await runDealReviewJobs({ now:due+3*DAY,sendReminder });
  assert.equal(get(review).state,'expired');
  assert.equal(get(chasing).state,'dp_hangus');
  assert.equal(reminders.length,2);
  const r = await request('/deals/review',owner);
  assert.ok(r.data.notices.some(n=>n.kind==='sla_escalated' && n.payload.deal_id===review));
  assert.ok(r.data.notices.some(n=>n.kind==='digest' && n.payload.reasons.some(a=>a.admin_id===10)));
});

test('owner takes one random 5% sample per window and records false positives', async () => {
  assert.equal((await request('/deals/audit/sample',agent,{})).status,403);
  const sample = await request('/deals/audit/sample',owner,{});
  assert.equal(sample.data.sampled,1);
  const audit = await request('/deals/review?tab=audit',owner);
  assert.equal(audit.data.cards.length,1);
  assert.equal((await request(`/deals/${audit.data.cards[0].id}/audit`,owner,{ false_positive:true,note:'Bukti ternyata untuk order lain' })).status,200);
  const repeated = await request('/deals/audit/sample',owner,{});
  assert.equal(repeated.data.sampled,0);
  const done = await request('/deals/review?tab=audit',owner);
  assert.deepEqual(done.data.audit_stats,[{ admin_id:10,classifier_version:'fixture-v1',audited:1,false_positive:1 }]);
});

// H1: shared deterministic helper; the failure message names what was awaited and the last value seen.
const wait = (fn,label='browser condition') => waitFor(fn,{ deadline:8000,interval:50,label });

test('Chrome desktop and 360px render card, SLA, reason grid, proof and DP form', async () => {
  const id = deal(10,'A',Date.now()-26*3600000);
  const executable = [process.env.MEDIA_TEST_BROWSER,'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium'].find(file=>file&&fs.existsSync(file));
  assert.ok(executable);
  const profile = path.join(fixture.dir,'review-browser');
  const browser = spawn(executable,['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=0',
    `--user-data-dir=${profile}`,'about:blank'],{ windowsHide:true,stdio:'ignore' });
  const browserClosed = childClose(browser);
  let socket;
  try {
    const portFile = path.join(profile,'DevToolsActivePort');
    await wait(()=>fs.existsSync(portFile));
    const port = fs.readFileSync(portFile,'utf8').split('\n')[0];
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await once(socket,'open');
    const requests = new Map();
    let seq=0;
    socket.addEventListener('message',event=>{
      const { id,error,result }=JSON.parse(event.data);
      const request=requests.get(id);
      if (!request) return;
      requests.delete(id);
      if (error) request.reject(Error(error.message));
      else request.resolve(result);
    });
    const cdp = (method,params={}) => new Promise((resolve,reject)=>{
      const id=++seq;
      requests.set(id,{resolve,reject});
      socket.send(JSON.stringify({id,method,params}));
    });
    const evalJs = async expression => {
      const { result,exceptionDetails } = await cdp('Runtime.evaluate',{ expression,returnByValue:true,awaitPromise:true });
      if (exceptionDetails) throw Error(exceptionDetails.exception?.description || exceptionDetails.text);
      return result.value;
    };
    await cdp('Network.setCookie',{ name:'sid',value:owner.slice(4),url:origin });
    await cdp('Page.navigate',{url:origin});
    await wait(()=>evalJs("typeof state!=='undefined' && state.me?.id===10"));
    const card = `document.querySelector('[data-deal="${id}"]')`;
    await evalJs("document.querySelector('#railDeals').click()");
    await wait(()=>evalJs(`!!${card}`));
    const dialog = "document.querySelector('.deal-dialog')";
    for(const width of [1366,360]) {
      await cdp('Emulation.setDeviceMetricsOverride',{width,height:width===360?780:900,deviceScaleFactor:1,mobile:width===360});
      // The resize re-renders the review list; the card is briefly absent (flake seen in H0 follow-up run).
      await wait(()=>evalJs(`!!${card}?.querySelector('[data-action=paid]')`),`deal card rendered at ${width}px`);
      assert.equal(await evalJs(`${card}.querySelector('[data-action=paid]').disabled`),true);
      assert.equal(await evalJs(`${card}.querySelector('.deal-sla').textContent.includes('Lewat SLA')`),true);
      assert.equal(await evalJs(`${card}.querySelectorAll('.deal-messages li').length<=6`),true);
      const fits = `(()=>{const r=${dialog}.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.bottom<=innerHeight && document.documentElement.scrollWidth<=innerWidth})()`;
      await evalJs(`${card}.querySelector('[data-action=reject]').click()`);
      assert.equal(await evalJs(`${dialog}.open && ${dialog}.querySelectorAll('.deal-reasons button').length===21`),true);
      await evalJs(`${dialog}.querySelector('button[value=lain_lain]').click()`);
      assert.equal(await evalJs(`!${dialog}.querySelector('textarea').checkValidity()`),true);
      assert.equal(await evalJs(fits),true);
      await evalJs(`${dialog}.close();${card}.querySelector('[data-action=dp]').click()`);
      assert.equal(await evalJs(`${dialog}.querySelector('[name=due_at]').required`),true);
      assert.equal(await evalJs(fits),true);
      await evalJs(`${dialog}.close();${card}.querySelector('[data-proof-view]').click()`);
      await wait(()=>evalJs(`!!${dialog}.querySelector('img')`));
      await evalJs(`${dialog}.close()`);
    }
    await evalJs(`${card}.querySelector('[data-action=proof]').click()`);
    await evalJs(`(()=>{const form=${dialog}.querySelector('[data-decision-form]');
      form.elements.message_id.value='${proof}'; form.elements.proof_amount.value='500000'; form.requestSubmit();})()`);
    await wait(()=>evalJs(`${card} && !${card}.querySelector('[data-action=paid]').disabled`));
    await evalJs(`${card}.querySelector('[data-action=paid]').click()`);
    await wait(()=>evalJs(`!${card}`));
    assert.equal(get(id).state,'verified_lunas');
  } finally {
    await stopFixtureBrowser(browser, browserClosed, socket);
  }
});
