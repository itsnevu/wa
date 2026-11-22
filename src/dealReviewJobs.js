import { db } from './db.js';
import { DAY, OPEN_REVIEW, appendDealEvent, insertDealNotice } from './dealReview.js';

const activeTenants = db.prepare("SELECT id FROM tenants WHERE status='active' AND deleted_at IS NULL");
const work = db.prepare(`SELECT d.*,c.jid FROM deals d JOIN chats c ON c.id=d.chat_id AND c.tenant_id=d.tenant_id
  WHERE d.tenant_id=? AND ((d.state IN (${OPEN_REVIEW}) AND COALESCE(d.due_sla_at,d.created_at+86400000)<=?)
    OR (d.state='dp_aktif' AND d.due_at<=?))`);
const owner = db.prepare(`SELECT user_id FROM tenant_members WHERE tenant_id=? AND role='owner' ORDER BY user_id LIMIT 1`);
const assign = db.prepare('UPDATE deals SET assigned_to=? WHERE tenant_id=? AND id=?');
const finish = db.prepare('UPDATE deals SET state=?,decided_at=? WHERE tenant_id=? AND id=?');
const distribution = db.prepare(`SELECT v."by" AS admin_id,v.reason_code,COUNT(*) AS total
  FROM deal_verifications v JOIN deals d ON d.id=v.deal_id
  WHERE d.tenant_id=? AND v.decision='rejected' AND v.at>=? AND v.at<? GROUP BY 1,2 ORDER BY 1,3 DESC`);
const openCount = db.prepare(`SELECT COUNT(*) AS total,MIN(created_at) AS oldest FROM deals
  WHERE tenant_id=? AND state IN (${OPEN_REVIEW})`);
const pending = db.prepare(`SELECT j.notice_key,j.deal_id,j.kind,d.session_id,d.due_at,d.amount_due,c.jid
  FROM deal_job_notices j JOIN deals d ON d.id=j.deal_id AND d.tenant_id=j.tenant_id AND d.state='dp_aktif'
  JOIN chats c ON c.id=d.chat_id AND c.tenant_id=d.tenant_id
  WHERE j.tenant_id=? AND j.delivered_at IS NULL AND j.kind IN ('dp_h_minus_1','dp_h_plus_1')
  ORDER BY j.at LIMIT 100`);
const delivered = db.prepare('UPDATE deal_job_notices SET delivered_at=? WHERE tenant_id=? AND notice_key=?');
const supersede = db.prepare(`UPDATE deal_job_notices SET delivered_at=?
  WHERE tenant_id=? AND notice_key=? AND delivered_at IS NULL`);
// chat_type arrives with the group schema; until backfill runs the JID suffix is authoritative.
export const isGroupChat = ({ chat_type, jid }) => chat_type === 'group' || String(jid ?? '').endsWith('@g.us');
const notify = (tenant,key,deal,kind,now,payload,sent = now) =>
  insertDealNotice.run(tenant,key,deal,kind,now,JSON.stringify(payload),sent).changes;

const plan = db.transaction((tenant,now) => {
  for (const d of work.all(tenant,now,now+DAY)) {
    if (d.state === 'dp_aktif') {
      if (now >= d.due_at+3*DAY) {
        finish.run('dp_hangus',now,tenant,d.id);
        appendDealEvent(d.id,'dp_hangus',{ due_at:d.due_at },null,now);
      } else if (now >= d.due_at+DAY) {
        supersede.run(now,tenant,`dp_h_minus_1:${d.id}`);
        notify(tenant,`dp_h_plus_1:${d.id}`,d.id,'dp_h_plus_1',now,{},null);
      } else if (now < d.due_at) notify(tenant,`dp_h_minus_1:${d.id}`,d.id,'dp_h_minus_1',now,{},null);
    } else if (now >= d.created_at+3*DAY) {
      finish.run('expired',now,tenant,d.id);
      appendDealEvent(d.id,'sla_expired',{},null,now);
    } else {
      const member = owner.get(tenant);
      if (member && notify(tenant,`sla:${d.id}`,d.id,'sla_escalated',now,{ owner_id:member.user_id })) {
        assign.run(member.user_id,tenant,d.id);
        appendDealEvent(d.id,'sla_escalated',{ owner_id:member.user_id },null,now);
      }
    }
  }
  const today = Math.floor(now/DAY)*DAY;
  const stats = openCount.get(tenant);
  notify(tenant,`digest:${today}`,null,'digest',now,{
    review_count:stats.total, oldest_age_ms:stats.oldest == null ? null : now-stats.oldest,
    reasons:distribution.all(tenant,today-DAY,today),
  });
});

let running = false;
export async function runDealReviewJobs({ now = Date.now(), sendReminder } = {}) {
  const tenants = activeTenants.all();
  for (const { id } of tenants) plan.immediate(id,now);
  if (!sendReminder || running) return;
  running = true;
  try {
    for (const { id:tenant } of tenants) {
      for (const entry of pending.all(tenant)) {
        if (entry.kind === 'dp_h_minus_1' && now >= entry.due_at) continue;
        // Hotfix: never announce a balance to a group. Permanent fix (DM to buyer) is task 6.
        if (isGroupChat(entry)) {
          db.transaction(() => {
            delivered.run(now,tenant,entry.notice_key);
            appendDealEvent(entry.deal_id,'dp_reminder_skipped',{ kind:entry.kind,reason:'group_chat' },null,now);
            // v9: queue for re-delivery to the buyer's DM once buyer_jid exists (v10).
            db.prepare(`INSERT OR IGNORE INTO dp_reminder_rescan(tenant_id,deal_id,kind,status,created_at) VALUES(?,?,?,'awaiting_buyer_jid',?)`).run(tenant,entry.deal_id,entry.kind,now);
          }).immediate();
          continue;
        }
        try {
          const balance = entry.amount_due.toLocaleString('id-ID');
          const date = new Intl.DateTimeFormat('id-ID',{ dateStyle:'medium',timeZone:'Asia/Jakarta' }).format(entry.due_at);
          const text = entry.kind === 'dp_h_minus_1'
            ? `Pengingat pembayaran. Sisa tagihan Rp ${balance}, jatuh tempo ${date} (WIB).`
            : `Pengingat pembayaran. Sisa tagihan Rp ${balance} telah melewati jatuh tempo ${date} (WIB).`;
          await sendReminder(entry.session_id,entry.jid,text);
          db.transaction(() => {
            delivered.run(now,tenant,entry.notice_key);
            appendDealEvent(entry.deal_id,entry.kind,{ due_at:entry.due_at },null,now);
          }).immediate();
        } catch (err) {
          console.warn('[deal.reminder]',entry.deal_id,err.message);
        }
      }
    }
  } finally { running = false; }
}

export function startDealReviewJobs(sendReminder) {
  const tick = () => void runDealReviewJobs({ sendReminder }).catch(err => console.error('[deal.jobs]',err.message));
  setImmediate(tick);
  return setInterval(tick,60000);
}
