-- Per-employee training pay rate (e.g. dollars per hour).
ALTER TABLE payroll.employees
ADD COLUMN IF NOT EXISTS training_rate NUMERIC(12, 4) NOT NULL DEFAULT 0
  CHECK (training_rate >= 0);

COMMENT ON COLUMN payroll.employees.training_rate IS 'Training pay rate (e.g. dollars per hour).';
