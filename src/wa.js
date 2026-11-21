import path from 'node:path';
import fs from 'node:fs';
import P from 'pino';
import QRCode from 'qrcode';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import makeWASocket, {
  useMultiFileAuthState,
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import { config } from './config.js';
import { q } from './db.js';
import { recordHealth } from './sessionHealth.js';
import { queueDealDetection } from './dealDetection.js';
import * as limits from './limits.js';
import { testPatterns } from './regexRunner.js';
import * as aiGuard from './ai/guard.js';
import * as notice from './ai/notice.js';
import { runTurn } from './ai/agent.js';

const logger = P({ level: 'silent' });
const live = new Map();
const reconnects = new Map();
const connecting = new Set();
const resyncQueues = new Map();
const appendObservers = new Map();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

export function emit(event) {
  if (typeof globalThis.__broadcast === 'function') globalThis.__broadcast(event);
}

function textOf(m) {
  return m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption
    || m.videoMessage?.caption || m.documentMessage?.fileName || '';
}

function unwrap(m) {
  let x = m || {};
  for (let i = 0; i < 3; i += 1) {
    const inner = x.viewOnceMessage?.message
      || x.viewOnceMessageV2?.message
      || x.viewOnceMessageV2Extension?.message
      || x.ephemeralMessage?.message
      || x.documentWithCaptionMessage?.message;
    if (!inner) break;
    x = inner;
  }
  return x;
}

function kindOf(msg) {
  const m = msg.message || {};
  if (m.imageMessage) return { kind: 'image', mime: m.imageMessage.mimetype };
  if (m.videoMessage) return { kind: 'video', mime: m.videoMessage.mimetype };
  if (m.audioMessage) return { kind: 'audio', mime: m.audioMessage.mimetype };
  if (m.stickerMessage) return { kind: 'sticker', mime: 'image/webp' };
  if (m.ptvMessage) return { kind: 'video', mime: m.ptvMessage.mimetype };
  if (m.documentMessage) return { kind: 'doc', mime: m.documentMessage.mimetype };
  return { kind: 'text', mime: null };
}

function normalizePhone(raw) {
  const digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('0')) return '62' + digits.slice(1);
  return digits;
}

function getChat(numberId, jid, name) {
  let chat = q.chatByJid.get(numberId, jid);
  if (!chat) {
    const local = q.contactByJid.get(numberId, jid);
    const tenantId = q.numberById.get(numberId).tenant_id;
    const info = q.insertChatForTenant.run(numberId, jid, local?.name || name || null, Date.now(), tenantId);
    chat = q.chatById.get(info.lastInsertRowid);
  }
  return chat;
}

async function matchRule(rules, text) {
  const body = text.toLowerCase();
  const sample = text.slice(0, 2000);
  let best = null;
  const regexRules = [];

  for (const r of rules) {
    if (r.match_type === 'exact' && body.trim() === r.pattern.toLowerCase()) {
      if (!best || r.priority < best.priority) best = r;
    } else if (r.match_type === 'contains' && body.includes(r.pattern.toLowerCase())) {
      if (!best || r.priority < best.priority) best = r;
    } else if (r.match_type === 'regex' && r.pattern.length <= 200) {
      regexRules.push(r);
    }
  }

  if (!regexRules.length) return best;

  const slow = regexRules.filter((r) => r.slow);
  const fast = regexRules.filter((r) => !r.slow);
  let hits = [];

  if (fast.length) {
    const items = fast.map((r) => ({ id: r.id, pattern: r.pattern }));
    try {
      hits = await testPatterns(items, sample);
    } catch (err) {
      if (err.message === 'timeout') {
        for (const r of fast) q.markRuleSlow.run(r.id);
        try { hits = await testPatterns(items, sample, 400); }
        catch { console.error('[regex] tetap timeout'); }
      } else {
        console.error('[regex]', err.message);
      }
    }
  }

  if (slow.length) {
    const items = slow.map((r) => ({ id: r.id, pattern: r.pattern }));
    try {
      hits = hits.concat(await testPatterns(items, sample, 400));
    } catch (err) {
      console.error('[regex] slow', err.message);
    }
  }

  for (const r of regexRules) {
    if (hits.includes(r.id) && (!best || r.priority < best.priority)) best = r;
  }
  return best;
}

