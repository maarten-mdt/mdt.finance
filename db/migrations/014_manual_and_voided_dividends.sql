-- Past dividends: amounts entered per person (to match what was actually paid when the share
-- structure was different), people who don't hold shares on the ledger at the record date, and
-- voiding a dividend that was entered wrong.

ALTER TABLE dividends DROP CONSTRAINT IF EXISTS dividends_input_mode_check;
ALTER TABLE dividends ADD CONSTRAINT dividends_input_mode_check CHECK (input_mode IN ('total', 'per_share', 'manual'));
ALTER TABLE dividends DROP CONSTRAINT dividends_per_share_when_needed;
ALTER TABLE dividends ADD CONSTRAINT dividends_per_share_when_needed
  CHECK (input_mode IN ('total', 'manual') OR amount_per_share_cents IS NOT NULL);

ALTER TABLE dividend_allocations DROP CONSTRAINT IF EXISTS dividend_allocations_shares_on_record_date_check;
ALTER TABLE dividend_allocations ADD CONSTRAINT dividend_allocations_shares_on_record_date_check CHECK (shares_on_record_date >= 0);

ALTER TABLE dividends ADD COLUMN voided_at timestamptz;
ALTER TABLE dividends ADD COLUMN voided_by text;
ALTER TABLE dividends ADD COLUMN void_reason text;

-- Void: reverse every cash entry the dividend created (payouts first, then the dividend credits),
-- newest first, and mark it voided. Nothing is deleted. Admin-only.
CREATE OR REPLACE FUNCTION app.void_dividend(p_dividend uuid, p_reason text) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  e credit_ledger;
  n integer := 0;
BEGIN
  IF NOT app.is_admin() AND current_user = 'app_user' THEN
    RAISE EXCEPTION 'only admins can void a dividend' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM dividends WHERE id = p_dividend AND voided_at IS NULL) THEN
    RAISE EXCEPTION 'dividend not found or already voided';
  END IF;
  FOR e IN
    SELECT * FROM credit_ledger l
    WHERE l.dividend_id = p_dividend AND l.type <> 'correction'
      AND NOT EXISTS (SELECT 1 FROM credit_ledger c WHERE c.reverses_entry_id = l.id)
    ORDER BY l.id DESC
  LOOP
    INSERT INTO credit_ledger (entry_date, person_id, type, amount_cents, dividend_id, reverses_entry_id, memo)
    VALUES (current_date, e.person_id, 'correction', -e.amount_cents, p_dividend, e.id, 'Dividend voided: ' || coalesce(p_reason, ''));
    n := n + 1;
  END LOOP;
  UPDATE dividends SET voided_at = now(), voided_by = app.current_actor(), void_reason = p_reason WHERE id = p_dividend;
  RETURN n;
END
$$;
REVOKE ALL ON FUNCTION app.void_dividend(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.void_dividend(uuid, text) TO app_user;
