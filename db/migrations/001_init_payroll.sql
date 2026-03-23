-- TEAM Payroll — isolated schema in a shared Neon database.
-- Run against your Neon DB (same DB as TEAM Voc is OK; different tables/schema).
--
--   psql "$DATABASE_URL" -f db/migrations/001_init_payroll.sql
--
-- Or paste into Neon SQL Editor.

CREATE SCHEMA IF NOT EXISTS payroll;

CREATE TABLE IF NOT EXISTS payroll.employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  hourly_rate NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (hourly_rate >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payroll_employees_provider_id
  ON payroll.employees (provider_id);

-- Future-proof store for misc settings / JSON blobs (extend TEAM Payroll without new migrations for simple cases).
CREATE TABLE IF NOT EXISTS payroll.app_kv (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON SCHEMA payroll IS 'TEAM Payroll tables (shared Neon DB; other apps use their own schemas/tables).';
COMMENT ON TABLE payroll.employees IS 'Employee display name and hourly rate, keyed by Gardiant/LNI Provider ID.';
COMMENT ON TABLE payroll.app_kv IS 'Key-value / JSON settings for TEAM Payroll.';
