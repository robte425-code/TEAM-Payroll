const DEFAULT_PTO_ROLLOVER_MAX_HOURS = 128;
const DEFAULT_SICK_ROLLOVER_MAX_HOURS = 40;

const PTO_ROLLOVER_MAX_KEY = "pto_rollover_max_hours";
const SICK_ROLLOVER_MAX_KEY = "sick_rollover_max_hours";
const LEAVE_ROLLOVER_THROUGH_YEAR_KEY = "leave_rollover_through_year";

const ADVISORY_LOCK_KEY = 0x504159524f4c4c; // "PAYROLL" fragment

function toNonNegativeNumber(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function parseHoursFromKv(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "number" && Number.isFinite(value)) return value >= 0 ? value : fallback;
  if (typeof value === "object" && value.hours != null) {
    return toNonNegativeNumber(value.hours, fallback);
  }
  return fallback;
}

function parseYearFromKv(value) {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "object" && value.year != null) {
    const y = Number(value.year);
    return Number.isFinite(y) ? Math.trunc(y) : null;
  }
  return null;
}

function currentCalendarYear() {
  return new Date().getFullYear();
}

function computeCarryoverHours(accrued, used, maxHours) {
  const available = Math.max(0, toNonNegativeNumber(accrued) - toNonNegativeNumber(used));
  return Math.min(available, toNonNegativeNumber(maxHours));
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

async function fetchRolloverSettings(db) {
  const [ptoRaw, sickRaw, yearRaw] = await Promise.all([
    readKv(db, PTO_ROLLOVER_MAX_KEY),
    readKv(db, SICK_ROLLOVER_MAX_KEY),
    readKv(db, LEAVE_ROLLOVER_THROUGH_YEAR_KEY),
  ]);

  return {
    ptoMaxHours: parseHoursFromKv(ptoRaw, DEFAULT_PTO_ROLLOVER_MAX_HOURS),
    sickMaxHours: parseHoursFromKv(sickRaw, DEFAULT_SICK_ROLLOVER_MAX_HOURS),
    lastRolloverYear: parseYearFromKv(yearRaw),
  };
}

async function updateRolloverSettings(pool, { ptoMaxHours, sickMaxHours }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (ptoMaxHours !== undefined) {
      await upsertKv(client, PTO_ROLLOVER_MAX_KEY, {
        hours: toNonNegativeNumber(ptoMaxHours, DEFAULT_PTO_ROLLOVER_MAX_HOURS),
      });
    }
    if (sickMaxHours !== undefined) {
      await upsertKv(client, SICK_ROLLOVER_MAX_KEY, {
        hours: toNonNegativeNumber(sickMaxHours, DEFAULT_SICK_ROLLOVER_MAX_HOURS),
      });
    }
    await client.query("COMMIT");
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
  return fetchRolloverSettings(pool);
}

async function ensureRolloverBaseline(client, currentYear) {
  const yearRaw = await readKv(client, LEAVE_ROLLOVER_THROUGH_YEAR_KEY);
  if (parseYearFromKv(yearRaw) != null) return false;

  await upsertKv(client, LEAVE_ROLLOVER_THROUGH_YEAR_KEY, { year: currentYear - 1 });
  return true;
}

function formatHours(n) {
  return (Math.round((Number(n) + Number.EPSILON) * 100) / 100).toFixed(2);
}

async function applyYearEndRolloverIfNeeded(pool) {
  const currentYear = currentCalendarYear();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [ADVISORY_LOCK_KEY]);

    const initialized = await ensureRolloverBaseline(client, currentYear);
    if (initialized) {
      await client.query("COMMIT");
      return { applied: false, initialized: true, employeesUpdated: 0, year: null };
    }

    const settings = await fetchRolloverSettings(client);
    const throughYear = settings.lastRolloverYear;
    const targetYear = currentYear - 1;

    if (throughYear == null || throughYear >= targetYear) {
      await client.query("COMMIT");
      return { applied: false, employeesUpdated: 0, year: null, lastRolloverYear: throughYear };
    }

    const empR = await client.query(
      `SELECT id, display_name,
              pto_ytd_hours_accrued, pto_ytd_hours_used,
              sick_ytd_hours_accrued, sick_ytd_hours_used
       FROM payroll.employees
       ORDER BY display_name ASC
       FOR UPDATE`
    );

    let employeesUpdated = 0;
    let batchId = null;

    for (const emp of empR.rows) {
      const beforePtoAccrued = Number(emp.pto_ytd_hours_accrued) || 0;
      const beforePtoUsed = Number(emp.pto_ytd_hours_used) || 0;
      const beforeSickAccrued = Number(emp.sick_ytd_hours_accrued) || 0;
      const beforeSickUsed = Number(emp.sick_ytd_hours_used) || 0;

      const ptoAvailable = Math.max(0, beforePtoAccrued - beforePtoUsed);
      const sickAvailable = Math.max(0, beforeSickAccrued - beforeSickUsed);
      const ptoCarry = computeCarryoverHours(beforePtoAccrued, beforePtoUsed, settings.ptoMaxHours);
      const sickCarry = computeCarryoverHours(
        beforeSickAccrued,
        beforeSickUsed,
        settings.sickMaxHours
      );

      const afterPtoAccrued = ptoCarry;
      const afterPtoUsed = 0;
      const afterSickAccrued = sickCarry;
      const afterSickUsed = 0;

      const unchanged =
        afterPtoAccrued === beforePtoAccrued &&
        afterPtoUsed === beforePtoUsed &&
        afterSickAccrued === beforeSickAccrued &&
        afterSickUsed === beforeSickUsed;

      if (unchanged) continue;

      if (!batchId) {
        const batchR = await client.query(
          `INSERT INTO payroll.leave_change_batches (operation_type)
           VALUES ('year_end_rollover')
           RETURNING id`
        );
        batchId = batchR.rows[0].id;
      }

      await client.query(
        `UPDATE payroll.employees
         SET pto_ytd_hours_accrued = $1,
             pto_ytd_hours_used = $2,
             sick_ytd_hours_accrued = $3,
             sick_ytd_hours_used = $4,
             updated_at = now()
         WHERE id = $5::uuid`,
        [afterPtoAccrued, afterPtoUsed, afterSickAccrued, afterSickUsed, emp.id]
      );

      const ptoLogIds = [];
      const sickLogIds = [];
      const employeeName = String(emp.display_name || "").trim();
      const ptoForfeited = Math.max(0, ptoAvailable - ptoCarry);
      const sickForfeited = Math.max(0, sickAvailable - sickCarry);

      if (ptoAvailable > 0 || beforePtoUsed > 0 || ptoCarry > 0) {
        const ptoReason = `Year-end ${targetYear} rollover: ${formatHours(ptoCarry)} hr PTO carried forward${
          ptoForfeited > 0 ? ` (${formatHours(ptoForfeited)} hr forfeited)` : ""
        }`;
        const ins = await client.query(
          `INSERT INTO payroll.pto_log (employee_name, action_date, action, hours, reason)
           VALUES ($1, make_date($2, 12, 31), 'Accrual', $3, $4)
           RETURNING id`,
          [employeeName, targetYear, ptoCarry, ptoReason]
        );
        if (ins.rows[0]?.id) ptoLogIds.push(ins.rows[0].id);
      }

      if (sickAvailable > 0 || beforeSickUsed > 0 || sickCarry > 0) {
        const sickReason = `Year-end ${targetYear} rollover: ${formatHours(sickCarry)} hr sick time carried forward${
          sickForfeited > 0 ? ` (${formatHours(sickForfeited)} hr forfeited)` : ""
        }`;
        const ins = await client.query(
          `INSERT INTO payroll.sick_time_log (employee_name, action_date, action, hours, reason)
           VALUES ($1, make_date($2, 12, 31), 'Accrual', $3, $4)
           RETURNING id`,
          [employeeName, targetYear, sickCarry, sickReason]
        );
        if (ins.rows[0]?.id) sickLogIds.push(ins.rows[0].id);
      }

      await client.query(
        `INSERT INTO payroll.leave_change_batch_details (
           batch_id, employee_id,
           pto_ytd_hours_accrued_before, pto_ytd_hours_used_before,
           sick_ytd_hours_accrued_before, sick_ytd_hours_used_before,
           pto_ytd_hours_accrued_after, pto_ytd_hours_used_after,
           sick_ytd_hours_accrued_after, sick_ytd_hours_used_after,
           pto_log_ids, sick_log_ids
         ) VALUES (
           $1, $2,
           $3, $4, $5, $6,
           $7, $8, $9, $10,
           $11::uuid[], $12::uuid[]
         )`,
        [
          batchId,
          emp.id,
          beforePtoAccrued,
          beforePtoUsed,
          beforeSickAccrued,
          beforeSickUsed,
          afterPtoAccrued,
          afterPtoUsed,
          afterSickAccrued,
          afterSickUsed,
          ptoLogIds,
          sickLogIds,
        ]
      );
      employeesUpdated += 1;
    }

    await upsertKv(client, LEAVE_ROLLOVER_THROUGH_YEAR_KEY, { year: targetYear });
    await client.query("COMMIT");

    return {
      applied: true,
      employeesUpdated,
      year: targetYear,
      lastRolloverYear: targetYear,
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
  DEFAULT_PTO_ROLLOVER_MAX_HOURS,
  DEFAULT_SICK_ROLLOVER_MAX_HOURS,
  computeCarryoverHours,
  fetchRolloverSettings,
  updateRolloverSettings,
  applyYearEndRolloverIfNeeded,
};
