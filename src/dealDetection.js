import { db } from './db.js';
import { resolveInboundChatScope } from './tenantScope.js';
import { runDealClassifier } from './regexRunner.js';
import { CLASSIFIER_VERSION } from './dealClassifier.js';

const BATCH = 100;
const SIX_HOURS = 6 * 3600000;
const stages = new Set(['no_signal','candidate','awaiting_proof','proof_submitted','verified_lunas','dp_aktif']);
const queue = new Map();
let scheduled = false;
let sweepRunning = false;

const latest = db.prepare(`SELECT message_range,output_json FROM classifier_runs
  WHERE tenant_id=? AND chat_id=? AND version=? ORDER BY id DESC LIMIT 1`);
const newMessages = db.prepare(`SELECT id,substr(body,1,2000) AS body,kind,from_me FROM messages
  WHERE tenant_id=? AND chat_id=? AND number_id=? AND id>? ORDER BY id LIMIT ?`);
const insertRun = db.prepare(`INSERT INTO classifier_runs(tenant_id,chat_id,version,message_range,output_json,tokens,status,at)
  VALUES(?,?,?,?,?,0,?,?) ON CONFLICT(chat_id,message_range,version) DO NOTHING`);
const findDeal = db.prepare('SELECT 1 FROM deals WHERE tenant_id=? AND session_id=? AND chat_id=? LIMIT 1');
const findCandidate = db.prepare(`SELECT id FROM deals WHERE tenant_id=? AND session_id=? AND chat_id=?
  AND order_id IS NULL AND classifier_version IS NOT NULL AND state IN ('candidate','awaiting_proof','proof_submitted')
  ORDER BY id DESC LIMIT 1`);
const refreshSuggestion = db.prepare(`UPDATE deals SET suggested_status=?,confidence=?,classifier_version=?
  WHERE tenant_id=? AND session_id=? AND chat_id=? AND id=?`);
