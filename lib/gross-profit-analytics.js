const DEFAULT_EMPLOYMENT_TYPE = "full_time";
const VALID_EMPLOYMENT_TYPES = new Set(["intern", "full_time"]);
const MILEAGE_RATE_KEY = "mileage_rate";

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

function parsePayrollEndDate(value) {
  const s = formatSqlDate(value);
  if (!s) return null;
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : s;
}

function addDaysToIsoDate(isoDate, days) {
  const s = formatSqlDate(isoDate);
  if (!s) return "";
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return formatSqlDate(d);
}

const DEFAULT_PAY_PERIOD_DAYS = 14;

function buildPayrollStartDateByEndDate(endDates) {
  const sorted = [...new Set((endDates || []).map((value) => formatSqlDate(value)).filter(Boolean))].sort();
  const map = new Map();
  for (let i = 0; i < sorted.length; i++) {
    const end = sorted[i];
    if (i === 0) {
      map.set(end, addDaysToIsoDate(end, -(DEFAULT_PAY_PERIOD_DAYS - 1)));
    } else {
      map.set(end, addDaysToIsoDate(sorted[i - 1], 1));
    }
  }
  return map;
}

function resolvePayrollStartDate(payrollEndDate, payrollStartDateByEndDate) {
  const end = formatSqlDate(payrollEndDate);
  if (!end) return "";
  const mapped = payrollStartDateByEndDate?.get(end);
  if (mapped) return mapped;
  return addDaysToIsoDate(end, -(DEFAULT_PAY_PERIOD_DAYS - 1));
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

function roundMoney(n) {
  return Math.round((toNumber(n) + Number.EPSILON) * 100) / 100;
}

function roundHours(n) {
  return Math.round((toNumber(n) + Number.EPSILON) * 100) / 100;
}

function normalizeEmploymentType(value) {
  const s = String(value || "")
    .trim()
    .toLowerCase();
  return VALID_EMPLOYMENT_TYPES.has(s) ? s : "";
}

function lniRateRowEmploymentType(row) {
  return normalizeEmploymentType(row?.employment_type ?? row?.employmentType);
}

function lniRateRowEffectiveDate(row) {
  return formatSqlDate(row?.effective_date ?? row?.effectiveDate);
}

function lniRateRowProfessionalRate(row) {
  return toNumber(row?.professional_rate ?? row?.professionalRate);
}

function lniRateRowTravelWaitRate(row) {
  return toNumber(row?.travel_wait_rate ?? row?.travelWaitRate);
}

function payrollCostTotal(row) {
  return (
    toNumber(row.regular_pay) +
    toNumber(row.overtime_pay) +
    toNumber(row.pto_pay) +
    toNumber(row.sick_pay) +
    toNumber(row.holiday_pay) +
    toNumber(row.training_pay) +
    toNumber(row.edu_pay) +
    toNumber(row.general_reimbursement) +
    toNumber(row.non_disc_bonus)
  );
}

function resolveEmploymentTypeForDate(historyRows, employeeId, asOfDate) {
  const id = String(employeeId || "");
  const date = formatSqlDate(asOfDate);
  if (!id || !date) return DEFAULT_EMPLOYMENT_TYPE;

  let resolved = null;
  for (const row of historyRows || []) {
    if (String(row.employee_id) !== id) continue;
    const effectiveDate = formatSqlDate(row.effective_date);
    if (!effectiveDate || effectiveDate > date) continue;
    if (!resolved || effectiveDate > formatSqlDate(resolved.effective_date)) {
      resolved = row;
    }
  }
  const type = normalizeEmploymentType(resolved?.employment_type);
  return type || DEFAULT_EMPLOYMENT_TYPE;
}

function resolveLniRatesForDate(rateRows, employmentType, asOfDate) {
  const type = normalizeEmploymentType(employmentType) || DEFAULT_EMPLOYMENT_TYPE;
  const date = formatSqlDate(asOfDate);
  if (!date) return null;

  let resolved = null;
  for (const row of rateRows || []) {
    if (lniRateRowEmploymentType(row) !== type) continue;
    const effectiveDate = lniRateRowEffectiveDate(row);
    if (!effectiveDate || effectiveDate > date) continue;
    if (!resolved || effectiveDate > lniRateRowEffectiveDate(resolved)) {
      resolved = row;
    }
  }
  if (!resolved) return null;
  return {
    employmentType: type,
    effectiveDate: lniRateRowEffectiveDate(resolved),
    professionalRate: lniRateRowProfessionalRate(resolved),
    travelWaitRate: lniRateRowTravelWaitRate(resolved),
  };
}

function buildEmployeeLookup(employees) {
  const byProviderId = new Map();
  const byName = new Map();
  for (const emp of employees || []) {
    const providerId = String(emp.provider_id ?? emp.providerId ?? "").trim();
    const displayName = String(emp.display_name ?? emp.displayName ?? "").trim();
    if (providerId) byProviderId.set(providerId, emp);
    const nameKey = normalizeName(displayName);
    if (nameKey) byName.set(nameKey, emp);
  }
  return { byProviderId, byName };
}

function resolveEmployeeForRow(row, lookup) {
  const providerId = String(row.provider_id || "").trim();
  if (providerId && lookup.byProviderId.has(providerId)) {
    return lookup.byProviderId.get(providerId);
  }
  const nameKey = normalizeName(row.employee_name);
  if (nameKey && lookup.byName.has(nameKey)) {
    return lookup.byName.get(nameKey);
  }
  return null;
}

function buildGrossProfitAnalytics({
  payrollRows,
  payrollStartDateByEndDate,
  employees,
  employmentTypeHistory,
  lniRateSchedules,
  mileageRate,
}) {
  const lookup = buildEmployeeLookup(employees);
  const startDateByEndDate =
    payrollStartDateByEndDate || buildPayrollStartDateByEndDate((payrollRows || []).map((row) => row.payroll_end_date));
  const byEmployee = new Map();
  const warnings = new Set();

  for (const row of payrollRows || []) {
    const payrollEndDate = formatSqlDate(row.payroll_end_date);
    const payrollStartDate = resolvePayrollStartDate(payrollEndDate, startDateByEndDate);
    const employeeName = String(row.employee_name || "").trim();
    const employeeKey = normalizeName(employeeName);
    if (!employeeKey || !payrollStartDate) continue;

    const employee = resolveEmployeeForRow(row, lookup);
    const employeeId = employee?.id ? String(employee.id) : "";
    const employmentType = employeeId
      ? resolveEmploymentTypeForDate(employmentTypeHistory, employeeId, payrollStartDate)
      : DEFAULT_EMPLOYMENT_TYPE;
    if (!employeeId) {
      warnings.add(`No employee record match for ${employeeName}; using full-time default and rates.`);
    }

    const rates = resolveLniRatesForDate(lniRateSchedules, employmentType, payrollStartDate);
    if (!rates) {
      warnings.add(`No L&I billing rates for ${employmentType} on or before ${payrollStartDate}.`);
    }

    const professionalHours = toNumber(row.case_plus_reports);
    const travelWaitHours = toNumber(row.travel_wait_hours);
    const professionalRate = rates?.professionalRate ?? 0;
    const travelWaitRate = rates?.travelWaitRate ?? 0;
    const lniRevenue = roundMoney(
      professionalHours * professionalRate + travelWaitHours * travelWaitRate
    );
    const mileageUnits = toNumber(row.mileage);
    const mileageReimbursement = roundMoney(mileageUnits * toNumber(mileageRate));
    const payrollCost = roundMoney(payrollCostTotal(row) - mileageReimbursement);
    const grossProfit = roundMoney(lniRevenue - payrollCost);

    if (!byEmployee.has(employeeKey)) {
      byEmployee.set(employeeKey, {
        employeeId,
        employeeName,
        employmentTypeCounts: {},
        professionalHours: 0,
        travelWaitHours: 0,
        lniRevenue: 0,
        payrollCost: 0,
        mileageReimbursement: 0,
        grossProfit: 0,
        periodCount: 0,
      });
    }
    const agg = byEmployee.get(employeeKey);
    agg.employmentTypeCounts[employmentType] = (agg.employmentTypeCounts[employmentType] || 0) + 1;
    agg.professionalHours = roundHours(agg.professionalHours + professionalHours);
    agg.travelWaitHours = roundHours(agg.travelWaitHours + travelWaitHours);
    agg.lniRevenue = roundMoney(agg.lniRevenue + lniRevenue);
    agg.payrollCost = roundMoney(agg.payrollCost + payrollCost);
    agg.mileageReimbursement = roundMoney(agg.mileageReimbursement + mileageReimbursement);
    agg.grossProfit = roundMoney(agg.grossProfit + grossProfit);
    agg.periodCount += 1;
  }

  const employeesOut = [...byEmployee.values()]
    .map((emp) => {
      const dominantType =
        Object.entries(emp.employmentTypeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ||
        DEFAULT_EMPLOYMENT_TYPE;
      return {
        ...emp,
        employmentType: dominantType,
        employmentTypeCounts: undefined,
      };
    })
    .sort((a, b) => b.grossProfit - a.grossProfit);

  return {
    mileageRate: toNumber(mileageRate),
    employees: employeesOut,
    warnings: [...warnings],
  };
}

async function readKvNumber(db, key) {
  const r = await db.query(`SELECT value FROM payroll.app_kv WHERE key = $1 LIMIT 1`, [key]);
  const raw = r.rows[0]?.value;
  if (raw == null) return 0;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw >= 0 ? raw : 0;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

async function fetchMileageRate(pool) {
  return readKvNumber(pool, MILEAGE_RATE_KEY);
}

async function fetchEmploymentTypeHistory(pool) {
  const r = await pool.query(
    `SELECT employee_id, employment_type, effective_date, updated_at
     FROM payroll.employee_employment_type_history
     ORDER BY employee_id ASC, effective_date ASC`
  );
  return r.rows;
}

async function fetchLniBillingRateSchedules(pool) {
  const r = await pool.query(
    `SELECT id, employment_type, effective_date, professional_rate, travel_wait_rate, updated_at
     FROM payroll.lni_billing_rate_schedules
     ORDER BY employment_type ASC, effective_date ASC`
  );
  return r.rows.map((row) => ({
    id: row.id,
    employmentType: normalizeEmploymentType(row.employment_type),
    effectiveDate: formatSqlDate(row.effective_date),
    professionalRate: toNumber(row.professional_rate),
    travelWaitRate: toNumber(row.travel_wait_rate),
    updatedAt: row.updated_at,
  }));
}

async function fetchEmployeesForGrossProfit(pool) {
  const r = await pool.query(
    `SELECT id, provider_id, display_name
     FROM payroll.employees
     ORDER BY display_name ASC, provider_id ASC`
  );
  return r.rows;
}

function resolveEmploymentTypeAsOf(historyRows, employeeId, asOfDate) {
  return resolveEmploymentTypeForDate(historyRows, employeeId, asOfDate);
}

async function fetchEmployeeEmploymentTypes(pool, asOfDate) {
  const [employees, history] = await Promise.all([
    fetchEmployeesForGrossProfit(pool),
    fetchEmploymentTypeHistory(pool),
  ]);
  const date = parsePayrollEndDate(asOfDate) || formatSqlDate(new Date());
  return employees.map((emp) => ({
    employeeId: String(emp.id),
    providerId: emp.provider_id || "",
    displayName: emp.display_name || "",
    employmentType: resolveEmploymentTypeAsOf(history, emp.id, date),
  }));
}

async function upsertEmploymentTypeChange(pool, { employeeId, employmentType, effectiveDate, updatedByEmail }) {
  const type = normalizeEmploymentType(employmentType);
  const date = parsePayrollEndDate(effectiveDate);
  const id = String(employeeId || "").trim();
  if (!id) throw new Error("Employee id is required.");
  if (!type) throw new Error("Employment type must be intern or full_time.");
  if (!date) throw new Error("Effective date is required (YYYY-MM-DD).");

  await pool.query(
    `INSERT INTO payroll.employee_employment_type_history (
       employee_id, employment_type, effective_date, updated_by_email, updated_at
     ) VALUES ($1::uuid, $2, $3::date, $4, now())
     ON CONFLICT (employee_id, effective_date) DO UPDATE SET
       employment_type = EXCLUDED.employment_type,
       updated_by_email = EXCLUDED.updated_by_email,
       updated_at = now()`,
    [id, type, date, String(updatedByEmail || "").trim() || null]
  );
}

async function upsertLniBillingRateSchedule(
  pool,
  { employmentType, effectiveDate, professionalRate, travelWaitRate, updatedByEmail }
) {
  const type = normalizeEmploymentType(employmentType);
  const date = parsePayrollEndDate(effectiveDate);
  if (!type) throw new Error("Employment type must be intern or full_time.");
  if (!date) throw new Error("Effective date is required (YYYY-MM-DD).");

  const prof = toNumber(professionalRate);
  const travel = toNumber(travelWaitRate);
  if (prof < 0 || travel < 0) throw new Error("Rates must be non-negative.");

  const result = await pool.query(
    `INSERT INTO payroll.lni_billing_rate_schedules (
       employment_type, effective_date, professional_rate, travel_wait_rate, updated_by_email, updated_at
     ) VALUES ($1, $2::date, $3, $4, $5, now())
     ON CONFLICT (employment_type, effective_date) DO UPDATE SET
       professional_rate = EXCLUDED.professional_rate,
       travel_wait_rate = EXCLUDED.travel_wait_rate,
       updated_by_email = EXCLUDED.updated_by_email,
       updated_at = now()
     RETURNING id, employment_type, effective_date, professional_rate, travel_wait_rate, updated_at`,
    [type, date, prof, travel, String(updatedByEmail || "").trim() || null]
  );
  const row = result.rows[0];
  return {
    id: row.id,
    employmentType: normalizeEmploymentType(row.employment_type),
    effectiveDate: formatSqlDate(row.effective_date),
    professionalRate: toNumber(row.professional_rate),
    travelWaitRate: toNumber(row.travel_wait_rate),
    updatedAt: row.updated_at,
  };
}

module.exports = {
  DEFAULT_EMPLOYMENT_TYPE,
  VALID_EMPLOYMENT_TYPES,
  DEFAULT_PAY_PERIOD_DAYS,
  buildGrossProfitAnalytics,
  buildPayrollStartDateByEndDate,
  resolvePayrollStartDate,
  fetchMileageRate,
  fetchEmploymentTypeHistory,
  fetchLniBillingRateSchedules,
  fetchEmployeeEmploymentTypes,
  fetchEmployeesForGrossProfit,
  upsertEmploymentTypeChange,
  upsertLniBillingRateSchedule,
  normalizeEmploymentType,
  parsePayrollEndDate,
  formatSqlDate,
};
