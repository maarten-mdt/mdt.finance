-- 1. Share quantities to two decimals. MDT's records hold shares like 75,106.22, so every share
--    quantity is now stored as integer HUNDREDTHS of a share (75,106.22 → 7510622). Still no
--    floats. Total shares outstanding (cycles, settings) stays in whole shares: it's the
--    price-formula denominator.
-- 2. Each ledger entry records the amount actually paid (records show e.g. $25,000.00 for
--    26.05 shares at $959.72, not $25,000.71). Cost basis uses this amount.
-- 3. Companies can hold shares with a named contact person who signs in.
-- 4. Maarten Van Ruitenburg's account becomes the sign-in for Van Ruitenburg Holdings Ltd. (VRH).

-- ---- 1 + 2: rescale existing entries (this is the only time ledger rows are rewritten) -------
ALTER TABLE share_ledger ADD COLUMN amount_cents bigint CHECK (amount_cents >= 0);

ALTER TABLE share_ledger DISABLE TRIGGER share_ledger_no_update;
UPDATE share_ledger SET amount_cents = shares * price_cents, shares = shares * 100;
ALTER TABLE share_ledger ENABLE TRIGGER share_ledger_no_update;

ALTER TABLE share_ledger ALTER COLUMN amount_cents SET NOT NULL;
COMMENT ON COLUMN share_ledger.shares IS 'Hundredths of a share (2605 = 26.05 shares)';
COMMENT ON COLUMN share_ledger.price_cents IS 'Price per whole share, in cents';
COMMENT ON COLUMN share_ledger.amount_cents IS 'Amount actually paid for the entry, in cents';

UPDATE dividend_allocations SET shares_on_record_date = shares_on_record_date * 100;
UPDATE orders SET shares_requested = shares_requested * 100, shares_filled = shares_filled * 100;
UPDATE buybacks SET shares = shares * 100;
COMMENT ON COLUMN dividend_allocations.shares_on_record_date IS 'Hundredths of a share';
COMMENT ON COLUMN orders.shares_requested IS 'Hundredths of a share';
COMMENT ON COLUMN buybacks.shares IS 'Hundredths of a share';

-- A correction must also mirror the amount paid.
CREATE OR REPLACE FUNCTION app.share_ledger_validate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  from_key text := app.holder_key(NEW.from_holder_id);
  to_key   text := app.holder_key(NEW.to_holder_id);
  orig     share_ledger;
  bal      bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.from_holder_id::text, 0));

  IF NEW.type = 'correction' THEN
    SELECT * INTO orig FROM share_ledger WHERE id = NEW.reverses_entry_id;
    IF EXISTS (SELECT 1 FROM share_ledger WHERE reverses_entry_id = orig.id) THEN
      RAISE EXCEPTION 'entry % has already been reversed', orig.id;
    END IF;
    IF orig.type = 'correction' THEN
      RAISE EXCEPTION 'a correction cannot itself be reversed; record a new entry instead';
    END IF;
    IF NEW.from_holder_id <> orig.to_holder_id OR NEW.to_holder_id <> orig.from_holder_id
       OR NEW.shares <> orig.shares OR NEW.price_cents <> orig.price_cents OR NEW.amount_cents <> orig.amount_cents THEN
      RAISE EXCEPTION 'a correction must exactly reverse entry % (swap holders, same shares, price and amount)', orig.id;
    END IF;
  ELSIF NEW.type = 'opening_balance' THEN
    IF from_key IS DISTINCT FROM 'opening_balance' THEN
      RAISE EXCEPTION 'opening balances must come from the "Opening balance (pre-system)" holder';
    END IF;
  ELSIF NEW.type = 'vrh_sale' THEN
    IF from_key IS DISTINCT FROM 'vrh' THEN RAISE EXCEPTION 'vrh_sale must be sold by VRH'; END IF;
  ELSIF NEW.type = 'vrh_buyback' THEN
    IF to_key IS DISTINCT FROM 'vrh' THEN RAISE EXCEPTION 'vrh_buyback must be bought by VRH'; END IF;
  ELSIF NEW.type = 'holder_transfer' THEN
    IF from_key IS NOT NULL OR to_key IS NOT NULL THEN
      RAISE EXCEPTION 'holder_transfer is between two individual holders, not VRH or system holders';
    END IF;
  END IF;

  IF NEW.type <> 'correction' AND to_key = 'opening_balance' THEN
    RAISE EXCEPTION 'shares can only move to the opening-balance holder by reversing an opening balance';
  END IF;

  IF from_key IS DISTINCT FROM 'opening_balance' THEN
    bal := app.share_balance(NEW.from_holder_id);
    IF bal < NEW.shares THEN
      RAISE EXCEPTION 'holder % has % hundredths of a share and cannot transfer %', NEW.from_holder_id, bal, NEW.shares
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- ---- 3: companies with a contact person -------------------------------------------------------
ALTER TABLE people ADD COLUMN contact_name text;
ALTER TABLE people ADD COLUMN merged_into uuid REFERENCES people(id);
COMMENT ON COLUMN people.contact_name IS 'For a company holder: the person who signs in for it';
COMMENT ON COLUMN people.merged_into IS 'This record was merged into another; kept for history only';

