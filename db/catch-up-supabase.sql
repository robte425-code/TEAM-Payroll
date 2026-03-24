-- TEAM Payroll — run in Supabase SQL Editor in one go (order matters).
-- After this script, per-employee mileage_rate and incentive_pay_rate are REMOVED;
-- those values are stored in payroll.app_kv (see /api/settings). Matches current app on main.
--
-- If you still see "column incentive_pay_rate does not exist": deploy the latest code from
-- GitHub (employees API must not SELECT that column). If you are stuck on an OLD deployment
-- that still queries employees.incentive_pay_rate, run ONLY the 003 section first, then
-- deploy the new app and run 005–006.

-- ========== 001_init_payroll.sql ==========
CREATE SCHEMA IF NOT EXISTS payroll;

CREATE TABLE IF NOT EXISTS payroll.employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  hourly_rate NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (hourly_rate >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payroll_employees_provider_id
  ON payroll.employees (provider_id);

CREATE TABLE IF NOT EXISTS payroll.app_kv (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON SCHEMA payroll IS 'TEAM Payroll tables (shared Neon DB; other apps use their own schemas/tables).';
COMMENT ON TABLE payroll.employees IS 'Employee display name and hourly rate, keyed by Gardiant/LNI Provider ID.';
COMMENT ON TABLE payroll.app_kv IS 'Key-value / JSON settings for TEAM Payroll.';

-- ========== 002_add_incentive_pay.sql ==========
ALTER TABLE payroll.employees
ADD COLUMN IF NOT EXISTS incentive_pay BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN payroll.employees.incentive_pay IS 'Whether employee receives incentive pay.';

-- ========== 003_add_incentive_pay_rate_mileage_rate.sql ==========
ALTER TABLE payroll.employees
ADD COLUMN IF NOT EXISTS incentive_pay_rate NUMERIC(12, 4) NOT NULL DEFAULT 0
  CHECK (incentive_pay_rate >= 0);

ALTER TABLE payroll.employees
ADD COLUMN IF NOT EXISTS mileage_rate NUMERIC(12, 4) NOT NULL DEFAULT 0
  CHECK (mileage_rate >= 0);

COMMENT ON COLUMN payroll.employees.incentive_pay_rate IS 'Incentive pay amount/rate (currency units per your payroll convention).';
COMMENT ON COLUMN payroll.employees.mileage_rate IS 'Mileage rate (e.g. dollars per mile).';

-- ========== 004_add_travel_rate.sql ==========
ALTER TABLE payroll.employees
ADD COLUMN IF NOT EXISTS travel_rate NUMERIC(12, 4) NOT NULL DEFAULT 0
  CHECK (travel_rate >= 0);

COMMENT ON COLUMN payroll.employees.travel_rate IS 'Travel pay rate (e.g. dollars per unit or hour).';

-- ========== 005_drop_employee_mileage_rate.sql ==========
ALTER TABLE payroll.employees
DROP COLUMN IF EXISTS mileage_rate;

-- ========== 006_drop_employee_incentive_pay_rate.sql ==========
ALTER TABLE payroll.employees
DROP COLUMN IF EXISTS incentive_pay_rate;

-- ========== 007_add_pto_edu_rates.sql ==========
ALTER TABLE payroll.employees
ADD COLUMN IF NOT EXISTS pto_rate NUMERIC(12, 4) NOT NULL DEFAULT 0
  CHECK (pto_rate >= 0);

ALTER TABLE payroll.employees
ADD COLUMN IF NOT EXISTS edu_rate NUMERIC(12, 4) NOT NULL DEFAULT 0
  CHECK (edu_rate >= 0);

COMMENT ON COLUMN payroll.employees.pto_rate IS 'PTO pay rate (e.g. dollars per hour).';
COMMENT ON COLUMN payroll.employees.edu_rate IS 'Education (Edu) pay rate (e.g. dollars per hour).';

-- ========== 008_add_min_wage_rate.sql ==========
ALTER TABLE payroll.employees
ADD COLUMN IF NOT EXISTS min_wage_rate NUMERIC(12, 4) NOT NULL DEFAULT 0
  CHECK (min_wage_rate >= 0);

COMMENT ON COLUMN payroll.employees.min_wage_rate IS 'Minimum wage rate for this employee (e.g. dollars per hour).';

-- ========== 009_add_paid_holidays.sql ==========
ALTER TABLE payroll.employees
ADD COLUMN IF NOT EXISTS paid_holidays BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN payroll.employees.paid_holidays IS 'Whether this employee receives paid holidays.';
