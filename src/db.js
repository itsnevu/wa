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
if (!cols('chats').includes('pn')) db.exec('ALTER TABLE chats ADD COLUMN pn TEXT');
if (!cols('numbers').includes('last_seen')) db.exec('ALTER TABLE numbers ADD COLUMN last_seen INTEGER');
if (!cols('chats').includes('assignee_id')) db.exec('ALTER TABLE chats ADD COLUMN assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL');
if (!cols('messages').includes('kind')) db.exec("ALTER TABLE messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'text'");
if (!cols('messages').includes('media_path')) db.exec('ALTER TABLE messages ADD COLUMN media_path TEXT');
if (!cols('messages').includes('mime')) db.exec('ALTER TABLE messages ADD COLUMN mime TEXT');
if (!cols('messages').includes('wa_id')) db.exec('ALTER TABLE messages ADD COLUMN wa_id TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_wa ON messages(number_id, wa_id) WHERE wa_id IS NOT NULL');

const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
if (count === 0) {
  db.prepare('INSERT INTO users (username, pass, role, created_at) VALUES (?, ?, ?, ?)')
    .run(config.adminUser, hashPassword(config.adminPass), 'admin', Date.now());
  console.log(`[db] admin dibuat: ${config.adminUser}`);
}

export const q = {
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
  chatById: db.prepare('SELECT * FROM chats WHERE id = ?'),
  deleteChat: db.prepare('DELETE FROM chats WHERE id = ?'),
  chatByJid: db.prepare('SELECT * FROM chats WHERE number_id = ? AND jid = ?'),
  insertChat: db.prepare('INSERT INTO chats (number_id, jid, name, last_at) VALUES (?, ?, ?, ?)'),
  touchChat: db.prepare('UPDATE chats SET last_at = ?, name = COALESCE(?, name) WHERE id = ?'),
  bumpUnread: db.prepare('UPDATE chats SET unread = unread + 1 WHERE id = ?'),
  clearUnread: db.prepare('UPDATE chats SET unread = 0 WHERE id = ?'),
  setChatUnread: db.prepare('UPDATE chats SET unread = ? WHERE id = ?'),

  setChatPn: db.prepare('UPDATE chats SET pn = ? WHERE id = ?'),
  setChatName: db.prepare('UPDATE chats SET name = ? WHERE id = ?'),
  setAssignee: db.prepare('UPDATE chats SET assignee_id = ? WHERE id = ?'),
  insertNotification: db.prepare('INSERT INTO notifications (user_id, number_id, chat_id, created_at) VALUES (?, ?, ?, ?)'),
  notificationsFor: db.prepare('SELECT f.*, c.name, c.pn, c.jid FROM notifications f JOIN chats c ON c.id = f.chat_id WHERE f.user_id = ? ORDER BY f.id DESC LIMIT ?'),
  markNotifRead: db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL'),
  unreadNotifCount: db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL'),
  chatsByAssignee: db.prepare('SELECT * FROM chats WHERE number_id = ? AND assignee_id = ? ORDER BY last_at DESC LIMIT 200'),
  insertMessage: db.prepare('INSERT OR IGNORE INTO messages (number_id, chat_id, from_me, body, ts, agent_id, kind, media_path, mime, wa_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
  messageByWaId: db.prepare('SELECT * FROM messages WHERE number_id = ? AND wa_id = ?'),
  messagesByChat: db.prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY ts ASC LIMIT 500'),

  rulesByNumber: db.prepare('SELECT * FROM rules WHERE number_id = ? AND enabled = 1 ORDER BY priority ASC, id ASC'),
  allRulesByNumber: db.prepare('SELECT * FROM rules WHERE number_id = ? ORDER BY priority ASC, id ASC'),
  insertRule: db.prepare('INSERT INTO rules (number_id, match_type, pattern, reply, priority) VALUES (?, ?, ?, ?, ?)'),
  toggleRule: db.prepare('UPDATE rules SET enabled = ? WHERE id = ?'),
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
