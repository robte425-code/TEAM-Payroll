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

-- ========== 010_add_health_insurance_deduction.sql ==========
ALTER TABLE payroll.employees
ADD COLUMN IF NOT EXISTS health_insurance_deduction NUMERIC(12, 4) NOT NULL DEFAULT 0
  CHECK (health_insurance_deduction >= 0);

COMMENT ON COLUMN payroll.employees.health_insurance_deduction IS 'Health insurance deduction amount in dollars for this employee.';

-- ========== 011_add_training_rate.sql ==========
ALTER TABLE payroll.employees
ADD COLUMN IF NOT EXISTS training_rate NUMERIC(12, 4) NOT NULL DEFAULT 0
  CHECK (training_rate >= 0);

COMMENT ON COLUMN payroll.employees.training_rate IS 'Training pay rate (e.g. dollars per hour).';

-- ========== 012_add_access_allowlist.sql ==========
-- Allowed access list for TEAM Payroll.
-- Only users whose email is present in this table (and is_enabled=true) can sign in.
CREATE TABLE IF NOT EXISTS payroll.app_access_emails (
  email TEXT PRIMARY KEY,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE payroll.app_access_emails
ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- Seed initial access users (requested).
INSERT INTO payroll.app_access_emails (email, is_enabled, is_admin)
VALUES
  ('robert@team-voc.com', TRUE, TRUE),
  ('julia@team-voc.com', TRUE, TRUE)
ON CONFLICT (email) DO NOTHING;

-- ========== 013_add_pto_sick_tracking.sql ==========
-- PTO/Sick YTD tracking on employees + PTO/Sick activity logs.
ALTER TABLE payroll.employees
ADD COLUMN IF NOT EXISTS pto_ytd_hours_accrued NUMERIC(12, 4) NOT NULL DEFAULT 0
  CHECK (pto_ytd_hours_accrued >= 0);

ALTER TABLE payroll.employees
ADD COLUMN IF NOT EXISTS pto_ytd_hours_used NUMERIC(12, 4) NOT NULL DEFAULT 0
  CHECK (pto_ytd_hours_used >= 0);

ALTER TABLE payroll.employees
ADD COLUMN IF NOT EXISTS sick_ytd_hours_accrued NUMERIC(12, 4) NOT NULL DEFAULT 0
  CHECK (sick_ytd_hours_accrued >= 0);

ALTER TABLE payroll.employees
ADD COLUMN IF NOT EXISTS sick_ytd_hours_used NUMERIC(12, 4) NOT NULL DEFAULT 0
  CHECK (sick_ytd_hours_used >= 0);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'payroll'
      AND t.typname = 'leave_action'
  ) THEN
    CREATE TYPE payroll.leave_action AS ENUM ('Accrual', 'Used');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS payroll.pto_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_name TEXT NOT NULL DEFAULT '',
  action_date DATE NOT NULL DEFAULT CURRENT_DATE,
  action payroll.leave_action NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payroll.sick_time_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_name TEXT NOT NULL DEFAULT '',
  action_date DATE NOT NULL DEFAULT CURRENT_DATE,
  action payroll.leave_action NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ========== 014_add_leave_change_batches.sql ==========
-- Batch history for PTO/Sick changes so "roll back last change" is reliable.
CREATE TABLE IF NOT EXISTS payroll.leave_change_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  rolled_back_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS payroll.leave_change_batch_details (
  id BIGSERIAL PRIMARY KEY,
  batch_id UUID NOT NULL REFERENCES payroll.leave_change_batches(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES payroll.employees(id) ON DELETE CASCADE,
  pto_ytd_hours_accrued_before NUMERIC(12, 4) NOT NULL DEFAULT 0,
  pto_ytd_hours_used_before NUMERIC(12, 4) NOT NULL DEFAULT 0,
  sick_ytd_hours_accrued_before NUMERIC(12, 4) NOT NULL DEFAULT 0,
  sick_ytd_hours_used_before NUMERIC(12, 4) NOT NULL DEFAULT 0,
  pto_ytd_hours_accrued_after NUMERIC(12, 4) NOT NULL DEFAULT 0,
  pto_ytd_hours_used_after NUMERIC(12, 4) NOT NULL DEFAULT 0,
  sick_ytd_hours_accrued_after NUMERIC(12, 4) NOT NULL DEFAULT 0,
  sick_ytd_hours_used_after NUMERIC(12, 4) NOT NULL DEFAULT 0,
  pto_log_ids UUID[] NOT NULL DEFAULT '{}'::uuid[],
  sick_log_ids UUID[] NOT NULL DEFAULT '{}'::uuid[]
);

CREATE INDEX IF NOT EXISTS idx_leave_change_batches_created_at
  ON payroll.leave_change_batches (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_leave_change_batch_details_batch_id
  ON payroll.leave_change_batch_details (batch_id);

-- ========== 015_add_leave_log_hours.sql ==========
-- Track hours on each PTO/Sick log row.
ALTER TABLE payroll.pto_log
ADD COLUMN IF NOT EXISTS hours NUMERIC(12, 4) NOT NULL DEFAULT 0
  CHECK (hours >= 0);

ALTER TABLE payroll.sick_time_log
ADD COLUMN IF NOT EXISTS hours NUMERIC(12, 4) NOT NULL DEFAULT 0
  CHECK (hours >= 0);

-- ========== 016_add_employee_login_email.sql ==========
ALTER TABLE payroll.employees
ADD COLUMN IF NOT EXISTS login_email TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_employees_login_email_lower
  ON payroll.employees (lower(trim(login_email)))
  WHERE login_email IS NOT NULL AND trim(login_email) <> '';

COMMENT ON COLUMN payroll.employees.login_email IS 'Work email for self-service; must match sign-in email.';
