-- Row-level security on every table.
--
--   * Holders read only their own rows. They never write: there are no write policies that a
--     non-admin request can satisfy.
--   * Admin writes go through server code that sets app.is_admin, and app.is_admin() also
--     checks user_roles, so a holder session can't promote itself.
--   * share_ledger rows name both counterparties, and SPEC.md says buyers never see who sold
--     to them. So holders get no direct access to the table; they read their own movements,
--     without counterparties, through app.my_share_entries().
--   * Auth tables are reachable only by auth_service.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'people', 'user_roles', 'settings', 'cycles', 'share_ledger', 'credit_ledger', 'orders',
    'payroll_enrolments', 'dividends', 'dividend_allocations', 'buybacks', 'documents',
    'packages', 'invites', 'audit_log',
    'user', 'session', 'account', 'verification', 'twoFactor', 'passkey', 'rateLimit'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END
$$;

-- ---- Grants -------------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE ON people, user_roles, cycles, orders, payroll_enrolments,
  dividends, dividend_allocations, buybacks, documents, packages, invites TO app_user;
GRANT SELECT, INSERT ON settings, share_ledger, credit_ledger TO app_user;
GRANT SELECT ON audit_log, current_settings, holdings, credit_balances TO app_user;
-- Deliberately no DELETE or TRUNCATE anywhere, and no UPDATE on ledgers, settings or audit_log.

-- ---- Policies: domain tables ----------------------------------------------------------------
-- Own rows or admin.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['credit_ledger', 'orders', 'payroll_enrolments',
                           'dividend_allocations', 'buybacks', 'documents', 'user_roles'] LOOP
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO app_user
                    USING (person_id = app.current_person_id() OR app.is_admin())', t || '_read', t);
  END LOOP;
END
$$;

CREATE POLICY people_read ON people FOR SELECT TO app_user
  USING (id = app.current_person_id() OR app.is_admin());

-- Program rules and declared dividends are the same for everyone signed in.
CREATE POLICY settings_read ON settings FOR SELECT TO app_user
  USING (app.current_person_id() IS NOT NULL);
CREATE POLICY dividends_read ON dividends FOR SELECT TO app_user
  USING (app.current_person_id() IS NOT NULL);
-- Holders see a price only once the board has approved it and an admin has locked it.
CREATE POLICY cycles_read ON cycles FOR SELECT TO app_user
  USING ((app.current_person_id() IS NOT NULL AND locked_at IS NOT NULL) OR app.is_admin());

-- Admin-only reads.
CREATE POLICY share_ledger_read ON share_ledger FOR SELECT TO app_user USING (app.is_admin());
CREATE POLICY packages_read ON packages FOR SELECT TO app_user USING (app.is_admin());
CREATE POLICY invites_read ON invites FOR SELECT TO app_user USING (app.is_admin());
CREATE POLICY audit_log_read ON audit_log FOR SELECT TO app_user USING (app.is_admin());

-- Admin-only writes.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['people', 'user_roles', 'settings', 'cycles', 'share_ledger', 'credit_ledger',
                           'orders', 'payroll_enrolments', 'dividends', 'dividend_allocations',
                           'buybacks', 'documents', 'packages', 'invites'] LOOP
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT TO app_user WITH CHECK (app.is_admin())', t || '_admin_insert', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['people', 'user_roles', 'cycles', 'orders', 'payroll_enrolments',
                           'dividends', 'dividend_allocations', 'buybacks', 'documents', 'packages', 'invites'] LOOP
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE TO app_user USING (app.is_admin()) WITH CHECK (app.is_admin())',
                   t || '_admin_update', t);
  END LOOP;
END
$$;

-- ---- Policies: auth tables (auth_service only) ------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['user', 'session', 'account', 'verification', 'twoFactor', 'passkey', 'rateLimit'] LOOP
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO auth_service USING (true) WITH CHECK (true)', t || '_auth_service', t);
  END LOOP;
END
$$;

-- ---- Holder-safe read functions ---------------------------------------------------------------
-- These run with the owner's rights but only ever return rows for app.current_person_id().

CREATE OR REPLACE FUNCTION app.my_share_entries()
RETURNS TABLE (id bigint, entry_date date, type share_entry_type, direction text,
               shares bigint, price_cents bigint, reverses_entry_id bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT l.id, l.entry_date, l.type,
         CASE WHEN l.to_holder_id = app.current_person_id() THEN 'in' ELSE 'out' END,
         l.shares, l.price_cents, l.reverses_entry_id
  FROM share_ledger l
  WHERE app.current_person_id() IS NOT NULL
    AND (l.to_holder_id = app.current_person_id() OR l.from_holder_id = app.current_person_id())
  ORDER BY l.entry_date, l.id
$$;

CREATE OR REPLACE FUNCTION app.my_share_balance() RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN app.current_person_id() IS NULL THEN 0
              ELSE app.share_balance(app.current_person_id()) END
$$;

-- Invite acceptance happens before anyone is signed in. This marks a valid, unused invite as
-- used and returns who it is for, in one step, so a token works exactly once.
CREATE OR REPLACE FUNCTION app.consume_invite(p_token_hash text)
RETURNS TABLE (person_id uuid, name text, email text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE inv invites;
BEGIN
  PERFORM set_config('app.actor_id', 'system:invite-acceptance', true);
  UPDATE invites SET used_at = now()
  WHERE token_hash = p_token_hash AND used_at IS NULL AND expires_at > now()
  RETURNING * INTO inv;
  IF inv.id IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT p.id, p.name, p.email FROM people p
    WHERE p.id = inv.person_id AND p.email IS NOT NULL AND p.status <> 'departed';
END
$$;

CREATE OR REPLACE FUNCTION app.peek_invite(p_token_hash text)
RETURNS TABLE (name text, email text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.name, p.email FROM invites i JOIN people p ON p.id = i.person_id
  WHERE i.token_hash = p_token_hash AND i.used_at IS NULL AND i.expires_at > now()
$$;

-- Admin view of account state (has an account, MFA on, passkeys) without exposing auth tables.
CREATE OR REPLACE FUNCTION app.account_status()
RETURNS TABLE (person_id uuid, has_account boolean, mfa_enabled boolean, passkeys integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u."personId", true, coalesce(u."twoFactorEnabled", false),
         (SELECT count(*)::int FROM passkey pk WHERE pk."userId" = u.id)
  FROM "user" u
  WHERE app.is_admin() AND u."personId" IS NOT NULL
$$;

-- Ledger trigger helpers must see every row regardless of who inserts.
ALTER FUNCTION app.holder_key(uuid) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION app.share_balance(uuid) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION app.share_ledger_validate() SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION app.credit_ledger_validate() SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO app_user;
GRANT USAGE ON SCHEMA app TO auth_service;
GRANT EXECUTE ON FUNCTION app.audit_auth_user(), app.audit_passkey(), app.redact(jsonb) TO auth_service;
