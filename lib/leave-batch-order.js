/**
 * Which PTO/Sick batch counts as "the latest", in one place.
 *
 * Two callers depend on this agreeing: the history panel labels a row "current
 * — most recent", and a no-argument rollback acts on whatever this resolves to.
 * When the rule lived in both files, any edit to one would have made the label
 * point at a different batch than the button takes — and mistaking one batch
 * for another is what made the 26 Aug 2026 duplicate so hard to unpick.
 *
 * Ordered by the largest detail id, not the batch UUID and not created_at:
 * gen_random_uuid() is not chronological, and two batches recorded seconds
 * apart share a timestamp closely enough to tie — which is exactly the case
 * that went wrong.
 *
 * Both fragments assume the batch table is aliased `b`.
 */

const LATEST_BATCH_ORDER_BY = `(
  SELECT COALESCE(MAX(d_ord.id), 0)
    FROM payroll.leave_change_batch_details d_ord
   WHERE d_ord.batch_id = b.id
) DESC, b.created_at DESC`;

const BATCH_COLUMNS = `b.id, b.operation_type, b.created_at, b.rolled_back_at`;

/** The one batch a rollback would take when none is named. */
function latestRollbackableSql(forUpdate) {
  return `SELECT ${BATCH_COLUMNS}
            FROM payroll.leave_change_batches b
           WHERE b.rolled_back_at IS NULL
             AND EXISTS (SELECT 1 FROM payroll.leave_change_batch_details d
                          WHERE d.batch_id = b.id)
           ORDER BY ${LATEST_BATCH_ORDER_BY}
           LIMIT 1
           ${forUpdate ? "FOR UPDATE OF b" : ""}`;
}

/** Its id alone, for callers that only need to mark a row as current. */
async function findLatestRollbackableBatchId(db) {
  const r = await db.query(latestRollbackableSql(false));
  return r.rows[0]?.id || null;
}

module.exports = {
  BATCH_COLUMNS,
  LATEST_BATCH_ORDER_BY,
  latestRollbackableSql,
  findLatestRollbackableBatchId,
};
