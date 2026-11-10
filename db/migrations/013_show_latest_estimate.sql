-- Shareholders see every locked (audited, board-approved) price, plus the LATEST year's price
-- even while it's still a draft, which the app labels as an estimate until it's locked.
-- Older unlocked drafts stay admin-only.

CREATE OR REPLACE FUNCTION app.latest_cycle_year() RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT max(year) FROM cycles
$$;
REVOKE ALL ON FUNCTION app.latest_cycle_year() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.latest_cycle_year() TO app_user;

DROP POLICY cycles_read ON cycles;
CREATE POLICY cycles_read ON cycles FOR SELECT TO app_user
  USING (
    (app.current_person_id() IS NOT NULL AND (locked_at IS NOT NULL OR year = app.latest_cycle_year()))
    OR app.is_admin()
  );
