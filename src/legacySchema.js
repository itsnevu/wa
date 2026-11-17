// Frozen legacy bootstrap; called only by the explicit migration runner.
import { hashPassword } from './passwords.js';
import { randomUUID } from 'node:crypto';
export function bootstrapLegacy(db, config) {
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
// Expand-only registry. Existing paths are retained for compatibility with message payloads.
// Ownership is checked again against messages/chats/numbers on every issuance and download.
db.exec(`CREATE TABLE IF NOT EXISTS media_records (
  uuid TEXT PRIMARY KEY,
  message_id INTEGER NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
  number_id INTEGER NOT NULL REFERENCES numbers(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_records_number ON media_records(number_id);`);
db.exec('CREATE INDEX IF NOT EXISTS idx_messages_media_path ON messages(media_path) WHERE media_path IS NOT NULL');
const registerMedia = db.prepare(`INSERT OR IGNORE INTO media_records(uuid,message_id,number_id,storage_path,created_at)
  VALUES (?,?,?,?,?)`);
function backfillMedia() {
  return db.transaction(() => {
    const rows = db.prepare(`SELECT m.id,m.number_id,m.media_path FROM messages m
      JOIN chats c ON c.id=m.chat_id JOIN numbers n ON n.id=c.number_id
      WHERE m.media_path IS NOT NULL AND m.media_path<>'' AND m.number_id=c.number_id
      AND NOT EXISTS (SELECT 1 FROM media_records r WHERE r.message_id=m.id)`).all();
    for (const m of rows) registerMedia.run(randomUUID(), m.id, m.number_id, m.media_path, Date.now());
    return rows.length;
  }).immediate();
}
backfillMedia();
if (!cols('ai_settings').includes('business_profile')) db.exec("ALTER TABLE ai_settings ADD COLUMN business_profile TEXT NOT NULL DEFAULT '{}'");
if (!cols('rules').includes('slow')) db.exec('ALTER TABLE rules ADD COLUMN slow INTEGER DEFAULT 0');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_wa ON messages(number_id, wa_id) WHERE wa_id IS NOT NULL');

const DEFAULT_STOP_REPLY = 'Baik, saya sambungkan ke agen kami. Mohon tunggu sebentar ya.';
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

return { backfillMedia, DEFAULT_STOP_REPLY };
}
