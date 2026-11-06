-- audit_log: who did what, to which row, with the before and after values. Append-only.
-- A trigger on every domain table writes it, so no code path can skip it.

CREATE TABLE audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor       text NOT NULL,
  action      text NOT NULL,          -- INSERT / UPDATE / DELETE, or an app event such as reveal.sin
  table_name  text,
  record_id   text,
  before      jsonb,
  after       jsonb
);
CREATE INDEX audit_log_at_idx ON audit_log (at DESC);
CREATE INDEX audit_log_record_idx ON audit_log (table_name, record_id);

CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION app.append_only();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION app.append_only();

-- Ciphertext is never copied into the log; the log only shows that it changed.
CREATE OR REPLACE FUNCTION app.redact(row_data jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN row_data IS NULL THEN NULL ELSE (
    SELECT coalesce(jsonb_object_agg(k, CASE
      WHEN k LIKE '%\_ciphertext' AND v <> 'null'::jsonb THEN to_jsonb('[encrypted]'::text)
      WHEN k = 'token_hash' THEN to_jsonb('[redacted]'::text)
      ELSE v END), '{}'::jsonb)
    FROM jsonb_each(row_data) AS e(k, v)
  ) END
$$;

CREATE OR REPLACE FUNCTION app.audit_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  b jsonb := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN app.redact(to_jsonb(OLD)) END;
  a jsonb := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN app.redact(to_jsonb(NEW)) END;
BEGIN
  INSERT INTO audit_log (actor, action, table_name, record_id, before, after)
  VALUES (app.current_actor(), TG_OP, TG_TABLE_NAME, coalesce(a, b) ->> 'id', b, a);
  RETURN NULL;
END
$$;

-- App-level events that aren't row writes (field reveals, sign-ins, invite links).
CREATE OR REPLACE FUNCTION app.log_event(p_action text, p_table text, p_record text, p_detail jsonb DEFAULT NULL)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO audit_log (actor, action, table_name, record_id, after)
  VALUES (app.current_actor(), p_action, p_table, p_record, p_detail)
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'people', 'user_roles', 'settings', 'cycles', 'share_ledger', 'credit_ledger', 'orders',
    'payroll_enrolments', 'dividends', 'dividend_allocations', 'buybacks', 'documents',
    'packages', 'invites'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I
                    FOR EACH ROW EXECUTE FUNCTION app.audit_row()', t || '_audit', t);
  END LOOP;
END
$$;

-- Account-level changes on the auth user table (2FA turned on, person linked), without secrets.
CREATE OR REPLACE FUNCTION app.audit_auth_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  b jsonb := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN
    jsonb_build_object('email', OLD.email, 'twoFactorEnabled', OLD."twoFactorEnabled", 'personId', OLD."personId") END;
  a jsonb := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN
    jsonb_build_object('email', NEW.email, 'twoFactorEnabled', NEW."twoFactorEnabled", 'personId', NEW."personId") END;
BEGIN
  IF b IS DISTINCT FROM a THEN
    INSERT INTO audit_log (actor, action, table_name, record_id, before, after)
    VALUES (coalesce(NULLIF(current_setting('app.actor_id', true), ''), 'auth'), TG_OP, 'user',
            coalesce(NEW.id, OLD.id), b, a);
  END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER user_audit AFTER INSERT OR UPDATE OR DELETE ON "user"
  FOR EACH ROW EXECUTE FUNCTION app.audit_auth_user();

CREATE OR REPLACE FUNCTION app.audit_passkey() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN  -- counter bumps on every sign-in are not account changes
    INSERT INTO audit_log (actor, action, table_name, record_id, after)
    VALUES ('auth', TG_OP, 'passkey', coalesce(NEW.id, OLD.id),
            jsonb_build_object('userId', coalesce(NEW."userId", OLD."userId"),
                               'name', coalesce(NEW.name, OLD.name)));
  END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER passkey_audit AFTER INSERT OR DELETE ON "passkey"
  FOR EACH ROW EXECUTE FUNCTION app.audit_passkey();
