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

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Identity of one billable line, stable across re-analysing the same file.
 *
 * Units are part of the key deliberately. If billing changes the hours on a
 * line, that is a different line and the exclusion should not silently carry
 * over to a figure nobody looked at — it reappears and has to be judged again.
 *
 * `occurrence` separates lines that are otherwise identical within one pull;
 * without it, excluding one of two matching rows would exclude both.
 */
function buildCalcRowKey(row, occurrence = 0) {
  return [
    normalizeEmployeeKey(row),
    String(row.referralNumber ?? row.referral_number ?? "").trim(),
    String(row.rateCode ?? row.rate_code ?? "").trim().toUpperCase(),
    String(row.dateFrom ?? row.date_from ?? "").trim(),
    String(row.dateTo ?? row.date_to ?? "").trim(),
    toNumber(row.units).toFixed(4),
    String(occurrence),
  ].join("\x1e");
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

function mapExcludedRow(row) {
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
    units: row.units == null ? 0 : Number(row.units),
    reason: row.reason || "",
    excludedByEmail: row.excluded_by_email || "",
    updatedAt: row.updated_at,
  };
}

const COLUMNS = `payroll_end_date, row_key, source_file, employee_name, provider_id,
                 claimant, referral_number, rate_code, date_from, date_to, units,
                 reason, excluded_by_email, updated_at`;

async function listExcludedRows(pool, payrollEndDate) {
  const endDate = parsePayrollEndDate(payrollEndDate);
  if (!endDate) return [];
  const result = await pool.query(
    `SELECT ${COLUMNS}
       FROM payroll.payroll_excluded_rows
      WHERE payroll_end_date = $1::date
      ORDER BY employee_name ASC, date_from ASC, rate_code ASC`,
    [endDate]
  );
  return result.rows.map(mapExcludedRow);
}

async function excludeRow(pool, { payrollEndDate, row, reason, excludedByEmail }) {
  const endDate = parsePayrollEndDate(payrollEndDate);
  if (!endDate) throw new Error("Payroll end date is required (YYYY-MM-DD).");
  if (!row || typeof row !== "object") throw new Error("Billing line is required.");

  const rowKey = String(row.rowKey || buildCalcRowKey(row)).trim();
  if (!rowKey) throw new Error("Billing line key is required.");

  // Required, not merely allowed: six months on, an exclusion with no reason is
  // indistinguishable from an error, and the hours it removed are real money.
  const why = String(reason || "").trim();
  if (!why) throw new Error("A reason is required to hold a line out of pay.");

  const result = await pool.query(
    `INSERT INTO payroll.payroll_excluded_rows (
       payroll_end_date, row_key, source_file, employee_name, provider_id,
       claimant, referral_number, rate_code, date_from, date_to, units,
       reason, excluded_by_email, updated_at
     ) VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())
     ON CONFLICT (payroll_end_date, row_key) DO UPDATE SET
       source_file = EXCLUDED.source_file,
       employee_name = EXCLUDED.employee_name,
       provider_id = EXCLUDED.provider_id,
       claimant = EXCLUDED.claimant,
       referral_number = EXCLUDED.referral_number,
       rate_code = EXCLUDED.rate_code,
       date_from = EXCLUDED.date_from,
       date_to = EXCLUDED.date_to,
       units = EXCLUDED.units,
       reason = EXCLUDED.reason,
       excluded_by_email = EXCLUDED.excluded_by_email,
       updated_at = now()
     RETURNING ${COLUMNS}`,
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
      toNumber(row.units),
      why.slice(0, 500),
      String(excludedByEmail || "").trim() || null,
    ]
  );
  return mapExcludedRow(result.rows[0]);
}

async function includeRow(pool, { payrollEndDate, rowKey }) {
  const endDate = parsePayrollEndDate(payrollEndDate);
  if (!endDate) throw new Error("Payroll end date is required (YYYY-MM-DD).");
  const key = String(rowKey || "").trim();
  if (!key) throw new Error("Billing line key is required.");
  const r = await pool.query(
    `DELETE FROM payroll.payroll_excluded_rows
      WHERE payroll_end_date = $1::date AND row_key = $2`,
    [endDate, key]
  );
  return { removed: r.rowCount || 0 };
}

module.exports = {
  buildCalcRowKey,
  listExcludedRows,
  excludeRow,
  includeRow,
};
