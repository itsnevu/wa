import assert from 'node:assert/strict';
import test from 'node:test';
import { twoTenants } from './tenant-fixture.mjs';

// Deterministic: every case injects `now`, runs inside a savepoint and uses its own chats.
const fixture = twoTenants();
Object.assign(process.env,{ DATA_DIR:fixture.dir,ALLOW_AUTO_MIGRATE:'1',MULTITENANT_ENABLED:'0' });
const { config } = await import('../src/config.js');
config.multitenantEnabled = true;
const { db } = await import('../src/db.js');
const { hashPassword } = await import('../src/passwords.js');
const { createHttpSurface } = await import('../src/httpSurface.js');
const { DAY, appendDealEvent } = await import('../src/dealReview.js');
const A = await import('../src/dealAnalytics.js');
db.prepare('UPDATE users SET pass=?').run(hashPassword('analytics-fixture-password'));
db.prepare("UPDATE users SET platform_role='admin' WHERE id=1").run();
const h = createHttpSurface();
await new Promise(resolve=>h.server.listen(0,'127.0.0.1',resolve));
const base = `http://127.0.0.1:${h.server.address().port}/api`;
test.after(async()=>{ h.wss.close(); h.server.closeAllConnections(); await new Promise(r=>h.server.close(r)); db.close(); fixture.close(); });
test.beforeEach(()=>db.exec('SAVEPOINT analytics_case'));
const configuredHours = [config.businessStart,config.businessEnd];
test.afterEach(()=>{ db.exec('ROLLBACK TO analytics_case; RELEASE analytics_case'); [config.businessStart,config.businessEnd] = configuredHours; });

// 2026-03-02 is a Monday. 03:00 UTC = 10:00 WIB (inside 09:00-17:00), 20:00 UTC = 03:00 WIB (outside).
const MONDAY = Date.UTC(2026,2,2);
const INSIDE = MONDAY + 3*3600000;
const OUTSIDE = MONDAY + 20*3600000;
const NOW = MONDAY + 10*DAY;
const RANGE = { from:MONDAY-DAY, to:NOW, now:NOW };
const ownerA = { tenantId:'A', role:'owner', userId:10 };
const adminA = { tenantId:'A', role:'tenant_admin', userId:11 };
const ownerB = { tenantId:'B', role:'owner', userId:20 };
let nextChat = 5000;
function deal(tenant='A',{ at=MONDAY, state='candidate', product=null }={}) {
  const number = tenant==='A' ? 10 : 20, chat = nextChat++;
  db.prepare('INSERT INTO chats(id,number_id,tenant_id,jid) VALUES(?,?,?,?)').run(chat,number,tenant,`${chat}@s.whatsapp.net`);
  const id = Number(db.prepare(`INSERT INTO deals(tenant_id,session_id,chat_id,state,amount,product_id,created_at)
    VALUES(?,?,?,?,1000000,?,?)`).run(tenant,number,chat,state,product,at).lastInsertRowid);
  return { id, chat, number, tenant };
}
const decide = (d,decision,at,extra={}) => {
  db.prepare(`UPDATE deals SET state=?,reason_code=?,origin=CASE WHEN ? THEN 'dp' ELSE origin END,
    amount_due=COALESCE(amount_due,1),due_at=COALESCE(due_at,1) WHERE id=?`)
    .run(decision,extra.reason_code ?? null,Number(decision.startsWith('dp_')),d.id);
  appendDealEvent(d.id,'decision',{ decision,amount:1000000,...extra },10,at);
};
const message = (d,fromMe,ts,extra={}) => db.prepare(`INSERT INTO messages(number_id,chat_id,tenant_id,from_me,body,ts,agent_id,analytics_source)
  VALUES(?,?,?,?,?,?,?,?)`).run(d.number,d.chat,d.tenant,fromMe,'isi chat rahasia',ts,extra.agent ?? null,extra.source ?? null);
const summary = (scope=ownerA,range=RANGE) => A.tenantDealAnalytics(scope,range).summary;
// Opening hours come from server config until v9; only the time zone is stored per tenant.
const hours = () => { config.businessStart = 9; config.businessEnd = 17; return A.configureDealHours(ownerA,{ timezone:'Asia/Jakarta' }); };

