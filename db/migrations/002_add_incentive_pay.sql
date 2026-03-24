-- Add incentive pay flag per employee.
ALTER TABLE payroll.employees
ADD COLUMN IF NOT EXISTS incentive_pay BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN payroll.employees.incentive_pay IS 'Whether employee receives incentive pay.';
