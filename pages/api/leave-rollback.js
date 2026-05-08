const { getPool } = require("../../lib/db");

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  let pool;
  try {
    pool = getPool();
  } catch (e) {
    return res.status(500).json({ error: e.message || "Database not configured" });
  }

  function asUuidArray(v) {
    if (Array.isArray(v)) return v;
    if (v == null) return [];
    if (typeof v === "string") {
      try {
        const p = JSON.parse(v);
        return Array.isArray(p) ? p : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `UPDATE payroll.leave_change_batches b
       SET rolled_back_at = now()
       WHERE b.rolled_back_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM payroll.leave_change_batch_details d WHERE d.batch_id = b.id
         )`
    );

    /** Latest batch that actually has detail rows (skip corrupt / empty batches). */
    let batch = null;
    let detailsR = null;
    for (let guard = 0; guard < 500; guard += 1) {
      // "Latest" batch = the one whose detail rows were inserted last (detail.id is BIGSERIAL).
      // Do not use batch UUID order — gen_random_uuid() is not chronological.
      const lastBatchR = await client.query(
        `SELECT b.id, b.operation_type, b.created_at
         FROM payroll.leave_change_batches b
         WHERE b.rolled_back_at IS NULL
         ORDER BY (
           SELECT COALESCE(MAX(d2.id), 0)
           FROM payroll.leave_change_batch_details d2
           WHERE d2.batch_id = b.id
         ) DESC,
         b.created_at DESC
         LIMIT 1
         FOR UPDATE OF b`
      );
      batch = lastBatchR.rows[0];
      if (!batch) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "No change batch to roll back" });
      }

      detailsR = await client.query(
        `SELECT *
         FROM payroll.leave_change_batch_details
         WHERE batch_id = $1
         ORDER BY id DESC`,
        [batch.id]
      );

      if (detailsR.rows.length === 0) {
        await client.query(
          `UPDATE payroll.leave_change_batches SET rolled_back_at = now() WHERE id = $1`,
          [batch.id]
        );
        batch = null;
        detailsR = null;
        continue;
      }
      break;
    }

    if (!batch || !detailsR || !detailsR.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "No change batch to roll back" });
    }

    let employeesUpdated = 0;
    for (const d of detailsR.rows) {
      const upd = await client.query(
        `UPDATE payroll.employees
         SET pto_ytd_hours_accrued = $1,
             pto_ytd_hours_used = $2,
             sick_ytd_hours_accrued = $3,
             sick_ytd_hours_used = $4,
             updated_at = now()
         WHERE id = $5::uuid`,
        [
          Number(d.pto_ytd_hours_accrued_before) || 0,
          Number(d.pto_ytd_hours_used_before) || 0,
          Number(d.sick_ytd_hours_accrued_before) || 0,
          Number(d.sick_ytd_hours_used_before) || 0,
          String(d.employee_id),
        ]
      );
      if ((upd.rowCount || 0) > 0) {
        employeesUpdated += 1;
      }

      const ptoIds = asUuidArray(d.pto_log_ids);
      if (ptoIds.length) {
        await client.query(`DELETE FROM payroll.pto_log WHERE id = ANY($1::uuid[])`, [ptoIds]);
      }
      const sickIds = asUuidArray(d.sick_log_ids);
      if (sickIds.length) {
        await client.query(`DELETE FROM payroll.sick_time_log WHERE id = ANY($1::uuid[])`, [
          sickIds,
        ]);
      }
    }

    await client.query(
      `UPDATE payroll.leave_change_batches
       SET rolled_back_at = now()
       WHERE id = $1`,
      [batch.id]
    );

    await client.query("COMMIT");
    return res.status(200).json({
      ok: true,
      batchId: batch.id,
      operationType: batch.operation_type,
      batchCreatedAt: batch.created_at,
      detailRows: detailsR.rows.length,
      employeesUpdated,
    });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore
    }
    return res.status(500).json({ error: e?.message || "Request failed" });
  } finally {
    client.release();
  }
}
