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
import * as limits from './limits.js';

const logger = P({ level: 'silent' });
const live = new Map();
const reconnects = new Map();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

export function emit(event) {
  if (typeof globalThis.__broadcast === 'function') globalThis.__broadcast(event);
}

function textOf(m) {
  return m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption
    || m.videoMessage?.caption || m.documentMessage?.fileName || '';
}

function kindOf(msg) {
  const m = msg.message || {};
  if (m.imageMessage) return { kind: 'image', mime: m.imageMessage.mimetype };
  if (m.videoMessage) return { kind: 'video', mime: m.videoMessage.mimetype };
  if (m.audioMessage) return { kind: 'audio', mime: m.audioMessage.mimetype };
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
    const info = q.insertChat.run(numberId, jid, name || null, Date.now());
    chat = q.chatById.get(info.lastInsertRowid);
  }
  return chat;
}

function matchRule(rules, text) {
  const body = text.toLowerCase();
  for (const r of rules) {
    if (r.match_type === 'exact' && body.trim() === r.pattern.toLowerCase()) return r;
    if (r.match_type === 'contains' && body.includes(r.pattern.toLowerCase())) return r;
    if (r.match_type === 'regex') {
      try { if (new RegExp(r.pattern, 'i').test(text)) return r; } catch { /* pola rusak */ }
    }
  }
  return null;
}

function enqueue(numberId, task) {
  const s = live.get(numberId);
  if (!s) throw new Error('nomor tidak aktif');
  s.queue.push(task);
  if (!s.busy) drain(numberId);
}

async function drain(numberId) {
  const s = live.get(numberId);
  if (!s) return;
  s.busy = true;
  while (s.queue.length) {
    const task = s.queue.shift();
    try {
      await task();
    } catch (err) {
      console.error('[queue]', numberId, err.message);
    }
    await sleep(config.delayMin + Math.random() * (config.delayMax - config.delayMin));
  }
  s.busy = false;
}

