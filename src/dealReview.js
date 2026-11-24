import { randomInt } from 'node:crypto';
import { db } from './db.js';
import { dealReasons } from './dealReasons.js';
import { dealProofAvailable } from './media.js';
import { classifyMessages } from './dealClassifier.js';

export const DAY = 86400000;
export const OPEN_REVIEW = "'candidate','awaiting_proof','proof_submitted'";
const canDecide = scope => !scope.grant && ['owner','tenant_admin'].includes(scope.role);
const ownerOnly = scope => scope.role === 'owner' && !scope.grant;
const failure = (status, message, code) => Object.assign(Error(message), { status, code });
const money = value => Number.isSafeInteger(value) && value > 0;
const idOf = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const fail = (message, code) => { throw failure(400, message, code); };
const scopedDeal = db.prepare(`SELECT d.*, n.owner_id,n.name AS session_name,c.jid,p.name AS product_name
  FROM deals d JOIN numbers n ON n.id=d.session_id AND n.tenant_id=d.tenant_id
  JOIN chats c ON c.id=d.chat_id AND c.tenant_id=d.tenant_id AND c.number_id=d.session_id
  LEFT JOIN products p ON p.id=d.product_id AND p.tenant_id=d.tenant_id
  WHERE d.tenant_id=? AND d.id=?`);

export function requireReviewer(scope, owner = false) {
  if (!(owner ? ownerOnly(scope) : canDecide(scope))) throw failure(403, 'Akses keputusan tidak tersedia.');
}

function getDeal(scope, id) {
  const row = scopedDeal.get(scope.tenantId, idOf(id));
  if (!row || scope.grant || (!canDecide(scope) && row.owner_id !== scope.userId)) {
    throw failure(404, 'Deal tidak ditemukan.');
  }
  return row;
}

const listRows = db.prepare(`SELECT d.id FROM deals d JOIN numbers n ON n.id=d.session_id AND n.tenant_id=d.tenant_id
  WHERE d.tenant_id=@tenantId AND (@all=1 OR n.owner_id=@userId)
  AND ((@tab='review' AND d.state IN (${OPEN_REVIEW})) OR (@tab='dp' AND d.state='dp_aktif') OR
    (@tab='audit' AND EXISTS(SELECT 1 FROM deal_events e WHERE e.deal_id=d.id AND e.type='audit_sampled')
      AND NOT EXISTS(SELECT 1 FROM deal_events e WHERE e.deal_id=d.id AND e.type='audit_completed')))
  ORDER BY CASE WHEN @tab='dp' THEN d.due_at ELSE d.due_sla_at END <= @now DESC,
  CASE WHEN @tab='dp' THEN 0 WHEN d.confidence>=0.85 THEN 0 WHEN d.confidence>=0.6 THEN 1 ELSE 2 END,
  d.created_at,d.id LIMIT 31 OFFSET @offset`);
const rejectedRows = db.prepare(`SELECT d.id, n.name AS session_name, d.amount, d.reason_code, d.decided_at,
  (SELECT v.note FROM deal_verifications v WHERE v.deal_id=d.id AND v.decision='rejected'
    ORDER BY v.at DESC,v.id DESC LIMIT 1) AS note
  FROM deals d JOIN numbers n ON n.id=d.session_id AND n.tenant_id=d.tenant_id
  WHERE d.tenant_id=@tenantId AND (@all=1 OR n.owner_id=@userId) AND d.state='rejected'
  ORDER BY d.decided_at DESC,d.id DESC LIMIT 31 OFFSET @offset`);
const relevant = db.prepare(`WITH pool AS (
  SELECT m.id,substr(m.body,1,500) AS body,m.kind,m.from_me,m.ts,m.media_path IS NOT NULL AS has_media
  FROM messages m WHERE m.tenant_id=@tenant_id AND m.number_id=@session_id AND m.chat_id=@chat_id
  AND m.id IN (SELECT message_id FROM deal_evidence WHERE deal_id=@id
    UNION SELECT id FROM (SELECT id FROM messages WHERE tenant_id=@tenant_id AND number_id=@session_id
      AND chat_id=@chat_id ORDER BY id DESC LIMIT 40))
)
SELECT *,EXISTS(SELECT 1 FROM deal_evidence WHERE deal_id=@id AND message_id=pool.id) AS is_evidence
FROM pool ORDER BY is_evidence DESC, CASE WHEN lower(body) LIKE '%transfer%' OR lower(body) LIKE '%bayar%'
  OR lower(body) LIKE '%qris%' OR lower(body) LIKE '%rp%' OR kind IN ('image','doc') THEN 0 ELSE 1 END, id DESC LIMIT 6`);
