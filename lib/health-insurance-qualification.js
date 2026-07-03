const DEFAULT_HEALTH_INSURANCE_HOURS_PER_WORKING_DAY = 7.2;
const HEALTH_INSURANCE_HOURS_PER_WORKING_DAY_KEY = "health_insurance_hours_per_working_day";

function toNonNegativeNumber(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function parseHoursPerWorkingDayFromKv(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "number" && Number.isFinite(value)) return value >= 0 ? value : fallback;
  if (typeof value === "object" && value.hoursPerWorkingDay != null) {
    return toNonNegativeNumber(value.hoursPerWorkingDay, fallback);
  }
  if (typeof value === "string" && value.trim() !== "") {
    return toNonNegativeNumber(value, fallback);
  }
  return fallback;
}

function formatSqlDate(value) {
  if (value == null || value === "") return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(value).trim();
  const isoMatch = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return isoMatch ? isoMatch[1] : "";
}

function normalizeName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function roundHours(n) {
  return Math.round((toNumber(n) + Number.EPSILON) * 100) / 100;
}

function formatMonthLabel(monthKey) {
  const [y, m] = String(monthKey || "").split("-");
  if (!y || !m) return String(monthKey || "");
  const d = new Date(`${y}-${m}-01T00:00:00`);
  return Number.isNaN(d.getTime())
    ? monthKey
    : d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function qualifyingHoursFromRow(row) {
  return (
    toNumber(row.case_plus_reports) +
    toNumber(row.travel_wait_hours) +
    toNumber(row.pto_time) +
    toNumber(row.sick_time)
  );
}

function buildHealthInsuranceQualification(rows, hoursPerWorkingDay) {
  const threshold = toNonNegativeNumber(hoursPerWorkingDay, DEFAULT_HEALTH_INSURANCE_HOURS_PER_WORKING_DAY);
  const months = new Map();

  for (const row of rows || []) {
    const endDate = formatSqlDate(row.payroll_end_date);
    const monthKey = endDate.slice(0, 7);
    if (!monthKey || monthKey.length !== 7) continue;

    const runId = String(row.run_id || "");
    const employeeName = String(row.employee_name || "").trim();
    const employeeKey = normalizeName(employeeName);
    if (!employeeKey) continue;

    if (!months.has(monthKey)) {
      months.set(monthKey, {
        monthKey,
        label: formatMonthLabel(monthKey),
        workingDays: 0,
        runIds: new Set(),
        employees: new Map(),
      });
    }
    const month = months.get(monthKey);

    if (runId && !month.runIds.has(runId)) {
      month.runIds.add(runId);
      month.workingDays += Math.max(0, Math.trunc(toNumber(row.working_days)));
    }

    if (!month.employees.has(employeeKey)) {
      month.employees.set(employeeKey, {
        employeeName,
        qualifyingHours: 0,
      });
    }
    month.employees.get(employeeKey).qualifyingHours += qualifyingHoursFromRow(row);
  }

  const monthKeys = [...months.keys()].sort();
  const employeeMap = new Map();

  for (const monthKey of monthKeys) {
    const month = months.get(monthKey);
    const requiredHours = roundHours(threshold * month.workingDays);

    for (const [employeeKey, emp] of month.employees) {
      if (!employeeMap.has(employeeKey)) {
        employeeMap.set(employeeKey, {
          employeeName: emp.employeeName,
          months: {},
        });
      }
      const qualifyingHours = roundHours(emp.qualifyingHours);
      employeeMap.get(employeeKey).months[monthKey] = {
        qualifyingHours,
        requiredHours,
        workingDays: month.workingDays,
        qualifies: qualifyingHours >= requiredHours - Number.EPSILON,
      };
    }
  }

  return {
    hoursPerWorkingDay: threshold,
    months: monthKeys.map((monthKey) => {
      const month = months.get(monthKey);
      return {
        monthKey,
        label: month.label,
        workingDays: month.workingDays,
        requiredHours: roundHours(threshold * month.workingDays),
      };
    }),
    employees: [...employeeMap.values()].sort((a, b) =>
      String(a.employeeName).localeCompare(String(b.employeeName), undefined, { sensitivity: "base" })
    ),
  };
}

async function readKv(db, key) {
  const r = await db.query(`SELECT value FROM payroll.app_kv WHERE key = $1 LIMIT 1`, [key]);
  return r.rows[0]?.value ?? null;
}

async function upsertKv(client, key, value) {
  await client.query(
    `INSERT INTO payroll.app_kv (key, value, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)]
  );
}

async function fetchHealthInsuranceSettings(db) {
  const raw = await readKv(db, HEALTH_INSURANCE_HOURS_PER_WORKING_DAY_KEY);
  return {
    hoursPerWorkingDay: parseHoursPerWorkingDayFromKv(
      raw,
      DEFAULT_HEALTH_INSURANCE_HOURS_PER_WORKING_DAY
    ),
  };
}

async function updateHealthInsuranceSettings(pool, { hoursPerWorkingDay }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (hoursPerWorkingDay !== undefined) {
      const value = toNonNegativeNumber(hoursPerWorkingDay, DEFAULT_HEALTH_INSURANCE_HOURS_PER_WORKING_DAY);
      await upsertKv(client, HEALTH_INSURANCE_HOURS_PER_WORKING_DAY_KEY, value);
    }
    await client.query("COMMIT");
    return fetchHealthInsuranceSettings(client);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

module.exports = {
  DEFAULT_HEALTH_INSURANCE_HOURS_PER_WORKING_DAY,
  HEALTH_INSURANCE_HOURS_PER_WORKING_DAY_KEY,
  buildHealthInsuranceQualification,
  fetchHealthInsuranceSettings,
  updateHealthInsuranceSettings,
};
