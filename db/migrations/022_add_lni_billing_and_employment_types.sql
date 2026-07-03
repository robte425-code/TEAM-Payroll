-- Employment type history (intern / full_time) and L&I billing rate schedules.

CREATE TABLE IF NOT EXISTS payroll.employee_employment_type_history (
  id BIGSERIAL PRIMARY KEY,
  employee_id UUID NOT NULL REFERENCES payroll.employees(id) ON DELETE CASCADE,
  employment_type TEXT NOT NULL CHECK (employment_type IN ('intern', 'full_time')),
  effective_date DATE NOT NULL,
  updated_by_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, effective_date)
);

CREATE INDEX IF NOT EXISTS idx_employee_employment_type_history_employee
  ON payroll.employee_employment_type_history (employee_id, effective_date DESC);

CREATE TABLE IF NOT EXISTS payroll.lni_billing_rate_schedules (
  id BIGSERIAL PRIMARY KEY,
  employment_type TEXT NOT NULL CHECK (employment_type IN ('intern', 'full_time')),
  effective_date DATE NOT NULL,
  professional_rate NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (professional_rate >= 0),
  travel_wait_rate NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (travel_wait_rate >= 0),
  updated_by_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employment_type, effective_date)
);

CREATE INDEX IF NOT EXISTS idx_lni_billing_rate_schedules_type_date
  ON payroll.lni_billing_rate_schedules (employment_type, effective_date DESC);

COMMENT ON TABLE payroll.employee_employment_type_history IS
  'Intern vs full-time classification by employee with effective dates.';
COMMENT ON TABLE payroll.lni_billing_rate_schedules IS
  'L&I billable rates per employment type; professional (case+report) and travel/wait.';
