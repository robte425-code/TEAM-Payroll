-- Persistent admin notes on the TEAM Payroll Analyzer page.

CREATE TABLE IF NOT EXISTS payroll.analyzer_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL DEFAULT '',
  created_by_email TEXT,
  updated_by_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analyzer_notes_updated_at
  ON payroll.analyzer_notes (updated_at DESC);

COMMENT ON TABLE payroll.analyzer_notes IS 'Admin notes persisted on the Payroll Analyzer page.';
