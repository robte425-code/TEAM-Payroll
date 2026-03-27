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
    let updatedEmployees = 0;

    for (const r of rows) {
      const providerId = String(r.providerId || "").trim();
      const employeeName = String(r.employeeName || "").trim();
      if (!providerId || !employeeName) continue;

      const ptoAccrual = toNonNegativeNumber(r.ptoAccrualHours);
      const ptoUsed = toNonNegativeNumber(r.ptoUsedHours);
      const sickAccrual = toNonNegativeNumber(r.sickAccrualHours);
      const sickUsed = toNonNegativeNumber(r.sickUsedHours);

      await pool.query(
        `UPDATE payroll.employees
         SET pto_ytd_hours_accrued = pto_ytd_hours_accrued + $1,
             pto_ytd_hours_used = pto_ytd_hours_used + $2,
             sick_ytd_hours_accrued = sick_ytd_hours_accrued + $3,
             sick_ytd_hours_used = sick_ytd_hours_used + $4,
             updated_at = now()
         WHERE provider_id = $5`,
        [ptoAccrual, ptoUsed, sickAccrual, sickUsed, providerId]
      );

      if (ptoAccrual > 0) {
        await pool.query(
          `INSERT INTO payroll.pto_log (employee_name, action_date, action, reason)
           VALUES ($1, CURRENT_DATE, 'Accrual', $2)`,
          [employeeName, "PTO accrual from billable hours"]
        );
      }
      if (ptoUsed > 0) {
        await pool.query(
          `INSERT INTO payroll.pto_log (employee_name, action_date, action, reason)
           VALUES ($1, CURRENT_DATE, 'Used', $2)`,
          [employeeName, "PTO used from non-bill file (Z PTO)"]
        );
      }
      if (sickAccrual > 0) {
        await pool.query(
          `INSERT INTO payroll.sick_time_log (employee_name, action_date, action, reason)
           VALUES ($1, CURRENT_DATE, 'Accrual', $2)`,
          [employeeName, "Sick time accrual from billable hours"]
        );
      }
      if (sickUsed > 0) {
        await pool.query(
          `INSERT INTO payroll.sick_time_log (employee_name, action_date, action, reason)
           VALUES ($1, CURRENT_DATE, 'Used', $2)`,
          [employeeName, "Sick time used from non-bill file (Z Sick time)"]
        );
      }
      updatedEmployees += 1;
    }

    await pool.query("COMMIT");
    return res.status(200).json({ ok: true, updatedEmployees });
  } catch (e) {
    try {
      await pool.query("ROLLBACK");
    } catch {
      // ignore
    }
    return res.status(500).json({ error: e?.message || "Request failed" });
  }
}