export async function connect(numberId) {
  const number = q.numberById.get(numberId);
  if (!number) throw new Error('nomor tidak ada');
  if (live.has(numberId)) return { status: 'sudah-aktif' };
  const retry = reconnects.get(numberId) || { attempt: 0, timer: null };
  clearTimeout(retry.timer);
  retry.timer = null;
  if (retry.attempt > 6) retry.attempt = 0;
  reconnects.set(numberId, retry);

  const dir = path.join(config.dataDir, 'sessions', String(numberId));
  fs.mkdirSync(dir, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(dir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
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

  const entry = { sock, queue: [], busy: false, pairingCode: null, qr: null, ready, isReady: false, resolveReady, rejectReady };
  live.set(numberId, entry);

  const markReady = () => {
    if (entry.isReady) return;
    entry.isReady = true;
    entry.resolveReady();
  };

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
  if (qr) {
    entry.qr = qr;
    markReady();
    emit({ type: 'number.qr', numberId, qr: await QRCode.toDataURL(qr, { margin: 1, width: 320 }) });
  }
    if (qr) markReady();

    if (connection === 'open') {
      entry.attempt = 0;
      retry.attempt = 0;
      entry.qr = null;
      markReady();
      q.updateNumberStatus.run('online', numberId);
      q.touchNumber.run(Date.now(), numberId);
      emit({ type: 'number.status', numberId, status: 'online' });
    }

    if (connection === 'close') {
      if (live.get(numberId) !== entry) return;
      const code = lastDisconnect?.error?.output?.statusCode;
      live.delete(numberId);
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

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (!msg.message || msg.key.remoteJid === 'status@broadcast') continue;
      if (msg.key.id && (q.messageByWaId.get(numberId, msg.key.id) || limits.seen(numberId + ':' + msg.key.id))) continue;
      const jid = msg.key.remoteJid;
      const pn = msg.key.remoteJidAlt || null;
      const fromMe = Boolean(msg.key.fromMe);
      const body = textOf(msg.message || {});
      const { kind, mime } = kindOf(msg);
      if (kind === 'text' && !body && !fromMe) continue;

      const chat = getChat(numberId, jid, msg.pushName || null);
      if (msg.pushName) q.setChatName.run(msg.pushName, chat.id);
      if (pn) q.setChatPn.run(pn, chat.id);
      let mediaPath = null;
      if (kind !== 'text') {
        try {
          const buf = await downloadMediaMessage(msg, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage });
          const ext = String(mime || 'bin').split('/')[1]?.split(';')[0] || 'bin';
          const file = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
          fs.writeFileSync(path.join(config.dataDir, 'media', file), buf);
          mediaPath = file;
        } catch (err) {
          console.error('[media]', numberId, err.message);
        }
      }
      const saved = q.insertMessage.run(numberId, chat.id, fromMe ? 1 : 0, body, Date.now(), null, kind, mediaPath, mime, msg.key.id || null);
      if (!saved.changes) continue;
      q.touchChat.run(Date.now(), msg.pushName || null, chat.id);
      if (!fromMe) q.bumpUnread.run(chat.id);
      if (!fromMe && chat.assignee_id) {
        q.insertNotification.run(chat.assignee_id, numberId, chat.id, Date.now());
        emit({ type: 'notification', userId: chat.assignee_id, numberId, chatId: chat.id, body });
      }

      emit({ type: 'message', numberId, chatId: chat.id, jid, body, fromMe, kind, mediaPath, waId: msg.key.id || null, ts: Date.now() });

      if (!fromMe && body && !jid.endsWith('@g.us') && limits.withinHours()) {
        const rules = q.rulesByNumber.all(numberId);
        const hit = matchRule(rules, body);
        if (hit && limits.chatAllowed(numberId, jid)) {
          limits.markChat(numberId, jid);
          const jitter = 1500 + Math.random() * 2500;
          setTimeout(() => {
            sendText(numberId, jid, hit.reply, null, true).catch((e) => console.error('[autoreply]', e.message));
          }, jitter);
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

export async function sendText(numberId, jid, text, agentId = null, isAuto = false) {
  const s = live.get(numberId);
  if (!s) throw new Error('nomor tidak aktif');
  const number = q.numberById.get(numberId);
  if (number) limits.assertQuota(number);

  const chat = getChat(numberId, jid, null);
  return new Promise((resolve, reject) => {
    enqueue(numberId, async () => {
      try {
        await limits.acquire(numberId);
        if (live.get(numberId) !== s) throw new Error('nomor tidak aktif');
        if (number) limits.assertQuota(number);
        if (isAuto && !limits.withinHours()) throw new Error('di luar jam operasional');
        limits.bumpDaily(numberId);
        await s.sock.sendPresenceUpdate('composing', jid);
        await sleep(Math.min(4000, 600 + text.length * 30));
        const sent = await s.sock.sendMessage(jid, { text });
        q.insertActivity.run(agentId, numberId, 'send', text.slice(0, 80), Date.now());
        await s.sock.sendPresenceUpdate('paused', jid);
        q.insertMessage.run(numberId, chat.id, 1, text, Date.now(), agentId, 'text', null, null, sent?.key?.id || null);
        q.touchChat.run(Date.now(), null, chat.id);
        emit({ type: 'message', numberId, chatId: chat.id, jid, body: text, fromMe: true, kind: 'text', mediaPath: null, waId: sent?.key?.id || null, ts: Date.now() });
        resolve(true);
      } catch (err) {
        reject(err);
      }
    });
  });
}

export async function sendQuote(numberId, jid, text, waId, agentId = null) {
  const s = live.get(numberId);
  if (!s) throw new Error('nomor tidak aktif');
  const number = q.numberById.get(numberId);
  if (number) limits.assertQuota(number);
  const chat = getChat(numberId, jid, null);
  const original = q.messageByWaId.get(numberId, waId);
  if (!original || original.chat_id !== chat.id) throw new Error('pesan kutipan tidak ditemukan');
  return new Promise((resolve, reject) => {
    enqueue(numberId, async () => {
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
        q.insertActivity.run(agentId, numberId, 'send', text.slice(0, 80), Date.now());
        await s.sock.sendPresenceUpdate('paused', jid);
        q.insertMessage.run(numberId, chat.id, 1, text, Date.now(), agentId, 'text', null, null, sent?.key?.id || null);
        q.touchChat.run(Date.now(), null, chat.id);
        emit({ type: 'message', numberId, chatId: chat.id, jid, body: text, fromMe: true, kind: 'text', mediaPath: null, waId: sent?.key?.id || null, ts: Date.now() });
        resolve(true);
      } catch (err) { reject(err); }
    });
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
    enqueue(numberId, async () => {
      try {
        await limits.acquire(numberId);
        if (live.get(numberId) !== s) throw new Error('nomor tidak aktif');
        if (number) limits.assertQuota(number);
        limits.bumpDaily(numberId);
        await s.sock.sendMessage(jid, { react: { text: emoji, key: { remoteJid: jid, id: waId, fromMe: Boolean(original.from_me) } } });
        resolve(true);
      } catch (err) { reject(err); }
    });
  });
}

export async function sendMedia(numberId, jid, buffer, mime, caption = '', agentId = null) {
  const s = live.get(numberId);
  if (!s) throw new Error('nomor tidak aktif');
  const number = q.numberById.get(numberId);
  if (number) limits.assertQuota(number);
  const chat = getChat(numberId, jid, null);
  const ext = String(mime || 'bin').split('/')[1]?.split(';')[0] || 'bin';
  const file = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  fs.writeFileSync(path.join(config.dataDir, 'media', file), buffer);

  return new Promise((resolve, reject) => {
    enqueue(numberId, async () => {
      try {
        await limits.acquire(numberId);
        if (live.get(numberId) !== s) throw new Error('nomor tidak aktif');
        if (number) limits.assertQuota(number);
        limits.bumpDaily(numberId);
        await s.sock.sendPresenceUpdate('composing', jid);
        const isImage = String(mime).startsWith('image/');
        const isVideo = String(mime).startsWith('video/');
        const payload = isImage
          ? { image: buffer, caption }
          : isVideo
            ? { video: buffer, caption }
            : { document: buffer, mimetype: mime, fileName: caption || file, caption };
        const sent = await s.sock.sendMessage(jid, payload);
        q.insertActivity.run(agentId, numberId, 'send', String(caption).slice(0, 80), Date.now());
        await s.sock.sendPresenceUpdate('paused', jid);
        q.insertMessage.run(numberId, chat.id, 1, caption, Date.now(), agentId, isImage ? 'image' : isVideo ? 'video' : 'doc', file, mime, sent?.key?.id || null);
        q.touchChat.run(Date.now(), null, chat.id);
        emit({ type: 'message', numberId, chatId: chat.id, jid, body: caption, fromMe: true, kind: isImage ? 'image' : isVideo ? 'video' : 'doc', mediaPath: file, waId: sent?.key?.id || null, ts: Date.now() });
        resolve(true);
      } catch (err) {
        reject(err);
      }
    });
  });
}

export function disconnect(numberId, forget = false) {
  clearTimeout(reconnects.get(numberId)?.timer);
  reconnects.delete(numberId);
  const s = live.get(numberId);
  if (!s) return;
  try { s.sock.end(undefined); } catch { /* sudah mati */ }
  live.delete(numberId);
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