function enqueue(numberId, task, reject) {
  const s = live.get(numberId);
  if (!s) throw new Error('nomor tidak aktif');
  s.queue.push({ task, reject });
  recordHealth(numberId, 'queue', s.queue.length);
  if (!resyncQueues.has(numberId) || s.open) drain(numberId);
}

export function drain(numberId) {
  const s = live.get(numberId);
  if (!s) return Promise.resolve(null);
  if (s.draining) return s.draining;
  if (!s.queue.length) return Promise.resolve({ attempted: 0, failed: 0 });
  s.draining = (async () => {
    const result = { attempted: 0, failed: 0 };
    while (live.get(numberId) === s && s.queue.length) {
      const { task } = s.queue.shift();
      recordHealth(numberId, 'queue', s.queue.length);
      try {
        if (await task(s) === false) result.failed++;
      } catch (err) {
        result.failed++;
        console.error('[queue]', numberId, err.message);
      }
      result.attempted++;
      await sleep(config.delayMin + Math.random() * (config.delayMax - config.delayMin));
    }
    return result;
  })().finally(() => {
    s.draining = null;
  });
  return s.draining;
}

const EXT = {
  'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/webm': 'webm',
  'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/amr': 'amr',
  'application/pdf': 'pdf',
};

function extFor(mime, kind) {
  if (kind === 'sticker') return 'webp';
  const base = String(mime || '').split(';')[0].trim().toLowerCase();
  const known = EXT[base];
  if (known) return known;
  const guess = base.split('/')[1] || '';
  return /^[a-z0-9]{1,8}$/.test(guess) ? guess : 'bin';
}

