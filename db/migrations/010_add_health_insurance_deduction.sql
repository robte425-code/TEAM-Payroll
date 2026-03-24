-- Per-employee health insurance deduction (dollars per pay period or as defined by payroll).
ALTER TABLE payroll.employees
ADD COLUMN IF NOT EXISTS health_insurance_deduction NUMERIC(12, 4) NOT NULL DEFAULT 0
  CHECK (health_insurance_deduction >= 0);

COMMENT ON COLUMN payroll.employees.health_insurance_deduction IS 'Health insurance deduction amount in dollars for this employee.';
