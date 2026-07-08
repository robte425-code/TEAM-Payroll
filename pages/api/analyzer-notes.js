const { buffer } = require("node:stream/consumers");
const { getPool } = require("../../lib/db");
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

function rowToClient(row) {
  return {
    id: row.id,
    content: row.content || "",
    createdByEmail: row.created_by_email || "",
    updatedByEmail: row.updated_by_email || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeContent(value) {
  return String(value ?? "").trim();
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store, max-age=0");

  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }

  const admin = await requireRealAdmin(req, res);
  if (!admin) return;

  let pool;
  try {
    pool = getPool();
  } catch (e) {
    return res.status(500).json({ error: e.message || "Database not configured" });
  }

  try {
    if (req.method === "GET") {
      const r = await pool.query(
        `SELECT id, content, created_by_email, updated_by_email, created_at, updated_at
         FROM payroll.analyzer_notes
         ORDER BY updated_at DESC, created_at DESC`
      );
      return res.status(200).json({ notes: r.rows.map(rowToClient) });
    }

    const body = await readJsonBody(req);

    if (req.method === "POST") {
      const content = normalizeContent(body.content);
      if (!content) return res.status(400).json({ error: "content is required" });

      const r = await pool.query(
        `INSERT INTO payroll.analyzer_notes (content, created_by_email, updated_by_email)
         VALUES ($1, $2, $2)
         RETURNING id, content, created_by_email, updated_by_email, created_at, updated_at`,
        [content, admin.email || null]
      );
      return res.status(201).json({ note: rowToClient(r.rows[0]) });
    }

    if (req.method === "PATCH") {
      const id = String(body.id || req.query?.id || "").trim();
      const content = normalizeContent(body.content);
      if (!id) return res.status(400).json({ error: "id is required" });
      if (!content) return res.status(400).json({ error: "content is required" });

      const r = await pool.query(
        `UPDATE payroll.analyzer_notes
         SET content = $1,
             updated_by_email = $2,
             updated_at = now()
         WHERE id = $3::uuid
         RETURNING id, content, created_by_email, updated_by_email, created_at, updated_at`,
        [content, admin.email || null, id]
      );
      if (!r.rows[0]) return res.status(404).json({ error: "Note not found" });
      return res.status(200).json({ note: rowToClient(r.rows[0]) });
    }

    if (req.method === "DELETE") {
      const id = String(body.id || req.query?.id || "").trim();
      if (!id) return res.status(400).json({ error: "id is required" });

      const r = await pool.query(`DELETE FROM payroll.analyzer_notes WHERE id = $1::uuid RETURNING id`, [
        id,
      ]);
      if (!r.rows[0]) return res.status(404).json({ error: "Note not found" });
      return res.status(200).json({ ok: true, id });
    }

    res.setHeader("Allow", "GET, POST, PATCH, DELETE, OPTIONS");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Request failed" });
  }
}