export async function connect(numberId, { timeoutMs } = {}) {
  const number = q.numberById.get(numberId);
  if (!number) throw new Error('nomor tidak ada');
  if (live.has(numberId) || connecting.has(numberId)) return { status: 'sedang-menyambung' };
  connecting.add(numberId);
  const retry = reconnects.get(numberId) || { attempt: 0, timer: null };
  clearTimeout(retry.timer);
  retry.timer = null;
  if (retry.attempt > 6) retry.attempt = 0;
  reconnects.set(numberId, retry);

  let sock;
  let saveCreds;
  let entry;
  try {
    const dir = path.join(config.dataDir, 'sessions', String(numberId));
    fs.mkdirSync(dir, { recursive: true });
    const load = async () => {
      const auth = await useMultiFileAuthState(dir);
      const { version } = await fetchLatestBaileysVersion();
      return { auth, version };
    };
    const { auth, version } = timeoutMs
      ? await withTimeout(load(), timeoutMs, 'Persiapan socket melebihi batas waktu.')
      : await load();
    saveCreds = auth.saveCreds;

    sock = makeWASocket({
      version,
      auth: auth.state,
      logger,
      browser: Browsers.ubuntu('Chrome'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
    });

    let resolveReady;
    let rejectReady;
    const ready = new Promise((res, rej) => { resolveReady = res; rejectReady = rej; });
    ready.catch(() => {});

    entry = { sock, queue: resyncQueues.get(numberId) || [], pairingCode: null, qr: null, ready, isReady: false, resolveReady, rejectReady };
    live.set(numberId, entry);
    recordHealth(numberId, 'queue', entry.queue.length);
  } finally {
    connecting.delete(numberId);
  }

  const markReady = () => {
    if (entry.isReady) return;
    entry.isReady = true;
    entry.resolveReady();
  };

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (live.get(numberId) !== entry) return;
    recordHealth(numberId, 'event');
    if (qr) {
      entry.qr = qr;
      markReady();
      emit({ type: 'number.qr', numberId, qr: await QRCode.toDataURL(qr, { margin: 1, width: 320 }) });
    }

    if (connection === 'open') {
      entry.open = true;
      recordHealth(numberId, 'connect');
      entry.attempt = 0;
      retry.attempt = 0;
      entry.qr = null;
      markReady();
      q.updateNumberStatus.run('online', numberId);
      q.touchNumber.run(Date.now(), numberId);
      emit({ type: 'number.status', numberId, status: 'online' });
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      live.delete(numberId);
      recordHealth(numberId, 'disconnect');
      if (!resyncQueues.has(numberId)) recordHealth(numberId, 'queue', 0);
      entry.rejectReady(new Error('koneksi tertutup sebelum siap'));

      if (code === DisconnectReason.loggedOut) {
        reconnects.delete(numberId);
        q.updateNumberStatus.run('loggedout', numberId);
        emit({ type: 'number.status', numberId, status: 'loggedout' });
        return;
      }

      q.updateNumberStatus.run('reconnecting', numberId);
      emit({ type: 'number.status', numberId, status: 'reconnecting' });
      entry.attempt = ++retry.attempt;
      const delay = Math.min(30000, 3000 * 2 ** entry.attempt) + Math.random() * 2000;
      if (entry.attempt > 6) {
        q.updateNumberStatus.run('error', numberId);
        emit({ type: 'number.status', numberId, status: 'error' });
        return;
      }
      retry.timer = setTimeout(() => connect(numberId).catch(() => {}), delay);
    }
  });

  async function upsert({ messages, type }) {
    if (live.get(numberId) !== entry) return;
    recordHealth(numberId, 'event');
    if (type !== 'notify' && type !== 'append') { recordHealth(numberId, 'drop', 'unsupported_upsert'); return; }
    for (const msg of messages) {
      const rawKeys = Object.keys(unwrap(msg.message) || {}).join(',');
      console.error('[in]', msg.key?.remoteJid, '| fromMe=', msg.key?.fromMe, '|', rawKeys);
      if (msg.key?.remoteJid === 'status@broadcast') continue;
      if (!msg.message || !msg.key?.remoteJid) { recordHealth(numberId, 'drop', 'missing_message'); continue; }
      const timestamp = Number(msg.messageTimestamp);
      if (msg.key.id && /@(?:s\.whatsapp\.net|lid)$/.test(msg.key.remoteJid) &&
        Number.isSafeInteger(timestamp) && timestamp > 0) {
        entry.historyAnchor = { key: msg.key, timestamp };
      }
      if (msg.key.id && (q.messageByWaId.get(numberId, msg.key.id) || limits.seen(numberId + ':' + msg.key.id))) continue;
      const jid = msg.key.remoteJid;
      const pn = msg.key.remoteJidAlt || null;
      const fromMe = Boolean(msg.key.fromMe);
      const body = textOf(unwrap(msg.message));
      const { kind, mime } = kindOf({ message: unwrap(msg.message) });
      if (kind === 'text' && !body && !fromMe) {
        recordHealth(numberId, 'drop', 'unsupported_message');
        continue;
      }

      const chat = getChat(numberId, jid, msg.pushName || null);
      if (msg.pushName) {
        q.setChatPushName.run(msg.pushName, chat.id);
        const local = q.contactByJid.get(numberId, jid);
        if (!local) q.setChatName.run(msg.pushName, chat.id);
      }
      if (pn) q.setChatPn.run(pn, chat.id);
      const saved = q.insertMessageForTenant.run(numberId, chat.id, fromMe ? 1 : 0, body, Date.now(), null, kind, null, mime, msg.key.id || null, chat.tenant_id);
      if (!saved.changes) continue;
      if (!fromMe) {
        recordHealth(numberId, 'inbound');
        if (type === 'append') appendObservers.get(numberId)?.();
      } else recordHealth(numberId, 'outbound');
      try { queueDealDetection(chat.id, chat.tenant_id); }
      catch (err) { console.error('[deal.schedule]', err.message); }
      const msgId = saved.lastInsertRowid;
      q.touchChat.run(Date.now(), null, chat.id);
        if (!fromMe) {
          q.bumpUnread.run(chat.id);
          q.reopenChat.run(chat.id);
        }
      if (!fromMe && chat.assignee_id) {
        q.insertNotificationForTenant.run(chat.assignee_id, numberId, chat.id, Date.now(), chat.tenant_id);
        emit({ type: 'notification', userId: chat.assignee_id, numberId, chatId: chat.id, body });
      }
      let mediaPath = null;
      if (kind !== 'text') {
        let mediaTimer;
        try {
          const content = unwrap(msg.message);
          const mediaMessage = { ...msg, message: content.ptvMessage ? { videoMessage: content.ptvMessage } : content };
          const buf = await Promise.race([
            downloadMediaMessage(mediaMessage, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage }),
            new Promise((_, reject) => { mediaTimer = setTimeout(() => reject(new Error('timeout 15s')), 15000); }),
          ]);
          const ext = extFor(mime, kind);
          const file = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
          fs.writeFileSync(path.join(config.dataDir, 'media', file), buf);
          mediaPath = file;
          q.setMessageMedia.run(file, msgId);
        } catch (err) {
          recordHealth(numberId, 'drop', 'media_download_failed');
          console.error('[media]', numberId, kind, err.message);
        } finally {
          clearTimeout(mediaTimer);
        }
      }

      emit({ type: 'message', numberId, chatId: chat.id, jid, body, fromMe, kind, mediaPath, waId: msg.key.id || null, ts: Date.now() });

      // append bisa berisi pesan lama (catch-up); jangan balas otomatis agar tidak membalas riwayat.
      // Rule dan AI saling eksklusif: rule yang cocok memiliki pesan ini, juga saat cooldown menahan balasannya.
      let ruleHandled = false;
      if (type === 'notify' && !fromMe && body && !jid.endsWith('@g.us') && limits.withinHours()) {
        const rules = q.rulesByNumber.all(numberId);
        const hit = await matchRule(rules, body);
        if (hit) ruleHandled = true;
        if (hit && limits.chatAllowed(numberId, jid)) {
          limits.markChat(numberId, jid);
          const jitter = 1500 + Math.random() * 2500;
          setTimeout(() => {
            sendText(numberId, jid, hit.reply, null, true).catch((e) => console.error('[autoreply]', e.message));
          }, jitter);
        }
      }
      if (!ruleHandled && type === 'notify' && typeof aiGuard !== 'undefined') {
        try { await handleAiMessage({ numberId, chat: q.chatById.get(chat.id), jid, body, fromMe, waId: msg.key.id }); }
        catch (err) { console.error('[ai]', numberId, err.message); }
      }
    }
  }
  sock.ev.on('messages.upsert', async update => {
    try { await upsert(update); }
    catch (err) {
      recordHealth(numberId, 'drop', 'message_processing_failed');
      console.error('[upsert]', numberId, err.message);
    }
  });
  sock.ev.on('messaging-history.set', ({ peerDataRequestSessionId, messages }) => {
    const requests = entry.historyResponses;
    if (!requests || !peerDataRequestSessionId || !Array.isArray(messages)) return;
    if (requests.size < 8) {
      const batch = requests.get(peerDataRequestSessionId) || [];
      requests.set(peerDataRequestSessionId, batch.concat(messages));
    }
  });
  entry.ingestHistory = messages => upsert({ messages, type: 'append' });

  sock.ev.on('call', async (calls) => {
    for (const call of calls) {
      if (call.status !== 'offer') continue;
      const jid = call.from;
      const chat = getChat(numberId, jid, null);
      const label = call.isVideo ? 'Panggilan video masuk' : 'Panggilan suara masuk';
      const body = config.callAutoReject ? `${label} - ditolak otomatis` : `${label} - tidak terjawab`;

      q.insertMessageForTenant.run(numberId, chat.id, 0, body, Date.now(), null, 'call', null, null, null, chat.tenant_id);
      q.touchChat.run(Date.now(), null, chat.id);
      q.bumpUnread.run(chat.id);
      emit({ type: 'message', numberId, chatId: chat.id, jid, body, fromMe: false, kind: 'call', mediaPath: null, ts: Date.now() });

      if (chat.assignee_id) {
        q.insertNotificationForTenant.run(chat.assignee_id, numberId, chat.id, Date.now(), chat.tenant_id);
        emit({ type: 'notification', userId: chat.assignee_id, numberId, chatId: chat.id, body });
      }

      if (config.callAutoReject) {
        try {
          await sock.rejectCall(call.id, jid);
          if (config.callReply) {
            setTimeout(() => {
              sendText(numberId, jid, config.callReply, null, true).catch((e) => console.error('[call]', e.message));
            }, 1500);
          }
        } catch (err) {
          console.error('[call]', numberId, err.message);
        }
      }
    }
  });

  return { status: 'pairing' };
}

