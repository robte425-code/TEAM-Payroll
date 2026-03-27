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
    const params = [];
    if (startDate) {
      params.push(startDate);
      dateClause.push(`l.action_date >= $${params.length + 1}::date`);
    }
    if (endDate) {
      params.push(endDate);
      dateClause.push(`l.action_date <= $${params.length + 1}::date`);
    }
    const whereDate = dateClause.length ? `AND ${dateClause.join(" AND ")}` : "";
    const whereDateByName = whereDate.replace(/\$(\d+)/g, (_, n) => `$${Math.max(1, Number(n) - 1)}`);

    // Prefer ID-based linkage via leave change batches (most reliable).
    const pto = await pool.query(
      `SELECT l.id, l.employee_name, l.action_date, l.action, l.hours, l.reason, l.created_at
       FROM payroll.pto_log l
       WHERE l.id IN (
         SELECT DISTINCT unnest(d.pto_log_ids)
         FROM payroll.leave_change_batch_details d
         WHERE d.employee_id = $1::uuid
       )
       ${whereDate}
       ORDER BY l.action_date DESC, l.created_at DESC`,
      [employeeId, ...params]
    );
    const sick = await pool.query(
      `SELECT l.id, l.employee_name, l.action_date, l.action, l.hours, l.reason, l.created_at
       FROM payroll.sick_time_log l
       WHERE l.id IN (
         SELECT DISTINCT unnest(d.sick_log_ids)
         FROM payroll.leave_change_batch_details d
         WHERE d.employee_id = $1::uuid
       )
       ${whereDate}
       ORDER BY l.action_date DESC, l.created_at DESC`,
      [employeeId, ...params]
    );

    // Fallback for older rows not captured in batch detail arrays: name-normalized match.
    if (pto.rows.length === 0) {
      const fallback = await pool.query(
        `SELECT l.id, l.employee_name, l.action_date, l.action, l.hours, l.reason, l.created_at
         FROM payroll.pto_log l
         WHERE lower(regexp_replace(trim(l.employee_name), '\s+', ' ', 'g')) =
               lower(regexp_replace(trim($1), '\s+', ' ', 'g'))
         ${whereDateByName}
         ORDER BY l.action_date DESC, l.created_at DESC`,
        [displayName, ...params]
      );
      pto.rows.push(...fallback.rows);
    }
    if (sick.rows.length === 0) {
      const fallback = await pool.query(
        `SELECT l.id, l.employee_name, l.action_date, l.action, l.hours, l.reason, l.created_at
         FROM payroll.sick_time_log l
         WHERE lower(regexp_replace(trim(l.employee_name), '\s+', ' ', 'g')) =
               lower(regexp_replace(trim($1), '\s+', ' ', 'g'))
         ${whereDateByName}
         ORDER BY l.action_date DESC, l.created_at DESC`,
        [displayName, ...params]
      );
      sick.rows.push(...fallback.rows);
    }

    return res.status(200).json({
      employeeName: displayName,
      ptoLogs: pto.rows,
      sickLogs: sick.rows,
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Request failed" });
  }
}

