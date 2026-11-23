CREATE ROLE fixture_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE SCHEMA fixture;
SET search_path = fixture, pg_catalog;

CREATE TABLE tenants (id uuid PRIMARY KEY);
-- Global identity and pre-selection sessions belong to the auth layer.
CREATE TABLE users (id bigint PRIMARY KEY);
CREATE TABLE sessions (id bigint PRIMARY KEY, user_id bigint NOT NULL REFERENCES users(id));
CREATE TABLE tenant_members (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id bigint NOT NULL REFERENCES users(id),
  PRIMARY KEY (tenant_id, user_id)
);
CREATE TABLE numbers (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id bigint NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE TABLE chats (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id bigint NOT NULL,
  number_id bigint NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, number_id) REFERENCES numbers(tenant_id, id)
);
CREATE TABLE messages (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id bigint NOT NULL,
  chat_id bigint NOT NULL,
  body text NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, chat_id) REFERENCES chats(tenant_id, id)
);
CREATE TABLE media_records (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id bigint NOT NULL,
  message_id bigint NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, message_id) REFERENCES messages(tenant_id, id)
);

INSERT INTO tenants VALUES ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
INSERT INTO users VALUES (1), (2);
INSERT INTO sessions VALUES (1, 1), (2, 2);
INSERT INTO tenant_members SELECT id, row_number() OVER (ORDER BY id) FROM tenants;
INSERT INTO numbers SELECT id, 1 FROM tenants;
INSERT INTO chats SELECT id, 1, 1 FROM tenants;
INSERT INTO chats VALUES ('00000000-0000-0000-0000-000000000002', 2, 1);
INSERT INTO messages SELECT id, 1, 1, id::text FROM tenants;
INSERT INTO media_records SELECT id, 1, 1 FROM tenants;

GRANT USAGE ON SCHEMA fixture TO fixture_app;
GRANT SELECT ON tenants, tenant_members, numbers, chats, messages, media_records TO fixture_app;
GRANT INSERT, UPDATE, DELETE ON messages TO fixture_app;

CREATE FUNCTION current_tenant() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

DO $$
DECLARE
  relation text;
  column_name text;
BEGIN
  FOREACH relation IN ARRAY ARRAY['tenants', 'tenant_members', 'numbers', 'chats', 'messages', 'media_records']
  LOOP
    column_name := CASE WHEN relation = 'tenants' THEN 'id' ELSE 'tenant_id' END;
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', relation);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', relation);
    EXECUTE format(
      'CREATE POLICY tenant_scope ON %I TO fixture_app USING (%I = fixture.current_tenant()) WITH CHECK (%I = fixture.current_tenant())',
      relation, column_name, column_name
    );
  END LOOP;
END $$;
