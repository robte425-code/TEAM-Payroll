const { buffer } = require("node:stream/consumers");
const { getPool } = require("../../lib/db");

const MILEAGE_KEY = "mileage_rate";
const INCENTIVE_PAY_RATE_KEY = "incentive_pay_rate";
const LNI_RATE_KEY = "lni_rate";

function toNonNegativeNumber(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
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
  if (req.method === "GET" || req.method === "DELETE" || req.method === "OPTIONS") {
    return {};
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

function parseRateFromRow(value) {
  if (value == null) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value >= 0 ? value : 0;
  if (typeof value === "object" && value.rate != null) {
    return toNonNegativeNumber(value.rate, 0);
  }
  return 0;
}

async function fetchOrgRates(pool) {
  const result = await pool.query(
    `SELECT key, value FROM payroll.app_kv WHERE key = ANY($1::text[])`,
    [[MILEAGE_KEY, INCENTIVE_PAY_RATE_KEY, LNI_RATE_KEY]]
  );
  const map = {};
  for (const row of result.rows) {
    map[row.key] = parseRateFromRow(row.value);
  }
  return {
    mileageRate: map[MILEAGE_KEY] ?? 0,
    incentivePayRate: map[INCENTIVE_PAY_RATE_KEY] ?? 0,
    lniRate: map[LNI_RATE_KEY] ?? 0,
  };
}

async function upsertRate(pool, key, rate) {
  await pool.query(
    `INSERT INTO payroll.app_kv (key, value, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify({ rate })]
  );
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET, PATCH, PUT, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }

  let pool;
  try {
    pool = getPool();
  } catch (e) {
    return res.status(500).json({ error: e.message || "Database not configured" });
  }

  try {
    if (req.method === "GET") {
      const rates = await fetchOrgRates(pool);
      return res.status(200).json(rates);
    }

    if (req.method === "PATCH" || req.method === "PUT") {
      const body = await readJsonBody(req);
      let updated = false;
      if (body.mileageRate !== undefined) {
        await upsertRate(pool, MILEAGE_KEY, toNonNegativeNumber(body.mileageRate, 0));
        updated = true;
      }
      if (body.incentivePayRate !== undefined) {
        await upsertRate(pool, INCENTIVE_PAY_RATE_KEY, toNonNegativeNumber(body.incentivePayRate, 0));
        updated = true;
      }
      if (body.lniRate !== undefined) {
        await upsertRate(pool, LNI_RATE_KEY, toNonNegativeNumber(body.lniRate, 0));
        updated = true;
      }
      if (!updated) {
        return res.status(400).json({
          error: "Provide mileageRate, incentivePayRate, and/or lniRate to update",
        });
      }
      const rates = await fetchOrgRates(pool);
      return res.status(200).json(rates);
    }

    res.setHeader("Allow", "GET, PATCH, PUT, OPTIONS");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    const msg = e && e.message ? e.message : "Request failed";
    return res.status(500).json({ error: msg });
  }
}