async function request(path,{ cookie,method='GET',body }={}) {
  const r = await fetch(base+path,{ method,headers:{ 'Content-Type':'application/json',...(cookie?{cookie}:{}) },
    body:body===undefined?undefined:JSON.stringify(body) });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status:r.status,data,text,headers:r.headers };
}
async function login(username) {
  const r = await request('/login',{ method:'POST',body:{ username,password:'analytics-fixture-password' } });
  assert.equal(r.status,200,username);
  return r.headers.get('set-cookie').split(';')[0];
}

test('1. pesan di luar jam operasional tidak menurunkan closing_rate; balasan dan keputusan tidak hitung ganda', () => {
  hours();
  const won = deal(); decide(won,'verified_lunas',MONDAY+DAY);
  const night = deal(); message(night,0,OUTSIDE);
  const day = deal(); message(day,0,INSIDE);
  // Injected clock: before 24 hours nothing is recorded yet.
  assert.equal(A.sweepUnanswered('A',INSIDE+DAY-1),0);
  let s = summary();
  assert.equal(s.counts.qualified_unanswered,1);
  assert.deepEqual([s.closing_rate.numerator,s.closing_rate.n],[1,2]);
  assert.ok(!A.insideBusinessHours(OUTSIDE,A.businessHours('A')));
  // Repeated reads stay idempotent.
  assert.equal(A.sweepUnanswered('A',NOW),0);
  // A later reply clears it; a new inbound inside hours may count again, still once per deal.
  message(day,1,INSIDE+2*DAY,{ agent:10,source:'human' });
  assert.equal(summary().counts.qualified_unanswered,0);
  message(day,0,INSIDE+3*DAY);
  assert.equal(summary().counts.qualified_unanswered,1);
  // Final decision replaces unanswered (no double count in the denominator).
  decide(day,'rejected',INSIDE+4*DAY,{ reason_code:'harga_tidak_cocok' });
  s = summary();
  assert.equal(s.counts.qualified_unanswered,0);
  assert.equal(s.counts.rejected,1);
  assert.equal(s.closing_rate.n,2);
});

test('2. DP aktif di luar penyebut closing, DP hangus di dalam; open_deals dan dp_share', () => {
  const direct = deal(); decide(direct,'verified_lunas',MONDAY+DAY);
  const active = deal(); decide(active,'dp_aktif',MONDAY+DAY);
  const lost = deal(); decide(lost,'dp_aktif',MONDAY+DAY);
  db.prepare("UPDATE deals SET state='dp_hangus' WHERE id=?").run(lost.id);
  appendDealEvent(lost.id,'dp_hangus',{ due_at:MONDAY+2*DAY },null,MONDAY+3*DAY);
  const waiting = deal(); decide(waiting,'awaiting_proof',MONDAY+DAY);
  const pending = deal(); decide(pending,'proof_submitted',MONDAY+DAY);
  const s = summary();
  assert.deepEqual([s.closing_rate.numerator,s.closing_rate.n],[1,2]);
  assert.equal(s.closing_rate.value,0.5);
  assert.deepEqual(s.open_deals,{ value:2,n:2,dp_aktif:1,awaiting_proof:1 });
  assert.equal(s.pending_verification.value,1);
  assert.deepEqual([s.dp_share.numerator,s.dp_share.n],[2,3]);
  assert.deepEqual([s.dp_settle.numerator,s.dp_settle.n],[0,1]);
  assert.equal(s.aging.dp_hangus.n,1);
  assert.equal(s.aging.dp_hangus.p90,2*DAY);
  assert.equal(s.aging.dp_active.p90,NOW-(MONDAY+DAY));
});

test('3. refund menurunkan neto, bruto dan riwayat pelunasan tetap', () => {
  const won = deal(); decide(won,'verified_lunas',MONDAY+DAY);
  const body = { action:'refund',amount:300000,note:'Barang retur sebagian',request_id:'refund-0001' };
  assert.throws(()=>A.recordAnalyticsOutcome(ownerA,won.id,body,MONDAY+2*DAY),/berbeda/);
  A.recordAnalyticsOutcome(adminA,won.id,body,MONDAY+2*DAY);
  A.recordAnalyticsOutcome(adminA,won.id,body,MONDAY+2*DAY); // same request id is idempotent
  assert.throws(()=>A.recordAnalyticsOutcome(adminA,won.id,{ ...body,amount:5 },MONDAY+2*DAY),/sudah dipakai/);
  assert.throws(()=>A.recordAnalyticsOutcome(adminA,won.id,{ ...body,amount:800000,request_id:'refund-0002' },MONDAY+2*DAY),/melebihi/);
  const s = summary();
  assert.deepEqual(s.revenue,{ gross:1000000,net:700000,refund:300000,n:1 });
  assert.equal(s.counts.verified_lunas,1);
  assert.equal(s.closing_rate.numerator,1);
  assert.equal(s.aov.net,700000);
});

