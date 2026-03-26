const { buffer } = require("node:stream/consumers");
const { getPool } = require("../../lib/db");
const { getToken } = require("next-auth/jwt");

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

async function requireAdmin(req) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token || token.role !== "admin") {
    return { ok: false, res: { status: 403, json: { error: "Admin access required" } } };
  }
  return { ok: true };
}

function normalizeEmail(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase();
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET, PATCH, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }

  const pool = getPool();
  try {
    const adminCheck = await requireAdmin(req);
    if (!adminCheck.ok) {
      return res.status(adminCheck.res.status).json(adminCheck.res.json);
    }

    if (req.method === "GET") {
      const r = await pool.query(
        `SELECT email
         FROM payroll.app_access_emails
         WHERE is_enabled = true
         ORDER BY email ASC`
      );
      return res.status(200).json({ allowedEmails: r.rows.map((x) => x.email) });
    }

    if (req.method === "PATCH") {
      const body = await readJsonBody(req);
      const allowedEmailsRaw = Array.isArray(body.allowedEmails) ? body.allowedEmails : null;
      if (!allowedEmailsRaw) {
        return res.status(400).json({ error: "Body must include allowedEmails: string[]" });
      }

      const allowedEmails = Array.from(
        new Set(
          allowedEmailsRaw
            .map(normalizeEmail)
            .filter((e) => e && e.includes("@"))
        )
      );

      await pool.query("BEGIN");
      await pool.query("DELETE FROM payroll.app_access_emails");
      if (allowedEmails.length) {
        await pool.query(
          `INSERT INTO payroll.app_access_emails (email, is_enabled)
           SELECT x, true
           FROM unnest($1::text[]) AS x
           ON CONFLICT (email) DO UPDATE SET is_enabled = EXCLUDED.is_enabled`,
          [allowedEmails]
        );
      }
      await pool.query("COMMIT");

      return res.status(200).json({ allowedEmails });
    }

    res.setHeader("Allow", "GET, PATCH, OPTIONS");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    // Best-effort rollback.
    try {
      await pool.query("ROLLBACK");
    } catch {
      // ignore
    }
    return res.status(500).json({ error: e?.message || "Request failed" });
  }
}

