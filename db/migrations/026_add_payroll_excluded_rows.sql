-- Billable lines the firm is rebilling but the employee has already been paid
-- for, so they must not be paid a second time.
--
-- The analyzer already drops anything flagged in the Adj/Resub column, but a
-- line moved to a different authorization arrives as ordinary new billing with
-- no flag at all. Before this there was no way to reduce such a line: the old
-- manual spreadsheet had one, the analyzer did not, and the only alternative
-- was paying it again and clawing it back.
--
-- Kept separate from payroll_adj_resub_rows on purpose. That table holds rows
-- that start excluded and may be added back; this one holds rows that start
-- included and are taken out. Same shape, opposite direction, different key
-- space — merging them would make both ambiguous.

CREATE TABLE IF NOT EXISTS payroll.payroll_excluded_rows (
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
  units NUMERIC(12, 4) NOT NULL DEFAULT 0,
  -- Why it was taken out. Required by the API: an unexplained exclusion is
  -- indistinguishable from a mistake when someone reviews this in six months.
  reason TEXT NOT NULL DEFAULT '',
  excluded_by_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (payroll_end_date, row_key)
);

CREATE INDEX IF NOT EXISTS idx_payroll_excluded_rows_end_date
  ON payroll.payroll_excluded_rows (payroll_end_date DESC);

COMMENT ON TABLE payroll.payroll_excluded_rows IS
  'Billable lines held out of pay for one payroll period, with the reason.';
