-- Health insurance monthly qualification: required hours = X * working days in month (default X = 7.2).

INSERT INTO payroll.app_kv (key, value, updated_at)
VALUES ('health_insurance_hours_per_working_day', '7.2'::jsonb, now())
ON CONFLICT (key) DO NOTHING;
