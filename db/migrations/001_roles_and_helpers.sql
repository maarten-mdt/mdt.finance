-- Roles and request-context helpers.
--
-- The app connects as app_user. app_user owns nothing, so row-level security always applies to it.
-- Every request runs inside a transaction that sets:
--   app.person_id  the signed-in person's id (empty for system work)
--   app.actor_id   who to record in audit_log (person id, or 'system:<script>')
--   app.is_admin   'true' when the signed-in person is an admin and the request is an admin action

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN;
  END IF;
END
$$;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS app;
GRANT USAGE ON SCHEMA app TO app_user;

CREATE OR REPLACE FUNCTION app.current_person_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.person_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app.current_actor() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT coalesce(NULLIF(current_setting('app.actor_id', true), ''), 'unknown:' || current_user)
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO app_user;

CREATE OR REPLACE FUNCTION app.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