export async function requestPairing(numberId, attempt = 1) {
  const number = q.numberById.get(numberId);
  if (!number) throw new Error('nomor tidak ada');

  if (!live.has(numberId)) await connect(numberId);
  const s = live.get(numberId);
  if (!s) throw new Error('sesi gagal dibuat');

  await withTimeout(s.ready, 25000, 'server WhatsApp tidak merespons, coba lagi');

  try {
    const code = await s.sock.requestPairingCode(normalizePhone(number.phone));
    s.pairingCode = code;
    return code;
  } catch (err) {
    if (attempt < 4) {
      await sleep(2500);
      if (!live.has(numberId)) await connect(numberId);
      return requestPairing(numberId, attempt + 1);
    }
    throw new Error(
      `${err.message} | gagal setelah ${attempt} percobaan. Cek: nomor sudah terdaftar di WhatsApp? slot perangkat tertaut belum penuh (maks 4)? Node versi 20+?`
    );
  }
}

export async function qrDataUrl(numberId) {
  const s = live.get(numberId);
  if (!s?.qr) return null;
  return QRCode.toDataURL(s.qr, { margin: 1, width: 320 });
}

export function hasQr(numberId) {
  return Boolean(live.get(numberId)?.qr);
}

export async function sendText(numberId, jid, text, agentId = null, isAuto = false, source = 'agent') {
  const s = live.get(numberId);
  if (!s) throw new Error('nomor tidak aktif');
  const number = q.numberById.get(numberId);
  if (number) limits.assertQuota(number);

  const chat = getChat(numberId, jid, null);
  if (source !== 'ai' && agentId) pauseAiForAgent(numberId, chat.id);
  return new Promise((resolve, reject) => {
    enqueue(numberId, async (s) => {
      try {
        await limits.acquire(numberId);
        if (live.get(numberId) !== s) throw new Error('nomor tidak aktif');
        if (number) limits.assertQuota(number);
        if (isAuto && !limits.withinHours()) throw new Error('di luar jam operasional');
        limits.bumpDaily(numberId);
        await s.sock.sendPresenceUpdate('composing', jid);
        await sleep(Math.min(4000, 600 + text.length * 30));
        const sent = await s.sock.sendMessage(jid, { text });
        recordHealth(numberId, 'outbound');
        q.insertActivityForTenant.run(agentId, numberId, 'send', text.slice(0, 80), Date.now(), chat.tenant_id);
        await s.sock.sendPresenceUpdate('paused', jid);
        q.insertMessageWithSource.run(numberId, chat.id, 1, text, Date.now(), agentId, 'text', null, null, sent?.key?.id || null, chat.tenant_id, source === 'ai' ? 'ai' : agentId ? 'human' : null);
        q.touchChat.run(Date.now(), null, chat.id);
        emit({ type: 'message', numberId, chatId: chat.id, jid, body: text, fromMe: true, kind: 'text', mediaPath: null, waId: sent?.key?.id || null, ts: Date.now() });
        resolve(true);
      } catch (err) {
        reject(err);
        return false;
      }
    }, reject);
  });
}

