const { buffer } = require("node:stream/consumers");
const { getPool } = require("../../lib/db");
const { requireRealAdmin } = require("../../lib/apiAuth");
const { listAdjResubRows, upsertAdjResubRow } = require("../../lib/payroll-adj-resub");

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
    res.setHeader("Allow", "GET, PUT, OPTIONS");
    res.setHeader("Access-Control-Allow-Methods", "GET, PUT, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }

  const admin = await requireRealAdmin(req, res);
  if (!admin) return;

  let pool;
  try {
    pool = getPool();
  } catch {
    return res.status(500).json({ error: "Database not configured" });
  }

  try {
    if (req.method === "GET") {
      const payrollEndDate = req.query?.payrollEndDate;
      const rows = await listAdjResubRows(pool, payrollEndDate);
      return res.status(200).json({ ok: true, payrollEndDate: String(payrollEndDate || "").slice(0, 10), rows });
    }

    if (req.method === "PUT") {
      const body = await readJsonBody(req);
      const row = await upsertAdjResubRow(pool, {
        payrollEndDate: body.payrollEndDate,
        row: body.row,
        updatedByEmail: admin.email || admin.name || "",
      });
      return res.status(200).json({ ok: true, row });
    }

    res.setHeader("Allow", "GET, PUT, OPTIONS");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Failed to save adjustment row" });
  }
}