const reasonFor = db.prepare('SELECT output_json FROM classifier_runs WHERE tenant_id=? AND chat_id=? AND version=? ORDER BY id DESC LIMIT 1');
const eventGet = db.prepare(`SELECT e.payload_json FROM deal_events e JOIN deals d ON d.id=e.deal_id
  WHERE d.tenant_id=? AND d.id=? AND e.type=? ORDER BY e.id DESC LIMIT 1`);
const evidenceMessage = db.prepare(`SELECT m.id,m.kind,m.media_path FROM messages m JOIN deals d
  ON d.tenant_id=m.tenant_id AND d.session_id=m.number_id AND d.chat_id=m.chat_id
  WHERE d.tenant_id=? AND d.id=? AND m.id=? AND m.from_me=0 AND m.kind IN ('image','doc')`);
const attach = db.prepare("INSERT OR IGNORE INTO deal_evidence(deal_id,message_id,kind) VALUES(?,?,'payment_attachment')");
const insertVerification = db.prepare(`INSERT INTO deal_verifications(deal_id,decision,reason_code,note,"by",at)
  VALUES(?,?,?,?,?,?)`);
const insertEvent = db.prepare('INSERT INTO deal_events(deal_id,type,payload_json,actor,at) VALUES(?,?,?,?,?)');
const update = db.prepare(`UPDATE deals SET state=@state,origin=@origin,amount=@amount,paid_amount=@paid_amount,
  amount_due=@amount_due,due_at=@due_at,method=@method,reason_code=@reason_code,decided_at=@decided_at
  WHERE tenant_id=@tenant_id AND id=@id`);
const payment = db.prepare('INSERT INTO dp_payments(deal_id,amount,method,proof_message_id,at) VALUES(?,?,?,?,?)');
const usedPaymentProof = db.prepare('SELECT 1 FROM dp_payments WHERE deal_id=? AND proof_message_id=?');
const totalPaid = db.prepare('SELECT COALESCE(SUM(amount),0) AS total FROM dp_payments WHERE deal_id=?');
const paymentKey = db.prepare(`SELECT 1 FROM deal_events WHERE deal_id=? AND type='decision'
  AND json_extract(payload_json,'$.request_id')=?`);
const notices = db.prepare(`SELECT kind,at,deal_id,payload_json FROM deal_job_notices WHERE tenant_id=?
  AND kind IN ('sla_escalated','digest') ORDER BY at DESC LIMIT 30`);
const auditStats = db.prepare(`SELECT json_extract(e.payload_json,'$.admin_id') AS admin_id,
  json_extract(e.payload_json,'$.classifier_version') AS classifier_version, COUNT(*) AS audited,
  SUM(json_extract(e.payload_json,'$.false_positive')) AS false_positive
  FROM deal_events e JOIN deals d ON d.id=e.deal_id WHERE d.tenant_id=? AND e.type='audit_completed'
  GROUP BY 1,2`);

export function appendDealEvent(id, type, payload, actor, at) {
  insertEvent.run(id, type, JSON.stringify(payload), actor == null ? null : String(actor), at);
}

export function getDealEvidence(scope, id, messageId) {
  const row = getDeal(scope, id);
  const message = evidenceMessage.get(scope.tenantId, row.id, idOf(messageId));
  if (!message?.media_path) throw failure(404, 'Lampiran bukti tidak tersedia.');
  return { row, message };
}

function card(row, now) {
  const output = row.classifier_version ? reasonFor.get(row.tenant_id,row.chat_id,row.classifier_version) : null;
  const proof = eventGet.get(row.tenant_id,row.id,'proof_recorded');
  const decision = JSON.parse(eventGet.get(row.tenant_id,row.id,'decision')?.payload_json ?? 'null');
  const parsed = proof && JSON.parse(proof.payload_json);
  const messages = relevant.all(row).sort((a,b) => a.id - b.id);
  const method = row.method === 'dana' && row.classifier_version === 'deal-rules-v1' && !row.decided_at
    ? classifyMessages(messages).method : row.method;
  return {
    id: row.id, session_name: row.session_name, state: row.state, origin: row.origin,
    amount: row.amount, paid_amount: row.paid_amount, amount_due: row.amount_due, due_at: row.due_at,
    method, qty: row.qty, confidence: row.confidence, created_at: row.created_at, due_sla_at: row.due_sla_at,
    age_ms: Math.max(0, now - row.created_at), overdue: now >= (row.due_sla_at ?? row.created_at + DAY),
    product: row.product_name || (output ? JSON.parse(output.output_json).product : null),
    model_reason: output ? JSON.parse(output.output_json).reason : null,
    messages,
    recorded_proof: parsed ? { message_id: parsed.message_id, amount: parsed.amount } : null,
    needs_info: row.state === 'awaiting_proof' && decision?.action === 'info',
    amount_mismatch: Boolean(parsed && parsed.amount !== row.amount || decision?.amount_mismatch),
  };
}

