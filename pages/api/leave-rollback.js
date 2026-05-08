const { getPool } = require("../../lib/db");

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
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

    const lastBatchR = await client.query(
      `SELECT id, operation_type, created_at
       FROM payroll.leave_change_batches
       WHERE rolled_back_at IS NULL
       ORDER BY created_at DESC, id DESC
       LIMIT 1
       FOR UPDATE`
    );
    const batch = lastBatchR.rows[0];
    if (!batch) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "No change batch to roll back" });
    }

    const detailsR = await client.query(
      `SELECT *
       FROM payroll.leave_change_batch_details
       WHERE batch_id = $1
       ORDER BY id DESC`,
      [batch.id]
    );

    let employeesUpdated = 0;
    for (const d of detailsR.rows) {
      await client.query(
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
          d.employee_id,
        ]
      );

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
      employeesUpdated += 1;
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
