const { buffer } = require("node:stream/consumers");
const { getPool } = require("../../lib/db");

async function readJsonBody(req) {
  if (req.body != null) {
    if (typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
    if (typeof req.body === "string") {
      try {
        return JSON.parse(req.body || "{}");
      } catch {
        return {};
      }
    }
    if (Buffer.isBuffer(req.body)) {
      try {
        return JSON.parse(req.body.toString("utf8") || "{}");
      } catch {
        return {};
      }
    }
  }
  try {
    const buf = await buffer(req);
    const s = buf.toString("utf8");
    if (!s.trim()) return {};
    return JSON.parse(s);
  } catch {
    return {};
  }
}

function toNonNegativeNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET, PATCH, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }

  let pool;
  try {
    pool = getPool();
  } catch (e) {
    return res.status(500).json({ error: e.message || "Database not configured" });
  }

  try {
    if (req.method === "GET") {
      const r = await pool.query(
        `SELECT id, provider_id, display_name,
                pto_ytd_hours_accrued, pto_ytd_hours_used,
                sick_ytd_hours_accrued, sick_ytd_hours_used
         FROM payroll.employees
         ORDER BY display_name ASC, provider_id ASC`
      );
      return res.status(200).json({
        employees: r.rows.map((x) => ({
          id: x.id,
          providerId: x.provider_id,
          displayName: x.display_name,
          ptoYtdHoursAccrued: Number(x.pto_ytd_hours_accrued) || 0,
          ptoYtdHoursUsed: Number(x.pto_ytd_hours_used) || 0,
          sickYtdHoursAccrued: Number(x.sick_ytd_hours_accrued) || 0,
          sickYtdHoursUsed: Number(x.sick_ytd_hours_used) || 0,
        })),
      });
    }

    if (req.method === "PATCH") {
      const body = await readJsonBody(req);
      const rows = Array.isArray(body.rows) ? body.rows : [];
      if (!rows.length) return res.status(400).json({ error: "rows[] is required" });

      await pool.query("BEGIN");
      const batchInserted = await pool.query(
        `INSERT INTO payroll.leave_change_batches (operation_type)
         VALUES ('manual_update')
         RETURNING id`
      );
      const batchId = batchInserted.rows[0]?.id;
      for (const row of rows) {
        const id = String(row.id || "").trim();
        if (!id) continue;

        const beforeR = await pool.query(
          `SELECT id,
                  pto_ytd_hours_accrued, pto_ytd_hours_used,
                  sick_ytd_hours_accrued, sick_ytd_hours_used
           FROM payroll.employees
           WHERE id = $1::uuid
           FOR UPDATE`,
          [id]
        );
        const before = beforeR.rows[0];
        if (!before) continue;

        const afterPtoAccrued = toNonNegativeNumber(row.ptoYtdHoursAccrued);
        const afterPtoUsed = toNonNegativeNumber(row.ptoYtdHoursUsed);
        const afterSickAccrued = toNonNegativeNumber(row.sickYtdHoursAccrued);
        const afterSickUsed = toNonNegativeNumber(row.sickYtdHoursUsed);

        await pool.query(
          `UPDATE payroll.employees
           SET pto_ytd_hours_accrued = $1,
               pto_ytd_hours_used = $2,
               sick_ytd_hours_accrued = $3,
               sick_ytd_hours_used = $4,
               updated_at = now()
           WHERE id = $5::uuid`,
          [
            afterPtoAccrued,
            afterPtoUsed,
            afterSickAccrued,
            afterSickUsed,
            id,
          ]
        );

        await pool.query(
          `INSERT INTO payroll.leave_change_batch_details (
             batch_id, employee_id,
             pto_ytd_hours_accrued_before, pto_ytd_hours_used_before,
             sick_ytd_hours_accrued_before, sick_ytd_hours_used_before,
             pto_ytd_hours_accrued_after, pto_ytd_hours_used_after,
             sick_ytd_hours_accrued_after, sick_ytd_hours_used_after
           ) VALUES (
             $1, $2,
             $3, $4,
             $5, $6,
             $7, $8,
             $9, $10
           )`,
          [
            batchId,
            before.id,
            Number(before.pto_ytd_hours_accrued) || 0,
            Number(before.pto_ytd_hours_used) || 0,
            Number(before.sick_ytd_hours_accrued) || 0,
            Number(before.sick_ytd_hours_used) || 0,
            afterPtoAccrued,
            afterPtoUsed,
            afterSickAccrued,
            afterSickUsed,
          ]
        );
      }
      await pool.query("COMMIT");
      return res.status(200).json({ ok: true, batchId });
    }

    res.setHeader("Allow", "GET, PATCH, OPTIONS");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    try {
      await pool.query("ROLLBACK");
    } catch {
      // ignore
    }
    return res.status(500).json({ error: e?.message || "Request failed" });
  }
}

