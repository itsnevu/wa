// v9: analytics corrections. Per-weekday operating schedule + holidays, idempotent unanswered marks
// (written by a background job, never by a read request) and a rescan queue for DP reminders that were
// skipped in group chats (delivery waits for buyer_jid in v10).
export function migrateDealAnalyticsV9(db,{businessStart=0,businessEnd=0}={}) {
  db.exec(`
    CREATE TABLE tenant_business_hours (
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),
      open_min INTEGER NOT NULL CHECK(open_min BETWEEN 0 AND 1440),
      close_min INTEGER NOT NULL CHECK(close_min BETWEEN 0 AND 1440),
      closed INTEGER NOT NULL DEFAULT 0 CHECK(closed IN (0,1)),
      PRIMARY KEY(tenant_id,weekday)
    );
    CREATE TABLE tenant_holidays (
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      day TEXT NOT NULL CHECK(day GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
      label TEXT CHECK(label IS NULL OR length(label) <= 80),
      PRIMARY KEY(tenant_id,day)
    );
    CREATE TABLE deal_unanswered_marks (
      deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      bucket TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY(deal_id,bucket)
    );
    CREATE TABLE dp_reminder_rescan (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'awaiting_buyer_jid' CHECK(status IN ('awaiting_buyer_jid','sent','dropped')),
      created_at INTEGER NOT NULL,
      UNIQUE(deal_id,kind)
    );
    CREATE INDEX dp_reminder_rescan_status ON dp_reminder_rescan(tenant_id,status);
  `);
  // Default schedule copied from the server config so behaviour is unchanged until a tenant edits it.
  // Equal start and end meant "24 hours" in v8.
  const open=businessStart===businessEnd?0:businessStart*60, close=businessStart===businessEnd?1440:businessEnd*60;
  const seed=db.prepare('INSERT INTO tenant_business_hours(tenant_id,weekday,open_min,close_min,closed) VALUES(?,?,?,?,0)');
  for (const {id} of db.prepare('SELECT id FROM tenants').all()) for (let w=0;w<7;w++) seed.run(id,w,open,close);
  // Existing facts are carried over so the job does not re-record them.
  db.exec(`
    INSERT OR IGNORE INTO deal_unanswered_marks(deal_id,bucket,created_at)
      SELECT deal_id,'inbound:'||json_extract(payload_json,'$.inbound_id'),at FROM deal_events
      WHERE type='analytics_unanswered' AND json_extract(payload_json,'$.inbound_id') IS NOT NULL;
    INSERT OR IGNORE INTO dp_reminder_rescan(tenant_id,deal_id,kind,status,created_at)
      SELECT d.tenant_id,e.deal_id,coalesce(json_extract(e.payload_json,'$.kind'),'unknown'),'awaiting_buyer_jid',e.at
      FROM deal_events e JOIN deals d ON d.id=e.deal_id WHERE e.type='dp_reminder_skipped';
  `);
}
