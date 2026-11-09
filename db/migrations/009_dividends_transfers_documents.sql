-- Dividends declared by total, file storage for agreements, and the upload-and-return
-- signing flow. Holders still never write directly: returning a signed agreement goes through
-- app.return_signed_agreement(), which only accepts their own outstanding request.

-- ---- Dividends: declare by total amount or by amount per share ---------------------------------
ALTER TABLE dividends ALTER COLUMN amount_per_share_cents DROP NOT NULL;
ALTER TABLE dividends ADD COLUMN input_mode text NOT NULL DEFAULT 'per_share' CHECK (input_mode IN ('total', 'per_share'));
ALTER TABLE dividends ADD CONSTRAINT dividends_per_share_when_needed
  CHECK (input_mode = 'total' OR amount_per_share_cents IS NOT NULL);
ALTER TABLE dividends ADD COLUMN memo text;

ALTER TABLE dividend_allocations ADD COLUMN paid_on date;
ALTER TABLE dividend_allocations ADD COLUMN payout_entry_id bigint REFERENCES credit_ledger(id);
ALTER TABLE dividend_allocations ADD CONSTRAINT dividend_allocations_paid_consistent
  CHECK ((disposition = 'paid_out') = (paid_on IS NOT NULL AND payout_entry_id IS NOT NULL));

-- Shares each holder held at the end of a date (for record dates). Admin-only via RLS on share_ledger.
CREATE OR REPLACE FUNCTION app.holdings_at(p_date date)
RETURNS TABLE (holder_id uuid, shares bigint)
LANGUAGE sql STABLE AS $$
  SELECT m.holder_id, sum(m.delta)::bigint
  FROM (SELECT to_holder_id AS holder_id, shares AS delta, entry_date FROM share_ledger
        UNION ALL
        SELECT from_holder_id, -shares, entry_date FROM share_ledger) m
  WHERE m.entry_date <= p_date
  GROUP BY m.holder_id
  HAVING sum(m.delta) > 0
$$;