test('4. origin DP tetap DP setelah lunas', () => {
  const dp = deal(); decide(dp,'dp_aktif',MONDAY+DAY); decide(dp,'verified_lunas',MONDAY+2*DAY);
  const direct = deal(); decide(direct,'verified_lunas',MONDAY+DAY);
  const s = summary();
  assert.equal(s.counts.settled_dp,1);
  assert.equal(s.counts.settled_direct,1);
  assert.deepEqual([s.dp_settle.numerator,s.dp_settle.n,s.dp_settle.value],[1,1,1]);
  assert.equal(s.open_deals.value,0);
});

test('5. tanda n < 10 dan pembagi nol sebagai data belum tersedia', () => {
  let s = summary();
  assert.deepEqual(s.closing_rate,{ numerator:0,n:0,value:null,low_sample:true });
  for (let i=0;i<9;i++) decide(deal(),'verified_lunas',MONDAY+DAY);
  s = summary();
  assert.equal(s.closing_rate.n,9); assert.equal(s.closing_rate.low_sample,true);
  decide(deal(),'verified_lunas',MONDAY+DAY);
  s = summary();
  assert.equal(s.closing_rate.n,10); assert.equal(s.closing_rate.low_sample,false);
  assert.equal(s.dp_settle.value,null);
});