function pauseAiForAgent(numberId, chatId) {
  const minutes = q.aiSettings?.get(numberId)?.ai_paused_minutes || 30;
  // Use existing query interface so all sends persist the same pause state.
  q.pauseAiChat.run(Date.now() + minutes * 60000, chatId);
}

const aiTurns = new Map();
export async function handleAiMessage(input) {
  const previous = aiTurns.get(input.numberId) || Promise.resolve();
  const task = previous.catch(() => {}).then(() => processAiMessage(input));
  aiTurns.set(input.numberId, task);
  try { await task; }
  finally { if (aiTurns.get(input.numberId) === task) aiTurns.delete(input.numberId); }
}

async function processAiMessage({numberId, chat, jid, body, fromMe, waId}) {
  chat = q.chatById.get(chat.id) || chat;
  const g = aiGuard.check({ numberId, chat, jid, body, fromMe, waId });
  if (g.action === 'stop') {
    const text = notice.stopNotice(numberId, chat, g.s);
    if (text) await sendText(numberId, jid, text, null, true, 'ai');
    if (g.reason === 'budget') notice.warnOnce(numberId, 'stop');
    return;
  }
  if (g.action === 'reply') {
    if (g.pct >= g.s.warn_percent) notice.warnOnce(numberId, 'warn');
    try {
      const out = await runTurn({ numberId, chat, jid, text: body });
      limits.bumpAi(numberId, out.tokens);
      if (waId) q.aiSeenPut.run(waId, Date.now());
      // An agent may take over while the model request is in flight.
      const fresh = q.chatById.get(chat.id);
      const settings = q.aiSettings.get(numberId);
      if (!fresh || fresh.ai_paused_until > Date.now() || !settings?.enabled) return;
      if (out.reply) await sendText(numberId, jid, out.reply, null, true, 'ai');
      q.insertAiLog.run(numberId, chat.id, body, out.reply || null, out.tokens, config.aiModel, null, Date.now());
      if (out.escalated) {
        const t = notice.stopNotice(numberId, chat, g.s);
        if (t && !out.reply) await sendText(numberId, jid, t, null, true, 'ai');
      }
      const pct = limits.aiPercent(numberId, g.s.daily_tokens);
      if (pct >= 100) notice.warnOnce(numberId, 'stop');
      else if (pct >= g.s.warn_percent) notice.warnOnce(numberId, 'warn');
    } catch (err) {
      q.insertAiLog.run(numberId, chat.id, body, null, 0, config.aiModel, err.message, Date.now());
      const text = notice.stopNotice(numberId, chat, g.s);
      if (text) await sendText(numberId, jid, text, null, true, 'ai');
    }
  }
}

