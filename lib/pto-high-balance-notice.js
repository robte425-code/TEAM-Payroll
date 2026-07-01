const { fetchRolloverSettings } = require("./leave-rollover");

const DEFAULT_PTO_HIGH_BALANCE_THRESHOLD_HOURS = 152;
const PTO_HIGH_BALANCE_THRESHOLD_KEY = "pto_high_balance_threshold_hours";

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

function formatHours(n) {
  return (Math.round((Number(n) + Number.EPSILON) * 100) / 100).toFixed(2);
}

async function fetchPtoHighBalanceSettings(db) {
  const raw = await readKv(db, PTO_HIGH_BALANCE_THRESHOLD_KEY);
  return {
    thresholdHours: parseHoursFromKv(raw, DEFAULT_PTO_HIGH_BALANCE_THRESHOLD_HOURS),
  };
}

async function updatePtoHighBalanceSettings(pool, { thresholdHours }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (thresholdHours !== undefined) {
      await upsertKv(client, PTO_HIGH_BALANCE_THRESHOLD_KEY, {
        hours: toNonNegativeNumber(thresholdHours, DEFAULT_PTO_HIGH_BALANCE_THRESHOLD_HOURS),
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
  return fetchPtoHighBalanceSettings(pool);
}

function buildPtoHighBalanceNotice({ ptoAvailableHours, ptoMaxCarryoverHours, thresholdHours }) {
  const available = Number(ptoAvailableHours) || 0;
  const threshold = toNonNegativeNumber(
    thresholdHours,
    DEFAULT_PTO_HIGH_BALANCE_THRESHOLD_HOURS
  );
  if (available <= threshold) return null;

  const carryover = Number(ptoMaxCarryoverHours) || 0;

  return {
    ptoAvailableHours: available,
    ptoMaxCarryoverHours: carryover,
    thresholdHours: threshold,
    message: `You currently have ${formatHours(available)} hours of PTO available. At year-end, only ${formatHours(carryover)} hours will carry over to the next year.`,
  };
}

async function getPtoHighBalanceNoticeForEmployee(pool, emp) {
  const [rollover, ptoHighBalance] = await Promise.all([
    fetchRolloverSettings(pool),
    fetchPtoHighBalanceSettings(pool),
  ]);
  const ptoAvailable =
    (Number(emp.pto_ytd_hours_accrued) || 0) - (Number(emp.pto_ytd_hours_used) || 0);
  return buildPtoHighBalanceNotice({
    ptoAvailableHours: ptoAvailable,
    ptoMaxCarryoverHours: rollover.ptoMaxHours,
    thresholdHours: ptoHighBalance.thresholdHours,
  });
}

module.exports = {
  DEFAULT_PTO_HIGH_BALANCE_THRESHOLD_HOURS,
  PTO_HIGH_BALANCE_THRESHOLD_KEY,
  buildPtoHighBalanceNotice,
  fetchPtoHighBalanceSettings,
  updatePtoHighBalanceSettings,
  getPtoHighBalanceNoticeForEmployee,
};
