-- Per-employee incentive pay rate and mileage reimbursement rate.
ALTER TABLE payroll.employees
ADD COLUMN IF NOT EXISTS incentive_pay_rate NUMERIC(12, 4) NOT NULL DEFAULT 0
  CHECK (incentive_pay_rate >= 0);

ALTER TABLE payroll.employees
ADD COLUMN IF NOT EXISTS mileage_rate NUMERIC(12, 4) NOT NULL DEFAULT 0
  CHECK (mileage_rate >= 0);

COMMENT ON COLUMN payroll.employees.incentive_pay_rate IS 'Incentive pay amount/rate (currency units per your payroll convention).';
COMMENT ON COLUMN payroll.employees.mileage_rate IS 'Mileage rate (e.g. dollars per mile).';
