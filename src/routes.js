import { Router } from 'express';
import { db, q, schemaStatus } from './db.js';
import { readiness } from './readiness.js';
import { acceptOwnerInvitation, login, setCookie, requireAuth, requireAdmin, canAccessNumber } from './auth.js';
import {startRaqioSession} from './raqioSso.js';
import {clearCookie,createLogoutHandler,logoutSqlite} from './sessionLogout.js';
import {createSqliteTransactions} from './database/transactions.js';
import { hashPassword, verifyPassword } from './passwords.js';
import * as guard from './loginGuard.js';
import * as wa from './wa.js';
import * as limits from './limits.js';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import * as backup from './backup.js';
import { aiApi } from './ai/routes.js';
import { issueMediaUrl, mediaError } from './media.js';
import {requireSessionScope,requireTenantScope} from './tenantScope.js';
import {parseMessageCursor,readChatMessages,withTenantRead} from './chatMessageRead.js';
import {mountSessionRoutes} from './sessionRoutes.js';
import {mountSessionHealthRoutes} from './sessionHealthRoutes.js';
import {appendAudit} from './platformAudit.js';
import {describeError,sendError} from './apiErrors.js';
import {platformApi,mountOwnerAudit} from './platformRoutes.js';

import {mountDealReview} from './dealReviewRoutes.js';

import {mountDealAnalytics} from './dealAnalyticsRoutes.js';

export const api = Router();

api.get('/health', (_req, res) => res.json({
  ok: true, schema_version: schemaStatus.version, schema_ddl_hash: schemaStatus.hash,
}));
// H3: readiness is separate from liveness; 503 until the database is open and migrated.
api.get('/ready', (_req, res) => { const r = readiness(db, schemaStatus); res.status(r.status).json(r.body); });

api.post('/login', (req, res) => {
  if(req.body?.raqio===true)return startRaqioSession(req,res);
  const { username, password, invitation_token } = req.body || {};
  if(config.raqioSso&&invitation_token===undefined)return res.status(403).json({code:'RAQIO_LOGIN_REQUIRED',loginUrl:config.raqioLoginUrl});
  if (typeof username !== 'string' || typeof password !== 'string') return res.status(400).json({ error: 'username dan password wajib' });
  if (guard.blocked(username, req.ip)) return res.status(429).json({ error: 'terlalu banyak percobaan, coba lagi nanti' });
  const out = invitation_token === undefined ? login(username, password, req) : acceptOwnerInvitation(invitation_token, username.trim(), password, req);
  if (!out) {
    guard.fail(username, req.ip);
    return res.status(401).json({ error: invitation_token === undefined ? 'username atau password salah' : 'Undangan atau kredensial aktivasi tidak valid' });
  }
  guard.reset(username, req.ip);
  setCookie(res, out.token, out.expires);
  if(out.noMembership)return res.status(409).json({error:'TENANT_NOT_SELECTED',code:'TENANT_NOT_SELECTED',reason:'NO_MEMBERSHIP'});
  res.json({ user: out.user });
});

api.post('/logout',requireSessionScope,createLogoutHandler(req =>
  logoutSqlite(req,createSqliteTransactions(path.join(config.dataDir,'app.db')))));

mountSessionRoutes(api);
mountSessionHealthRoutes(api);
mountDealReview(api);
mountDealAnalytics(api);
api.use('/platform',platformApi);
mountOwnerAudit(api);

api.post('/password',requireSessionScope, (req, res) => {
  const { old, next } = req.body || {};
  if (typeof next !== 'string' || next.length < config.passMin) return res.status(400).json({ error: `password minimal ${config.passMin} karakter` });
  const row = q.userByName.get(req.user.username);
  if (!row || !verifyPassword(String(old || ''), row.pass)) return res.status(401).json({ error: 'password lama salah' });
  q.setUserPass.run(hashPassword(next), req.user.id);
  res.json({ ok: true });
});

api.post('/logout-all',requireSessionScope, (req, res) => {
  q.deleteAllSessions.run(req.user.id);
  clearCookie(res);
  res.json({ ok: true });
});

