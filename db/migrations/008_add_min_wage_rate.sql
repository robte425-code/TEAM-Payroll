-- Per-employee minimum wage rate (currency per hour; payroll floor for that employee).
ALTER TABLE payroll.employees
ADD COLUMN IF NOT EXISTS min_wage_rate NUMERIC(12, 4) NOT NULL DEFAULT 0
  CHECK (min_wage_rate >= 0);

COMMENT ON COLUMN payroll.employees.min_wage_rate IS 'Minimum wage rate for this employee (e.g. dollars per hour).';
