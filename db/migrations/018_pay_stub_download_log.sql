-- Audit log for pay stub PDF downloads.

CREATE TABLE IF NOT EXISTS payroll.pay_stub_download_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pay_stub_id UUID REFERENCES payroll.pay_stubs(id) ON DELETE SET NULL,
  pay_stub_employee_id UUID REFERENCES payroll.employees(id) ON DELETE SET NULL,
  stub_employee_name TEXT NOT NULL DEFAULT '',
  check_date DATE,
  pay_period_start DATE,
  pay_period_end DATE,
  downloaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  session_email TEXT NOT NULL DEFAULT '',
  effective_email TEXT NOT NULL DEFAULT '',
  impersonating BOOLEAN NOT NULL DEFAULT false,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_pay_stub_download_log_downloaded_at
  ON payroll.pay_stub_download_log (downloaded_at DESC);

CREATE INDEX IF NOT EXISTS idx_pay_stub_download_log_pay_stub_id
  ON payroll.pay_stub_download_log (pay_stub_id);

CREATE INDEX IF NOT EXISTS idx_pay_stub_download_log_session_email
  ON payroll.pay_stub_download_log (session_email);

COMMENT ON TABLE payroll.pay_stub_download_log IS 'Who downloaded which pay stub PDF and when.';
