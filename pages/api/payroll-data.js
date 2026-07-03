const { getPool } = require("../../lib/db");
const { requireRealAdmin } = require("../../lib/apiAuth");
const {
  buildHealthInsuranceQualification,
  fetchHealthInsuranceSettings,
  updateHealthInsuranceSettings,
} = require("../../lib/health-insurance-qualification");
const {
  buildGrossProfitAnalytics,
  buildPayrollStartDateByEndDate,
  fetchMileageRate,
  fetchEmploymentTypeHistory,
  fetchLniBillingRateSchedules,
  fetchEmployeeEmploymentTypes,
  fetchEmployeesForGrossProfit,
  upsertEmploymentTypeChange,
  upsertLniBillingRateSchedule,
} = require("../../lib/gross-profit-analytics");
const { buffer } = require("node:stream/consumers");

function parseDateParam(value) {
  const s = formatSqlDate(value);
  if (!s) return "";
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? "" : s;
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

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function moneyTotal(row) {
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

function emptyPayBuckets() {
  return {
    regularPay: 0,
    overtimePay: 0,
    ptoPay: 0,
    sickPay: 0,
    holidayPay: 0,
    trainingPay: 0,
    eduPay: 0,
    generalReimbursement: 0,
    nonDiscBonus: 0,
  };
}

function emptyHourBuckets() {
  return {
    casePlusReports: 0,
    nbTime: 0,
    travelWaitHours: 0,
    overtimeHours: 0,
    ptoTime: 0,
    sickTime: 0,
  };
}

function addRowToBuckets(target, row) {
  target.pay.regularPay += toNumber(row.regular_pay);
  target.pay.overtimePay += toNumber(row.overtime_pay);
  target.pay.ptoPay += toNumber(row.pto_pay);
  target.pay.sickPay += toNumber(row.sick_pay);
  target.pay.holidayPay += toNumber(row.holiday_pay);
  target.pay.trainingPay += toNumber(row.training_pay);
  target.pay.eduPay += toNumber(row.edu_pay);
  target.pay.generalReimbursement += toNumber(row.general_reimbursement);
  target.pay.nonDiscBonus += toNumber(row.non_disc_bonus);

  target.hours.casePlusReports += toNumber(row.case_plus_reports);
  target.hours.nbTime += toNumber(row.nb_time);
  target.hours.travelWaitHours += toNumber(row.travel_wait_hours);
  target.hours.overtimeHours += toNumber(row.overtime_hours);
  target.hours.ptoTime += toNumber(row.pto_time);
  target.hours.sickTime += toNumber(row.sick_time);
}

function totalObjectValues(obj) {
  return Object.values(obj || {}).reduce((sum, value) => sum + toNumber(value), 0);
}

function buildAnalytics(rows) {
  const byPeriod = new Map();
  const byEmployee = new Map();
  const employeeNames = new Map();
  const summary = {
    totalPayrollCost: 0,
    totalHoursWorked: 0,
    overtimeHours: 0,
    ptoHours: 0,
    sickHours: 0,
    nonDiscBonus: 0,
    reimbursements: 0,
    employeeCount: 0,
    runCount: 0,
  };
  const runIds = new Set();
  const employeeKeys = new Set();

  for (const row of rows) {
    const runId = String(row.run_id || "");
    const endDate = formatSqlDate(row.payroll_end_date);
    const employeeName = String(row.employee_name || "").trim();
    const employeeKey = normalizeName(employeeName);
    const cost = moneyTotal(row);

    runIds.add(runId);
    if (employeeKey) employeeKeys.add(employeeKey);

    if (!byPeriod.has(endDate)) {
      byPeriod.set(endDate, {
        payrollEndDate: endDate,
        pay: emptyPayBuckets(),
        hours: emptyHourBuckets(),
        totalCost: 0,
        employeeCount: 0,
        employeeKeys: new Set(),
      });
    }
    const period = byPeriod.get(endDate);
    addRowToBuckets(period, row);
    period.totalCost += cost;
    if (employeeKey) period.employeeKeys.add(employeeKey);

    if (employeeKey && !byEmployee.has(employeeKey)) {
      byEmployee.set(employeeKey, {
        employeeName,
        pay: emptyPayBuckets(),
        hours: emptyHourBuckets(),
        totalCost: 0,
        runCount: 0,
        runIds: new Set(),
      });
      employeeNames.set(employeeKey, employeeName);
    }
    if (employeeKey) {
      const emp = byEmployee.get(employeeKey);
      addRowToBuckets(emp, row);
      emp.totalCost += cost;
      emp.runIds.add(runId);
    }

    summary.totalPayrollCost += cost;
    summary.totalHoursWorked += toNumber(row.total_hours_worked);
    summary.overtimeHours += toNumber(row.overtime_hours);
    summary.ptoHours += toNumber(row.pto_time);
    summary.sickHours += toNumber(row.sick_time);
    summary.nonDiscBonus += toNumber(row.non_disc_bonus);
    summary.reimbursements += toNumber(row.general_reimbursement);
  }

  summary.runCount = runIds.size;
  summary.employeeCount = employeeKeys.size;
  summary.averageCostPerEmployee = summary.employeeCount
    ? summary.totalPayrollCost / summary.employeeCount
    : 0;

  const periods = [...byPeriod.values()]
    .map((period) => ({
      ...period,
      employeeCount: period.employeeKeys.size,
      employeeKeys: undefined,
    }))
    .sort((a, b) => a.payrollEndDate.localeCompare(b.payrollEndDate));

  const employees = [...byEmployee.values()]
    .map((emp) => ({
      ...emp,
      runCount: emp.runIds.size,
      runIds: undefined,
      totalHours: totalObjectValues(emp.hours),
    }))
    .sort((a, b) => b.totalCost - a.totalCost);

  return {
    summary,
    periods,
    employees,
    employeeOptions: [...employeeNames.values()].sort((a, b) =>
      String(a).localeCompare(String(b), undefined, { sensitivity: "base" })
    ),
  };
}

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

async function loadPayrollAnalytics(pool, filters) {
  const { startDate, endDate, payrollEndDate, employee } = filters;
  const where = [];
  const params = [];
  function addParam(value) {
    params.push(value);
    return `$${params.length}`;
  }

  if (payrollEndDate) {
    where.push(`r.payroll_end_date = ${addParam(payrollEndDate)}::date`);
  } else {
    if (startDate) where.push(`r.payroll_end_date >= ${addParam(startDate)}::date`);
    if (endDate) where.push(`r.payroll_end_date <= ${addParam(endDate)}::date`);
  }
  if (employee) {
    where.push(`lower(regexp_replace(trim(rr.employee_name), '\\s+', ' ', 'g')) = ${addParam(employee)}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [
    runsResult,
    employeeOptionsResult,
    rowsResult,
    healthInsuranceSettings,
    employeesResult,
    employmentTypeHistory,
    lniRateSchedules,
    mileageRate,
  ] = await Promise.all([
    pool.query(
      `SELECT id, payroll_end_date, working_days, holiday_days, non_bill_file_name, updated_at
       FROM payroll.payroll_runs
       ORDER BY payroll_end_date DESC`
    ),
    pool.query(
      `SELECT DISTINCT rr.employee_name
       FROM payroll.payroll_run_rows rr
       WHERE trim(rr.employee_name) <> ''
       ORDER BY rr.employee_name ASC`
    ),
    pool.query(
      `SELECT
         r.id AS run_id,
         r.payroll_end_date,
         r.working_days,
         rr.provider_id,
         rr.employee_name,
         rr.case_plus_reports,
         rr.nb_time,
         rr.travel_wait_hours,
         rr.total_hours_worked,
         rr.overtime_hours,
         rr.pto_time,
         rr.sick_time,
         rr.regular_pay,
         rr.overtime_pay,
         rr.pto_pay,
         rr.sick_pay,
         rr.holiday_pay,
         rr.training_pay,
         rr.edu_pay,
         rr.mileage,
         rr.general_reimbursement,
         rr.non_disc_bonus
       FROM payroll.payroll_runs r
       JOIN payroll.payroll_run_rows rr ON rr.run_id = r.id
       ${whereSql}
       ORDER BY r.payroll_end_date ASC, rr.sort_order ASC`,
      params
    ),
    fetchHealthInsuranceSettings(pool),
    fetchEmployeesForGrossProfit(pool),
    fetchEmploymentTypeHistory(pool),
    fetchLniBillingRateSchedules(pool),
    fetchMileageRate(pool),
  ]);

  const analytics = buildAnalytics(rowsResult.rows);
  const employeeOptions = employeeOptionsResult.rows
    .map((r) => String(r.employee_name || "").trim())
    .filter(Boolean)
    .sort((a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: "base" }));
  const healthInsuranceQualification = buildHealthInsuranceQualification(
    rowsResult.rows,
    healthInsuranceSettings.hoursPerWorkingDay
  );
  const payrollStartDateByEndDate = buildPayrollStartDateByEndDate(
    runsResult.rows.map((r) => formatSqlDate(r.payroll_end_date))
  );
  const grossProfit = buildGrossProfitAnalytics({
    payrollRows: rowsResult.rows,
    payrollStartDateByEndDate,
    employees: employeesResult,
    employmentTypeHistory,
    lniRateSchedules,
    mileageRate,
  });
  const employeeEmploymentTypes = await fetchEmployeeEmploymentTypes(
    pool,
    endDate || payrollEndDate || startDate || new Date()
  );

  return {
    filters: { startDate, endDate, payrollEndDate, employee },
    runs: runsResult.rows.map((r) => ({
      id: r.id,
      payrollEndDate: formatSqlDate(r.payroll_end_date),
      workingDays: r.working_days == null ? null : Number(r.working_days),
      holidayDays: r.holiday_days == null ? null : Number(r.holiday_days),
      nonBillFileName: r.non_bill_file_name || "",
      updatedAt: r.updated_at,
    })),
    ...analytics,
    employeeOptions,
    healthInsuranceSettings,
    healthInsuranceQualification,
    lniBillingRateSchedules: lniRateSchedules,
    employeeEmploymentTypes,
    grossProfit,
  };
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") {
    res.setHeader("Allow", "GET, PATCH, OPTIONS");
    res.setHeader("Access-Control-Allow-Methods", "GET, PATCH, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }

  const admin = await requireRealAdmin(req, res);
  if (!admin) return;

  let pool;
  try {
    pool = getPool();
  } catch {
    return res.status(500).json({ error: "Database not configured" });
  }

  if (req.method === "PATCH") {
    try {
      const body = await readJsonBody(req);
      const response = { ok: true };

      if (body.healthInsuranceSettings || body.hoursPerWorkingDay != null) {
        const settings = body.healthInsuranceSettings || body;
        response.healthInsuranceSettings = await updateHealthInsuranceSettings(pool, {
          hoursPerWorkingDay: settings.hoursPerWorkingDay,
        });
      }

      if (Array.isArray(body.employmentTypeUpdates) && body.employmentTypeUpdates.length) {
        for (const item of body.employmentTypeUpdates) {
          await upsertEmploymentTypeChange(pool, {
            employeeId: item.employeeId,
            employmentType: item.employmentType,
            effectiveDate: item.effectiveDate,
            updatedByEmail: admin.email || admin.name || "",
          });
        }
        response.employeeEmploymentTypes = await fetchEmployeeEmploymentTypes(pool, new Date());
      }

      if (body.lniRateSchedule) {
        response.lniRateSchedule = await upsertLniBillingRateSchedule(pool, {
          employmentType: body.lniRateSchedule.employmentType,
          effectiveDate: body.lniRateSchedule.effectiveDate,
          professionalRate: body.lniRateSchedule.professionalRate,
          travelWaitRate: body.lniRateSchedule.travelWaitRate,
          updatedByEmail: admin.email || admin.name || "",
        });
        response.lniBillingRateSchedules = await fetchLniBillingRateSchedules(pool);
      }

      if (
        !response.healthInsuranceSettings &&
        !response.employeeEmploymentTypes &&
        !response.lniRateSchedule
      ) {
        return res.status(400).json({ error: "No supported settings provided to update." });
      }

      return res.status(200).json(response);
    } catch (e) {
      return res.status(500).json({ error: e?.message || "Failed to save payroll analytics settings" });
    }
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, PATCH, OPTIONS");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const startDate = parseDateParam(req.query?.startDate);
  const endDate = parseDateParam(req.query?.endDate);
  const payrollEndDate = parseDateParam(req.query?.payrollEndDate);
  const employee = normalizeName(req.query?.employee);

  try {
    const data = await loadPayrollAnalytics(pool, { startDate, endDate, payrollEndDate, employee });
    return res.status(200).json({ ok: true, ...data });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Failed to load payroll analytics" });
  }
}
