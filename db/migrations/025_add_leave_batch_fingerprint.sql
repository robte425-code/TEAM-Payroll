-- Identify a leave recording by its contents, so the same one cannot be
-- applied twice.
--
-- On 26 Aug 2026 an identical 'record' batch went in at 20:05:23 and again at
-- 20:06:06, doubling PTO and sick hours for all 13 employees. Nothing rejected
-- the second one. The damage is invisible on the day — balances are simply
-- wrong from then on — and it took a fortnight to notice.

ALTER TABLE payroll.leave_change_batches
ADD COLUMN IF NOT EXISTS request_fingerprint TEXT;

-- Only un-rolled-back batches are compared, so re-recording after a deliberate
-- rollback stays possible. That is a real workflow: it is what happened earlier
-- the same evening.
CREATE INDEX IF NOT EXISTS idx_leave_change_batches_fingerprint
  ON payroll.leave_change_batches (request_fingerprint, created_at DESC)
  WHERE rolled_back_at IS NULL AND request_fingerprint IS NOT NULL;
