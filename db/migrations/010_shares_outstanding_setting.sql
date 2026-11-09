-- Total shares outstanding across all classes: the denominator in the price formula
-- (SPEC: (7 × audited EBITDA − debt) ÷ total shares outstanding, all classes).
-- 100,078 Class A shares as of November 2026. Change it on Admin → Settings when counsel
-- creates new classes; each change is a new dated row, so past valuations stay reproducible.
INSERT INTO settings (key, int_value, description, effective_from, created_by)
VALUES ('shares_outstanding_total', 100078,
        'Total shares outstanding across all classes (price formula denominator)',
        '2026-11-01', 'system:migration');
