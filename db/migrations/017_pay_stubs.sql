-- Consolidated pay stub PDF uploads (split per employee).

CREATE TABLE IF NOT EXISTS payroll.pay_stub_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_date DATE NOT NULL,
  pay_period_start DATE,
  pay_period_end DATE,
  source_filename TEXT NOT NULL DEFAULT '',
  uploaded_by_email TEXT,
  page_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (check_date, pay_period_start, pay_period_end)
);

CREATE TABLE IF NOT EXISTS payroll.pay_stubs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES payroll.pay_stub_batches(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES payroll.employees(id) ON DELETE SET NULL,
  page_number INT NOT NULL,
  extracted_name TEXT NOT NULL DEFAULT '',
  payroll_relief_emp_no TEXT,
  pdf_data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (batch_id, page_number)
);

CREATE INDEX IF NOT EXISTS idx_pay_stubs_employee_id
  ON payroll.pay_stubs (employee_id);

CREATE INDEX IF NOT EXISTS idx_pay_stub_batches_check_date
  ON payroll.pay_stub_batches (check_date DESC);

COMMENT ON TABLE payroll.pay_stub_batches IS 'One uploaded consolidated PDF per pay period.';
COMMENT ON TABLE payroll.pay_stubs IS 'Individual employee pay stub PDF pages extracted from a batch.';
