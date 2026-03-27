-- Track hours on each PTO/Sick log row.

ALTER TABLE payroll.pto_log
ADD COLUMN IF NOT EXISTS hours NUMERIC(12, 4) NOT NULL DEFAULT 0
  CHECK (hours >= 0);

ALTER TABLE payroll.sick_time_log
ADD COLUMN IF NOT EXISTS hours NUMERIC(12, 4) NOT NULL DEFAULT 0
  CHECK (hours >= 0);