api.patch('/me',requireSessionScope, (req, res) => {
  const name = String(req.body?.username || '').trim();
  if (name.length < 3) return res.status(400).json({ error: 'username minimal 3 karakter' });
  try { q.setUsername.run(name, req.user.id); res.json({ ok: true }); }
  catch { res.status(400).json({ error: 'username sudah dipakai' }); }
});

api.use(requireAuth);
api.use(aiApi);

api.post('/chats/:chatId/media-url', (req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    res.json(issueMediaUrl(Number(req.params.chatId), req.body?.media_path, req.user));
  } catch (err) { mediaError(err, req, res, next); }
});

api.get('/monitor', requireAdmin, (_req, res) => {
  res.json(q.allNumbers.all().map((n) => ({ id: n.id, name: n.name, phone: n.phone, status: n.status, last_seen: n.last_seen, attempts: wa.attemptsOf(n.id) })));
});
api.get('/activity', requireAdmin, (_req, res) => res.json(q.activityRecent.all(100)));

api.get('/search', (req, res) => {
  const term = String(req.query.q || '').trim();
  if (term.length < 2) return res.json([]);
  const nums = req.user.role === 'admin' ? q.allNumbers.all() : q.numbersByOwner.all(req.user.id);
  const ids = nums.map((n) => n.id);
  if (!ids.length) return res.json([]);
  const rows = db.prepare(`SELECT m.id, m.body, m.ts, m.chat_id, m.number_id, c.name, c.push_name, c.pn, c.jid, n.name AS number
    FROM messages m JOIN chats c ON c.id = m.chat_id JOIN numbers n ON n.id = m.number_id
    WHERE m.body LIKE ? AND m.number_id IN (${ids.map(() => '?').join(',')})
    ORDER BY m.ts DESC LIMIT 50`).all(`%${term}%`, ...ids);
  res.json(rows);
});


api.get('/backups', requireAdmin, (_req, res) => res.json(backup.list()));

api.post('/backups', requireAdmin, async (_req, res) => {
  try { res.json({ name: await backup.run() }); } catch (err) { res.status(500).json({ error: err.message }); }
});

api.get('/backups/:name', requireAdmin, (req, res) => {
  const name = backup.safeName(req.params.name);
  if (!name) return res.status(400).json({ error: 'nama tidak valid' });
  const file = path.resolve(config.backupDir, name);
  if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) return res.status(404).json({ error: 'tidak ada' });
  res.download(file, name);
});

api.delete('/backups/:name', requireAdmin, (req, res) => {
  const name = backup.safeName(req.params.name);
  if (!name) return res.status(400).json({ error: 'nama tidak valid' });
  fs.rmSync(path.join(config.backupDir, name), { force: true });
  res.json({ ok: true });
});

api.get('/numbers', (req, res) => {
  const rows = req.user.role === 'admin' ? q.allNumbers.all() : q.numbersByOwner.all(req.user.id);
  const day = limits.aiDay();
  const stopped = db.prepare("SELECT number_id FROM ai_alerts WHERE day=? AND level='stop'").all(day);
  res.json(rows.map(({ id, name, phone, status, owner_id, created_at, last_seen, tenant_id }) => ({
    id, name, phone, status, owner_id, created_at, last_seen, tenant_id,
    ai_stopped: stopped.some(alert => alert.number_id === id),
  })));
});

api.post('/numbers', requireAdmin, (req, res) => {
  const { phone, name, owner_id } = req.body || {};
  if (!phone || !name) return res.status(400).json({ error: 'phone dan name wajib' });
  const info = q.insertNumber.run(phone, name, owner_id || null, Date.now());
  res.json({ id: Number(info.lastInsertRowid) });
});

api.post('/numbers/:id/start', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const n = q.numberById.get(id);
  if (!n) return res.status(404).json({ error: 'nomor tidak ada' });
  wa.connect(id).catch((e) => console.error('[start]', id, e.message));
  res.json({ ok: true });
});

