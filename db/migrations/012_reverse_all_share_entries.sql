-- "Start over": reverse every share movement that hasn't already been reversed, newest first
-- (an undo stack, so no balance can go negative midway). Nothing is deleted: each reversal is a
-- correction entry, and the audit log records who did it. Admin-only through RLS on share_ledger.
CREATE OR REPLACE FUNCTION app.reverse_all_share_entries(p_memo text) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  e share_ledger;
  n integer := 0;
BEGIN
  IF NOT app.is_admin() AND current_user = 'app_user' THEN
    RAISE EXCEPTION 'only admins can reverse share entries' USING ERRCODE = 'insufficient_privilege';
  END IF;
  FOR e IN
    SELECT * FROM share_ledger l
    WHERE l.type <> 'correction'
      AND NOT EXISTS (SELECT 1 FROM share_ledger c WHERE c.reverses_entry_id = l.id)
    ORDER BY l.id DESC
  LOOP
    INSERT INTO share_ledger (entry_date, type, from_holder_id, to_holder_id, shares, price_cents, amount_cents, reverses_entry_id, memo)
    VALUES (current_date, 'correction', e.to_holder_id, e.from_holder_id, e.shares, e.price_cents, e.amount_cents, e.id, p_memo);
    n := n + 1;
  END LOOP;
  RETURN n;
END
$$;

REVOKE ALL ON FUNCTION app.reverse_all_share_entries(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.reverse_all_share_entries(text) TO app_user;
