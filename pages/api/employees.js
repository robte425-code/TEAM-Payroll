const { buffer } = require("node:stream/consumers");
const { getPool } = require("../../lib/db");

function rowToClient(row) {
  return {
    id: row.id,
    providerId: row.provider_id,
    displayName: row.display_name,
    hourlyRate: row.hourly_rate != null ? Number(row.hourly_rate) : 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getQueryId(req) {
  if (req.query && req.query.id) return String(req.query.id).trim();
  try {
    const host = req.headers?.host || "localhost";
    const proto = req.headers?.["x-forwarded-proto"] || "http";
    const u = new URL(req.url || "", `${proto}://${host}`);
    return String(u.searchParams.get("id") || "").trim();
  } catch {
    return "";
  }
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

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
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
        `SELECT id, provider_id, display_name, hourly_rate, created_at, updated_at
         FROM payroll.employees
         ORDER BY display_name ASC, provider_id ASC`
      );
      return res.status(200).json({ employees: result.rows.map(rowToClient) });
    }

    const body = await readJsonBody(req);

    if (req.method === "POST") {
      const providerId = String(body.providerId || "").trim();
      const displayName = String(body.displayName ?? "").trim();
      const hourlyRate = Number(body.hourlyRate);

      if (!providerId) {
        return res.status(400).json({ error: "providerId is required" });
      }
      if (!Number.isFinite(hourlyRate) || hourlyRate < 0) {
        return res.status(400).json({ error: "hourlyRate must be a non-negative number" });
      }

      const inserted = await pool.query(
        `INSERT INTO payroll.employees (provider_id, display_name, hourly_rate)
         VALUES ($1, $2, $3)
         RETURNING id, provider_id, display_name, hourly_rate, created_at, updated_at`,
        [providerId, displayName, hourlyRate]
      );
      const row = inserted && inserted.rows && inserted.rows[0];
      if (!row) {
        return res.status(500).json({ error: "Insert failed" });
      }
      return res.status(201).json({ employee: rowToClient(row) });
    }

    if (req.method === "PATCH") {
      const id = String(body.id || "").trim();
      if (!id) {
        return res.status(400).json({ error: "id is required" });
      }
      const providerId = String(body.providerId || "").trim();
      const displayName = String(body.displayName ?? "").trim();
      const hourlyRate = Number(body.hourlyRate);

      if (!providerId) {
        return res.status(400).json({ error: "providerId is required" });
      }
      if (!Number.isFinite(hourlyRate) || hourlyRate < 0) {
        return res.status(400).json({ error: "hourlyRate must be a non-negative number" });
      }

      const updated = await pool.query(
        `UPDATE payroll.employees
         SET provider_id = $1,
             display_name = $2,
             hourly_rate = $3,
             updated_at = now()
         WHERE id = $4::uuid
         RETURNING id, provider_id, display_name, hourly_rate, created_at, updated_at`,
        [providerId, displayName, hourlyRate, id]
      );
      if (!updated.rows.length) {
        return res.status(404).json({ error: "Employee not found" });
      }
      return res.status(200).json({ employee: rowToClient(updated.rows[0]) });
    }

    if (req.method === "DELETE") {
      const id = getQueryId(req);
      if (!id) {
        return res.status(400).json({ error: "Query id is required" });
      }
      const deleted = await pool.query(
        `DELETE FROM payroll.employees
         WHERE id = $1::uuid
         RETURNING id`,
        [id]
      );
      if (!deleted.rows.length) {
        return res.status(404).json({ error: "Employee not found" });
      }
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST, PATCH, DELETE, OPTIONS");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    const msg = e && e.message ? e.message : "Request failed";
    if (/unique|duplicate/i.test(msg)) {
      return res.status(409).json({ error: "Provider ID already exists" });
    }
    return res.status(500).json({ error: msg });
  }
}