export async function sendQuote(numberId, jid, text, waId, agentId = null) {
  const s = live.get(numberId);
  if (!s) throw new Error('nomor tidak aktif');
  const number = q.numberById.get(numberId);
  if (number) limits.assertQuota(number);
  const chat = getChat(numberId, jid, null);
  if (agentId) pauseAiForAgent(numberId, chat.id);
  const original = q.messageByWaId.get(numberId, waId);
  if (!original || original.chat_id !== chat.id) throw new Error('pesan kutipan tidak ditemukan');
  return new Promise((resolve, reject) => {
    enqueue(numberId, async (s) => {
      try {
        await limits.acquire(numberId);
        if (live.get(numberId) !== s) throw new Error('nomor tidak aktif');
        if (number) limits.assertQuota(number);
        limits.bumpDaily(numberId);
        await s.sock.sendPresenceUpdate('composing', jid);
        const sent = await s.sock.sendMessage(jid, { text }, { quoted: {
          key: { remoteJid: jid, id: waId, fromMe: Boolean(original.from_me) },
          message: { conversation: original.body || '' },
        } });
        recordHealth(numberId, 'outbound');
        q.insertActivityForTenant.run(agentId, numberId, 'send', text.slice(0, 80), Date.now(), chat.tenant_id);
        await s.sock.sendPresenceUpdate('paused', jid);
        q.insertMessageForTenant.run(numberId, chat.id, 1, text, Date.now(), agentId, 'text', null, null, sent?.key?.id || null, chat.tenant_id);
        q.touchChat.run(Date.now(), null, chat.id);
        emit({ type: 'message', numberId, chatId: chat.id, jid, body: text, fromMe: true, kind: 'text', mediaPath: null, waId: sent?.key?.id || null, ts: Date.now() });
        resolve(true);
      } catch (err) { reject(err); return false; }
    }, reject);
  });
}

export async function sendReaction(numberId, jid, waId, emoji) {
  const s = live.get(numberId);
  if (!s) throw new Error('nomor tidak aktif');
  const number = q.numberById.get(numberId);
  if (number) limits.assertQuota(number);
  const original = q.messageByWaId.get(numberId, waId);
  if (!original || q.chatById.get(original.chat_id)?.jid !== jid) throw new Error('pesan tidak ditemukan');
  return new Promise((resolve, reject) => {
    enqueue(numberId, async (s) => {
      try {
        await limits.acquire(numberId);
        if (live.get(numberId) !== s) throw new Error('nomor tidak aktif');
        if (number) limits.assertQuota(number);
        limits.bumpDaily(numberId);
        await s.sock.sendMessage(jid, { react: { text: emoji, key: { remoteJid: jid, id: waId, fromMe: Boolean(original.from_me) } } });
        recordHealth(numberId, 'outbound');
        resolve(true);
      } catch (err) { reject(err); return false; }
    }, reject);
  });
}

