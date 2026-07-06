const { ensureEmployees } = require("./ensure-employee");

function toNonNegativeNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parsePayrollEndDate(value) {
  const s = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return s;
}

function normalizePayroll20Row(row, sortOrder) {
  return {
    sortOrder,
    providerId: String(row.providerId || "").trim(),
    employeeName: String(row.employeeName || "").trim(),
    casePlusReports: toNumber(row.casePlusReports),
    nbTime: toNumber(row.nbTime),
    travelWaitHours: toNumber(row.travelWaitHours),
    totalHoursWorked: toNumber(row.totalHoursWorked),
    overtimeHours: toNumber(row.overtimeHours),
    ptoTime: toNumber(row.ptoTime),
    sickTime: toNumber(row.sickTime),
    regularPay: toNumber(row.regularPay),
    overtimePay: toNumber(row.overtimePay),
    ptoPay: toNumber(row.ptoPay),
    sickPay: toNumber(row.sickPay),
    holidayPay: toNumber(row.holidayPay),
    trainingPay: toNumber(row.trainingPay),
    eduPay: toNumber(row.eduPay),
    mileage: toNumber(row.mileage ?? row.mileageReimb),
    generalReimbursement: toNumber(row.generalReimbursement),
    nonDiscBonus: toNumber(row.nonDiscBonus),
  };
}

async function savePayrollRun(pool, { payrollEndDate, recordedByEmail, payload }) {
  const endDate = parsePayrollEndDate(payrollEndDate);
  if (!endDate) {
    throw new Error("Payroll end date is required (YYYY-MM-DD).");
  }

  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  if (!rows.length) {
    throw new Error("Payroll 2.0 employee rows are required.");
  }

  const normalizedRows = rows
    .map((row, index) => normalizePayroll20Row(row, index))
    .filter((row) => row.employeeName);

  if (!normalizedRows.length) {
    throw new Error("No valid employee rows to record.");
  }

  const nbOnlyNames = Array.isArray(payload.nbOnlyEmployeeNames)
    ? payload.nbOnlyEmployeeNames.map((n) => String(n || "").trim()).filter(Boolean)
    : [];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT id FROM payroll.payroll_runs WHERE payroll_end_date = $1::date LIMIT 1`,
      [endDate]
    );
    const overwritten = Boolean(existing.rows[0]);

    const runResult = await client.query(
      `INSERT INTO payroll.payroll_runs (
         payroll_end_date,
         working_days,
         holiday_days,
         incentive_threshold,
         non_bill_file_name,
         heather_commission,
         management_fee,
         nb_only_employee_names,
         sums,
         recorded_by_email,
         updated_at
       ) VALUES (
         $1::date,
         $2,
         $3,
         $4,
         $5,
         $6,
         $7,
         $8::jsonb,
         $9::jsonb,
         $10,
         now()
       )
       ON CONFLICT (payroll_end_date) DO UPDATE SET
         working_days = EXCLUDED.working_days,
         holiday_days = EXCLUDED.holiday_days,
         incentive_threshold = EXCLUDED.incentive_threshold,
         non_bill_file_name = EXCLUDED.non_bill_file_name,
         heather_commission = EXCLUDED.heather_commission,
         management_fee = EXCLUDED.management_fee,
         nb_only_employee_names = EXCLUDED.nb_only_employee_names,
         sums = EXCLUDED.sums,
         recorded_by_email = EXCLUDED.recorded_by_email,
         updated_at = now()
       RETURNING id`,
      [
        endDate,
        payload.workingDays != null ? Math.trunc(toNumber(payload.workingDays)) : null,
        payload.holidayDays != null ? Math.trunc(toNumber(payload.holidayDays)) : null,
        toNumber(payload.incentiveThreshold),
        String(payload.fileName || "").trim(),
        toNumber(payload.heatherCommission),
        toNumber(payload.managementFee),
        JSON.stringify(nbOnlyNames),
        JSON.stringify(payload.sums && typeof payload.sums === "object" ? payload.sums : {}),
        String(recordedByEmail || "").trim() || null,
      ]
    );

    const runId = runResult.rows[0]?.id;
    if (!runId) throw new Error("Failed to save payroll run.");

    await ensureEmployees(
      client,
      normalizedRows.map((row) => ({
        providerId: row.providerId,
        displayName: row.employeeName,
      }))
    );

    await client.query(`DELETE FROM payroll.payroll_run_rows WHERE run_id = $1::uuid`, [runId]);

    for (const row of normalizedRows) {
      await client.query(
        `INSERT INTO payroll.payroll_run_rows (
           run_id, sort_order, provider_id, employee_name,
           case_plus_reports, nb_time, travel_wait_hours,
           total_hours_worked, overtime_hours, pto_time, sick_time,
           regular_pay, overtime_pay, pto_pay, sick_pay, holiday_pay,
           training_pay, edu_pay, mileage, general_reimbursement, non_disc_bonus
         ) VALUES (
           $1, $2, $3, $4,
           $5, $6, $7,
           $8, $9, $10, $11,
           $12, $13, $14, $15, $16,
           $17, $18, $19, $20, $21
         )`,
        [
          runId,
          row.sortOrder,
          row.providerId,
          row.employeeName,
          row.casePlusReports,
          row.nbTime,
          row.travelWaitHours,
          row.totalHoursWorked,
          row.overtimeHours,
          row.ptoTime,
          row.sickTime,
          row.regularPay,
          row.overtimePay,
          row.ptoPay,
          row.sickPay,
          row.holidayPay,
          row.trainingPay,
          row.eduPay,
          row.mileage,
          row.generalReimbursement,
          row.nonDiscBonus,
        ]
      );
    }

    await client.query("COMMIT");

    return {
      runId,
      payrollEndDate: endDate,
      employeeCount: normalizedRows.length,
      overwritten,
    };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }
}

module.exports = {
  parsePayrollEndDate,
  savePayrollRun,
};
