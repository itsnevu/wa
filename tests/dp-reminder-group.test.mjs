import assert from 'node:assert/strict';
import test from 'node:test';
import { twoTenants } from './tenant-fixture.mjs';

// Hotfix 0.1: a DP reminder must never be posted into a group chat; DM reminders keep working.
const fixture = twoTenants();
Object.assign(process.env,{ DATA_DIR:fixture.dir,ALLOW_AUTO_MIGRATE:'1',MULTITENANT_ENABLED:'0' });
const { db } = await import('../src/db.js');
const { DAY } = await import('../src/dealReview.js');
const { runDealReviewJobs,isGroupChat } = await import('../src/dealReviewJobs.js');
test.after(()=>{ db.close(); fixture.close(); });

const now = Date.UTC(2026,5,1);
function dpDeal(chatId,jid) {
  db.prepare('INSERT INTO chats(id,number_id,tenant_id,jid) VALUES(?,10,\'A\',?)').run(chatId,jid);
  return Number(db.prepare(`INSERT INTO deals(tenant_id,session_id,chat_id,state,origin,amount,paid_amount,amount_due,due_at,created_at)
    VALUES('A',10,?,'dp_aktif','dp',500000,100000,400000,?,?)`).run(chatId,now+DAY/2,now-DAY).lastInsertRowid);
}

test('pengingat DP: grup dilewati dan dicatat, DM tetap terkirim, tidak dicoba ulang', async () => {
  const group = dpDeal(8001,'120363000000000001@g.us');
  const dm = dpDeal(8002,'6281200000001@s.whatsapp.net');
  const sent = [];
  const sendReminder = async (_session,jid,text) => { sent.push({ jid,text }); };
  await runDealReviewJobs({ now,sendReminder });
  await runDealReviewJobs({ now:now+60000,sendReminder }); // second pass must not retry the group
  assert.deepEqual(sent.map(s=>s.jid),['6281200000001@s.whatsapp.net']);
  assert.match(sent[0].text,/Sisa tagihan Rp 400\.000/);
  const skipped = db.prepare("SELECT payload_json FROM deal_events WHERE deal_id=? AND type='dp_reminder_skipped'").all(group);
  assert.equal(skipped.length,1);
  assert.deepEqual(JSON.parse(skipped[0].payload_json),{ kind:'dp_h_minus_1',reason:'group_chat' });
  assert.equal(db.prepare("SELECT count(*) n FROM deal_job_notices WHERE deal_id=? AND delivered_at IS NULL").get(group).n,0);
  assert.equal(db.prepare("SELECT count(*) n FROM deal_events WHERE deal_id=? AND type='dp_h_minus_1'").get(dm).n,1);
});

test('isGroupChat: chat_type menang, sufiks JID sebagai fallback', () => {
  assert.equal(isGroupChat({ chat_type:'group',jid:'x@s.whatsapp.net' }),true);
  assert.equal(isGroupChat({ jid:'1203@g.us' }),true);
  assert.equal(isGroupChat({ chat_type:'dm',jid:'62@s.whatsapp.net' }),false);
  assert.equal(isGroupChat({ jid:null }),false);
});