test('6. CSV meredaksi telepon/rekening, aman untuk spreadsheet dan mengikuti retensi', () => {
  const product = Number(db.prepare(`INSERT INTO products(tenant_id,number_id,sku,name,price) VALUES('A',10,'csv-sku',?,1)`)
    .run('=HYPERLINK("x") rek 1234567890 hp 0812-3456-7890').lastInsertRowid);
  decide(deal('A',{ product }),'verified_lunas',MONDAY+DAY);
  const old = deal('A',{ at:MONDAY-DAY/2 }); decide(old,'verified_lunas',MONDAY);
  const prior = config.retentionDays;
  config.retentionDays = Math.ceil((NOW-MONDAY)/DAY);
  try {
    const csv = A.exportDealAnalytics(ownerA,A.analyticsRange({ from:String(MONDAY-DAY),to:String(NOW) },NOW,true));
    assert.ok(!csv.includes('1234567890') && !csv.includes('3456'));
    assert.match(csv,/12\*{6}90/);
    assert.match(csv,/"'=HYPERLINK/);
    assert.equal(csv.trim().split('\r\n').length,2,'deal older than retention excluded');
  } finally { config.retentionDays = prior; }
  assert.equal(A.maskAnalyticsText('+62 812 3456 7890'),'62*********90');
});

test('7. isolasi semua agregat antar tenant dan agregat platform tanpa detail', () => {
  const productB = Number(db.prepare(`INSERT INTO products(tenant_id,number_id,sku,name,price) VALUES('B',20,'b-sku','Produk Rahasia B',1)`).run().lastInsertRowid);
  decide(deal('A'),'verified_lunas',MONDAY+DAY);
  for (let i=0;i<3;i++) decide(deal('B',{ product:productB }),'verified_lunas',MONDAY+DAY);
  const a = A.tenantDealAnalytics(ownerA,RANGE), b = A.tenantDealAnalytics(ownerB,RANGE);
  assert.equal(a.summary.counts.verified_lunas,1);
  assert.equal(b.summary.counts.verified_lunas,3);
  assert.ok(!JSON.stringify(a).includes('Produk Rahasia B'));
  for (const field of ['product','number','agent','handler']) {
    assert.equal(a.groups[field].reduce((n,g)=>n+g.n,0),a.summary.n,field);
  }
  assert.ok(!a.deals.some(d=>b.deals.some(x=>x.id===d.id)));
  const p = A.platformDealAnalytics(RANGE);
  assert.equal(p.summary.counts.verified_lunas,4);
  assert.equal(p.tenants,2);
  assert.equal(p.groups,undefined); assert.equal(p.deals,undefined);
  assert.ok(!/Produk Rahasia B|secret-|isi chat/.test(JSON.stringify(p)));
});

test('replay: angka dihitung dari deal_events, bukan dari kolom state deals', () => {
  const won = deal(); decide(won,'verified_lunas',MONDAY+DAY);
  const forged = deal();
  db.prepare("UPDATE deals SET state='verified_lunas' WHERE id=?").run(forged.id); // no decision event
  const before = summary();
  assert.equal(before.counts.verified_lunas,1);
  // As-of replay ignores events after the injected clock.
  assert.equal(summary(ownerA,{ ...RANGE,now:MONDAY+DAY/2 }).counts.verified_lunas,0);
  assert.deepEqual(summary(),before);
});

test('atribusi: produk, nomor, agen, AI vs manusia, dan yang belum diketahui eksplisit', () => {
  const ai = deal(); message(ai,1,INSIDE,{ source:'ai' });
  const human = deal(); message(human,1,INSIDE,{ agent:11,source:'human' });
  decide(ai,'verified_lunas',MONDAY+DAY); decide(human,'verified_lunas',MONDAY+DAY);
  const unknown = deal(); decide(unknown,'rejected',MONDAY+DAY,{ reason_code:'harga_tidak_cocok' });
  const g = A.tenantDealAnalytics(ownerA,RANGE).groups;
  const handler = Object.fromEntries(g.handler.map(x=>[x.key,x.n]));
  assert.deepEqual(handler,{ ai:1,human:1,unknown:1 });
  assert.ok(g.product.some(x=>x.label==='Belum tercatat'));
  assert.ok(g.agent.some(x=>x.label==='A-1'));
  assert.ok(g.number.every(x=>x.label==='A-number-0'));
});

test('tren mingguan mengikuti zona waktu tenant', () => {
  // Sunday 18:00 UTC = Monday 01:00 WIB -> belongs to the Monday week in Jakarta.
  assert.equal(A.weekOf(MONDAY-6*3600000,'Asia/Jakarta'),'2026-03-02');
  assert.equal(A.weekOf(MONDAY-6*3600000,'UTC'),'2026-02-23');
  decide(deal('A',{ at:MONDAY+DAY }),'verified_lunas',MONDAY+DAY);
  const weeks = A.tenantDealAnalytics(ownerA,RANGE).weekly;
  assert.equal(weeks.find(w=>w.week==='2026-03-02').counts.verified_lunas,1);
});

test('role: owner/tenant_admin melihat detail dan CSV; agen dan platform tidak; platform hanya agregat', async () => {
  db.prepare("UPDATE tenant_members SET role='tenant_admin' WHERE tenant_id='A' AND user_id=11").run();
  const owner = await login('A-0'), admin = await login('A-1'), agent = await login('B-1'), platform = await login('platform-fixture');
  for (const cookie of [owner,admin]) {
    assert.equal((await request('/deals/analytics',{ cookie })).status,200);
    const csv = await request('/deals/analytics/export',{ cookie });
    assert.equal(csv.status,200);
    assert.match(csv.headers.get('content-type'),/text\/csv/);
    assert.match(csv.headers.get('content-disposition'),/attachment/);
    assert.equal(csv.headers.get('cache-control'),'private, no-store');
  }
  assert.equal((await request('/deals/analytics',{ cookie:agent })).status,403);
  assert.equal((await request('/deals/analytics/export',{ cookie:agent })).status,403);
  assert.equal((await request('/deals/analytics/hours',{ cookie:agent,method:'PATCH',body:{ timezone:'UTC' } })).status,403);
  assert.notEqual((await request('/deals/analytics',{ cookie:platform })).status,200);
  assert.notEqual((await request('/deals/analytics/export',{ cookie:platform })).status,200);
  const agg = await request('/platform/deal-analytics',{ cookie:platform });
  assert.equal(agg.status,200);
  assert.equal(agg.data.groups,undefined);
  assert.equal((await request('/platform/deal-analytics',{ cookie:owner })).status,403);
  assert.equal((await request('/deals/analytics?from=5&to=1',{ cookie:owner })).status,400);
  assert.equal((await request('/deals/analytics/hours',{ cookie:owner,method:'PATCH',body:{ timezone:'Mars/Base' } })).status,400);
});
