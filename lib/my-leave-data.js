const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return UUID_RE.test(String(value || "").trim());
}

async function findEmployeeByEmail(pool, email) {
  const r = await pool.query(
    `SELECT id, display_name,
            pto_ytd_hours_accrued, pto_ytd_hours_used,
            sick_ytd_hours_accrued, sick_ytd_hours_used
     FROM payroll.employees
     WHERE lower(trim(login_email)) = $1
     LIMIT 1`,
    [email]
  );
  return r.rows[0] || null;
}

async function findEmployeeById(pool, employeeId) {
  const r = await pool.query(
    `SELECT id, display_name,
            pto_ytd_hours_accrued, pto_ytd_hours_used,
            sick_ytd_hours_accrued, sick_ytd_hours_used
     FROM payroll.employees
     WHERE id = $1::uuid
     LIMIT 1`,
    [employeeId]
  );
  return r.rows[0] || null;
}

async function fetchLeaveDataForEmployee(pool, emp) {
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

  return {
    employeeId,
    employeeName: displayName,
    ptoYtdHoursAccrued: ptoAccrued,
    ptoYtdHoursUsed: ptoUsed,
    ptoAvailableHours: ptoAccrued - ptoUsed,
    sickYtdHoursAccrued: sickAccrued,
    sickYtdHoursUsed: sickUsed,
    sickAvailableHours: sickAccrued - sickUsed,
    ptoLogs: pto.rows,
    sickLogs: sick.rows,
  };
}

module.exports = {
  isUuid,
  findEmployeeByEmail,
  findEmployeeById,
  fetchLeaveDataForEmployee,
};
