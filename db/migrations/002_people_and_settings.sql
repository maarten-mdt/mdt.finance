-- People (every holder, including VRH), admin roles, and program settings.

CREATE TYPE person_type AS ENUM (
  'employee',
  'outside_investor',
  'entity',        -- a company holder such as VRH
  'system'         -- bookkeeping counterparties such as "Opening balance (pre-system)"
);

CREATE TYPE employment_status AS ENUM ('active', 'leave', 'departed', 'not_applicable');

CREATE TABLE people (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type              person_type NOT NULL,
  name              text NOT NULL CHECK (length(trim(name)) > 0),
  email             text UNIQUE CHECK (email IS NULL OR email = lower(email)),
  hire_date         date,
  status            employment_status NOT NULL DEFAULT 'not_applicable',
  departure_date    date,
  departure_reason  text,
  tax_residency     text,
  -- Field-level encryption happens in the app (AES-256-GCM); the key never reaches the database.
  sin_ciphertext    text,
  sin_last4         text CHECK (sin_last4 IS NULL OR sin_last4 ~ '^[0-9]{3,4}$'),
  bank_ciphertext   text,
  bank_last4        text CHECK (bank_last4 IS NULL OR bank_last4 ~ '^[0-9]{3,4}$'),
  -- A fixed key for well-known holders, so code never looks VRH up by name.
  system_key        text UNIQUE CHECK (system_key IS NULL OR system_key IN ('vrh', 'opening_balance')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (type <> 'employee' OR hire_date IS NOT NULL),
  CHECK (type IN ('employee', 'outside_investor') OR email IS NULL),
  CHECK (departure_date IS NULL OR status = 'departed')
);

CREATE TRIGGER people_touch BEFORE UPDATE ON people
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE user_roles (
  person_id   uuid NOT NULL REFERENCES people(id),
  role        text NOT NULL CHECK (role IN ('admin')),
  granted_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, role)
);

-- Admin = the request says it is an admin request AND the signed-in person really holds the role.
CREATE OR REPLACE FUNCTION app.is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(current_setting('app.is_admin', true), '') = 'true'
     AND EXISTS (SELECT 1 FROM user_roles
                 WHERE person_id = app.current_person_id() AND role = 'admin')
$$;

-- Program rules (SPEC.md "Program rules"). Never edited in place: a change is a new row
-- with a later effective_from, so every past calculation can be reproduced.
CREATE TABLE settings (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key             text NOT NULL,
  int_value       bigint,
  text_value      text,
  description     text NOT NULL,
  effective_from  timestamptz NOT NULL DEFAULT now(),
  created_by      text NOT NULL DEFAULT app.current_actor(),
  CHECK ((int_value IS NULL) <> (text_value IS NULL)),
  UNIQUE (key, effective_from)
);

CREATE VIEW current_settings WITH (security_invoker = true) AS
  SELECT DISTINCT ON (key) key, int_value, text_value, description, effective_from
  FROM settings
  WHERE effective_from <= now()
  ORDER BY key, effective_from DESC;

INSERT INTO settings (key, int_value, description, effective_from, created_by) VALUES
  ('valuation_multiple_x100',   700,     'EBITDA multiple × 100 (700 = 7×)',                       '2026-01-01', 'system:migration'),
  ('min_purchase_cents',        100000,  'Minimum purchase per transaction, in cents ($1,000)',     '2026-01-01', 'system:migration'),
  ('max_purchase_cents',        1000000, 'Maximum purchase per transaction, in cents ($10,000)',    '2026-01-01', 'system:migration'),
  ('eligibility_years',         4,       'Years of continuous service before an employee may buy',  '2026-01-01', 'system:migration'),
  ('hold_service_years',        10,      'Years of service needed to keep shares after leaving',    '2026-01-01', 'system:migration'),
  ('hold_ownership_years',      5,       'Years of ownership needed to keep shares after leaving',  '2026-01-01', 'system:migration');
