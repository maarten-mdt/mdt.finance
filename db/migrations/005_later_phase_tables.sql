-- Tables for Phases 2–5 (orders, dividends, buybacks, documents, lawyer packages).
-- Created now so the schema doesn't need reworking later; no UI uses them in Phase 1.
-- Columns tied to an open decision in SPEC.md are left nullable/flexible on purpose.

CREATE TYPE order_side AS ENUM ('buy', 'sell');
CREATE TYPE order_status AS ENUM (
  'submitted', 'awaiting_payment', 'paid', 'cancelled', 'filled', 'partly_filled', 'carried_forward'
);
CREATE TYPE payment_status AS ENUM ('not_required', 'awaiting', 'received', 'refunded');

CREATE TABLE orders (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id              uuid NOT NULL REFERENCES cycles(id),
  person_id             uuid NOT NULL REFERENCES people(id),
  side                  order_side NOT NULL,
  -- Buy orders are an amount; sell requests are a share count.
  amount_cents          bigint CHECK (amount_cents > 0),
  credit_applied_cents  bigint NOT NULL DEFAULT 0 CHECK (credit_applied_cents >= 0),
  shares_requested      bigint CHECK (shares_requested > 0),
  payment_status        payment_status NOT NULL DEFAULT 'not_required',
  payment_received_at   timestamptz,
  payment_confirmed_by  text,
  shares_filled         bigint NOT NULL DEFAULT 0 CHECK (shares_filled >= 0),
  status                order_status NOT NULL DEFAULT 'submitted',
  carried_from_order_id uuid REFERENCES orders(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK ((side = 'buy') = (amount_cents IS NOT NULL)),
  CHECK ((side = 'sell') = (shares_requested IS NOT NULL))
);
CREATE INDEX orders_person_idx ON orders (person_id);
CREATE INDEX orders_cycle_idx ON orders (cycle_id);
CREATE TRIGGER orders_touch BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- Payroll savings enrolment (amounts are recorded here; the deductions land in credit_ledger).
CREATE TABLE payroll_enrolments (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id               uuid NOT NULL REFERENCES people(id),
  per_paycheque_cents     bigint NOT NULL CHECK (per_paycheque_cents > 0),
  starts_on               date NOT NULL,
  ends_on                 date,
  created_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on IS NULL OR ends_on >= starts_on)
);
CREATE INDEX payroll_enrolments_person_idx ON payroll_enrolments (person_id);

CREATE TABLE dividends (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  declaration_date      date NOT NULL,
  record_date           date NOT NULL,
  amount_per_share_cents bigint NOT NULL CHECK (amount_per_share_cents > 0),
  total_cents           bigint NOT NULL CHECK (total_cents > 0),
  declared_by           text NOT NULL DEFAULT app.current_actor(),
  created_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE credit_ledger
  ADD CONSTRAINT credit_ledger_dividend_fk FOREIGN KEY (dividend_id) REFERENCES dividends(id);

CREATE TYPE dividend_disposition AS ENUM ('pending', 'paid_out', 'applied_to_purchase');

CREATE TABLE dividend_allocations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dividend_id           uuid NOT NULL REFERENCES dividends(id),
  person_id             uuid NOT NULL REFERENCES people(id),
  shares_on_record_date bigint NOT NULL CHECK (shares_on_record_date > 0),
  amount_cents          bigint NOT NULL CHECK (amount_cents > 0),
  disposition           dividend_disposition NOT NULL DEFAULT 'pending',
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dividend_id, person_id)
);
CREATE INDEX dividend_allocations_person_idx ON dividend_allocations (person_id);

-- Buyback price and timing are an open decision: price_cents and amount_cents are filled in
-- when the rule is applied, and the trigger records why the buyback exists.
CREATE TYPE buyback_trigger AS ENUM ('quit', 'fired', 'fired_for_cause', 'retired', 'deceased', 'other');

CREATE TABLE buybacks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id      uuid NOT NULL REFERENCES people(id),
  trigger        buyback_trigger NOT NULL,
  shares         bigint NOT NULL CHECK (shares > 0),
  price_cents    bigint CHECK (price_cents > 0),
  amount_cents   bigint CHECK (amount_cents > 0),
  price_rule     text,
  queued_at      timestamptz NOT NULL DEFAULT now(),
  settled_date   date,
  ledger_entry_id bigint REFERENCES share_ledger(id),
  CHECK (settled_date IS NULL OR (ledger_entry_id IS NOT NULL AND amount_cents IS NOT NULL))
);
CREATE INDEX buybacks_person_idx ON buybacks (person_id);

CREATE TYPE document_type AS ENUM (
  'shareholder_agreement', 'purchase_agreement', 'transfer_form',
  'transaction_confirmation', 'annual_statement', 'dividend_notice', 'other'
);
CREATE TYPE document_status AS ENUM ('draft', 'sent', 'signed', 'complete', 'superseded', 'void');

CREATE TABLE documents (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id            uuid NOT NULL REFERENCES people(id),
  type                 document_type NOT NULL,
  version              text NOT NULL,
  adobe_agreement_id   text UNIQUE,
  status               document_status NOT NULL DEFAULT 'draft',
  storage_key          text,             -- object key in the Railway storage bucket
  sha256               text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX documents_person_idx ON documents (person_id);
CREATE TRIGGER documents_touch BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE packages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start   date NOT NULL,
  period_end     date NOT NULL,
  generated_at   timestamptz NOT NULL DEFAULT now(),
  approved_by    text,
  approved_at    timestamptz,
  sent_at        timestamptz,
  storage_key    text,
  sha256         text,
  CHECK (period_end >= period_start),
  CHECK (sent_at IS NULL OR approved_at IS NOT NULL)
);