-- ---- Files ------------------------------------------------------------------------------------
-- PDFs live in Postgres: a few dozen agreements don't justify separate storage, and this keeps
-- them inside the same backups, transactions and access rules as everything else.
CREATE TABLE files (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name     text NOT NULL,
  content_type  text NOT NULL CHECK (content_type = 'application/pdf'),
  size_bytes    integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  sha256        text NOT NULL,
  content       bytea NOT NULL,
  uploaded_by   text NOT NULL DEFAULT app.current_actor(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Agreement versions an admin can send out (e.g. "Shareholder agreement v1, March 2027").
CREATE TABLE agreement_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type        document_type NOT NULL DEFAULT 'shareholder_agreement',
  version     text NOT NULL,
  file_id     uuid NOT NULL REFERENCES files(id),
  is_current  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (type, version)
);
CREATE UNIQUE INDEX agreement_templates_one_current ON agreement_templates (type) WHERE is_current;

-- documents: one row per agreement per person.
--   sent      → admin sent a template; the person needs to sign and return it
--   signed    → the person uploaded a signed copy; waiting for an admin to confirm
--   complete  → confirmed (or uploaded directly by an admin), with the date it was signed
--   void      → rejected or withdrawn
ALTER TABLE documents ADD COLUMN template_id uuid REFERENCES agreement_templates(id);
ALTER TABLE documents ADD COLUMN signed_file_id uuid REFERENCES files(id);
ALTER TABLE documents ADD COLUMN signed_on date;
ALTER TABLE documents ADD COLUMN sent_at timestamptz;
ALTER TABLE documents ADD COLUMN returned_at timestamptz;
ALTER TABLE documents ADD COLUMN reviewed_by text;
ALTER TABLE documents ADD COLUMN reviewed_at timestamptz;
ALTER TABLE documents ADD COLUMN note text;
ALTER TABLE documents ADD CONSTRAINT documents_complete_has_signature
  CHECK (status <> 'complete' OR (signed_file_id IS NOT NULL AND signed_on IS NOT NULL));
ALTER TABLE documents ADD CONSTRAINT documents_sent_has_template
  CHECK (status <> 'sent' OR template_id IS NOT NULL);

-- ---- Audit: never copy file contents into the log ----------------------------------------------
CREATE OR REPLACE FUNCTION app.redact(row_data jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN row_data IS NULL THEN NULL ELSE (
    SELECT coalesce(jsonb_object_agg(k, CASE
      WHEN k LIKE '%\_ciphertext' AND v <> 'null'::jsonb THEN to_jsonb('[encrypted]'::text)
      WHEN k = 'token_hash' THEN to_jsonb('[redacted]'::text)
      WHEN k = 'content' THEN to_jsonb('[file contents]'::text)
      ELSE v END), '{}'::jsonb)
    FROM jsonb_each(row_data) AS e(k, v)
  ) END
$$;

CREATE TRIGGER files_audit AFTER INSERT OR UPDATE OR DELETE ON files
  FOR EACH ROW EXECUTE FUNCTION app.audit_row();
CREATE TRIGGER agreement_templates_audit AFTER INSERT OR UPDATE OR DELETE ON agreement_templates
  FOR EACH ROW EXECUTE FUNCTION app.audit_row();

-- Files are evidence: never changed or deleted.
CREATE TRIGGER files_no_update BEFORE UPDATE OR DELETE ON files
  FOR EACH ROW EXECUTE FUNCTION app.append_only();

-- ---- RLS ------------------------------------------------------------------------------------
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE files FORCE ROW LEVEL SECURITY;
ALTER TABLE agreement_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE agreement_templates FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON files TO app_user;
GRANT SELECT, INSERT, UPDATE ON agreement_templates TO app_user;

-- Admins only; holders reach their own files through the functions below.
CREATE POLICY files_admin_read ON files FOR SELECT TO app_user USING (app.is_admin());
CREATE POLICY files_admin_insert ON files FOR INSERT TO app_user WITH CHECK (app.is_admin());
CREATE POLICY agreement_templates_admin_read ON agreement_templates FOR SELECT TO app_user USING (app.is_admin());
CREATE POLICY agreement_templates_admin_insert ON agreement_templates FOR INSERT TO app_user WITH CHECK (app.is_admin());
CREATE POLICY agreement_templates_admin_update ON agreement_templates FOR UPDATE TO app_user
  USING (app.is_admin()) WITH CHECK (app.is_admin());

-- A holder's file: the template they were sent, or the signed copy of their own document.
CREATE OR REPLACE FUNCTION app.my_document_file(p_document_id uuid, p_which text)
RETURNS TABLE (file_name text, content_type text, content bytea)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT f.file_name, f.content_type, f.content
  FROM documents d
  LEFT JOIN agreement_templates t ON t.id = d.template_id
  JOIN files f ON f.id = CASE p_which WHEN 'template' THEN t.file_id WHEN 'signed' THEN d.signed_file_id END
  WHERE d.id = p_document_id
    AND d.person_id = app.current_person_id()
    AND d.status <> 'void'
$$;

-- The only holder write in the system: return a signed copy of an agreement they were sent.
CREATE OR REPLACE FUNCTION app.return_signed_agreement(
  p_document_id uuid, p_file_name text, p_size integer, p_sha256 text, p_content bytea)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  doc documents;
  fid uuid;
BEGIN
  SELECT * INTO doc FROM documents WHERE id = p_document_id FOR UPDATE;
  IF doc.id IS NULL OR doc.person_id IS DISTINCT FROM app.current_person_id() THEN
    RAISE EXCEPTION 'agreement not found' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF doc.status NOT IN ('sent', 'signed') THEN
    RAISE EXCEPTION 'this agreement is not waiting for a signed copy';
  END IF;
  INSERT INTO files (file_name, content_type, size_bytes, sha256, content)
  VALUES (p_file_name, 'application/pdf', p_size, p_sha256, p_content)
  RETURNING id INTO fid;
  UPDATE documents SET status = 'signed', signed_file_id = fid, returned_at = now() WHERE id = doc.id;
END
$$;

REVOKE ALL ON FUNCTION app.my_document_file(uuid, text), app.return_signed_agreement(uuid, text, integer, text, bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.holdings_at(date), app.my_document_file(uuid, text),
  app.return_signed_agreement(uuid, text, integer, text, bytea) TO app_user;
