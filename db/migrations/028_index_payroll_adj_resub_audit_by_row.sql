-- Look up the history of one adjustment line directly.
--
-- "Who saved this, and who cleared it?" is the question the audit table
-- exists to answer, and it filters on row_key. Migration 027 indexed only the
-- period, so that lookup scanned every entry for the period. The table is
-- append-only and never pruned, so the cost would only grow.

CREATE INDEX IF NOT EXISTS idx_payroll_adj_resub_audit_row
  ON payroll.payroll_adj_resub_audit (row_key, created_at DESC);
