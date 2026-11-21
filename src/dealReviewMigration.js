export function migrateDealReview(db) {
  db.exec(`
    CREATE TABLE deal_job_notices (
      tenant_id TEXT NOT NULL REFERENCES tenants(id), notice_key TEXT NOT NULL,
      deal_id INTEGER REFERENCES deals(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, at INTEGER NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
      delivered_at INTEGER, PRIMARY KEY(tenant_id,notice_key)
    );
    CREATE TRIGGER deal_job_notices_scope BEFORE INSERT ON deal_job_notices
      WHEN NEW.deal_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM deals WHERE id=NEW.deal_id AND tenant_id=NEW.tenant_id)
      BEGIN SELECT RAISE(ABORT,'deal notice tenant mismatch'); END;
    CREATE INDEX deals_review_queue ON deals(tenant_id,state,due_sla_at,id);
    CREATE INDEX deal_events_history ON deal_events(deal_id,type,id DESC);
  `);
}
