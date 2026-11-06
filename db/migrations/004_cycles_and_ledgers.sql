-- Annual cycles and the two append-only ledgers (SPEC.md "Data model").
-- Money is bigint cents; shares are bigint whole shares. No numeric/float columns.

CREATE TYPE cycle_status AS ENUM ('draft', 'locked', 'window_open', 'window_closed', 'matched', 'settled');

CREATE TABLE cycles (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year                   integer NOT NULL UNIQUE CHECK (year BETWEEN 2000 AND 2200),
  ebitda_cents           bigint NOT NULL,
  debt_cents             bigint NOT NULL CHECK (debt_cents >= 0),
  multiple_x100          bigint NOT NULL CHECK (multiple_x100 > 0),
  shares_outstanding     bigint NOT NULL CHECK (shares_outstanding > 0),
  price_per_share_cents  bigint NOT NULL CHECK (price_per_share_cents > 0),
  window_opens_on        date,
  window_closes_on       date,
  settlement_date        date NOT NULL,
  status                 cycle_status NOT NULL DEFAULT 'draft',
  locked_by              text,
  locked_at              timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'draft') = (locked_at IS NULL)),
  CHECK (window_closes_on IS NULL OR window_opens_on IS NULL OR window_closes_on >= window_opens_on)
);

CREATE TRIGGER cycles_touch BEFORE UPDATE ON cycles
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- Once a price is locked after board approval, its inputs can never change.
CREATE OR REPLACE FUNCTION app.cycles_freeze_locked() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.locked_at IS NOT NULL AND (
       NEW.ebitda_cents, NEW.debt_cents, NEW.multiple_x100, NEW.shares_outstanding,
       NEW.price_per_share_cents, NEW.year, NEW.locked_at, NEW.locked_by)
     IS DISTINCT FROM (
       OLD.ebitda_cents, OLD.debt_cents, OLD.multiple_x100, OLD.shares_outstanding,
       OLD.price_per_share_cents, OLD.year, OLD.locked_at, OLD.locked_by) THEN
    RAISE EXCEPTION 'cycle % is locked; its valuation cannot change', OLD.year
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER cycles_freeze BEFORE UPDATE ON cycles
  FOR EACH ROW EXECUTE FUNCTION app.cycles_freeze_locked();

CREATE OR REPLACE FUNCTION app.forbid_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows cannot be deleted', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER cycles_no_delete BEFORE DELETE ON cycles
  FOR EACH ROW EXECUTE FUNCTION app.forbid_delete();

-- ---------------------------------------------------------------------------
-- Append-only guard shared by both ledgers and audit_log.
CREATE OR REPLACE FUNCTION app.append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed. Record a reversing entry instead.',
    TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
END
$$;

-- ---------------------------------------------------------------------------
-- share_ledger: the single source of truth for who owns what.
CREATE TYPE share_entry_type AS ENUM ('vrh_sale', 'holder_transfer', 'vrh_buyback', 'opening_balance', 'correction');

CREATE TABLE share_ledger (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_date         date NOT NULL,
  type               share_entry_type NOT NULL,
  from_holder_id     uuid NOT NULL REFERENCES people(id),
  to_holder_id       uuid NOT NULL REFERENCES people(id),
  shares             bigint NOT NULL CHECK (shares > 0),
  price_cents        bigint NOT NULL CHECK (price_cents >= 0),
  cycle_id           uuid REFERENCES cycles(id),
  reverses_entry_id  bigint UNIQUE REFERENCES share_ledger(id),
  memo               text,
  created_by         text NOT NULL DEFAULT app.current_actor(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (from_holder_id <> to_holder_id),
  CHECK ((type = 'correction') = (reverses_entry_id IS NOT NULL))
);

CREATE INDEX share_ledger_from_idx ON share_ledger (from_holder_id);
CREATE INDEX share_ledger_to_idx ON share_ledger (to_holder_id);

CREATE TRIGGER share_ledger_no_update BEFORE UPDATE OR DELETE ON share_ledger
  FOR EACH ROW EXECUTE FUNCTION app.append_only();
CREATE TRIGGER share_ledger_no_truncate BEFORE TRUNCATE ON share_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION app.append_only();

CREATE OR REPLACE FUNCTION app.holder_key(holder uuid) RETURNS text
LANGUAGE sql STABLE AS $$ SELECT system_key FROM people WHERE id = holder $$;

CREATE OR REPLACE FUNCTION app.share_balance(holder uuid) RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT sum(shares) FROM share_ledger WHERE to_holder_id = holder), 0)
       - coalesce((SELECT sum(shares) FROM share_ledger WHERE from_holder_id = holder), 0)