export function listDealReview(scope, tab, offset, now = Date.now()) {
  if (scope.grant) throw failure(403, 'Akses antrean tidak tersedia.');
  if (tab === 'audit') requireReviewer(scope, true);
  const filters = { tenantId: scope.tenantId, userId: scope.userId, all: Number(canDecide(scope)), offset };
  const rows = tab === 'rejected' ? rejectedRows.all(filters) : listRows.all({ ...filters, tab, now });
  const page = rows.slice(0,30);
  return {
    can_decide: canDecide(scope), owner: ownerOnly(scope), reasons: dealReasons,
    cards: tab === 'rejected' ? page : page.map(({ id }) => card(getDeal(scope,id),now)), has_more: rows.length > 30,
    notices: ownerOnly(scope) ? notices.all(scope.tenantId).map(n => ({ ...n, payload: { ...JSON.parse(n.payload_json), deal_id:n.deal_id }, payload_json: undefined })) : [],
    audit_stats: tab === 'audit' ? auditStats.all(scope.tenantId) : [],
  };
}

export const decideDeal = db.transaction((scope, id, body, now = Date.now()) => {
  requireReviewer(scope);
  const row = getDeal(scope,id);
  const action = body?.action;
  const note = typeof body?.note === 'string' ? body.note.trim() : '';
  if (note.length > 1500) fail('Catatan maksimal 1500 karakter.');
  if (action === 'installment' && typeof body.request_id === 'string' && paymentKey.get(row.id, body.request_id)) return card(row, now);
  if (action === 'installment' ? row.state !== 'dp_aktif' : !['candidate','awaiting_proof','proof_submitted'].includes(row.state)) {
    throw failure(409, 'Status deal sudah berubah. Muat ulang antrean.');
  }
  const previous = row.state;
  let reason = null;
  let mismatch = false;
  let proofAmount;
  let paymentAmount;
  if (action === 'proof') {
    const proof = evidenceMessage.get(scope.tenantId,row.id,idOf(body.message_id));
    if (!dealProofAvailable(proof?.media_path) || !money(body.proof_amount) || !money(body.amount ?? row.amount)) {
      fail('Pilih lampiran bukti yang tersedia dan isi nominal tagihan serta bukti.');
    }
    row.amount = body.amount ?? row.amount;
    attach.run(row.id,proof.id);
    appendDealEvent(row.id,'proof_recorded',{ message_id: proof.id, amount: body.proof_amount },scope.userId,now);
    row.state = 'proof_submitted';
  } else if (action === 'paid') {
    const proofRow = eventGet.get(scope.tenantId,row.id,'proof_recorded');
    const proof = proofRow && JSON.parse(proofRow.payload_json);
    if (row.state !== 'proof_submitted' || !proof || !money(row.amount) ||
      !dealProofAvailable(evidenceMessage.get(scope.tenantId,row.id,proof.message_id)?.media_path)) {
      throw failure(409,'Bukti pembayaran belum tercatat atau sudah tidak tersedia.');
    }
    proofAmount = proof.amount;
    mismatch = proofAmount !== row.amount;
    if (mismatch && !note) throw failure(422,'Nominal bukti berbeda. Isi alasan override.', 'AMOUNT_MISMATCH');
    row.state = 'verified_lunas';
    row.paid_amount = proofAmount;
  } else if (action === 'dp' || action === 'installment') {
    const initial = action === 'dp';
    const method = typeof body.method === 'string' ? body.method.trim() : '';
    paymentAmount = body.paid_amount;
    if (!money(paymentAmount) || !method || method.length > 80) fail('Isi nominal pembayaran dan metode.');
    if (!initial && (typeof body.request_id !== 'string' || !/^[\w-]{8,80}$/.test(body.request_id))) fail('Identitas pembayaran diperlukan.');
    const proofId = body.message_id == null ? null : idOf(body.message_id);
    if (body.message_id != null && !dealProofAvailable(evidenceMessage.get(scope.tenantId,row.id,proofId)?.media_path)) {
      fail('Lampiran pembayaran tidak tersedia.');
    }
    if (proofId && usedPaymentProof.get(row.id,proofId)) throw failure(409,'Lampiran ini sudah tercatat pada ledger DP.');
    if (initial) {
      const amount = body.amount ?? row.amount;
      if (!money(amount) || !money(body.amount_due) || amount - paymentAmount !== body.amount_due ||
        !Number.isSafeInteger(body.due_at) || body.due_at <= now || body.due_at > 8640000000000000) {
        fail('Total harus sama dengan DP ditambah sisa tagihan. Pilih jatuh tempo di masa depan.');
      }
      Object.assign(row,{ amount, due_at: body.due_at, origin: 'dp', method });
    } else if (!proofId && !note) fail('Pilih bukti cicilan atau isi catatan verifikasi.');
    payment.run(row.id,paymentAmount,method,proofId,now);
    row.paid_amount = totalPaid.get(row.id).total;
    row.amount_due = Math.max(row.amount - row.paid_amount,0);
    row.state = row.amount_due ? 'dp_aktif' : 'verified_lunas';
    if (!row.amount_due) appendDealEvent(row.id,'dp_termin',{ paid_amount: row.paid_amount },scope.userId,now);
  } else if (action === 'reject') {
    if (typeof body.reason_code !== 'string' || !Object.hasOwn(dealReasons,body.reason_code)) fail('Pilih alasan penolakan.');
    reason = body.reason_code;
    if (dealReasons[reason].requiresNote && note.length < 10) fail('Catatan Lain-lain minimal 10 karakter.');
    row.state = 'rejected';
  } else if (action === 'info') {
    row.state = 'awaiting_proof';
  } else fail('Keputusan tidak dikenali.');
  row.reason_code = reason;
  row.decided_at = now;
  const verification = insertVerification.run(row.id,row.state,reason,note || null,scope.userId,now);
  update.run(row);
  appendDealEvent(row.id,'decision',{
    action, from: previous, decision: row.state, reason_code: reason, amount: row.amount,
    proof_amount: proofAmount, payment_amount: paymentAmount, amount_mismatch: mismatch,
    request_id: action === 'installment' ? body.request_id : undefined, classifier_version: row.classifier_version,
    training_label: row.state, verification_id: Number(verification.lastInsertRowid),
  },scope.userId,now);
  return card(row,now);
});

