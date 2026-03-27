-- Batch history for PTO/Sick changes so "roll back last change" is reliable.

CREATE TABLE IF NOT EXISTS payroll.leave_change_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  rolled_back_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS payroll.leave_change_batch_details (
  id BIGSERIAL PRIMARY KEY,
  batch_id UUID NOT NULL REFERENCES payroll.leave_change_batches(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES payroll.employees(id) ON DELETE CASCADE,
  pto_ytd_hours_accrued_before NUMERIC(12, 4) NOT NULL DEFAULT 0,
  pto_ytd_hours_used_before NUMERIC(12, 4) NOT NULL DEFAULT 0,
  sick_ytd_hours_accrued_before NUMERIC(12, 4) NOT NULL DEFAULT 0,
  sick_ytd_hours_used_before NUMERIC(12, 4) NOT NULL DEFAULT 0,
  pto_ytd_hours_accrued_after NUMERIC(12, 4) NOT NULL DEFAULT 0,
  pto_ytd_hours_used_after NUMERIC(12, 4) NOT NULL DEFAULT 0,
  sick_ytd_hours_accrued_after NUMERIC(12, 4) NOT NULL DEFAULT 0,
  sick_ytd_hours_used_after NUMERIC(12, 4) NOT NULL DEFAULT 0,
  pto_log_ids UUID[] NOT NULL DEFAULT '{}'::uuid[],
  sick_log_ids UUID[] NOT NULL DEFAULT '{}'::uuid[]
);

CREATE INDEX IF NOT EXISTS idx_leave_change_batches_created_at
  ON payroll.leave_change_batches (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_leave_change_batch_details_batch_id
  ON payroll.leave_change_batch_details (batch_id);

