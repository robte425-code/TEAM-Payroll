const { getToken } = require("next-auth/jwt");
const { getPool } = require("../../lib/db");

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    return res.status(500).json({ error: "Auth not configured" });
  }

  let token;
  try {
    token = await getToken({ req, secret });
  } catch {
    token = null;
  }
  const email = String(token?.email || "").trim().toLowerCase();
  if (!email) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  let pool;
  try {
    pool = getPool();
  } catch (e) {
    return res.status(500).json({ error: e.message || "Database not configured" });
  }

  try {
    const empR = await pool.query(
      `SELECT id, display_name,
              pto_ytd_hours_accrued, pto_ytd_hours_used,
              sick_ytd_hours_accrued, sick_ytd_hours_used
       FROM payroll.employees
       WHERE lower(trim(login_email)) = $1
       LIMIT 1`,
      [email]
    );
    const emp = empR.rows[0];
    if (!emp) {
      return res.status(404).json({
        error:
          "No employee record is linked to your sign-in email. Ask a payroll admin to set your Sign-in email on the Employee pay rates page.",
      });
    }

    const employeeId = emp.id;
    const displayName = emp.display_name || "";

    const ptoAccrued = Number(emp.pto_ytd_hours_accrued) || 0;
    const ptoUsed = Number(emp.pto_ytd_hours_used) || 0;
    const sickAccrued = Number(emp.sick_ytd_hours_accrued) || 0;
    const sickUsed = Number(emp.sick_ytd_hours_used) || 0;

    const pto = await pool.query(
      `SELECT l.id, l.employee_name, l.action_date, l.action, l.hours, l.reason, l.created_at
       FROM payroll.pto_log l
       WHERE l.id IN (
         SELECT DISTINCT unnest(d.pto_log_ids)
         FROM payroll.leave_change_batch_details d
         WHERE d.employee_id = $1::uuid
       )
       ORDER BY l.action_date DESC, l.created_at DESC`,
      [employeeId]
    );

    const sick = await pool.query(
      `SELECT l.id, l.employee_name, l.action_date, l.action, l.hours, l.reason, l.created_at
       FROM payroll.sick_time_log l
       WHERE l.id IN (
         SELECT DISTINCT unnest(d.sick_log_ids)
         FROM payroll.leave_change_batch_details d
         WHERE d.employee_id = $1::uuid
       )
       ORDER BY l.action_date DESC, l.created_at DESC`,
      [employeeId]
    );

    if (pto.rows.length === 0) {
      const fallback = await pool.query(
        `SELECT l.id, l.employee_name, l.action_date, l.action, l.hours, l.reason, l.created_at
         FROM payroll.pto_log l
         WHERE lower(regexp_replace(trim(l.employee_name), '\\s+', ' ', 'g')) =
               lower(regexp_replace(trim($1), '\\s+', ' ', 'g'))
         ORDER BY l.action_date DESC, l.created_at DESC`,
        [displayName]
      );
      pto.rows.push(...fallback.rows);
    }
    if (sick.rows.length === 0) {
      const fallback = await pool.query(
        `SELECT l.id, l.employee_name, l.action_date, l.action, l.hours, l.reason, l.created_at
         FROM payroll.sick_time_log l
         WHERE lower(regexp_replace(trim(l.employee_name), '\\s+', ' ', 'g')) =
               lower(regexp_replace(trim($1), '\\s+', ' ', 'g'))
         ORDER BY l.action_date DESC, l.created_at DESC`,
        [displayName]
      );
      sick.rows.push(...fallback.rows);
    }

    return res.status(200).json({
      employeeName: displayName,
      ptoYtdHoursAccrued: ptoAccrued,
      ptoYtdHoursUsed: ptoUsed,
      ptoAvailableHours: ptoAccrued - ptoUsed,
      sickYtdHoursAccrued: sickAccrued,
      sickYtdHoursUsed: sickUsed,
      sickAvailableHours: sickAccrued - sickUsed,
      ptoLogs: pto.rows,
      sickLogs: sick.rows,
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Request failed" });
  }
}
