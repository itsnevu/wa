export function migratePlatformSchema(db){
  const dependent=db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name!='users' AND sql LIKE '%users%'").all();
  for(const trigger of dependent)db.exec(`DROP TRIGGER "${trigger.name.replaceAll('"','""')}"`);
  const original=db.prepare("SELECT sql FROM sqlite_master WHERE name='users'").get().sql;
  const create=original.replace(/CREATE TABLE\s+users/i,'CREATE TABLE __platform_users').replace(/platform_role TEXT CHECK\(platform_role IS NULL OR platform_role='platform_admin'\)/,"platform_role TEXT NOT NULL DEFAULT 'none' CHECK(platform_role IN ('none','admin'))");
  if(create===original||!create.includes("IN ('none','admin')"))throw Error('Unrecognized users role schema');
  db.exec(create);
  const cols=db.prepare('PRAGMA table_info(users)').all().map(c=>c.name);
  db.exec(`INSERT INTO __platform_users(${cols.join(',')}) SELECT ${cols.map(c=>c==='platform_role'?"CASE WHEN platform_role='platform_admin' THEN 'admin' ELSE 'none' END":c).join(',')} FROM users`);
  db.exec(`DROP TABLE users; ALTER TABLE __platform_users RENAME TO users;
    ALTER TABLE users ADD COLUMN email TEXT COLLATE NOCASE;
    CREATE UNIQUE INDEX user_email ON users(email) WHERE email IS NOT NULL;
    ALTER TABLE tenants ADD COLUMN slug TEXT COLLATE NOCASE;
    UPDATE tenants SET slug=lower(id);
    CREATE UNIQUE INDEX tenant_slug ON tenants(slug);
    ALTER TABLE tenants ADD COLUMN deleted_at INTEGER;
    ALTER TABLE tenants ADD COLUMN owner_email TEXT;
    ALTER TABLE tenants ADD COLUMN quota_json TEXT NOT NULL DEFAULT '{}';
    ALTER TABLE sessions ADD COLUMN platform_grant_id TEXT;
    ALTER TABLE sessions ADD COLUMN revocation_reason TEXT;
    CREATE TABLE platform_grants(id TEXT PRIMARY KEY NOT NULL,actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),reason TEXT NOT NULL,capabilities_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,revoked_at INTEGER,last_seen_at INTEGER NOT NULL);
    CREATE INDEX grants_actor ON platform_grants(actor_user_id,revoked_at);
    CREATE INDEX grants_tenant ON platform_grants(tenant_id,revoked_at);
    CREATE TABLE platform_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,at INTEGER NOT NULL,actor_user_id INTEGER,
      actor_platform_role TEXT NOT NULL,action TEXT NOT NULL,tenant_id TEXT,target_type TEXT,target_id TEXT,
      before_json TEXT,after_json TEXT,ip TEXT,ua_hash TEXT,reason TEXT);
    CREATE INDEX platform_audit_tenant ON platform_audit(tenant_id,id);
    CREATE TRIGGER platform_audit_no_replace BEFORE INSERT ON platform_audit WHEN EXISTS(SELECT 1 FROM platform_audit WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'audit append-only'); END;
    CREATE TRIGGER platform_audit_no_update BEFORE UPDATE ON platform_audit BEGIN SELECT RAISE(ABORT,'audit append-only'); END;
    CREATE TRIGGER platform_audit_no_delete BEFORE DELETE ON platform_audit BEGIN SELECT RAISE(ABORT,'audit append-only'); END;
    CREATE TABLE tenant_invitations(id TEXT PRIMARY KEY NOT NULL,tenant_id TEXT NOT NULL REFERENCES tenants(id),email TEXT NOT NULL COLLATE NOCASE,
      role TEXT NOT NULL CHECK(role='owner'),token_hash TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,accepted_at INTEGER);
    CREATE UNIQUE INDEX invitation_owner ON tenant_invitations(tenant_id) WHERE accepted_at IS NULL;
    UPDATE users SET auth_version=auth_version+1 WHERE platform_role='admin';
    UPDATE sessions SET revoked_at=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) WHERE user_id IN (SELECT id FROM users WHERE platform_role='admin');
    CREATE TRIGGER user_auth_change AFTER UPDATE OF role,platform_role ON users
    WHEN NEW.role IS NOT OLD.role OR NEW.platform_role IS NOT OLD.platform_role BEGIN
      UPDATE users SET auth_version=auth_version+1 WHERE id=NEW.id;
      UPDATE sessions SET revoked_at=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) WHERE user_id=NEW.id AND revoked_at IS NULL;
    END;
    CREATE TRIGGER platform_role_grants AFTER UPDATE OF platform_role ON users WHEN OLD.platform_role='admin' AND NEW.platform_role!='admin' BEGIN
      INSERT INTO platform_audit(at,actor_user_id,actor_platform_role,action,tenant_id,target_type,target_id,before_json,after_json,ip,ua_hash,reason)
      SELECT CAST((julianday('now')-2440587.5)*86400000 AS INTEGER),OLD.id,OLD.platform_role,'grant_revoked',tenant_id,'grant',id,
        json_object('revoked_at',revoked_at),json_object('revoked',1),'internal','','platform_role_changed' FROM platform_grants WHERE actor_user_id=OLD.id AND revoked_at IS NULL;
      UPDATE platform_grants SET revoked_at=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) WHERE actor_user_id=OLD.id AND revoked_at IS NULL;
      UPDATE sessions SET platform_grant_id=NULL,active_tenant_id=NULL WHERE user_id=OLD.id AND platform_grant_id IS NOT NULL;
    END;
  `);
  for(const trigger of dependent)db.exec(trigger.sql);
}
