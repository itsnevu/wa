import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';
import { hashPassword } from './passwords.js';

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(path.join(config.dataDir, 'media'), { recursive: true });
fs.mkdirSync(path.join(config.dataDir, 'sessions'), { recursive: true });

export const db = new Database(path.join(config.dataDir, 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, number_id INTEGER, action TEXT NOT NULL, detail TEXT, at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  pass TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'agent',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS numbers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'offline',
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS send_count (
  number_id INTEGER NOT NULL REFERENCES numbers(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (number_id, day)
);

CREATE TABLE IF NOT EXISTS chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number_id INTEGER NOT NULL REFERENCES numbers(id) ON DELETE CASCADE,
  jid TEXT NOT NULL,
  name TEXT,
  last_at INTEGER NOT NULL DEFAULT 0,
  unread INTEGER NOT NULL DEFAULT 0,
  UNIQUE (number_id, jid)
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number_id INTEGER NOT NULL REFERENCES numbers(id) ON DELETE CASCADE,
  chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  from_me INTEGER NOT NULL DEFAULT 0,
  body TEXT NOT NULL DEFAULT '',
  ts INTEGER NOT NULL,
  agent_id INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, ts);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  number_id INTEGER NOT NULL REFERENCES numbers(id) ON DELETE CASCADE,
  chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  read_at INTEGER
);

CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number_id INTEGER NOT NULL REFERENCES numbers(id) ON DELETE CASCADE,
  match_type TEXT NOT NULL DEFAULT 'contains',
  pattern TEXT NOT NULL,
  reply TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number_id INTEGER REFERENCES numbers(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS labels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#64748b'
);

CREATE TABLE IF NOT EXISTS chat_labels (
  chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  label_id INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (chat_id, label_id)
);
`);

const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
if (!cols('chats').includes('ai_paused_until')) db.exec('ALTER TABLE chats ADD COLUMN ai_paused_until INTEGER');
if (!cols('chats').includes('state')) db.exec("ALTER TABLE chats ADD COLUMN state TEXT NOT NULL DEFAULT 'active'");
db.exec(`
CREATE TABLE IF NOT EXISTS ai_settings (
  number_id INTEGER PRIMARY KEY REFERENCES numbers(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0, provider TEXT NOT NULL DEFAULT 'ollama',
  base_url TEXT, api_key TEXT, model TEXT NOT NULL DEFAULT '', system_prompt TEXT NOT NULL DEFAULT '',
  max_per_hour INTEGER NOT NULL DEFAULT 6, min_gap_sec INTEGER NOT NULL DEFAULT 20,
  daily_tokens INTEGER NOT NULL DEFAULT 200000, warn_percent INTEGER NOT NULL DEFAULT 80,
  stop_reply TEXT NOT NULL DEFAULT '', escalate_keywords TEXT NOT NULL DEFAULT '',
  ai_paused_minutes INTEGER NOT NULL DEFAULT 30
);
CREATE TABLE IF NOT EXISTS ai_usage (
  number_id INTEGER NOT NULL REFERENCES numbers(id) ON DELETE CASCADE, day TEXT NOT NULL,
  tokens INTEGER NOT NULL DEFAULT 0, replies INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(number_id, day)
);
CREATE TABLE IF NOT EXISTS ai_notice (
  number_id INTEGER NOT NULL REFERENCES numbers(id) ON DELETE CASCADE,
  chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE, day TEXT NOT NULL, kind TEXT NOT NULL,
  PRIMARY KEY(number_id, chat_id, day, kind)
);
CREATE TABLE IF NOT EXISTS ai_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, number_id INTEGER NOT NULL REFERENCES numbers(id) ON DELETE CASCADE,
  day TEXT NOT NULL, level TEXT NOT NULL, at INTEGER NOT NULL, UNIQUE(number_id, day, level)
);
CREATE TABLE IF NOT EXISTS ai_seen (wa_id TEXT PRIMARY KEY, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS ai_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, number_id INTEGER NOT NULL REFERENCES numbers(id) ON DELETE CASCADE,
  chat_id INTEGER REFERENCES chats(id) ON DELETE SET NULL, prompt TEXT, reply TEXT,
  tokens INTEGER NOT NULL DEFAULT 0, model TEXT, error TEXT, at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_logs_number_at ON ai_logs(number_id, at);
CREATE INDEX IF NOT EXISTS idx_ai_logs_chat_at ON ai_logs(chat_id, at);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT, number_id INTEGER NOT NULL REFERENCES numbers(id) ON DELETE CASCADE,
  sku TEXT NOT NULL UNIQUE, name TEXT NOT NULL, price REAL NOT NULL CHECK(price >= 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0), description TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT, number_id INTEGER NOT NULL REFERENCES numbers(id) ON DELETE CASCADE,
  chat_id INTEGER REFERENCES chats(id) ON DELETE SET NULL, code TEXT NOT NULL UNIQUE,
  items_json TEXT NOT NULL, total REAL NOT NULL, status TEXT NOT NULL DEFAULT 'new', created_at INTEGER NOT NULL
);
`);
if (!cols('chats').includes('pinned')) db.exec('ALTER TABLE chats ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0');
if (!cols('chats').includes('pn')) db.exec('ALTER TABLE chats ADD COLUMN pn TEXT');
if (!cols('chats').includes('push_name')) db.exec('ALTER TABLE chats ADD COLUMN push_name TEXT');
db.exec('CREATE TABLE IF NOT EXISTS contacts (jid TEXT PRIMARY KEY, name TEXT NOT NULL, updated_at INTEGER NOT NULL)');
db.exec(`CREATE TABLE IF NOT EXISTS contacts_v2 (number_id INTEGER NOT NULL, jid TEXT NOT NULL, name TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (number_id, jid))`);
// Nama lama bersifat global; salin sekali ke tiap nomor yang sudah punya chat dengan jid tersebut.
// Tabel contacts lama dibiarkan sebagai arsip dan tidak lagi dipakai.
if (!db.prepare("SELECT 1 FROM meta WHERE key = 'contacts_v2_migrated'").get()) {
  db.transaction(() => {
    db.exec(`INSERT OR IGNORE INTO contacts_v2 (number_id, jid, name, updated_at)
      SELECT c.number_id, ct.jid, ct.name, ct.updated_at FROM contacts ct JOIN chats c ON c.jid = ct.jid`);
    db.prepare("INSERT INTO meta (key, value) VALUES ('contacts_v2_migrated', ?)").run(String(Date.now()));
  })();
}
if (!cols('numbers').includes('last_seen')) db.exec('ALTER TABLE numbers ADD COLUMN last_seen INTEGER');
if (!cols('chats').includes('assignee_id')) db.exec('ALTER TABLE chats ADD COLUMN assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL');
if (!cols('chats').includes('status')) db.exec("ALTER TABLE chats ADD COLUMN status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','in_progress','resolved'))");
if (!cols('messages').includes('kind')) db.exec("ALTER TABLE messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'text'");
if (!cols('messages').includes('media_path')) db.exec('ALTER TABLE messages ADD COLUMN media_path TEXT');
if (!cols('messages').includes('mime')) db.exec('ALTER TABLE messages ADD COLUMN mime TEXT');
if (!cols('messages').includes('wa_id')) db.exec('ALTER TABLE messages ADD COLUMN wa_id TEXT');
if (!cols('ai_settings').includes('business_profile')) db.exec("ALTER TABLE ai_settings ADD COLUMN business_profile TEXT NOT NULL DEFAULT '{}'");
if (!cols('rules').includes('slow')) db.exec('ALTER TABLE rules ADD COLUMN slow INTEGER DEFAULT 0');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_wa ON messages(number_id, wa_id) WHERE wa_id IS NOT NULL');

export const DEFAULT_STOP_REPLY = 'Baik, saya sambungkan ke agen kami. Mohon tunggu sebentar ya.';
// Sekali saja: stop_reply kosong membuat pelanggan tidak menerima apa pun saat AI berhenti.
if (!db.prepare("SELECT 1 FROM meta WHERE key = 'ai_stop_reply_default'").get()) {
  db.transaction(() => {
    db.prepare("UPDATE ai_settings SET stop_reply = ? WHERE stop_reply = ''").run(DEFAULT_STOP_REPLY);
    db.prepare("INSERT INTO meta (key, value) VALUES ('ai_stop_reply_default', ?)").run(String(Date.now()));
  })();
}

const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
if (count === 0) {
  db.prepare('INSERT INTO users (username, pass, role, created_at) VALUES (?, ?, ?, ?)')
    .run(config.adminUser, hashPassword(config.adminPass), 'admin', Date.now());
  console.log(`[db] admin dibuat: ${config.adminUser}`);
}

export const q = {
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
  deleteAllSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),

  insertSession: db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)'),
  sessionByToken: db.prepare('SELECT s.token, s.expires_at, u.id, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?'),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token = ?'),

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
  notificationsFor: db.prepare('SELECT f.*, c.name, c.push_name, c.pn, c.jid FROM notifications f JOIN chats c ON c.id = f.chat_id WHERE f.user_id = ? ORDER BY f.id DESC LIMIT ?'),
  markNotifRead: db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL'),
  unreadNotifCount: db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL'),
  chatsByAssignee: db.prepare('SELECT * FROM chats WHERE number_id = ? AND assignee_id = ? ORDER BY last_at DESC LIMIT 200'),
  insertMessage: db.prepare('INSERT OR IGNORE INTO messages (number_id, chat_id, from_me, body, ts, agent_id, kind, media_path, mime, wa_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
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
