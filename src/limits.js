import { db, q } from './db.js';
import { config } from './config.js';

const buckets = new Map();
const cooldown = new Map();
const seenIds = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function bucket(numberId) {
  if (!Number.isFinite(config.ratePerMinute) || config.ratePerMinute < 1) {
    throw new Error('RATE_PER_MINUTE harus minimal 1');
  }
  let b = buckets.get(numberId);
  if (!b) {
    b = { tokens: config.ratePerMinute, last: Date.now() };
    buckets.set(numberId, b);
  }
  const elapsed = (Date.now() - b.last) / 60000;
  b.tokens = Math.min(config.ratePerMinute, b.tokens + elapsed * config.ratePerMinute);
  b.last = Date.now();
  return b;
}

export function remaining(numberId) {
  return Math.max(0, Math.floor(bucket(numberId).tokens));
}

export async function acquire(numberId) {
  for (;;) {
    const b = bucket(numberId);
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return;
    }
    await sleep(400 + Math.random() * 800);
  }
}

export function chatAllowed(numberId, jid) {
  const last = cooldown.get(numberId + ':' + jid);
  return last === undefined || Date.now() - last >= config.chatCooldownMin * 60000;
}

export function markChat(numberId, jid) {
  cooldown.set(numberId + ':' + jid, Date.now());
}

export function seen(waId) {
  if (!waId) return false;
  const now = Date.now();
  const last = seenIds.get(waId);
  if (last !== undefined && now - last < 3600000) return true;
  seenIds.delete(waId);
  seenIds.set(waId, now);
  if (seenIds.size > 4000) {
    const cut = now - 3600000;
    for (const [k, v] of seenIds) if (v < cut) seenIds.delete(k);
    while (seenIds.size > 4000) seenIds.delete(seenIds.keys().next().value);
  }
  return false;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function dailyUsed(numberId) {
  const row = db.prepare('SELECT count FROM send_count WHERE number_id = ? AND day = ?').get(numberId, today());
  return row ? row.count : 0;
}

export function dailyCap(number) {
  if (!config.warmupEnabled) return config.dailyCap;
  const days = Math.max(1, Math.floor((Date.now() - number.created_at) / 86400000) + 1);
  return Math.min(config.warmupStart + (days - 1) * config.warmupStep, config.dailyCap);
}

export function assertQuota(number) {
  const cap = dailyCap(number);
  const used = dailyUsed(number.id);
  if (used >= cap) {
    throw new Error(`kuota harian habis (${used}/${cap}), lanjut besok`);
  }
}

export function bumpDaily(numberId) {
  db.prepare(`INSERT INTO send_count (number_id, day, count) VALUES (?, ?, 1)
    ON CONFLICT(number_id, day) DO UPDATE SET count = count + 1`).run(numberId, today());
}

export function withinHours() {
  if (config.businessStart === config.businessEnd) return true;
  const h = new Date().getHours();
  return config.businessStart <= config.businessEnd
    ? h >= config.businessStart && h < config.businessEnd
    : h >= config.businessStart || h < config.businessEnd;
}

export function aiDay() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}

export function aiUsage(numberId) {
  return q.aiUsageGet.get(numberId, aiDay()) || { number_id: numberId, day: aiDay(), tokens: 0, replies: 0 };
}

export function bumpAi(numberId, tokens) {
  q.aiUsageBump.run(numberId, aiDay(), Math.max(0, Math.trunc(Number(tokens) || 0)), 1);
}

export function aiPercent(numberId, budget) {
  return budget > 0 ? aiUsage(numberId).tokens / budget * 100 : 0;
}
