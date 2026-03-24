-- Mileage rate is organization-wide (payroll.app_kv); remove per-employee column.
ALTER TABLE payroll.employees
DROP COLUMN IF EXISTS mileage_rate;
