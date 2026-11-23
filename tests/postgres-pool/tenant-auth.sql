CREATE ROLE auth_role NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE app_role NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE app_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS PASSWORD 'fixture-only-password';
GRANT auth_role,app_role TO app_login WITH INHERIT FALSE;
CREATE SCHEMA tenant_auth;
CREATE SCHEMA tenant_data;
REVOKE ALL ON SCHEMA tenant_auth,tenant_data FROM PUBLIC;
CREATE TABLE tenant_auth.sessions (
  token_hash text PRIMARY KEY,user_id bigint NOT NULL,tenant_id uuid,
  expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX sessions_tenant_user ON tenant_auth.sessions(tenant_id,user_id);
CREATE TABLE tenant_auth.tenant_members (
  user_id bigint NOT NULL,tenant_id uuid NOT NULL,
  role text NOT NULL CHECK(role IN ('owner','tenant_admin','agent')),PRIMARY KEY(user_id,tenant_id)
);
CREATE TABLE tenant_data.tenants (id uuid PRIMARY KEY,status text NOT NULL DEFAULT 'active',deleted_at timestamptz);
CREATE TABLE tenant_data.session_audit (
  tenant_id uuid NOT NULL REFERENCES tenant_data.tenants,user_id bigint NOT NULL,prior_tenant uuid NOT NULL
);
CREATE TABLE tenant_data.send_quota (
  tenant_id uuid NOT NULL REFERENCES tenant_data.tenants,number_id bigint NOT NULL,
  day date NOT NULL,used integer NOT NULL CHECK(used>=0),PRIMARY KEY(tenant_id,number_id,day)
);
REVOKE ALL ON ALL TABLES IN SCHEMA tenant_auth,tenant_data FROM PUBLIC;
GRANT USAGE ON SCHEMA tenant_auth TO auth_role;
GRANT SELECT (token_hash,user_id,tenant_id,expires_at,created_at) ON tenant_auth.sessions TO auth_role;
GRANT UPDATE (token_hash,tenant_id,expires_at) ON tenant_auth.sessions TO auth_role;
GRANT SELECT (user_id,tenant_id,role) ON tenant_auth.tenant_members TO auth_role;
GRANT USAGE ON SCHEMA tenant_data TO app_role;
GRANT SELECT ON tenant_data.tenants,tenant_data.send_quota TO app_role;
GRANT INSERT ON tenant_data.session_audit,tenant_data.send_quota TO app_role;
GRANT UPDATE (used) ON tenant_data.send_quota TO app_role;
CREATE FUNCTION tenant_data.active_tenant() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('app.tenant_id',true),'')::uuid $$;
REVOKE ALL ON FUNCTION tenant_data.active_tenant() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant_data.active_tenant() TO app_role;
ALTER TABLE tenant_data.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_data.tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON tenant_data.tenants TO app_role USING (id=tenant_data.active_tenant());
ALTER TABLE tenant_data.session_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_data.session_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON tenant_data.session_audit TO app_role WITH CHECK (tenant_id=tenant_data.active_tenant());
ALTER TABLE tenant_data.send_quota ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_data.send_quota FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON tenant_data.send_quota TO app_role USING (tenant_id=tenant_data.active_tenant())
  WITH CHECK (tenant_id=tenant_data.active_tenant());

-- Operator mutations share the tenant lock with request authorization.
CREATE FUNCTION tenant_auth.revoke_on_role_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD.role IS DISTINCT FROM NEW.role THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(OLD.tenant_id::text,3201));
    UPDATE tenant_auth.sessions SET expires_at=clock_timestamp()
      WHERE tenant_id=OLD.tenant_id AND user_id=OLD.user_id AND expires_at>clock_timestamp();
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER revoke_member_role BEFORE UPDATE OF role OR DELETE ON tenant_auth.tenant_members
  FOR EACH ROW EXECUTE FUNCTION tenant_auth.revoke_on_role_change();
CREATE FUNCTION tenant_data.revoke_on_tenant_removal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR NEW.status='suspended' OR NEW.deleted_at IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(OLD.id::text,3201));
    UPDATE tenant_auth.sessions SET expires_at=clock_timestamp()
      WHERE tenant_id=OLD.id AND expires_at>clock_timestamp();
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER revoke_tenant_sessions BEFORE UPDATE OF status,deleted_at OR DELETE ON tenant_data.tenants
  FOR EACH ROW EXECUTE FUNCTION tenant_data.revoke_on_tenant_removal();
REVOKE ALL ON FUNCTION tenant_auth.revoke_on_role_change(),tenant_data.revoke_on_tenant_removal() FROM PUBLIC;

-- Operator entry points take the lock before PostgreSQL locks a row for DML.
-- This keeps lock order consistent with a tenant request inserting an FK row.
CREATE FUNCTION tenant_auth.set_member_role(p_user bigint,p_tenant uuid,p_role text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant::text,3201));
  IF p_role IS NULL THEN
    DELETE FROM tenant_auth.tenant_members WHERE user_id=p_user AND tenant_id=p_tenant;
  ELSE
    UPDATE tenant_auth.tenant_members SET role=p_role WHERE user_id=p_user AND tenant_id=p_tenant;
  END IF;
END $$;
CREATE FUNCTION tenant_data.close_tenant(p_tenant uuid,p_remove boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant::text,3201));
  IF p_remove THEN
    DELETE FROM tenant_data.tenants WHERE id=p_tenant;
  ELSE
    UPDATE tenant_data.tenants SET status='suspended' WHERE id=p_tenant;
  END IF;
END $$;
REVOKE ALL ON FUNCTION tenant_auth.set_member_role(bigint,uuid,text),tenant_data.close_tenant(uuid,boolean) FROM PUBLIC;
