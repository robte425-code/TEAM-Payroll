const { getPool } = require("../../lib/db");

function parseDateOrNull(v) {
  const s = String(v || "").trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  let pool;
  try {
    pool = getPool();
  } catch (e) {
    return res.status(500).json({ error: e.message || "Database not configured" });
  }

  try {
    const employeeId = String(req.query?.employeeId || "").trim();
    if (!employeeId) return res.status(400).json({ error: "employeeId is required" });
    const startDate = parseDateOrNull(req.query?.startDate);
    const endDate = parseDateOrNull(req.query?.endDate);

    const emp = await pool.query(
      `SELECT display_name FROM payroll.employees WHERE id = $1::uuid`,
      [employeeId]
    );
    const displayName = emp.rows[0]?.display_name;
    if (!displayName) return res.status(404).json({ error: "Employee not found" });

    const dateClause = [];
    const params = [displayName];
    if (startDate) {
      params.push(startDate);
      dateClause.push(`action_date >= $${params.length}::date`);
    }
    if (endDate) {
      params.push(endDate);
      dateClause.push(`action_date <= $${params.length}::date`);
    }
    const whereDate = dateClause.length ? `AND ${dateClause.join(" AND ")}` : "";

    const pto = await pool.query(
      `SELECT id, employee_name, action_date, action, hours, reason, created_at
       FROM payroll.pto_log
       WHERE lower(regexp_replace(trim(employee_name), '\s+', ' ', 'g')) =
             lower(regexp_replace(trim($1), '\s+', ' ', 'g'))
       ${whereDate}
       ORDER BY action_date DESC, created_at DESC`,
      params
    );
    const sick = await pool.query(
      `SELECT id, employee_name, action_date, action, hours, reason, created_at
       FROM payroll.sick_time_log
       WHERE lower(regexp_replace(trim(employee_name), '\s+', ' ', 'g')) =
             lower(regexp_replace(trim($1), '\s+', ' ', 'g'))
       ${whereDate}
       ORDER BY action_date DESC, created_at DESC`,
      params
    );

    return res.status(200).json({
      employeeName: displayName,
      ptoLogs: pto.rows,
      sickLogs: sick.rows,
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Request failed" });
  }
}

