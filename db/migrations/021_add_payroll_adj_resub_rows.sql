-- Stored adjustment/resubmission unit edits keyed by payroll end date.

CREATE TABLE IF NOT EXISTS payroll.payroll_adj_resub_rows (
  id BIGSERIAL PRIMARY KEY,
  payroll_end_date DATE NOT NULL,
  row_key TEXT NOT NULL,
  source_file TEXT NOT NULL DEFAULT '',
  employee_name TEXT NOT NULL DEFAULT '',
  provider_id TEXT NOT NULL DEFAULT '',
  claimant TEXT NOT NULL DEFAULT '',
  referral_number TEXT NOT NULL DEFAULT '',
  rate_code TEXT NOT NULL DEFAULT '',
  date_from TEXT NOT NULL DEFAULT '',
  date_to TEXT NOT NULL DEFAULT '',
  adj_resub TEXT NOT NULL DEFAULT '',
  spreadsheet_units NUMERIC(12, 4) NOT NULL DEFAULT 0,
  resolved_units NUMERIC(12, 4),
  units_locked BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (payroll_end_date, row_key)
);

CREATE INDEX IF NOT EXISTS idx_payroll_adj_resub_rows_end_date
  ON payroll.payroll_adj_resub_rows (payroll_end_date DESC);

COMMENT ON TABLE payroll.payroll_adj_resub_rows IS
  'Per-line adjustment/resubmission unit edits from the Payroll Analyzer, keyed by payroll end date.';
