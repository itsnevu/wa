export function migrateDealEvidenceSettings(db) {
  db.exec(`CREATE TABLE deal_evidence_settings (
    tenant_id TEXT PRIMARY KEY NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    enabled INTEGER NOT NULL CHECK (enabled IN (0,1)),
    signing_key TEXT NOT NULL CHECK (length(signing_key)=64)
  )`);
}
