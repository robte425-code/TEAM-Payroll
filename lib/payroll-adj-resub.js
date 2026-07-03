function normalizeName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function parsePayrollEndDate(value) {
  const s = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return s;
}

function normalizeEmployeeKey(row) {
  const providerId = String(row.providerId ?? row.provider_id ?? "").trim();
  if (providerId) return providerId;
  return normalizeName(row.employeeName ?? row.employee_name);
}

function buildAdjResubRowKey(row) {
  const employeeKey = normalizeEmployeeKey(row);
  const adjLetters = String(row.adjResub ?? row.adj_resub ?? "")
    .replace(/[^a-z]/gi, "")
    .toUpperCase();
  return [
    employeeKey,
    String(row.referralNumber ?? row.referral_number ?? "").trim(),
    String(row.rateCode ?? row.rate_code ?? "").trim().toUpperCase(),
    String(row.dateFrom ?? row.date_from ?? "").trim(),
    String(row.dateTo ?? row.date_to ?? "").trim(),
    adjLetters,
  ].join("\x1e");
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
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

function mapAdjResubRow(row) {
  return {
    rowKey: row.row_key,
    payrollEndDate: formatSqlDate(row.payroll_end_date),
    sourceFile: row.source_file || "",
    employeeName: row.employee_name || "",
    providerId: row.provider_id || "",
    claimant: row.claimant || "",
    referralNumber: row.referral_number || "",
    rateCode: row.rate_code || "",
    dateFrom: row.date_from || "",
    dateTo: row.date_to || "",
    adjResub: row.adj_resub || "",
    spreadsheetUnits: row.spreadsheet_units == null ? 0 : Number(row.spreadsheet_units),
    resolvedUnits: row.resolved_units == null ? null : Number(row.resolved_units),
    unitsLocked: Boolean(row.units_locked),
    updatedAt: row.updated_at,
    updatedByEmail: row.updated_by_email || "",
  };
}

async function listAdjResubRows(pool, payrollEndDate) {
  const endDate = parsePayrollEndDate(payrollEndDate);
  if (!endDate) return [];

  const result = await pool.query(
    `SELECT
       payroll_end_date,
       row_key,
       source_file,
       employee_name,
       provider_id,
       claimant,
       referral_number,
       rate_code,
       date_from,
       date_to,
       adj_resub,
       spreadsheet_units,
       resolved_units,
       units_locked,
       updated_by_email,
       updated_at
     FROM payroll.payroll_adj_resub_rows
     WHERE payroll_end_date = $1::date
     ORDER BY employee_name ASC, referral_number ASC, rate_code ASC`,
    [endDate]
  );
  return result.rows.map(mapAdjResubRow);
}

async function upsertAdjResubRow(pool, { payrollEndDate, row, updatedByEmail }) {
  const endDate = parsePayrollEndDate(payrollEndDate);
  if (!endDate) {
    throw new Error("Payroll end date is required (YYYY-MM-DD).");
  }
  if (!row || typeof row !== "object") {
    throw new Error("Adjustment row is required.");
  }

  const rowKey = String(row.rowKey || buildAdjResubRowKey(row)).trim();
  if (!rowKey) {
    throw new Error("Adjustment row key is required.");
  }

  const resolvedUnits =
    row.resolvedUnits == null || row.resolvedUnits === ""
      ? null
      : toNumber(row.resolvedUnits);
  const unitsLocked = Boolean(row.unitsLocked);

  const result = await pool.query(
    `INSERT INTO payroll.payroll_adj_resub_rows (
       payroll_end_date,
       row_key,
       source_file,
       employee_name,
       provider_id,
       claimant,
       referral_number,
       rate_code,
       date_from,
       date_to,
       adj_resub,
       spreadsheet_units,
       resolved_units,
       units_locked,
       updated_by_email,
       updated_at
     ) VALUES (
       $1::date,
       $2,
       $3,
       $4,
       $5,
       $6,
       $7,
       $8,
       $9,
       $10,
       $11,
       $12,
       $13,
       $14,
       $15,
       now()
     )
     ON CONFLICT (payroll_end_date, row_key) DO UPDATE SET
       source_file = EXCLUDED.source_file,
       employee_name = EXCLUDED.employee_name,
       provider_id = EXCLUDED.provider_id,
       claimant = EXCLUDED.claimant,
       referral_number = EXCLUDED.referral_number,
       rate_code = EXCLUDED.rate_code,
       date_from = EXCLUDED.date_from,
       date_to = EXCLUDED.date_to,
       adj_resub = EXCLUDED.adj_resub,
       spreadsheet_units = EXCLUDED.spreadsheet_units,
       resolved_units = EXCLUDED.resolved_units,
       units_locked = EXCLUDED.units_locked,
       updated_by_email = EXCLUDED.updated_by_email,
       updated_at = now()
     RETURNING
       payroll_end_date,
       row_key,
       source_file,
       employee_name,
       provider_id,
       claimant,
       referral_number,
       rate_code,
       date_from,
       date_to,
       adj_resub,
       spreadsheet_units,
       resolved_units,
       units_locked,
       updated_by_email,
       updated_at`,
    [
      endDate,
      rowKey,
      String(row.sourceFile || "").trim(),
      String(row.employeeName || "").trim(),
      String(row.providerId || "").trim(),
      String(row.claimant || "").trim(),
      String(row.referralNumber || "").trim(),
      String(row.rateCode || "").trim().toUpperCase(),
      String(row.dateFrom || "").trim(),
      String(row.dateTo || "").trim(),
      String(row.adjResub || "").trim(),
      toNumber(row.spreadsheetUnits ?? row.units),
      resolvedUnits,
      unitsLocked,
      String(updatedByEmail || "").trim() || null,
    ]
  );

  return mapAdjResubRow(result.rows[0]);
}

module.exports = {
  buildAdjResubRowKey,
  listAdjResubRows,
  upsertAdjResubRow,
};
