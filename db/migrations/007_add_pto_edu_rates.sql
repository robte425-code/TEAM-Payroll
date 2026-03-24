-- Per-employee PTO and Edu pay rates (currency units per your payroll convention).
ALTER TABLE payroll.employees
ADD COLUMN IF NOT EXISTS pto_rate NUMERIC(12, 4) NOT NULL DEFAULT 0
  CHECK (pto_rate >= 0);

ALTER TABLE payroll.employees
ADD COLUMN IF NOT EXISTS edu_rate NUMERIC(12, 4) NOT NULL DEFAULT 0
  CHECK (edu_rate >= 0);

COMMENT ON COLUMN payroll.employees.pto_rate IS 'PTO pay rate (e.g. dollars per hour).';
COMMENT ON COLUMN payroll.employees.edu_rate IS 'Education (Edu) pay rate (e.g. dollars per hour).';