export async function sendMedia(numberId, jid, buffer, mime, caption = '', agentId = null) {
  const s = live.get(numberId);
  if (!s) throw new Error('nomor tidak aktif');
  const number = q.numberById.get(numberId);
  if (number) limits.assertQuota(number);
  const chat = getChat(numberId, jid, null);
  if (agentId) pauseAiForAgent(numberId, chat.id);
  const isSticker = String(mime) === 'image/webp';
  const ext = extFor(mime, isSticker ? 'sticker' : null);
  const file = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  fs.writeFileSync(path.join(config.dataDir, 'media', file), buffer);

  return new Promise((resolve, reject) => {
    enqueue(numberId, async (s) => {
      try {
        await limits.acquire(numberId);
        if (live.get(numberId) !== s) throw new Error('nomor tidak aktif');
        if (number) limits.assertQuota(number);
        limits.bumpDaily(numberId);
        await s.sock.sendPresenceUpdate('composing', jid);
        const isImage = String(mime).startsWith('image/');
        const isVideo = String(mime).startsWith('video/');
        const isAudio = String(mime).startsWith('audio/');
        const isVoice = isAudio && String(mime).includes('ogg');
        const payload = isSticker ? { sticker: buffer } : isImage
          ? { image: buffer, caption }
          : isVideo
            ? { video: buffer, caption }
            : isVoice
              ? { audio: buffer, mimetype: 'audio/ogg; codecs=opus', ptt: true }
              : isAudio
                ? { audio: buffer, mimetype: mime }
                : { document: buffer, mimetype: mime, fileName: caption || file };
        const kind = isSticker ? 'sticker' : isImage ? 'image' : isVideo ? 'video' : isAudio ? 'audio' : 'doc';
        const sent = await s.sock.sendMessage(jid, payload);
        recordHealth(numberId, 'outbound');
        q.insertActivityForTenant.run(agentId, numberId, 'send', String(caption).slice(0, 80), Date.now(), chat.tenant_id);
        await s.sock.sendPresenceUpdate('paused', jid);
        q.insertMessageForTenant.run(numberId, chat.id, 1, caption, Date.now(), agentId, kind, file, mime, sent?.key?.id || null, chat.tenant_id);
        q.touchChat.run(Date.now(), null, chat.id);
        emit({ type: 'message', numberId, chatId: chat.id, jid, body: caption, fromMe: true, kind, mediaPath: file, waId: sent?.key?.id || null, ts: Date.now() });
        resolve(true);
      } catch (err) {
        reject(err);
        return false;
      }
    }, reject);
  });
}

export function disconnect(numberId, forget = false) {
  clearTimeout(reconnects.get(numberId)?.timer);
  reconnects.delete(numberId);
  const s = live.get(numberId);
  if (!s) return;
  live.delete(numberId);
  recordHealth(numberId, 'disconnect');
  if (!resyncQueues.has(numberId)) recordHealth(numberId, 'queue', 0);
  s.rejectReady(new Error('koneksi ditutup'));
  try { s.sock.end(undefined); } catch { /* sudah mati */ }
  if (forget) fs.rmSync(path.join(config.dataDir, 'sessions', String(numberId)), { recursive: true, force: true });
}

export function attemptsOf(numberId) {
  return reconnects.get(numberId)?.attempt || 0;
}

export function statusOf(numberId) {
  const s = live.get(numberId);
  if (!s) return null;
  return s.sock.user ? 'online' : 'pairing';
}

export async function restoreAll() {
  for (const n of q.allNumbers.all()) {
    const dir = path.join(config.dataDir, 'sessions', String(n.id));
    if (!fs.existsSync(path.join(dir, 'creds.json'))) continue;
    await connect(n.id).catch((e) => console.error('[restore]', n.id, e.message));
  }
}

export function socketOpen(numberId) {
  const entry = live.get(numberId);
  return Boolean(entry?.open && entry.sock.ws?.isOpen);
}

