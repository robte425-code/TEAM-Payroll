-- Per-employee discretionary bonus on stored Payroll 2.0 runs (e.g. year-end bonuses).

ALTER TABLE payroll.payroll_run_rows
ADD COLUMN IF NOT EXISTS discretionary_bonus NUMERIC(12, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN payroll.payroll_run_rows.discretionary_bonus IS 'Manual discretionary bonus ($) entered for the pay period.';
