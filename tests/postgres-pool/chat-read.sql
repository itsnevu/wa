CREATE SCHEMA app;
CREATE TABLE app.tenants(id uuid PRIMARY KEY, status text NOT NULL, deleted_at bigint);
CREATE TABLE app.users(id bigint PRIMARY KEY, role text NOT NULL);
CREATE TABLE app.tenant_members(
  tenant_id uuid REFERENCES app.tenants, user_id bigint REFERENCES app.users,
  PRIMARY KEY(tenant_id,user_id)
);
CREATE TABLE app.numbers(
  tenant_id uuid REFERENCES app.tenants, id bigint, owner_id bigint REFERENCES app.users,
  PRIMARY KEY(tenant_id,id)
);
CREATE TABLE app.chats(
  tenant_id uuid, id bigint, number_id bigint NOT NULL,
  PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,number_id) REFERENCES app.numbers
);
CREATE TABLE app.messages(
  tenant_id uuid, id bigint, number_id bigint NOT NULL, chat_id bigint NOT NULL,
  from_me boolean NOT NULL DEFAULT false, body text NOT NULL DEFAULT '', ts bigint NOT NULL,
  agent_id bigint, kind text NOT NULL DEFAULT 'text', media_path text, mime text, wa_id text, analytics_source text,
  PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,number_id) REFERENCES app.numbers,
  FOREIGN KEY(tenant_id,chat_id) REFERENCES app.chats
);
CREATE INDEX chat_read_page ON app.messages (tenant_id,chat_id,ts DESC,id DESC);
CREATE TABLE app.labels(
  tenant_id uuid REFERENCES app.tenants,id bigint,name text NOT NULL,color text NOT NULL,
  PRIMARY KEY(tenant_id,id)
);
CREATE TABLE app.chat_labels(
  tenant_id uuid,chat_id bigint,label_id bigint,
  PRIMARY KEY(tenant_id,chat_id,label_id), FOREIGN KEY(tenant_id,chat_id) REFERENCES app.chats,
  FOREIGN KEY(tenant_id,label_id) REFERENCES app.labels
);

CREATE FUNCTION app.message_reader_role(p_user_id bigint) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT u.role FROM app.tenant_members m JOIN app.users u ON u.id=m.user_id
  JOIN app.tenants t ON t.id=m.tenant_id
  WHERE m.tenant_id=fixture.current_tenant() AND m.user_id=p_user_id
    AND t.status='active' AND t.deleted_at IS NULL
$$;
REVOKE ALL ON FUNCTION app.message_reader_role(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.message_reader_role(bigint) TO fixture_app;
GRANT USAGE ON SCHEMA app TO fixture_app;

DO $$
DECLARE relation text;
BEGIN
  FOREACH relation IN ARRAY ARRAY['tenants','tenant_members','numbers','chats','messages','labels','chat_labels']
  LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',relation);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',relation);
    EXECUTE format('CREATE POLICY read_tenant ON app.%I FOR SELECT TO fixture_app USING (%I=fixture.current_tenant())',
      relation,CASE WHEN relation='tenants' THEN 'id' ELSE 'tenant_id' END);
    EXECUTE format('GRANT SELECT ON app.%I TO fixture_app',relation);
  END LOOP;
END $$;
