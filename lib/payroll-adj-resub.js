// The one copy of the key, shared with the analyzer page. See its header.
const { buildAdjResubRowKey } = require("../public/shared/adj-resub-row-key");
const { ValidationError } = require("./validation-error");

function parsePayrollEndDate(value) {
  const s = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return s;
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
    throw new ValidationError("Payroll end date is required (YYYY-MM-DD).");
  }
  if (!row || typeof row !== "object") {
    throw new ValidationError("Adjustment row is required.");
  }

  const rowKey = String(row.rowKey || buildAdjResubRowKey(row)).trim();
  if (!rowKey) {
    throw new ValidationError("Adjustment row key is required.");
  }

  // A row with no employee can never be matched back to an invoice line, so it
  // can only ever be a mistake. The way one would be written is a request that
  // was meant to clear a value — it carries nothing but the key — arriving
  // without clear set to true and falling through to here, overwriting the
  // saved value with a blank row instead of removing it.
  if (!String(row.employeeName || "").trim() && !String(row.providerId || "").trim()) {
    throw new ValidationError("An adjustment needs the employee it belongs to.");
  }

  const resolvedUnits =
    row.resolvedUnits == null || row.resolvedUnits === ""
      ? null
      : toNumber(row.resolvedUnits);
  const unitsLocked = Boolean(row.unitsLocked);

  // The change and its audit entry in one statement, so the history cannot
  // record a save that did not happen or miss one that did.
  const result = await pool.query(
    `WITH saved AS (
     INSERT INTO payroll.payroll_adj_resub_rows (
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
       updated_at
     ), logged AS (
       INSERT INTO payroll.payroll_adj_resub_audit (
         payroll_end_date, row_key, action, employee_name, rate_code,
         referral_number, date_from, date_to, spreadsheet_units, resolved_units,
         actor_email
       )
       SELECT payroll_end_date, row_key, 'saved', employee_name, rate_code,
              referral_number, date_from, date_to, spreadsheet_units, resolved_units,
              updated_by_email
         FROM saved
     )
     SELECT * FROM saved`,
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

/**
 * Forget a stored adjustment entirely.
 *
 * Locking a value used to be one-way: the cell rendered as text, so a number
 * committed by accident could not be undone in the app and came back locked on
 * every analyze of that period. Removing the row is the undo.
 */
async function deleteAdjResubRow(pool, { payrollEndDate, rowKey, clearedByEmail }) {
  const endDate = parsePayrollEndDate(payrollEndDate);
  if (!endDate) throw new ValidationError("Payroll end date is required (YYYY-MM-DD).");
  const key = String(rowKey || "").trim();
  if (!key) throw new ValidationError("Adjustment row key is required.");

  // Deleted and logged in one statement. The value being removed was being
  // paid, so who removed it and what it was are worth keeping even though the
  // row itself is not. `removed` counts the deleted rows, which is what tells
  // the page whether anything actually happened.
  const r = await pool.query(
    `WITH gone AS (
       DELETE FROM payroll.payroll_adj_resub_rows
        WHERE payroll_end_date = $1::date AND row_key = $2
       RETURNING *
     ), logged AS (
       INSERT INTO payroll.payroll_adj_resub_audit (
         payroll_end_date, row_key, action, employee_name, rate_code,
         referral_number, date_from, date_to, spreadsheet_units, resolved_units,
         actor_email
       )
       SELECT payroll_end_date, row_key, 'cleared', employee_name, rate_code,
              referral_number, date_from, date_to, spreadsheet_units, resolved_units,
              $3
         FROM gone
       RETURNING id
     )
     SELECT count(*)::int AS removed FROM gone`,
    [endDate, key, String(clearedByEmail || "").trim() || null]
  );
  return { removed: r.rows[0]?.removed || 0 };
}

module.exports = {
  buildAdjResubRowKey,
  deleteAdjResubRow,
  listAdjResubRows,
  upsertAdjResubRow,
};
