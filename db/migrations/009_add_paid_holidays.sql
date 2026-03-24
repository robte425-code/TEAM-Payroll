-- Per-employee: whether paid company holidays apply to this employee.
ALTER TABLE payroll.employees
ADD COLUMN IF NOT EXISTS paid_holidays BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN payroll.employees.paid_holidays IS 'Whether this employee receives paid holidays.';
