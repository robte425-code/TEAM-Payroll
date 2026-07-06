const { buffer } = require("node:stream/consumers");
const { getPool } = require("../../lib/db");
const { ensureEmployees } = require("../../lib/ensure-employee");

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

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ error: "Method not allowed" });
  }

  let pool;
  try {
    pool = getPool();
  } catch (e) {
    return res.status(500).json({ error: "Database not configured" });
  }

  const body = await readJsonBody(req);
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) {
    return res.status(400).json({ error: "rows[] is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ensured = await ensureEmployees(client, rows);
    await client.query("COMMIT");
    return res.status(200).json({ ok: true, ensured });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    return res.status(500).json({ error: e?.message || "Request failed" });
  } finally {
    client.release();
  }
}