-- Hire dates may be unknown for existing holders, and a company may have a contact email.
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
           WHERE conrelid = 'people'::regclass AND contype = 'c' LOOP
    IF c.def LIKE '%hire_date IS NOT NULL%' OR c.def LIKE '%email IS NULL%' THEN
      EXECUTE format('ALTER TABLE people DROP CONSTRAINT %I', c.conname);
    END IF;
  END LOOP;
END
$$;
ALTER TABLE people ADD CONSTRAINT people_system_has_no_email CHECK (type <> 'system' OR email IS NULL);

CREATE OR REPLACE FUNCTION app.user_roles_guard_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM people WHERE id = NEW.person_id AND email IS NOT NULL
                 AND status <> 'departed' AND merged_into IS NULL) THEN
    RAISE EXCEPTION 'Only a current person with an email can be an admin.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

-- ---- 4: merging a person into the holder record they sign in for ----------------------------------
-- Moves the login, admin role, agreements and invites, gives the target the email and contact
-- name, transfers any shares the merged record held, and marks it merged (kept for history).
-- Owner-only (migrations and scripts); every change is audit-logged by the table triggers.
CREATE OR REPLACE FUNCTION app.merge_person_into(p_from uuid, p_into uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  m people;
  v people;
  bal bigint;
  t share_entry_type;
BEGIN
  SELECT * INTO m FROM people WHERE id = p_from;
  SELECT * INTO v FROM people WHERE id = p_into;
  IF m.id IS NULL OR v.id IS NULL OR m.id = v.id THEN RAISE EXCEPTION 'merge needs two different people'; END IF;
  IF m.merged_into IS NOT NULL THEN RETURN; END IF;
  IF m.system_key IS NOT NULL THEN RAISE EXCEPTION 'system holders cannot be merged away'; END IF;

  UPDATE people SET email = NULL, merged_into = v.id WHERE id = m.id;
  UPDATE people SET email = coalesce(v.email, m.email), contact_name = coalesce(v.contact_name, m.name) WHERE id = v.id;

  UPDATE "user" SET "personId" = v.id WHERE "personId" = m.id;
  INSERT INTO user_roles (person_id, role) SELECT v.id, role FROM user_roles WHERE person_id = m.id ON CONFLICT DO NOTHING;
  DELETE FROM user_roles WHERE person_id = m.id;
  UPDATE documents SET person_id = v.id WHERE person_id = m.id;
  UPDATE invites SET person_id = v.id WHERE person_id = m.id;

  bal := app.share_balance(m.id);
  IF bal > 0 THEN
    t := CASE WHEN v.system_key = 'vrh' THEN 'vrh_buyback' ELSE 'holder_transfer' END;
    INSERT INTO share_ledger (entry_date, type, from_holder_id, to_holder_id, shares, price_cents, amount_cents, memo)
    VALUES (current_date, t, m.id, v.id, bal, 0, 0, 'Account merge: holdings moved to ' || v.name);
  END IF;
END
$$;
REVOKE ALL ON FUNCTION app.merge_person_into(uuid, uuid) FROM PUBLIC;

-- The two system holders every ledger needs (same as Admin → "Create VRH and opening-balance
-- holders"), so the merge below can always run.
INSERT INTO people (type, name, system_key)
SELECT 'entity', 'Van Ruitenburg Holdings Ltd.', 'vrh' WHERE NOT EXISTS (SELECT 1 FROM people WHERE system_key = 'vrh');
INSERT INTO people (type, name, system_key)
SELECT 'system', 'Opening balance (pre-system)', 'opening_balance' WHERE NOT EXISTS (SELECT 1 FROM people WHERE system_key = 'opening_balance');

-- Maarten Van Ruitenburg signs in as Van Ruitenburg Holdings Ltd. (does nothing if he has no record yet).
DO $$
DECLARE m uuid; v uuid;
BEGIN
  SELECT id INTO m FROM people WHERE email = 'maarten@mdttac.com' AND system_key IS NULL AND merged_into IS NULL;
  SELECT id INTO v FROM people WHERE system_key = 'vrh';
  IF m IS NOT NULL AND v IS NOT NULL THEN
    PERFORM set_config('app.actor_id', 'system:account-merge', true);
    PERFORM app.merge_person_into(m, v);
  END IF;
END
$$;

-- ---- Holder's own movements now include the amount paid ----------------------------------------
DROP FUNCTION app.my_share_entries();
CREATE FUNCTION app.my_share_entries()
RETURNS TABLE (id bigint, entry_date date, type share_entry_type, direction text,
               shares bigint, price_cents bigint, amount_cents bigint, reverses_entry_id bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT l.id, l.entry_date, l.type,
         CASE WHEN l.to_holder_id = app.current_person_id() THEN 'in' ELSE 'out' END,
         l.shares, l.price_cents, l.amount_cents, l.reverses_entry_id
  FROM share_ledger l
  WHERE app.current_person_id() IS NOT NULL
    AND (l.to_holder_id = app.current_person_id() OR l.from_holder_id = app.current_person_id())
  ORDER BY l.entry_date, l.id
$$;
REVOKE ALL ON FUNCTION app.my_share_entries() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.my_share_entries() TO app_user;
