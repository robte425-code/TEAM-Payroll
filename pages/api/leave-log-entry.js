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

function toPositiveNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function normalizeAction(value) {
  const s = String(value || "").trim();
  if (s === "Accrual" || s === "Used") return s;
  return null;
}

function normalizeLogType(value) {
  const s = String(value || "").trim().toLowerCase();
  if (s === "pto" || s === "sick") return s;
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
    return res.status(500).json({ error: "Database not configured" });
  }

  const body = await readJsonBody(req);
  const employeeId = String(body.employeeId || "").trim();
  const logType = normalizeLogType(body.logType);
  const action = normalizeAction(body.action);
  const hours = toPositiveNumber(body.hours);
  const reason = String(body.reason ?? "").trim();

  if (!employeeId) return res.status(400).json({ error: "employeeId is required" });
  if (!logType) return res.status(400).json({ error: "logType must be pto or sick" });
  if (!action) return res.status(400).json({ error: "action must be Accrual or Used" });
  if (hours == null) return res.status(400).json({ error: "hours must be a positive number" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const empR = await client.query(
      `SELECT id, display_name,
              pto_ytd_hours_accrued, pto_ytd_hours_used,
              sick_ytd_hours_accrued, sick_ytd_hours_used
       FROM payroll.employees
       WHERE id = $1::uuid
       FOR UPDATE`,
      [employeeId]
    );
    const emp = empR.rows[0];
    if (!emp) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Employee not found" });
    }

    const beforePtoAccrued = Number(emp.pto_ytd_hours_accrued) || 0;
    const beforePtoUsed = Number(emp.pto_ytd_hours_used) || 0;
    const beforeSickAccrued = Number(emp.sick_ytd_hours_accrued) || 0;
    const beforeSickUsed = Number(emp.sick_ytd_hours_used) || 0;

    let afterPtoAccrued = beforePtoAccrued;
    let afterPtoUsed = beforePtoUsed;
    let afterSickAccrued = beforeSickAccrued;
    let afterSickUsed = beforeSickUsed;

    if (logType === "pto") {
      if (action === "Accrual") afterPtoAccrued += hours;
      else afterPtoUsed += hours;
    } else if (action === "Accrual") {
      afterSickAccrued += hours;
    } else {
      afterSickUsed += hours;
    }

    const logTable = logType === "pto" ? "payroll.pto_log" : "payroll.sick_time_log";
    const logIns = await client.query(
      `INSERT INTO ${logTable} (employee_name, action_date, action, hours, reason)
       VALUES ($1, CURRENT_DATE, $2, $3, $4)
       RETURNING id, employee_name, action_date, action, hours, reason, created_at`,
      [emp.display_name || "", action, hours, reason]
    );
    const logRow = logIns.rows[0];
    if (!logRow?.id) throw new Error("Failed to create log entry");

    await client.query(
      `UPDATE payroll.employees
       SET pto_ytd_hours_accrued = $1,
           pto_ytd_hours_used = $2,
           sick_ytd_hours_accrued = $3,
           sick_ytd_hours_used = $4,
           updated_at = now()
       WHERE id = $5::uuid`,
      [afterPtoAccrued, afterPtoUsed, afterSickAccrued, afterSickUsed, employeeId]
    );

    const batchInserted = await client.query(
      `INSERT INTO payroll.leave_change_batches (operation_type)
       VALUES ('manual_log')
       RETURNING id`
    );
    const batchId = batchInserted.rows[0]?.id;
    if (!batchId) throw new Error("Failed to create change batch");

    const ptoLogIds = logType === "pto" ? [logRow.id] : [];
    const sickLogIds = logType === "sick" ? [logRow.id] : [];

    await client.query(
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
        employeeId,
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

    await client.query("COMMIT");

    return res.status(201).json({
      ok: true,
      batchId,
      log: logRow,
      ytd: {
        ptoYtdHoursAccrued: afterPtoAccrued,
        ptoYtdHoursUsed: afterPtoUsed,
        sickYtdHoursAccrued: afterSickAccrued,
        sickYtdHoursUsed: afterSickUsed,
      },
    });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    return res.status(500).json({ error: e?.message || "Request failed" });
  } finally {
    client.release();
  }
}
