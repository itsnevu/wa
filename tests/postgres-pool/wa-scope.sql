CREATE TABLE tenant_data.wa_numbers(
  tenant_id uuid REFERENCES tenant_data.tenants,id bigint,owner_id bigint,PRIMARY KEY(tenant_id,id)
);
CREATE TABLE tenant_data.wa_chats(
  tenant_id uuid,number_id bigint,id bigint,jid text NOT NULL,
  PRIMARY KEY(tenant_id,number_id,id),FOREIGN KEY(tenant_id,number_id) REFERENCES tenant_data.wa_numbers
);
CREATE TABLE tenant_data.wa_messages(
  tenant_id uuid,number_id bigint,chat_id bigint,id bigint GENERATED ALWAYS AS IDENTITY,
  wa_id text,body text NOT NULL,from_me boolean NOT NULL,ts bigint NOT NULL,
  PRIMARY KEY(tenant_id,number_id,id),UNIQUE(tenant_id,number_id,wa_id),
  FOREIGN KEY(tenant_id,number_id,chat_id) REFERENCES tenant_data.wa_chats
);
CREATE TABLE tenant_data.wa_rules(
  tenant_id uuid,number_id bigint,id bigint,pattern text NOT NULL,reply text NOT NULL,
  priority integer NOT NULL,enabled boolean NOT NULL,PRIMARY KEY(tenant_id,number_id,id),
  FOREIGN KEY(tenant_id,number_id) REFERENCES tenant_data.wa_numbers
);
CREATE INDEX wa_rules_active ON tenant_data.wa_rules(tenant_id,number_id,priority,id) WHERE enabled;
CREATE TABLE tenant_data.wa_media(
  tenant_id uuid,id uuid,number_id bigint NOT NULL,message_id bigint NOT NULL,storage_key text NOT NULL,
  PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id,number_id,message_id) REFERENCES tenant_data.wa_messages,
  CHECK(storage_key=tenant_id::text||'/'||id::text)
);
DO $$
DECLARE relation text;
BEGIN
  FOREACH relation IN ARRAY ARRAY['wa_numbers','wa_chats','wa_messages','wa_rules','wa_media']
  LOOP
    EXECUTE format('ALTER TABLE tenant_data.%I ENABLE ROW LEVEL SECURITY',relation);
    EXECUTE format('ALTER TABLE tenant_data.%I FORCE ROW LEVEL SECURITY',relation);
    EXECUTE format('CREATE POLICY tenant_scope ON tenant_data.%I TO app_role
      USING (tenant_id=tenant_data.active_tenant()) WITH CHECK (tenant_id=tenant_data.active_tenant())',relation);
    EXECUTE format('REVOKE ALL ON tenant_data.%I FROM PUBLIC',relation);
    EXECUTE format('GRANT SELECT ON tenant_data.%I TO app_role',relation);
  END LOOP;
END $$;
GRANT INSERT ON tenant_data.wa_messages,tenant_data.wa_media TO app_role;
