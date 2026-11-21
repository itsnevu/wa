import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';
import { ensureSchema } from './schemaMigrations.js';
import { configureTenantScope } from './tenantScope.js';
import {configureSessionStore} from './sessionStore.js';
import { randomUUID } from 'node:crypto';

fs.mkdirSync(config.dataDir, { recursive: true });
export const db = new Database(path.join(config.dataDir, 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
await ensureSchema(db, config);
configureSessionStore(db);
fs.mkdirSync(path.join(config.dataDir, 'media'), { recursive: true });
fs.mkdirSync(path.join(config.dataDir, 'sessions'), { recursive: true });
configureTenantScope(db, () => config.multitenantEnabled);
export const DEFAULT_STOP_REPLY = 'Baik, saya sambungkan ke agen kami. Mohon tunggu sebentar ya.';
export function backfillMedia() {
  return db.transaction(() => {
    const rows=db.prepare(`SELECT m.id,m.number_id,m.media_path FROM messages m JOIN chats c ON c.id=m.chat_id JOIN numbers n ON n.id=c.number_id WHERE m.media_path IS NOT NULL AND m.media_path<>'' AND m.number_id=c.number_id AND NOT EXISTS(SELECT 1 FROM media_records r WHERE r.message_id=m.id)`).all();
    const insert=db.prepare('INSERT OR IGNORE INTO media_records(uuid,message_id,number_id,storage_path,created_at) VALUES(?,?,?,?,?)');
    for(const m of rows) insert.run(randomUUID(),m.id,m.number_id,m.media_path,Date.now());
    return rows.length;
  }).immediate();
}
export const q = {
  tenantMemberships:db.prepare('SELECT tenant_id FROM tenant_members WHERE user_id=? ORDER BY tenant_id'),
  aiSettings: db.prepare('SELECT * FROM ai_settings WHERE number_id = ?'),
  pauseAiChat: db.prepare('UPDATE chats SET ai_paused_until = ? WHERE id = ?'),
  aiUsageGet: db.prepare('SELECT * FROM ai_usage WHERE number_id = ? AND day = ?'),
  aiUsageBump: db.prepare(`INSERT INTO ai_usage(number_id, day, tokens, replies) VALUES (?, ?, ?, ?)
    ON CONFLICT(number_id, day) DO UPDATE SET tokens = tokens + excluded.tokens, replies = replies + excluded.replies`),
  aiSeen: db.prepare('SELECT * FROM ai_seen WHERE wa_id = ?'),
  aiSeenPut: db.prepare('INSERT OR IGNORE INTO ai_seen(wa_id, at) VALUES (?, ?)'),
  countAiLogsLastHour: db.prepare('SELECT COUNT(*) AS n FROM ai_logs WHERE chat_id = ? AND at > ?'),
  lastAiReply: db.prepare('SELECT at FROM ai_logs WHERE chat_id = ? AND reply IS NOT NULL AND error IS NULL ORDER BY at DESC, id DESC LIMIT 1'),
  lastMessages: db.prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY ts DESC, id DESC LIMIT ?'),
  addNotice: db.prepare('INSERT OR IGNORE INTO ai_notice(number_id, chat_id, day, kind) VALUES (?, ?, ?, ?)'),
  addAlert: db.prepare('INSERT OR IGNORE INTO ai_alerts(number_id, day, level, at) VALUES (?, ?, ?, ?)'),
  insertAiLog: db.prepare('INSERT INTO ai_logs(number_id, chat_id, prompt, reply, tokens, model, error, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
  searchProducts: db.prepare('SELECT * FROM products WHERE number_id = ? AND active = 1 AND (name LIKE ? OR sku LIKE ?) ORDER BY name LIMIT 20'),
  productBySku: db.prepare('SELECT * FROM products WHERE number_id = ? AND sku = ? AND active = 1'),
  decStock: db.prepare('UPDATE products SET stock = stock - ? WHERE number_id = ? AND sku = ?'),
  insertOrder: db.prepare('INSERT INTO orders(number_id, chat_id, code, items_json, total, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
  setChatState: db.prepare('UPDATE chats SET state = ? WHERE id = ?'),
  metaGet: db.prepare('SELECT value FROM meta WHERE key = ?'),
  insertActivity: db.prepare('INSERT INTO activity (user_id, number_id, action, detail, at) VALUES (?, ?, ?, ?, ?)'),
  insertActivityForTenant: db.prepare('INSERT INTO activity (user_id, number_id, action, detail, at, tenant_id) VALUES (?, ?, ?, ?, ?, ?)'),
  activityRecent: db.prepare('SELECT a.*, u.username, n.name AS number_name FROM activity a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN numbers n ON n.id = a.number_id ORDER BY a.id DESC LIMIT ?'),
  touchNumber: db.prepare('UPDATE numbers SET last_seen = ? WHERE id = ?'),
  metaSet: db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
  userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
  userById: db.prepare('SELECT id, username, role FROM users WHERE id = ?'),
  allUsers: db.prepare('SELECT id, username, role FROM users ORDER BY id'),
  insertUser: db.prepare('INSERT INTO users (username, pass, role, created_at) VALUES (?, ?, ?, ?)'),
  deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
  setUserPass: db.prepare('UPDATE users SET pass = ? WHERE id = ?'),
  setUsername: db.prepare('UPDATE users SET username = ? WHERE id = ?'),
  deleteAllSessions: db.prepare("UPDATE sessions SET revoked_at=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) WHERE user_id = ? AND revoked_at IS NULL"),

  insertSession: db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)'),
  sessionByToken: db.prepare('SELECT s.id AS token, s.expires_at, u.id, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.revoked_at IS NULL'),
  deleteSession: db.prepare("UPDATE sessions SET revoked_at=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) WHERE id = ? AND revoked_at IS NULL"),

  allNumbers: db.prepare('SELECT * FROM numbers ORDER BY id'),
  numbersByOwner: db.prepare('SELECT * FROM numbers WHERE owner_id = ? ORDER BY id'),
  numberById: db.prepare('SELECT * FROM numbers WHERE id = ?'),
  insertNumber: db.prepare('INSERT INTO numbers (phone, name, owner_id, created_at) VALUES (?, ?, ?, ?)'),
  updateNumberStatus: db.prepare('UPDATE numbers SET status = ? WHERE id = ?'),
  deleteNumber: db.prepare('DELETE FROM numbers WHERE id = ?'),

  chatsByNumber: db.prepare('SELECT * FROM chats WHERE number_id = ? ORDER BY last_at DESC LIMIT 200'),
  chatById: db.prepare('SELECT c.*, ct.name AS local_name FROM chats c LEFT JOIN contacts_v2 ct ON ct.number_id = c.number_id AND ct.jid = c.jid WHERE c.id = ?'),
  inboxChats: db.prepare(`SELECT c.*, u.username AS assignee_name, ct.name AS local_name,
    m.body AS last_body, m.kind AS last_kind, m.from_me AS last_from_me
    FROM chats c LEFT JOIN users u ON u.id = c.assignee_id
    LEFT JOIN contacts_v2 ct ON ct.number_id = c.number_id AND ct.jid = c.jid
    LEFT JOIN messages m ON m.id = (SELECT id FROM messages WHERE chat_id = c.id ORDER BY ts DESC, id DESC LIMIT 1)
    WHERE c.number_id = @numberId AND (@mine = 0 OR c.assignee_id = @userId)
    AND (@queue != 'unread' OR c.unread > 0)
    AND (@queue != 'unassigned' OR c.assignee_id IS NULL)
    AND (@status = '' OR c.status = @status)
    ORDER BY c.pinned DESC, c.last_at DESC, c.id DESC LIMIT 200`),
  setChatStatus: db.prepare('UPDATE chats SET status = ? WHERE id = ?'),
  reopenChat: db.prepare("UPDATE chats SET status = 'new' WHERE id = ? AND status = 'resolved'"),
  deleteChat: db.prepare('DELETE FROM chats WHERE id = ?'),
  chatByJid: db.prepare('SELECT * FROM chats WHERE number_id = ? AND jid = ?'),
  insertChat: db.prepare('INSERT INTO chats (number_id, jid, name, last_at) VALUES (?, ?, ?, ?)'),
  insertChatForTenant: db.prepare('INSERT INTO chats (number_id, jid, name, last_at, tenant_id) VALUES (?, ?, ?, ?, ?)'),
  touchChat: db.prepare('UPDATE chats SET last_at = ?, name = COALESCE(?, name) WHERE id = ?'),
  bumpUnread: db.prepare('UPDATE chats SET unread = unread + 1 WHERE id = ?'),
  clearUnread: db.prepare('UPDATE chats SET unread = 0 WHERE id = ?'),
  setChatUnread: db.prepare('UPDATE chats SET unread = ? WHERE id = ?'),

  setChatPn: db.prepare('UPDATE chats SET pn = ? WHERE id = ?'),
  setChatName: db.prepare('UPDATE chats SET name = ? WHERE id = ?'),
  setChatPushName: db.prepare('UPDATE chats SET push_name = ? WHERE id = ?'),
  upsertContact: db.prepare('INSERT INTO contacts_v2 (number_id, jid, name, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(number_id, jid) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at'),
  contactByJid: db.prepare('SELECT * FROM contacts_v2 WHERE number_id = ? AND jid = ?'),
  deleteContact: db.prepare('DELETE FROM contacts_v2 WHERE number_id = ? AND jid = ?'),
  setAssignee: db.prepare('UPDATE chats SET assignee_id = ? WHERE id = ?'),
  insertNotification: db.prepare('INSERT INTO notifications (user_id, number_id, chat_id, created_at) VALUES (?, ?, ?, ?)'),
  insertNotificationForTenant: db.prepare('INSERT INTO notifications (user_id, number_id, chat_id, created_at, tenant_id) VALUES (?, ?, ?, ?, ?)'),
  notificationsFor: db.prepare('SELECT f.*, c.name, c.push_name, c.pn, c.jid FROM notifications f JOIN chats c ON c.id = f.chat_id WHERE f.user_id = ? ORDER BY f.id DESC LIMIT ?'),
  markNotifRead: db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL'),
  unreadNotifCount: db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL'),
  chatsByAssignee: db.prepare('SELECT * FROM chats WHERE number_id = ? AND assignee_id = ? ORDER BY last_at DESC LIMIT 200'),
  insertMessage: db.prepare('INSERT OR IGNORE INTO messages (number_id, chat_id, from_me, body, ts, agent_id, kind, media_path, mime, wa_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
  insertMessageForTenant: db.prepare('INSERT OR IGNORE INTO messages (number_id, chat_id, from_me, body, ts, agent_id, kind, media_path, mime, wa_id, tenant_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
  insertMessageWithSource: db.prepare('INSERT OR IGNORE INTO messages (number_id, chat_id, from_me, body, ts, agent_id, kind, media_path, mime, wa_id, tenant_id, analytics_source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
  setMessageMedia: db.prepare('UPDATE messages SET media_path = ? WHERE id = ?'),
  messageByWaId: db.prepare('SELECT * FROM messages WHERE number_id = ? AND wa_id = ?'),
  messagesByChat: db.prepare('SELECT * FROM (SELECT * FROM messages WHERE chat_id = ? AND ts < ? ORDER BY ts DESC LIMIT 500) ORDER BY ts ASC'),

  rulesByNumber: db.prepare('SELECT * FROM rules WHERE number_id = ? AND enabled = 1 ORDER BY priority ASC, id ASC'),
  allRulesByNumber: db.prepare('SELECT * FROM rules WHERE number_id = ? ORDER BY priority ASC, id ASC'),
  insertRule: db.prepare('INSERT INTO rules (number_id, match_type, pattern, reply, priority) VALUES (?, ?, ?, ?, ?)'),
  toggleRule: db.prepare('UPDATE rules SET enabled = ?, slow = 0 WHERE id = ?'),
  markRuleSlow: db.prepare('UPDATE rules SET slow = 1 WHERE id = ?'),
  deleteRule: db.prepare('DELETE FROM rules WHERE id = ?'),

  allTemplates: db.prepare('SELECT * FROM templates ORDER BY id DESC'),
  insertTemplate: db.prepare('INSERT INTO templates (number_id, title, body) VALUES (?, ?, ?)'),
  deleteTemplate: db.prepare('DELETE FROM templates WHERE id = ?'),

  allLabels: db.prepare('SELECT * FROM labels ORDER BY name'),
  insertLabel: db.prepare('INSERT INTO labels (name, color) VALUES (?, ?)'),
  deleteLabel: db.prepare('DELETE FROM labels WHERE id = ?'),
  labelsForChat: db.prepare('SELECT l.* FROM labels l JOIN chat_labels cl ON cl.label_id = l.id WHERE cl.chat_id = ?'),
  addChatLabel: db.prepare('INSERT OR IGNORE INTO chat_labels (chat_id, label_id) VALUES (?, ?)'),
  removeChatLabel: db.prepare('DELETE FROM chat_labels WHERE chat_id = ? AND label_id = ?'),
};
