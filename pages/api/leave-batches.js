const { getPool } = require("../../lib/db");
const { requireRealAdmin } = require("../../lib/apiAuth");

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/**
 * Recent PTO/Sick change batches, newest first.
 *
 * Exists so a rollback can be aimed. "Roll back the last change" was the only
 * option, which is why the duplicate recorded on 26 Aug 2026 could not be
 * undone through the app at all — a later payroll sat on top of it, and the
 * button would have taken that instead.
 *
 * Ordered by the largest detail id rather than the batch UUID: gen_random_uuid()
 * is not chronological, and created_at alone cannot separate two batches
 * recorded seconds apart — which is exactly the case that went wrong.
 */
export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store, max-age=0");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const admin = await requireRealAdmin(req, res);
  if (!admin) return;

  let pool;
  try {
    pool = getPool();
  } catch (e) {
    return res.status(500).json({ error: e.message || "Database not configured" });
  }

  const requested = Number(req.query?.limit);
  const limit = Number.isFinite(requested)
    ? Math.min(Math.max(Math.trunc(requested), 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  try {
    const r = await pool.query(
      `SELECT b.id,
              b.operation_type,
              b.created_at,
              b.rolled_back_at,
              COALESCE(agg.detail_rows, 0)   AS detail_rows,
              COALESCE(agg.pto_accrued, 0)   AS pto_accrued,
              COALESCE(agg.pto_used, 0)      AS pto_used,
              COALESCE(agg.sick_accrued, 0)  AS sick_accrued,
              COALESCE(agg.sick_used, 0)     AS sick_used,
              COALESCE(agg.max_detail_id, 0) AS max_detail_id
         FROM payroll.leave_change_batches b
         LEFT JOIN LATERAL (
           SELECT count(*)::int AS detail_rows,
                  MAX(d.id)     AS max_detail_id,
                  SUM(d.pto_ytd_hours_accrued_after  - d.pto_ytd_hours_accrued_before)  AS pto_accrued,
                  SUM(d.pto_ytd_hours_used_after     - d.pto_ytd_hours_used_before)     AS pto_used,
                  SUM(d.sick_ytd_hours_accrued_after - d.sick_ytd_hours_accrued_before) AS sick_accrued,
                  SUM(d.sick_ytd_hours_used_after    - d.sick_ytd_hours_used_before)    AS sick_used
             FROM payroll.leave_change_batch_details d
            WHERE d.batch_id = b.id
         ) agg ON TRUE
        ORDER BY COALESCE(agg.max_detail_id, 0) DESC, b.created_at DESC
        LIMIT $1`,
      [limit]
    );

    // The one a no-argument rollback would take: newest that still has rows and
    // has not already been undone.
    const latest = r.rows.find(
      (x) => !x.rolled_back_at && Number(x.detail_rows) > 0
    );

    return res.status(200).json({
      batches: r.rows.map((x) => ({
        batchId: x.id,
        operationType: x.operation_type,
        createdAt: x.created_at,
        rolledBackAt: x.rolled_back_at,
        detailRows: Number(x.detail_rows) || 0,
        isLatestRollbackable: Boolean(latest && latest.id === x.id),
        totals: {
          ptoAccrued: Number(x.pto_accrued) || 0,
          ptoUsed: Number(x.pto_used) || 0,
          sickAccrued: Number(x.sick_accrued) || 0,
          sickUsed: Number(x.sick_used) || 0,
        },
      })),
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Request failed" });
  }
}
