const { randomUUID } = require("node:crypto");

const AUTO_PROVIDER_PREFIX = "AUTO-";

const EMPLOYEE_SELECT = `id, provider_id, display_name, login_email,
              pto_ytd_hours_accrued, pto_ytd_hours_used,
              sick_ytd_hours_accrued, sick_ytd_hours_used`;

function normalizeDisplayName(name) {
  return String(name || "").trim();
}

async function findEmployeeByProviderId(client, providerId, forUpdate = false) {
  const pid = String(providerId || "").trim();
  if (!pid) return null;
  const lock = forUpdate ? " FOR UPDATE" : "";
  const r = await client.query(
    `SELECT ${EMPLOYEE_SELECT}
     FROM payroll.employees
     WHERE provider_id = $1${lock}`,
    [pid]
  );
  return r.rows[0] || null;
}

async function findEmployeeByDisplayName(client, displayName, forUpdate = false) {
  const name = normalizeDisplayName(displayName);
  if (!name) return null;
  const lock = forUpdate ? " FOR UPDATE" : "";
  const r = await client.query(
    `SELECT ${EMPLOYEE_SELECT}
     FROM payroll.employees
     WHERE lower(regexp_replace(trim(display_name), '\\s+', ' ', 'g')) =
           lower(regexp_replace(trim($1), '\\s+', ' ', 'g'))
     ORDER BY updated_at DESC NULLS LAST, created_at DESC
     LIMIT 1${lock}`,
    [name]
  );
  return r.rows[0] || null;
}

async function insertEmployee(client, { providerId, displayName }) {
  const pid = String(providerId || "").trim();
  if (!pid) return null;
  const name = normalizeDisplayName(displayName);
  const r = await client.query(
    `INSERT INTO payroll.employees (
       provider_id, display_name, hourly_rate, incentive_pay, paid_holidays,
       travel_rate, pto_rate, edu_rate, training_rate, min_wage_rate,
       pto_ytd_hours_accrued, pto_ytd_hours_used,
       sick_ytd_hours_accrued, sick_ytd_hours_used, health_insurance_deduction
     ) VALUES (
       $1, $2, 0, FALSE, FALSE,
       0, 0, 0, 0, 0,
       0, 0, 0, 0, 0
     )
     RETURNING ${EMPLOYEE_SELECT}`,
    [pid, name]
  );
  return r.rows[0] || null;
}

async function upgradeAutoProviderId(client, employeeId, newProviderId) {
  const pid = String(newProviderId || "").trim();
  if (!employeeId || !pid) return null;
  const r = await client.query(
    `UPDATE payroll.employees
     SET provider_id = $1,
         updated_at = now()
     WHERE id = $2::uuid
     RETURNING ${EMPLOYEE_SELECT}`,
    [pid, employeeId]
  );
  return r.rows[0] || null;
}

function isAutoProviderId(providerId) {
  return String(providerId || "").startsWith(AUTO_PROVIDER_PREFIX);
}

/**
 * Find or create payroll.employees row. When a real Provider ID arrives for a
 * name-only AUTO-* row, upgrades provider_id to the real ID.
 */
async function ensureEmployee(client, { providerId, displayName, forUpdate = false }) {
  const pid = String(providerId || "").trim();
  const name = normalizeDisplayName(displayName);
  if (!pid && !name) return null;

  if (pid) {
    const byProvider = await findEmployeeByProviderId(client, pid, forUpdate);
    if (byProvider) return byProvider;

    if (name) {
      const byName = await findEmployeeByDisplayName(client, name, forUpdate);
      if (byName && isAutoProviderId(byName.provider_id)) {
        try {
          const upgraded = await upgradeAutoProviderId(client, byName.id, pid);
          if (upgraded) return upgraded;
        } catch (e) {
          if (e?.code !== "23505") throw e;
          const existing = await findEmployeeByProviderId(client, pid, forUpdate);
          if (existing) return existing;
        }
      }
    }

    return insertEmployee(client, { providerId: pid, displayName: name });
  }

  const byName = await findEmployeeByDisplayName(client, name, forUpdate);
  if (byName) return byName;

  return insertEmployee(client, {
    providerId: `${AUTO_PROVIDER_PREFIX}${randomUUID()}`,
    displayName: name,
  });
}

async function ensureEmployees(client, rows) {
  const list = Array.isArray(rows) ? rows : [];
  let ensured = 0;
  const seen = new Set();

  for (const row of list) {
    const providerId = String(row?.providerId ?? row?.provider_id ?? "").trim();
    const displayName = normalizeDisplayName(row?.displayName ?? row?.employeeName ?? row?.employee_name);
    if (!providerId && !displayName) continue;

    const key = `${providerId}::${displayName.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const employee = await ensureEmployee(client, { providerId, displayName });
    if (employee) ensured += 1;
  }

  return ensured;
}

module.exports = {
  AUTO_PROVIDER_PREFIX,
  ensureEmployee,
  ensureEmployees,
  findEmployeeByDisplayName,
  findEmployeeByProviderId,
};