export async function resync(numberId, step) {
  let newMessages = 0;
  let lastAppendAt = Date.now();
  let entry;
  let previousAnchor;
  appendObservers.set(numberId, () => { newMessages++; lastAppendAt = Date.now(); });
  try {
    const closed = await step('close', () => {
      if (connecting.has(numberId)) throw Error('Sesi sedang membuka socket.');
      const current = live.get(numberId);
      previousAnchor = current?.historyAnchor;
      resyncQueues.set(numberId, current?.queue || []);
      if (current) current.queue = [];
      disconnect(numberId);
      return current ? { status: 'ok' } : { status: 'skipped', detail: 'Socket sudah tertutup.' };
    });
    const startedAt = Date.now();
    const reconnect = await step('reconnect', async () => {
      if (closed.status === 'failed') return { status: 'skipped' };
      const credentials = path.join(config.dataDir, 'sessions', String(numberId), 'creds.json');
      if (!fs.existsSync(credentials)) throw Error('Kredensial tersimpan tidak tersedia.');
      await connect(numberId, { timeoutMs: 30000 });
      entry = live.get(numberId);
      if (!entry) throw Error('Socket baru tidak tersedia.');
      return { status: 'ok' };
    });
    const opened = await step('open', async () => {
      if (reconnect.status !== 'ok') return { status: 'skipped' };
      while (live.get(numberId) === entry && !socketOpen(numberId)) {
        if (Date.now() - startedAt >= 30000) {
          disconnect(numberId);
          throw Error('WhatsApp belum tersambung dalam 30 detik.');
        }
        await sleep(100);
      }
      if (live.get(numberId) !== entry) throw Error('Socket tertutup sebelum tersambung.');
      return { status: 'ok' };
    });
    await step('drain', async () => {
      if (opened.status !== 'ok') return { status: 'skipped' };
      const result = await withTimeout(drain(numberId), 30000, 'Antrean masih berjalan setelah 30 detik.');
      if (!result) throw Error('Socket tidak tersedia untuk mengirim antrean.');
      if (entry.queue.length) throw Error('Koneksi terputus sebelum antrean selesai dikirim.');
      return { ...result, status: result.failed ? 'failed' : 'ok' };
    });
    await step('history', async () => {
      if (opened.status !== 'ok') return { status: 'skipped' };
      const observedAt = Date.now();
      while (live.get(numberId) === entry && socketOpen(numberId) && Date.now() - observedAt < 8000 &&
        Date.now() - Math.max(observedAt, lastAppendAt) < 3000) await sleep(100);
      if (live.get(numberId) !== entry || !socketOpen(numberId)) throw Error('Koneksi terputus saat memeriksa riwayat.');
      const anchor = entry.historyAnchor || previousAnchor;
      if (!anchor || typeof entry.sock.fetchMessageHistory !== 'function') {
        return {
          status: 'unsupported',
          detail: 'Riwayat tambahan memerlukan referensi pesan asli dan dukungan perangkat tertaut.',
          observation_completed: true,
        };
      }

      // The peer request is for one chat. Only an attributed response can confirm receipt.
      entry.historyResponses = new Map();
      const requestId = await withTimeout(
        entry.sock.fetchMessageHistory(20, anchor.key, anchor.timestamp),
        5000,
        'Perangkat tertaut belum menerima permintaan riwayat.',
      );
      const deadline = Date.now() + 5000;
      while (live.get(numberId) === entry && socketOpen(numberId) &&
        !entry.historyResponses.has(requestId) && Date.now() < deadline) await sleep(100);
      const batch = entry.historyResponses.get(requestId);
      if (!batch) return { status: 'unconfirmed', detail: 'Belum ada respons riwayat dalam waktu pemeriksaan.' };
      await withTimeout(entry.ingestHistory(batch), 5000, 'Pemrosesan riwayat masih berjalan.');
      return { status: 'ok', received: batch.length, observation_completed: true };
    });
    return newMessages;
  } finally {
    appendObservers.delete(numberId);
    if (entry) entry.historyResponses = null;
    const pending = resyncQueues.get(numberId);
    resyncQueues.delete(numberId);
    if (pending?.length && !socketOpen(numberId)) {
      for (const { reject } of pending.splice(0)) reject(Error('Antrean terhenti karena socket terputus.'));
      recordHealth(numberId, 'queue', 0);
    }
  }
}
