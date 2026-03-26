-- Allowed access list for TEAM Payroll.
-- Only users whose email is present in this table (and is_enabled=true) can sign in.

CREATE TABLE IF NOT EXISTS payroll.app_access_emails (
  email TEXT PRIMARY KEY,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE payroll.app_access_emails
ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- Seed initial access users (requested).
INSERT INTO payroll.app_access_emails (email, is_enabled, is_admin)
VALUES
  ('robert@team-voc.com', TRUE, TRUE),
  ('julia@team-voc.com', TRUE, TRUE)
ON CONFLICT (email) DO NOTHING;

