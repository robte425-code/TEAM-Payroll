-- Per-employee travel rate (currency units per your payroll convention).
ALTER TABLE payroll.employees
ADD COLUMN IF NOT EXISTS travel_rate NUMERIC(12, 4) NOT NULL DEFAULT 0
  CHECK (travel_rate >= 0);

COMMENT ON COLUMN payroll.employees.travel_rate IS 'Travel pay rate (e.g. dollars per unit or hour).';
