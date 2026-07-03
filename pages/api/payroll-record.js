const { buffer } = require("node:stream/consumers");
const { getPool } = require("../../lib/db");
const { savePayrollRun } = require("../../lib/payroll-record");
const { requireRealAdmin } = require("../../lib/apiAuth");

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

  const admin = await requireRealAdmin(req, res);
  if (!admin) return;

  let pool;
  try {
    pool = getPool();
  } catch (e) {
    return res.status(500).json({ error: "Database not configured" });
  }

  try {
    const body = await readJsonBody(req);
    const result = await savePayrollRun(pool, {
      payrollEndDate: body.payrollEndDate,
      recordedByEmail: admin.email,
      payload: body.payload,
    });

    return res.status(200).json({
      ok: true,
      ...result,
    });
  } catch (e) {
    const message = e?.message || "Request failed";
    const status = message.includes("required") || message.includes("No valid") ? 400 : 500;
    return res.status(status).json({ error: message });
  }
}
