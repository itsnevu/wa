import { q, DEFAULT_STOP_REPLY } from '../db.js';
import * as limits from '../limits.js';

export function check({ numberId, chat, jid, body, fromMe, waId }) {
  if (fromMe) return { action: 'skip', reason: 'self' };
  if (String(jid).endsWith('@g.us')) return { action: 'skip', reason: 'group' };
  const raw = q.aiSettings.get(numberId);
  if (!raw?.enabled) return { action: 'skip', reason: 'off' };
  const s = { ...raw, stop_reply: raw.stop_reply || DEFAULT_STOP_REPLY };
  // 'pending' = sudah dieskalasi ke agen. Nilai normal di DB adalah 'active' (db.js), 'open' diterima sebagai sinonim.
  if (chat.state && !['active', 'open'].includes(chat.state)) return { action: 'skip', reason: 'state' };
  if (chat.ai_paused_until > Date.now()) return { action: 'skip', reason: 'paused' };
  if (waId && q.aiSeen.get(waId)) return { action: 'skip', reason: 'dup' };
  if (!limits.withinHours()) return { action: 'skip', reason: 'hours' };
  const keywords = String(s.escalate_keywords || '').split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
  if (keywords.some(k => String(body || '').toLowerCase().includes(k))) return { action: 'stop', reason: 'keyword', s };
  const pct = limits.aiPercent(numberId, s.daily_tokens);
  if (pct >= 100) return { action: 'stop', reason: 'budget', s, pct };
  const lastHour = q.countAiLogsLastHour.get(chat.id, Date.now() - 3600000)?.n || 0;
  if (lastHour >= s.max_per_hour) return { action: 'skip', reason: 'rate' };
  const lastAt = q.lastAiReply.get(chat.id)?.at || 0;
  if (Date.now() - lastAt < s.min_gap_sec * 1000) return { action: 'skip', reason: 'gap' };
  return { action: 'reply', reason: 'ok', s, pct };
}
