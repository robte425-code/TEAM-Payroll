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

