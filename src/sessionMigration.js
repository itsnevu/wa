export function migrateSessionSchema(db){
  if(!db.inTransaction)throw Error('Session migration requires BEGIN IMMEDIATE');
  // Old bearer tokens are intentionally invalidated, never silently promoted.
  db.exec(`DROP TABLE sessions;
    ALTER TABLE users ADD COLUMN platform_role TEXT CHECK(platform_role IS NULL OR platform_role='platform_admin');
    ALTER TABLE users ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0;
    CREATE TABLE sessions(
      id TEXT PRIMARY KEY NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      active_tenant_id TEXT REFERENCES tenants(id),
      created_at INTEGER NOT NULL DEFAULT 0,
      last_seen_at INTEGER NOT NULL DEFAULT 0,
      rotated_from TEXT,
      revoked_at INTEGER,
      ua_hash TEXT NOT NULL DEFAULT '',
      expires_at INTEGER NOT NULL,
      auth_version INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX sessions_user_active ON sessions(user_id,revoked_at,expires_at);
    CREATE INDEX sessions_expiry ON sessions(expires_at);
    CREATE TRIGGER user_auth_change AFTER UPDATE OF role,platform_role ON users
    WHEN NEW.role IS NOT OLD.role OR NEW.platform_role IS NOT OLD.platform_role
    BEGIN
      UPDATE users SET auth_version=auth_version+1 WHERE id=NEW.id;
      UPDATE sessions SET revoked_at=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) WHERE user_id=NEW.id AND revoked_at IS NULL;
    END;`);
  for(const event of ['INSERT','DELETE','UPDATE']){
    const id=event==='DELETE'?'OLD.user_id':'NEW.user_id';
    const condition=event==='UPDATE'?" WHEN NEW.role IS NOT OLD.role OR NEW.tenant_id IS NOT OLD.tenant_id OR NEW.user_id IS NOT OLD.user_id":'';
    db.exec(`CREATE TRIGGER member_auth_${event} AFTER ${event} ON tenant_members${condition} BEGIN
      UPDATE users SET auth_version=auth_version+1 WHERE id=${id};
      ${event==='UPDATE'?'UPDATE sessions SET revoked_at=CAST((julianday(\'now\')-2440587.5)*86400000 AS INTEGER) WHERE user_id=NEW.user_id AND revoked_at IS NULL;':''}
    END;`);
  }
}
