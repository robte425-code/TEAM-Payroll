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

async function resolveEmployeeForUpdate(pool, providerId, employeeName) {
  const pid = String(providerId || "").trim();
  const name = String(employeeName || "").trim();

  if (pid) {
    const byProvider = await pool.query(
      `SELECT id, provider_id,
              pto_ytd_hours_accrued, pto_ytd_hours_used,
              sick_ytd_hours_accrued, sick_ytd_hours_used
       FROM payroll.employees
       WHERE provider_id = $1
       FOR UPDATE`,
      [pid]
    );
    if (byProvider.rows[0]) return byProvider.rows[0];
  }

  if (name) {
    const byName = await pool.query(
      `SELECT id, provider_id,
              pto_ytd_hours_accrued, pto_ytd_hours_used,
              sick_ytd_hours_accrued, sick_ytd_hours_used
       FROM payroll.employees
       WHERE lower(regexp_replace(trim(display_name), '\s+', ' ', 'g')) =
             lower(regexp_replace(trim($1), '\s+', ' ', 'g'))
       ORDER BY updated_at DESC NULLS LAST, created_at DESC
       LIMIT 1
       FOR UPDATE`,
      [name]
    );
    if (byName.rows[0]) return byName.rows[0];
  }

  return null;
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ error: "Method not allowed" });
  }

  let pool;
  try {
    pool = getPool();
  } catch (e) {
    return res.status(500).json({ error: e.message || "Database not configured" });
  }

  try {
    const body = await readJsonBody(req);
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (!rows.length) return res.status(400).json({ error: "rows[] is required" });

    await pool.query("BEGIN");
    const batchInserted = await pool.query(
      `INSERT INTO payroll.leave_change_batches (operation_type)
       VALUES ('record')
       RETURNING id`
    );
    const batchId = batchInserted.rows[0]?.id;
    let updatedEmployees = 0;

    for (const r of rows) {
      const providerId = String(r.providerId || "").trim();
      const employeeName = String(r.employeeName || "").trim();
      if (!providerId || !employeeName) continue;

      const ptoAccrual = toNonNegativeNumber(r.ptoAccrualHours);
      const ptoUsed = toNonNegativeNumber(r.ptoUsedHours);
      const sickAccrual = toNonNegativeNumber(r.sickAccrualHours);
      const sickUsed = toNonNegativeNumber(r.sickUsedHours);

      const before = await resolveEmployeeForUpdate(pool, providerId, employeeName);
      if (!before) continue;

      const beforePtoAccrued = Number(before.pto_ytd_hours_accrued) || 0;
      const beforePtoUsed = Number(before.pto_ytd_hours_used) || 0;
      const beforeSickAccrued = Number(before.sick_ytd_hours_accrued) || 0;
      const beforeSickUsed = Number(before.sick_ytd_hours_used) || 0;

      const afterPtoAccrued = beforePtoAccrued + ptoAccrual;
      const afterPtoUsed = beforePtoUsed + ptoUsed;
      const afterSickAccrued = beforeSickAccrued + sickAccrual;
      const afterSickUsed = beforeSickUsed + sickUsed;

      await pool.query(
        `UPDATE payroll.employees
         SET pto_ytd_hours_accrued = $1,
             pto_ytd_hours_used = $2,
             sick_ytd_hours_accrued = $3,
             sick_ytd_hours_used = $4,
             updated_at = now()
         WHERE id = $5::uuid`,
        [afterPtoAccrued, afterPtoUsed, afterSickAccrued, afterSickUsed, before.id]
      );

      const ptoLogIds = [];
      const sickLogIds = [];
      if (ptoAccrual > 0) {
        const ins = await pool.query(
          `INSERT INTO payroll.pto_log (employee_name, action_date, action, hours, reason)
           VALUES ($1, CURRENT_DATE, 'Accrual', $2, $3)
           RETURNING id`,
          [employeeName, ptoAccrual, "PTO accrual from billable hours"]
        );
        if (ins.rows[0]?.id) ptoLogIds.push(ins.rows[0].id);
      }
      if (ptoUsed > 0) {
        const ins = await pool.query(
          `INSERT INTO payroll.pto_log (employee_name, action_date, action, hours, reason)
           VALUES ($1, CURRENT_DATE, 'Used', $2, $3)
           RETURNING id`,
          [employeeName, ptoUsed, "PTO used from non-bill file (Z PTO)"]
        );
        if (ins.rows[0]?.id) ptoLogIds.push(ins.rows[0].id);
      }
      if (sickAccrual > 0) {
        const ins = await pool.query(
          `INSERT INTO payroll.sick_time_log (employee_name, action_date, action, hours, reason)
           VALUES ($1, CURRENT_DATE, 'Accrual', $2, $3)
           RETURNING id`,
          [employeeName, sickAccrual, "Sick time accrual from billable hours"]
        );
        if (ins.rows[0]?.id) sickLogIds.push(ins.rows[0].id);
      }
      if (sickUsed > 0) {
        const ins = await pool.query(
          `INSERT INTO payroll.sick_time_log (employee_name, action_date, action, hours, reason)
           VALUES ($1, CURRENT_DATE, 'Used', $2, $3)
           RETURNING id`,
          [employeeName, sickUsed, "Sick time used from non-bill file (Z Sick time)"]
        );
        if (ins.rows[0]?.id) sickLogIds.push(ins.rows[0].id);
      }

      await pool.query(
        `INSERT INTO payroll.leave_change_batch_details (
           batch_id, employee_id,
           pto_ytd_hours_accrued_before, pto_ytd_hours_used_before,
           sick_ytd_hours_accrued_before, sick_ytd_hours_used_before,
           pto_ytd_hours_accrued_after, pto_ytd_hours_used_after,
           sick_ytd_hours_accrued_after, sick_ytd_hours_used_after,
           pto_log_ids, sick_log_ids
         ) VALUES (
           $1, $2,
           $3, $4,
           $5, $6,
           $7, $8,
           $9, $10,
           $11::uuid[], $12::uuid[]
         )`,
        [
          batchId,
          before.id,
          beforePtoAccrued,
          beforePtoUsed,
          beforeSickAccrued,
          beforeSickUsed,
          afterPtoAccrued,
          afterPtoUsed,
          afterSickAccrued,
          afterSickUsed,
          ptoLogIds,
          sickLogIds,
        ]
      );
      updatedEmployees += 1;
    }

    if (updatedEmployees <= 0) {
      await pool.query("ROLLBACK");
      return res.status(400).json({
        error:
          "No employees were recorded. Please regenerate Payroll 2.0 and ensure employee Provider IDs are present.",
      });
    }

    await pool.query("COMMIT");
    return res.status(200).json({ ok: true, updatedEmployees, batchId });
  } catch (e) {
    try {
      await pool.query("ROLLBACK");
    } catch {
      // ignore
    }
    return res.status(500).json({ error: e?.message || "Request failed" });
  }
}

