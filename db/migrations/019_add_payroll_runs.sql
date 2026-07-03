-- Stored Payroll 2.0 runs keyed by payroll end date (overwrite on re-record).

CREATE TABLE IF NOT EXISTS payroll.payroll_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_end_date DATE NOT NULL,
  working_days INT,
  holiday_days INT,
  incentive_threshold NUMERIC(12, 4) NOT NULL DEFAULT 0,
  non_bill_file_name TEXT NOT NULL DEFAULT '',
  heather_commission NUMERIC(12, 2) NOT NULL DEFAULT 0,
  management_fee NUMERIC(12, 2) NOT NULL DEFAULT 0,
  nb_only_employee_names JSONB NOT NULL DEFAULT '[]'::jsonb,
  sums JSONB NOT NULL DEFAULT '{}'::jsonb,
  recorded_by_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (payroll_end_date)
);

CREATE TABLE IF NOT EXISTS payroll.payroll_run_rows (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES payroll.payroll_runs(id) ON DELETE CASCADE,
  sort_order INT NOT NULL DEFAULT 0,
  provider_id TEXT NOT NULL DEFAULT '',
  employee_name TEXT NOT NULL DEFAULT '',
  case_plus_reports NUMERIC(12, 4) NOT NULL DEFAULT 0,
  nb_time NUMERIC(12, 4) NOT NULL DEFAULT 0,
  travel_wait_hours NUMERIC(12, 4) NOT NULL DEFAULT 0,
  total_hours_worked NUMERIC(12, 4) NOT NULL DEFAULT 0,
  overtime_hours NUMERIC(12, 4) NOT NULL DEFAULT 0,
  pto_time NUMERIC(12, 4) NOT NULL DEFAULT 0,
  sick_time NUMERIC(12, 4) NOT NULL DEFAULT 0,
  regular_pay NUMERIC(12, 2) NOT NULL DEFAULT 0,
  overtime_pay NUMERIC(12, 2) NOT NULL DEFAULT 0,
  pto_pay NUMERIC(12, 2) NOT NULL DEFAULT 0,
  sick_pay NUMERIC(12, 2) NOT NULL DEFAULT 0,
  holiday_pay NUMERIC(12, 2) NOT NULL DEFAULT 0,
  training_pay NUMERIC(12, 2) NOT NULL DEFAULT 0,
  edu_pay NUMERIC(12, 2) NOT NULL DEFAULT 0,
  mileage NUMERIC(12, 4) NOT NULL DEFAULT 0,
  general_reimbursement NUMERIC(12, 2) NOT NULL DEFAULT 0,
  non_disc_bonus NUMERIC(12, 2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_payroll_runs_end_date
  ON payroll.payroll_runs (payroll_end_date DESC);

CREATE INDEX IF NOT EXISTS idx_payroll_run_rows_run_id
  ON payroll.payroll_run_rows (run_id);

COMMENT ON TABLE payroll.payroll_runs IS 'Payroll 2.0 run header; one row per payroll end date.';
COMMENT ON TABLE payroll.payroll_run_rows IS 'Per-employee Payroll 2.0 result rows for a stored run.';