const knownNotice = db.prepare('SELECT 1 FROM deal_job_notices WHERE tenant_id=? AND notice_key=?');
const sampleCandidates = db.prepare(`SELECT d.id,d.classifier_version,v."by" AS admin_id FROM deals d
  JOIN deal_verifications v ON v.id=(SELECT id FROM deal_verifications WHERE deal_id=d.id AND decision='verified_lunas' ORDER BY id DESC LIMIT 1)
  WHERE d.tenant_id=? AND d.state='verified_lunas' AND v.at>? AND v.at<=?
  AND NOT EXISTS(SELECT 1 FROM deal_events e WHERE e.deal_id=d.id AND e.type='audit_sampled')`);

export const insertDealNotice = db.prepare(`INSERT OR IGNORE INTO deal_job_notices
  (tenant_id,notice_key,deal_id,kind,at,payload_json,delivered_at) VALUES(?,?,?,?,?,?,?)`);

export const sampleDealAudit = db.transaction((scope,now = Date.now()) => {
  requireReviewer(scope,true);
  const key = 'audit:' + new Date(now).toISOString().slice(0,10);
  if (knownNotice.get(scope.tenantId,key)) return { sampled: 0, already_sampled: true };
  const candidates = sampleCandidates.all(scope.tenantId,now-DAY,now);
  if (!candidates.length) return { sampled: 0 };
  if (!insertDealNotice.run(scope.tenantId,key,null,'audit_window',now,'{}',now).changes) return { sampled: 0, already_sampled: true };
  const count = Math.ceil(candidates.length * 0.05);
  for (let i=0; i<count; i++) {
    const j = randomInt(i,candidates.length);
    [candidates[i],candidates[j]] = [candidates[j],candidates[i]];
    const { id,admin_id,classifier_version } = candidates[i];
    appendDealEvent(id,'audit_sampled',{ admin_id,classifier_version },scope.userId,now);
  }
  return { sampled: count };
});

export const completeDealAudit = db.transaction((scope,id,body,now = Date.now()) => {
  requireReviewer(scope,true);
  const row = getDeal(scope,id);
  const sample = eventGet.get(scope.tenantId,row.id,'audit_sampled');
  if (!sample || eventGet.get(scope.tenantId,row.id,'audit_completed')) throw failure(409,'Sampel audit tidak aktif.');
  const note = typeof body?.note === 'string' ? body.note.trim() : '';
  if (typeof body?.false_positive !== 'boolean' || note.length > 1500 || (body.false_positive && note.length < 10)) {
    fail('Pilih hasil audit. False positive membutuhkan catatan minimal 10 karakter.');
  }
  appendDealEvent(row.id,'audit_completed',{ ...JSON.parse(sample.payload_json), false_positive: body.false_positive, note },scope.userId,now);
  return { audited: true };
});