$$;

-- Validates every new share movement.
CREATE OR REPLACE FUNCTION app.share_ledger_validate() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  from_key text := app.holder_key(NEW.from_holder_id);
  to_key   text := app.holder_key(NEW.to_holder_id);
  orig     share_ledger;
  bal      bigint;
BEGIN
  -- Serialise movements per sending holder so two inserts can't both spend the same shares.
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
       OR NEW.shares <> orig.shares OR NEW.price_cents <> orig.price_cents THEN
      RAISE EXCEPTION 'a correction must exactly reverse entry % (swap holders, same shares and price)', orig.id;
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

  -- Nobody but the opening-balance holder may go negative.
  IF from_key IS DISTINCT FROM 'opening_balance' THEN
    bal := app.share_balance(NEW.from_holder_id);
    IF bal < NEW.shares THEN
      RAISE EXCEPTION 'holder % has % shares and cannot transfer %', NEW.from_holder_id, bal, NEW.shares
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER share_ledger_validate BEFORE INSERT ON share_ledger
  FOR EACH ROW EXECUTE FUNCTION app.share_ledger_validate();

-- Holdings are always computed from the ledger, never stored.
CREATE VIEW holdings WITH (security_invoker = true) AS
  SELECT holder_id, sum(delta)::bigint AS shares
  FROM (
    SELECT to_holder_id AS holder_id, shares AS delta FROM share_ledger
    UNION ALL
    SELECT from_holder_id, -shares FROM share_ledger
  ) moves
  GROUP BY holder_id;

-- ---------------------------------------------------------------------------
-- credit_ledger: cash credit held for a person (dividends, payroll savings, leftovers).
CREATE TYPE credit_entry_type AS ENUM (
  'dividend', 'payroll_saving', 'leftover_cash', 'top_up', 'payout', 'applied_to_purchase', 'correction'
);

CREATE TABLE credit_ledger (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_date         date NOT NULL,
  person_id          uuid NOT NULL REFERENCES people(id),
  type               credit_entry_type NOT NULL,
  amount_cents       bigint NOT NULL CHECK (amount_cents <> 0),
  cycle_id           uuid REFERENCES cycles(id),
  dividend_id        uuid,             -- FK added once dividends exists (005)
  reverses_entry_id  bigint UNIQUE REFERENCES credit_ledger(id),
  memo               text,
  created_by         text NOT NULL DEFAULT app.current_actor(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK ((type = 'correction') = (reverses_entry_id IS NOT NULL)),
  -- Money in is positive, money out is negative.
  CHECK (type NOT IN ('dividend', 'payroll_saving', 'leftover_cash', 'top_up') OR amount_cents > 0),
  CHECK (type NOT IN ('payout', 'applied_to_purchase') OR amount_cents < 0)
);

CREATE INDEX credit_ledger_person_idx ON credit_ledger (person_id);

CREATE TRIGGER credit_ledger_no_update BEFORE UPDATE OR DELETE ON credit_ledger
  FOR EACH ROW EXECUTE FUNCTION app.append_only();
CREATE TRIGGER credit_ledger_no_truncate BEFORE TRUNCATE ON credit_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION app.append_only();

CREATE OR REPLACE FUNCTION app.credit_ledger_validate() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  orig credit_ledger;
  bal  bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('credit:' || NEW.person_id::text, 0));
  IF NEW.type = 'correction' THEN
    SELECT * INTO orig FROM credit_ledger WHERE id = NEW.reverses_entry_id;
    IF EXISTS (SELECT 1 FROM credit_ledger WHERE reverses_entry_id = orig.id) THEN
      RAISE EXCEPTION 'credit entry % has already been reversed', orig.id;
    END IF;
    IF orig.type = 'correction' OR orig.person_id <> NEW.person_id OR NEW.amount_cents <> -orig.amount_cents THEN
      RAISE EXCEPTION 'a correction must exactly reverse credit entry % for the same person', orig.id;
    END IF;
  END IF;
  SELECT coalesce(sum(amount_cents), 0) INTO bal FROM credit_ledger WHERE person_id = NEW.person_id;
  IF bal + NEW.amount_cents < 0 THEN
    RAISE EXCEPTION 'credit balance for % would go negative', NEW.person_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER credit_ledger_validate BEFORE INSERT ON credit_ledger
  FOR EACH ROW EXECUTE FUNCTION app.credit_ledger_validate();

CREATE VIEW credit_balances WITH (security_invoker = true) AS
  SELECT person_id, sum(amount_cents)::bigint AS balance_cents
  FROM credit_ledger
  GROUP BY person_id;
