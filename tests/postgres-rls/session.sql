SET search_path = fixture, pg_catalog;
SELECT pg_backend_pid() AS backend_pid \gset
\echo BACKEND :backend_pid

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls))
    OR EXISTS (
      SELECT FROM pg_class WHERE relnamespace = 'fixture'::regnamespace
      AND relowner = current_user::regrole::oid
    ) THEN
    RAISE EXCEPTION 'fixture application role can bypass RLS';
  END IF;
  IF EXISTS (SELECT FROM messages) THEN
    RAISE EXCEPTION 'messages visible without tenant context';
  END IF;
  BEGIN
    PERFORM 1 FROM users;
    RAISE EXCEPTION 'identity table readable by tenant role';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM sessions;
    RAISE EXCEPTION 'session table readable by tenant role';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO messages VALUES ('00000000-0000-0000-0000-000000000001', 2, 1, 'missing context');
    RAISE EXCEPTION 'insert allowed without tenant context';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

BEGIN;
SELECT set_config('app.tenant_id', :'tenant', true), set_config('fixture.other_tenant', :'other', true);
DO $$
DECLARE
  tenant uuid := current_tenant();
  other uuid := current_setting('fixture.other_tenant')::uuid;
  row_count bigint;
BEGIN
  IF (SELECT count(*) FROM tenants) <> 1 OR NOT EXISTS (SELECT FROM tenants WHERE id = tenant) OR
     (SELECT count(*) FROM tenant_members) <> 1 OR NOT EXISTS (SELECT FROM tenant_members WHERE tenant_id = tenant) OR
     (SELECT count(*) FROM numbers) <> 1 OR NOT EXISTS (SELECT FROM numbers WHERE tenant_id = tenant) OR
     NOT EXISTS (SELECT FROM chats WHERE tenant_id = tenant) OR EXISTS (SELECT FROM chats WHERE tenant_id <> tenant) OR
     (SELECT count(*) FROM messages) <> 1 OR NOT EXISTS (SELECT FROM messages WHERE body = tenant::text) OR
     (SELECT count(*) FROM media_records) <> 1 OR NOT EXISTS (SELECT FROM media_records WHERE tenant_id = tenant) THEN
    RAISE EXCEPTION 'tenant read isolation failed';
  END IF;
  UPDATE messages SET body = 'foreign update' WHERE tenant_id = other;
  GET DIAGNOSTICS row_count = ROW_COUNT;
  IF row_count <> 0 THEN RAISE EXCEPTION 'foreign update affected rows'; END IF;
  DELETE FROM messages WHERE tenant_id = other;
  GET DIAGNOSTICS row_count = ROW_COUNT;
  IF row_count <> 0 THEN RAISE EXCEPTION 'foreign delete affected rows'; END IF;
  BEGIN
    INSERT INTO messages VALUES (other, 2, 1, 'foreign insert');
    RAISE EXCEPTION 'foreign insert allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  INSERT INTO messages VALUES (tenant, 2, 1, 'own insert');
  BEGIN
    UPDATE messages SET tenant_id = other WHERE tenant_id = tenant AND id = 2;
    RAISE EXCEPTION 'tenant reassignment allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  UPDATE messages SET body = 'own update' WHERE id = 2;
  IF NOT EXISTS (SELECT FROM messages WHERE id = 2 AND body = 'own update') THEN
    RAISE EXCEPTION 'own update failed';
  END IF;
  DELETE FROM messages WHERE id = 2;
  GET DIAGNOSTICS row_count = ROW_COUNT;
  IF row_count <> 1 THEN RAISE EXCEPTION 'own delete failed'; END IF;
  IF tenant = '00000000-0000-0000-0000-000000000001' THEN
    BEGIN
      INSERT INTO messages VALUES (tenant, 3, 2, 'chat 2 belongs only to tenant B');
      RAISE EXCEPTION 'foreign chat reference allowed';
    EXCEPTION WHEN foreign_key_violation THEN NULL;
    END;
  END IF;
END $$;
COMMIT;

DO $$
BEGIN
  IF EXISTS (SELECT FROM messages) THEN RAISE EXCEPTION 'tenant context leaked across transactions'; END IF;
END $$;

BEGIN;
SELECT set_config('app.tenant_id', 'malformed', true);
DO $$
BEGIN
  PERFORM 1 FROM messages;
  RAISE EXCEPTION 'malformed tenant context accepted';
EXCEPTION WHEN invalid_text_representation THEN NULL;
END $$;
ROLLBACK;
\echo RLS_PASS :tenant
