const { buffer } = require("node:stream/consumers");
const { getPool } = require("../../lib/db");

const MILEAGE_KEY = "mileage_rate";

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

function parseMileageFromRow(value) {
  if (value == null) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value >= 0 ? value : 0;
  if (typeof value === "object" && value.rate != null) {
    return toNonNegativeNumber(value.rate, 0);
  }
  return 0;
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
      const result = await pool.query(
        `SELECT value FROM payroll.app_kv WHERE key = $1`,
        [MILEAGE_KEY]
      );
      const mileageRate = result.rows[0] ? parseMileageFromRow(result.rows[0].value) : 0;
      return res.status(200).json({ mileageRate });
    }

    if (req.method === "PATCH" || req.method === "PUT") {
      const body = await readJsonBody(req);
      const mileageRate = toNonNegativeNumber(body.mileageRate, 0);
      await pool.query(
        `INSERT INTO payroll.app_kv (key, value, updated_at)
         VALUES ($1, $2::jsonb, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [MILEAGE_KEY, JSON.stringify({ rate: mileageRate })]
      );
      return res.status(200).json({ mileageRate });
    }

    res.setHeader("Allow", "GET, PATCH, PUT, OPTIONS");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    const msg = e && e.message ? e.message : "Request failed";
    return res.status(500).json({ error: msg });
  }
}