api.post('/numbers/:id/pairing', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!canAccessNumber(req.user, id)) return res.status(403).json({ error: 'tidak punya akses' });
  try {
    await wa.connect(id);
    res.json({ pairingCode: await wa.requestPairing(id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.get('/numbers/:id/qr', async (req, res) => {
  const id = Number(req.params.id);
  if (!canAccessNumber(req.user, id)) return res.status(403).json({ error: 'tidak punya akses' });
  try {
    const qr = await wa.qrDataUrl(id);
    const n = q.numberById.get(id);
    res.json({ qr, status: n?.status ?? null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.get('/numbers/:id/quota', (req, res) => {
  const id = Number(req.params.id);
  const n = q.numberById.get(id);
  if (!n) return res.status(404).json({ error: 'nomor tidak ada' });
  if (!canAccessNumber(req.user, id)) return res.status(403).json({ error: 'tidak punya akses' });
  res.json({ used: limits.dailyUsed(id), cap: limits.dailyCap(n), remaining: limits.remaining(id) });
});

api.post('/numbers/:id/reconnect', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  try { await wa.connect(id); res.json({ ok: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

api.patch('/numbers/:id/name', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!canAccessNumber(req.user, id)) return res.status(403).json({ error: 'tidak punya akses' });
  if (!q.numberById.get(id)) return res.status(404).json({ error: 'nomor tidak ada' });
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name || name.length > 60) return res.status(400).json({ error: 'nama wajib 1–60 karakter' });
  db.prepare('UPDATE numbers SET name = ? WHERE id = ?').run(name, id);
  res.json({ ok: true, name });
});

// Database refusals of the delete routes become JSON (with request id) through the central mapping;
// only the wording names the entity.
function deleteFailure(req, res, err, what) {
  const { code } = describeError(err);
  const wording = {
    DEAL_DECIDED: `${what} tidak dapat dihapus karena memiliki deal yang sudah diputuskan.`,
    CONSTRAINT: `${what} masih dipakai data lain sehingga tidak dapat dihapus.`,
    DATABASE: `${what} tidak dapat dihapus.`,
  };
  if (!wording[code]) throw err;
  return sendError(req, res, err, { error: wording[code] });
}
// Optional free-text reason stored in the audit row.
function deleteReason(req) {
  const raw = req.body?.reason ?? req.query?.reason;
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string' || raw.trim().length > 500) throw Object.assign(Error('Alasan maksimal 500 karakter.'), { status: 400 });
  return raw.trim() || null;
}
// Tenant-scoped lookups: an entity of another tenant is indistinguishable from a missing one (404).
const scopedNumber = db.prepare(`SELECT n.*,(SELECT count(*) FROM chats WHERE number_id=n.id) AS chat_count,
  (SELECT count(*) FROM messages WHERE number_id=n.id) AS message_count,(SELECT count(*) FROM deals WHERE session_id=n.id) AS deal_count
  FROM numbers n WHERE n.id=? AND n.tenant_id=?`);
const scopedChat = db.prepare(`SELECT c.*,(SELECT count(*) FROM messages WHERE chat_id=c.id) AS message_count,
  (SELECT count(*) FROM deals WHERE chat_id=c.id) AS deal_count FROM chats c WHERE c.id=? AND c.tenant_id=?`);
const scopedMember = db.prepare(`SELECT u.id,u.username,tm.role,(SELECT count(*) FROM tenant_members o WHERE o.user_id=u.id AND o.tenant_id<>tm.tenant_id) AS other_tenants,
  (SELECT count(*) FROM deal_verifications v JOIN deals d ON d.id=v.deal_id WHERE v."by"=u.id AND d.tenant_id=tm.tenant_id) AS verifications
  FROM tenant_members tm JOIN users u ON u.id=tm.user_id WHERE tm.tenant_id=? AND tm.user_id=?`);

api.delete('/numbers/:id', requireTenantScope, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const tenantId = req.tenantScope.tenantId;
  const number = scopedNumber.get(id, tenantId);
  if (!number) return res.status(404).json({ error: 'nomor tidak ada' });
  const reason = deleteReason(req);
  // Database first: a refused delete must not log the WhatsApp session out.
  try {
    db.transaction(() => {
      appendAudit(db, { actor: req.user, req, action: 'number_deleted', tenantId, targetType: 'number', targetId: String(id), reason: reason || 'number_deleted',
        before: { name: number.name, phone: number.phone, chats: number.chat_count, messages: number.message_count, deals: number.deal_count } });
      q.deleteNumber.run(id);
    })();
  } catch (err) { return deleteFailure(req, res, err, 'Nomor'); }
  try { wa.disconnect(id); } catch (err) { console.error('[number.delete] disconnect gagal untuk nomor', id, err.message); }
  try { wa.forgetSession(id); } catch (err) { console.error('[number.delete] hapus sesi gagal untuk nomor', id, err.message); }
  res.json({ ok: true });
});

api.get('/numbers/:id/chats', (req, res) => {
  const id = Number(req.params.id);
  if (!canAccessNumber(req.user, id)) return res.status(403).json({ error: 'tidak punya akses' });
  const queue = req.query.queue || 'all';
  const status = req.query.status || '';
  if (!['all', 'unread', 'mine', 'unassigned'].includes(queue) || !['', 'new', 'in_progress', 'resolved'].includes(status)) return res.status(400).json({ error: 'filter chat tidak valid' });
  res.json(q.inboxChats.all({ numberId:id, userId:req.user.id, mine:req.query.mine === '1' || queue === 'mine' ? 1 : 0, queue, status }));
});

api.patch('/chats/:chatId/pin', requireAuth, (req, res) => {
  const chat = q.chatById.get(Number(req.params.chatId));
  if (!chat) return res.status(404).json({ error: 'chat tidak ada' });
  if (!canAccessNumber(req.user, chat.number_id)) return res.status(403).json({ error: 'tidak punya akses' });
  if (typeof req.body?.pinned !== 'boolean') return res.status(400).json({ error: 'pinned harus boolean' });
  db.prepare('UPDATE chats SET pinned = ? WHERE id = ?').run(Number(req.body.pinned), chat.id);
  res.json({ ok: true });
});

api.patch('/chats/:chatId/status', (req, res) => {
  const chat = q.chatById.get(Number(req.params.chatId));
  if (!chat) return res.status(404).json({ error:'chat tidak ada' });
  if (!canAccessNumber(req.user, chat.number_id)) return res.status(403).json({ error:'tidak punya akses' });
  const status = req.body?.status;
  if (!['new', 'in_progress', 'resolved'].includes(status)) return res.status(400).json({ error:'status tidak valid' });
  q.setChatStatus.run(status, chat.id);
  res.json({ ok:true, status });
});

api.put('/chats/:chatId/name', (req, res) => {
  const chat = q.chatById.get(Number(req.params.chatId));
  if (!chat) return res.status(404).json({ error: 'chat tidak ada' });
  if (!canAccessNumber(req.user, chat.number_id)) return res.status(403).json({ error: 'tidak punya akses' });
  if (req.body?.name != null && typeof req.body.name !== 'string') return res.status(400).json({ error: 'nama harus berupa teks' });
  const name = (req.body?.name || '').trim();
  db.transaction(() => {
    if (name) {
      q.upsertContact.run(chat.number_id, chat.jid, name, Date.now());
      q.setChatName.run(name, chat.id);
    } else {
      q.deleteContact.run(chat.number_id, chat.jid);
      q.setChatName.run(chat.push_name || null, chat.id);
    }
  })();
  res.json({ ok: true });
});

api.get('/chats/:chatId/messages', requireTenantScope, async (req, res) => {
  let before;
  try { before = parseMessageCursor(req.query.before); }
  catch (error) {
    if (error.status === 400) return res.status(400).json({error:error.message});
    throw error;
  }
  const {tenantId,userId} = req.tenantScope;
  const chatId = Number(req.params.chatId);
  const page = await withTenantRead(tenantId,tx=>readChatMessages(tx,{tenantId,userId,chatId,before}));
  if (page.status) return res.status(page.status).json({error:page.error});
  res.json(page);
});

api.get('/chats/:chatId/export', (req, res) => {
  const chat = q.chatById.get(Number(req.params.chatId));
  if (!chat) return res.status(404).json({ error: 'chat tidak ada' });
  if (!canAccessNumber(req.user, chat.number_id)) return res.status(403).json({ error: 'tidak punya akses' });
  const rows = db.prepare('SELECT ts, from_me, body FROM messages WHERE chat_id = ? ORDER BY ts, id').all(chat.id);
  const quote = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const csv = 'ts,from_me,body\r\n' + rows.map((m) => [m.ts, m.from_me, m.body].map(quote).join(',')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="chat-${chat.id}.csv"`);
  res.send('\uFEFF' + csv);
});

api.post('/chats/:chatId/send', async (req, res) => {
  const chat = q.chatById.get(Number(req.params.chatId));
  if (!chat) return res.status(404).json({ error: 'chat tidak ada' });
  if (!canAccessNumber(req.user, chat.number_id)) return res.status(403).json({ error: 'tidak punya akses' });
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'text kosong' });
  try {
    if (req.body.quote_wa_id) {
      const original = q.messageByWaId.get(chat.number_id, String(req.body.quote_wa_id));
      if (!original || original.chat_id !== chat.id) return res.status(400).json({ error: 'pesan kutipan tidak ditemukan' });
      await wa.sendQuote(chat.number_id, chat.jid, text, String(req.body.quote_wa_id), req.user.id);
    } else await wa.sendText(chat.number_id, chat.jid, text, req.user.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.post('/chats/:chatId/react', async (req, res) => {
  const chat = q.chatById.get(Number(req.params.chatId));
  if (!chat) return res.status(404).json({ error: 'chat tidak ada' });
  if (!canAccessNumber(req.user, chat.number_id)) return res.status(403).json({ error: 'tidak punya akses' });
  const { wa_id, emoji } = req.body || {};
  if (!wa_id || !['👍', '❤️', '😂', '😮', '🙏'].includes(emoji)) return res.status(400).json({ error: 'reaksi tidak valid' });
  const original = q.messageByWaId.get(chat.number_id, String(wa_id));
  if (!original || original.chat_id !== chat.id) return res.status(400).json({ error: 'pesan tidak ditemukan' });
  try { await wa.sendReaction(chat.number_id, chat.jid, String(wa_id), emoji); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

api.post('/chats/:chatId/unread', (req, res) => {
  const chat = q.chatById.get(Number(req.params.chatId));
  if (!chat) return res.status(404).json({ error: 'chat tidak ada' });
  if (!canAccessNumber(req.user, chat.number_id)) return res.status(403).json({ error: 'tidak punya akses' });
  q.setChatUnread.run(1, chat.id);
  res.json({ ok: true });
});

api.post('/chats/:chatId/media', async (req, res) => {
  const chat = q.chatById.get(Number(req.params.chatId));
  if (!chat) return res.status(404).json({ error: 'chat tidak ada' });
  if (!canAccessNumber(req.user, chat.number_id)) return res.status(403).json({ error: 'tidak punya akses' });
  const { base64, mime, caption = '' } = req.body || {};
  if (!base64 || !mime) return res.status(400).json({ error: 'base64 dan mime wajib' });
  try {
    const buffer = Buffer.from(String(base64).replace(/^data:[^;]+;base64,/, ''), 'base64');
    if (buffer.length > 16 * 1024 * 1024) return res.status(413).json({ error: 'maksimal 16 MB' });
    await wa.sendMedia(chat.number_id, chat.jid, buffer, mime, String(caption), req.user.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.post('/chats/:chatId/read', (req, res) => {
  const chat = q.chatById.get(Number(req.params.chatId));
  if (!chat) return res.status(404).json({ error: 'chat tidak ada' });
  if (!canAccessNumber(req.user, chat.number_id)) return res.status(403).json({ error: 'tidak punya akses' });
  q.clearUnread.run(chat.id);
  res.json({ ok: true });
});

api.patch('/chats/:chatId/assign', (req, res) => {
  const chat = q.chatById.get(Number(req.params.chatId));
  if (!chat) return res.status(404).json({ error: 'chat tidak ada' });
  if (!canAccessNumber(req.user, chat.number_id)) return res.status(403).json({ error: 'tidak punya akses' });
  const id = req.body?.user_id == null ? null : Number(req.body.user_id);
  const user = id == null ? null : q.userById.get(id);
  if (id != null && (!user || !canAccessNumber(user, chat.number_id))) return res.status(400).json({ error: 'agen tidak punya akses nomor ini' });
  q.setAssignee.run(id, chat.id);
  if (id != null) {
    const minutes = q.aiSettings.get(chat.number_id)?.ai_paused_minutes || 30;
    q.pauseAiChat.run(Date.now() + minutes * 60000, chat.id);
  }
  res.json({ ok: true });
});

api.get('/notifications', (req, res) => res.json(q.notificationsFor.all(req.user.id, 30)));
api.get('/notifications/count', (req, res) => res.json(q.unreadNotifCount.get(req.user.id)));
api.post('/notifications/read', (req, res) => {
  q.markNotifRead.run(Date.now(), req.user.id);
  res.json({ ok: true });
});

api.delete('/chats/:chatId', requireTenantScope, (req, res) => {
  const tenantId = req.tenantScope.tenantId;
  const chat = scopedChat.get(Number(req.params.chatId), tenantId);
  if (!chat) return res.status(404).json({ error: 'chat tidak ada' });
  if (!canAccessNumber(req.user, chat.number_id)) return res.status(403).json({ error: 'tidak punya akses' });
  const reason = deleteReason(req);
  try {
    db.transaction(() => {
      appendAudit(db, { actor: req.user, req, action: 'chat_deleted', tenantId, targetType: 'chat', targetId: String(chat.id), reason: reason || 'chat_deleted',
        before: { number_id: chat.number_id, messages: chat.message_count, deals: chat.deal_count } });
      q.deleteChat.run(chat.id);
    })();
  } catch (err) { return deleteFailure(req, res, err, 'Chat'); }
  res.json({ ok: true });
});

api.get('/numbers/:id/rules', (req, res) => {
  const id = Number(req.params.id);
  if (!canAccessNumber(req.user, id)) return res.status(403).json({ error: 'tidak punya akses' });
  res.json(q.allRulesByNumber.all(id));
});

api.post('/numbers/:id/rules', (req, res) => {
  const id = Number(req.params.id);
  if (!canAccessNumber(req.user, id)) return res.status(403).json({ error: 'tidak punya akses' });
  const { match_type = 'contains', pattern, reply, priority = 0 } = req.body || {};
  if (!pattern || !reply) return res.status(400).json({ error: 'pattern dan reply wajib' });
  if (match_type === 'regex' && /\([^()]*[+*]\)[+*]/.test(pattern)) {
    return res.status(400).json({ error: 'pola punya quantifier bersarang, misal (a+)+' });
  }
  if (match_type === 'regex') {
    try { new RegExp(pattern, 'i'); } catch { return res.status(400).json({ error: 'pola regex tidak valid' }); }
  }
  q.insertRule.run(id, match_type, pattern, reply, Number(priority));
  res.json({ ok: true });
});

function ownRule(req) {
  const r = db.prepare('SELECT * FROM rules WHERE id = ?').get(Number(req.params.id));
  return r && canAccessNumber(req.user, r.number_id) ? r : null;
}

function ownChat(req) {
  const c = q.chatById.get(Number(req.params.chatId));
  return c && canAccessNumber(req.user, c.number_id) ? c : null;
}

api.patch('/rules/:id', (req, res) => {
  const rule = ownRule(req);
  if (!rule) return res.status(403).json({ error: 'tidak punya akses' });
  q.toggleRule.run(req.body?.enabled ? 1 : 0, rule.id);
  res.json({ ok: true });
});

api.delete('/rules/:id', (req, res) => {
  const rule = ownRule(req);
  if (!rule) return res.status(403).json({ error: 'tidak punya akses' });
  q.deleteRule.run(rule.id);
  res.json({ ok: true });
});

api.get('/templates', (req, res) => {
  res.json(q.allTemplates.all().filter((t) => !t.number_id || canAccessNumber(req.user, t.number_id)));
});

api.post('/templates', (req, res) => {
  const { title, body, number_id } = req.body || {};
  if (!title || !body) return res.status(400).json({ error: 'title dan body wajib' });
  if (number_id && !canAccessNumber(req.user, Number(number_id))) return res.status(403).json({ error: 'tidak punya akses' });
  q.insertTemplate.run(number_id || null, title, body);
  res.json({ ok: true });
});

api.delete('/templates/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM templates WHERE id = ?').get(Number(req.params.id));
  if (!t) return res.status(404).json({ error: 'template tidak ada' });
  const allowed = t.number_id ? canAccessNumber(req.user, t.number_id) : req.user.role === 'admin';
  if (!allowed) return res.status(403).json({ error: 'tidak punya akses' });
  q.deleteTemplate.run(t.id);
  res.json({ ok: true });
});

api.get('/labels', (_req, res) => res.json(q.allLabels.all()));
api.post('/labels', (req, res) => {
  const { name, color } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name wajib' });
  try {
    q.insertLabel.run(name, color || '#64748b');
    res.json({ ok: true });
  } catch { res.status(400).json({ error: 'label sudah ada' }); }
});
api.delete('/labels/:id', requireAdmin, (req, res) => { q.deleteLabel.run(Number(req.params.id)); res.json({ ok: true }); });

api.post('/chats/:chatId/labels/:labelId', (req, res) => {
  const chat = ownChat(req);
  if (!chat) return res.status(403).json({ error: 'tidak punya akses' });
  const label = db.prepare('SELECT id FROM labels WHERE id = ?').get(Number(req.params.labelId));
  if (!label) return res.status(404).json({ error: 'label tidak ada' });
  q.addChatLabel.run(chat.id, label.id);
  res.json({ ok: true });
});
api.delete('/chats/:chatId/labels/:labelId', (req, res) => {
  const chat = ownChat(req);
  if (!chat) return res.status(403).json({ error: 'tidak punya akses' });
  q.removeChatLabel.run(chat.id, Number(req.params.labelId));
  res.json({ ok: true });
});

api.get('/users',requireTenantScope, requireAdmin, (_req, res) => res.json(q.allUsers.all()));

api.post('/users',requireTenantScope, requireAdmin, (req, res) => {
  const { username, password, role = 'agent' } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username dan password wajib' });
  if (typeof password !== 'string' || password.length < config.passMin) return res.status(400).json({ error: `password minimal ${config.passMin} karakter` });
  try {
    const passwordHash = hashPassword(password);
    const now = Date.now();
    const {tenantId} = req.tenantScope;
    db.transaction(() => {
      const {lastInsertRowid} = q.insertUser.run(username, passwordHash, role, now);
      db.prepare(`INSERT INTO tenant_members(tenant_id,user_id,role,created_at)
        VALUES (?,?,CASE WHEN EXISTS(SELECT 1 FROM tenant_members WHERE tenant_id=? AND role='owner')
          THEN 'agent' ELSE 'owner' END,?)`).run(tenantId,lastInsertRowid,tenantId,now);
    }).immediate();
    res.json({ ok: true });
  } catch { res.status(400).json({ error: 'username sudah dipakai' }); }
});

api.delete('/users/:id',requireTenantScope, requireAdmin, (req, res) => {
  const tenantId = req.tenantScope.tenantId;
  const member = scopedMember.get(tenantId, Number(req.params.id));
  if (!member) return res.status(404).json({ error: 'pengguna tidak ada' });
  // Accounts are global: deleting one that also belongs to another workspace would remove it there too.
  if (member.other_tenants) return res.status(409).json({ error: 'Pengguna juga anggota workspace lain dan tidak dapat dihapus dari sini.', code: 'USER_IN_OTHER_TENANT', request_id: req.requestId });
  const reason = deleteReason(req);
  try {
    db.transaction(() => {
      appendAudit(db, { actor: req.user, req, action: 'user_deleted', tenantId, targetType: 'user', targetId: String(member.id), reason: reason || 'user_deleted',
        before: { username: member.username, role: member.role, verifications: member.verifications } });
      q.deleteUser.run(member.id);
    })();
  } catch (err) { return deleteFailure(req, res, err, 'Pengguna'); }
  res.json({ ok: true });
});
