CREATE ROLE control_role NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE control_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS PASSWORD 'fixture-only-password';
GRANT control_role TO control_login WITH INHERIT FALSE;
CREATE SCHEMA tenant_ops;
CREATE TABLE tenant_ops.active_tenants(id uuid PRIMARY KEY);
CREATE TABLE tenant_ops.readiness(
  singleton boolean PRIMARY KEY CHECK(singleton),
  schema_version integer NOT NULL,queue_depth integer NOT NULL,drops_by_reason jsonb NOT NULL,
  oldest_pending_at bigint,running_jobs integer NOT NULL
);
REVOKE ALL ON SCHEMA tenant_ops FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA tenant_ops FROM PUBLIC;
GRANT USAGE ON SCHEMA tenant_ops TO control_role;
GRANT SELECT ON tenant_ops.active_tenants,tenant_ops.readiness TO control_role;

CREATE TABLE tenant_data.deal_work(
  tenant_id uuid REFERENCES tenant_data.tenants,id bigint,state text NOT NULL CHECK(state IN ('pending','claimed')),
  PRIMARY KEY(tenant_id,id)
);
CREATE INDEX deal_work_pending ON tenant_data.deal_work(tenant_id,id) WHERE state='pending';
ALTER TABLE tenant_data.deal_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_data.deal_work FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON tenant_data.deal_work TO app_role
  USING (tenant_id=tenant_data.active_tenant()) WITH CHECK (tenant_id=tenant_data.active_tenant());
REVOKE ALL ON tenant_data.deal_work FROM PUBLIC;
GRANT SELECT, UPDATE(state) ON tenant_data.deal_work TO app_role;
GRANT DELETE ON tenant_data.wa_messages TO app_role;
CREATE INDEX wa_history ON tenant_data.wa_messages(tenant_id,number_id,chat_id,ts DESC,id DESC);
CREATE INDEX wa_retention ON tenant_data.wa_messages(tenant_id,ts);