const newDeal = db.prepare(`INSERT INTO deals(tenant_id,session_id,chat_id,state,amount,method,qty,confidence,
  suggested_status,classifier_version,due_sla_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
const insertEvidence = db.prepare(`INSERT INTO deal_evidence(deal_id,message_id,kind)
  SELECT d.id,m.id,'payment_attachment' FROM deals d JOIN messages m ON m.tenant_id=d.tenant_id
  AND m.chat_id=d.chat_id AND m.number_id=d.session_id
  WHERE d.tenant_id=? AND d.id=? AND m.id=? AND m.from_me=0 AND m.kind IN ('image','doc')
  ON CONFLICT(deal_id,message_id) DO NOTHING`);

function validate(raw, messages) {
  const text = value => value === null || typeof value === 'string' && value.length <= 100;
  const number = value => value === null || Number.isSafeInteger(value) && value > 0;
  if (!raw || !stages.has(raw.stage) || !Array.isArray(raw.signals) || raw.signals.length > 20 ||
    raw.signals.some(signal => typeof signal !== 'string' || signal.length > 80) ||
    !number(raw.nominal) || !text(raw.method) || !text(raw.product) || !number(raw.qty) ||
    !Array.isArray(raw.evidence_ids) || raw.evidence_ids.length > messages.length ||
    raw.evidence_ids.some(id => !Number.isSafeInteger(id)) ||
    !Number.isFinite(raw.confidence) || raw.confidence < 0 || raw.confidence > 1 ||
    typeof raw.reason !== 'string' || raw.reason.length > 300) throw Error('invalid_classifier_output');
  const eligible = new Set(messages.filter(m => !m.from_me && ['image','doc'].includes(m.kind)).map(m => m.id));
  const evidence = [...new Set(raw.evidence_ids)].filter(id => eligible.has(id));
  return {
    stage: raw.stage === 'no_signal' ? 'no_signal' : evidence.length ? 'candidate' : 'awaiting_proof',
    suggested_status: raw.stage, signals: raw.signals, nominal: raw.nominal, method: raw.method,
    product: raw.product, qty: raw.qty, evidence_ids: evidence, confidence: raw.confidence, reason: raw.reason,
  };
}

const zoneOf = confidence => confidence >= 0.85 ? 'priority' : confidence >= 0.6 ? 'normal' : 'parked';

function createCandidate(scope, output, now, state, version = CLASSIFIER_VERSION) {
  const { tenantId, sessionId, chatId } = scope;
  if (findDeal.get(tenantId, sessionId, chatId)) return false;
  const saved = newDeal.run(tenantId, sessionId, chatId, state, output.nominal, output.method, output.qty,
    output.confidence, output.suggested_status, version, now + 24 * 3600000, now);
  for (const id of output.evidence_ids) insertEvidence.run(tenantId, saved.lastInsertRowid, id);
  return true;
}

export async function classifyChat(chatId, tenantId, classify = runDealClassifier) {
  const scope = resolveInboundChatScope(db, chatId, tenantId);
  if (!scope) return false;
  const prior = latest.get(tenantId, chatId, CLASSIFIER_VERSION);
  const cursor = Number(prior?.message_range.split(':')[1] ?? 0);
  const messages = newMessages.all(tenantId, chatId, scope.sessionId, cursor, BATCH);
  if (!messages.length) return false;
  const range = `${messages[0].id}:${messages.at(-1).id}`;
  const output = validate(await classify(messages), messages);
  const context = prior && JSON.parse(prior.output_json);
  output.nominal ??= context?.nominal ?? null;
  output.method ??= context?.method ?? null;
  output.product ??= context?.product ?? null;
  output.qty ??= context?.qty ?? null;
  const hasPaymentSignal = output.signals.includes('payment_claim') || output.suggested_status === 'verified_lunas';
  const hasEvidence = output.evidence_ids.length > 0;
  const hasSignal = hasEvidence || hasPaymentSignal || Boolean(output.nominal && output.method);
  const now = Date.now();
  const retry = db.transaction(() => {
    if (!resolveInboundChatScope(db, chatId, tenantId)) return false;
    if (latest.get(tenantId, chatId, CLASSIFIER_VERSION)?.message_range !== prior?.message_range) return true;
    const saved = insertRun.run(tenantId, chatId, CLASSIFIER_VERSION, range, JSON.stringify(output), zoneOf(output.confidence), now);
    if (!saved.changes || !hasSignal || output.stage === 'no_signal') return;
    const candidate = findCandidate.get(tenantId, scope.sessionId, chatId);
    if (!candidate) {
      createCandidate(scope, output, now, output.stage);
      return;
    }
    refreshSuggestion.run(output.suggested_status, output.confidence, CLASSIFIER_VERSION,
      tenantId, scope.sessionId, chatId, candidate.id);
    for (const id of output.evidence_ids) insertEvidence.run(tenantId, candidate.id, id);
  }).immediate();
  return Boolean(retry) || messages.length === BATCH;
}

export function queueDealDetection(chatId, tenantId) {
  const key = `${tenantId}:${chatId}`;
  if (queue.has(key)) return;
  if (queue.size >= 256) {
    console.warn(JSON.stringify({ event: 'deal_detection_drop', reason: 'schedule_full' }));
    return;
  }
  queue.set(key, [chatId, tenantId]);
  if (!scheduled) {
    scheduled = true;
    setImmediate(processQueue);
  }
}

async function processQueue() {
  const [key, args] = queue.entries().next().value ?? [];
  if (!args) { scheduled = false; return; }
  queue.delete(key);
  try {
    if (await classifyChat(...args)) queueDealDetection(...args);
  } catch (err) {
    console.warn(JSON.stringify({ event: 'deal_detection_drop', reason: err.code || 'processing_error' }));
  } finally {
    setImmediate(processQueue);
  }
}

const activeTenants = db.prepare("SELECT id FROM tenants WHERE status='active' AND deleted_at IS NULL ORDER BY id");
const chatsWithoutDeal = db.prepare(`SELECT c.id FROM chats c WHERE c.tenant_id=? AND c.id>?
  AND NOT EXISTS(SELECT 1 FROM deals d WHERE d.tenant_id=c.tenant_id AND d.chat_id=c.id)
  ORDER BY c.id LIMIT 100`);
const yieldToServer = () => new Promise(resolve => setImmediate(resolve));

export async function sweepSilentClosings(classify = runDealClassifier) {
  if (sweepRunning) return 0;
  sweepRunning = true;
  let created = 0;
  try {
    for (const { id: tenantId } of activeTenants.all()) {
      let cursor = 0;
      for (let page; (page = chatsWithoutDeal.all(tenantId, cursor)).length;) {
        for (const { id: chatId } of page) {
          cursor = chatId;
          const scope = resolveInboundChatScope(db, chatId, tenantId);
          if (!scope) continue;
          try {
            let messageCursor = 0;
            let output;
            for (let messages; (messages = newMessages.all(tenantId, chatId, scope.sessionId, messageCursor, BATCH)).length;) {
              messageCursor = messages.at(-1).id;
              const next = validate(await classify(messages), messages);
              if (next.evidence_ids.length) { output = undefined; break; }
              output = {
                ...next,
                nominal: next.nominal ?? output?.nominal,
                method: next.method ?? output?.method,
                qty: next.qty ?? output?.qty ?? null,
                suggested_status: next.suggested_status === 'no_signal' ? output?.suggested_status : next.suggested_status,
                confidence: Math.max(next.confidence, output?.confidence ?? 0),
              };
            }
            if (output?.nominal && output.method) {
              output.confidence = Math.max(0.6, Math.min(0.84, output.confidence));
              created += Number(db.transaction(() => Boolean(resolveInboundChatScope(db, chatId, tenantId))
                && createCandidate(scope, output, Date.now(), 'awaiting_proof')).immediate());
            }
          } catch (err) {
            console.warn(JSON.stringify({ event: 'deal_sweep_drop', reason: err.code || 'processing_error' }));
          }
        }
        await yieldToServer();
      }
    }
    return created;
  } finally {
    sweepRunning = false;
  }
}

export function startDealSweep() {
  const run = () => void sweepSilentClosings().catch(err => console.error('[deal.sweep]', err.message));
  setImmediate(run);
  return setInterval(run, SIX_HOURS);
}
