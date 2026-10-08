-- Every change to a saved adjustment, kept after the adjustment itself is gone.
--
-- payroll_adj_resub_rows holds only the current value, and clearing a value
-- deletes its row outright. That is the right shape for deciding what gets
-- paid, but it meant a figure that was saved, locked and paid could vanish
-- with no record that it ever existed or who removed it. On 8 Oct 2026 two
-- adjustments were committed by accident and later cleared; afterwards the
-- only evidence of either event was a conversation.
--
-- Append-only. Rows are written in the same statement as the change they
-- describe, so the history cannot disagree with what actually happened.

CREATE TABLE IF NOT EXISTS payroll.payroll_adj_resub_audit (
  id BIGSERIAL PRIMARY KEY,
  payroll_end_date DATE NOT NULL,
  row_key TEXT NOT NULL,
  -- 'saved' when a value is stored or replaced, 'cleared' when it is removed.
  action TEXT NOT NULL CHECK (action IN ('saved', 'cleared')),
  employee_name TEXT NOT NULL DEFAULT '',
  rate_code TEXT NOT NULL DEFAULT '',
  referral_number TEXT NOT NULL DEFAULT '',
  date_from TEXT NOT NULL DEFAULT '',
  date_to TEXT NOT NULL DEFAULT '',
  spreadsheet_units NUMERIC(12, 4),
  -- For 'cleared', the value that stopped being paid.
  resolved_units NUMERIC(12, 4),
  actor_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payroll_adj_resub_audit_period
  ON payroll.payroll_adj_resub_audit (payroll_end_date DESC, created_at DESC);

COMMENT ON TABLE payroll.payroll_adj_resub_audit IS
  'Append-only history of saved and cleared adjustment units, by payroll period.';
