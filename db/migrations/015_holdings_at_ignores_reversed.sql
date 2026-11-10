-- Holdings on a past date must ignore entries that were later reversed, and their corrections,
-- whatever date the correction was recorded on: a reversal means the entry never happened.
-- (Before this, "Start over" reversals dated today left the originals counting for past dates,
-- doubling record-date holdings when the history was re-entered.)
CREATE OR REPLACE FUNCTION app.holdings_at(p_date date)
RETURNS TABLE (holder_id uuid, shares bigint)
LANGUAGE sql STABLE AS $$
  WITH live AS (
    SELECT l.* FROM share_ledger l
    WHERE l.type <> 'correction'
      AND NOT EXISTS (SELECT 1 FROM share_ledger c WHERE c.reverses_entry_id = l.id)
  )
  SELECT m.holder_id, sum(m.delta)::bigint
  FROM (SELECT to_holder_id AS holder_id, shares AS delta, entry_date FROM live
        UNION ALL
        SELECT from_holder_id, -shares, entry_date FROM live) m
  WHERE m.entry_date <= p_date
  GROUP BY m.holder_id
  HAVING sum(m.delta) > 0
$$;
