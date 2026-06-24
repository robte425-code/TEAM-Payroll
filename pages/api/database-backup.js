const fs = require("fs");
const { IncomingForm } = require("formidable");
const { getPool } = require("../../lib/db");
const { requireRealAdmin } = require("../../lib/apiAuth");
const {
  generatePayrollBackupSql,
  backupFilename,
  MAX_RESTORE_BYTES,
  restorePayrollBackupSql,
} = require("../../lib/payroll-db-backup");

export const config = {
  api: {
    bodyParser: false,
  },
};

function parseForm(req) {
  return new Promise((resolve, reject) => {
    const form = new IncomingForm({
      maxFileSize: MAX_RESTORE_BYTES,
      keepExtensions: true,
    });
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

function readUploadedSql(file) {
  const entry = Array.isArray(file) ? file[0] : file;
  if (!entry) return null;
  const filepath = entry.filepath || entry.path;
  if (!filepath) return null;
  const stat = fs.statSync(filepath);
  if (stat.size > MAX_RESTORE_BYTES) {
    throw new Error(`File too large (max ${Math.round(MAX_RESTORE_BYTES / (1024 * 1024))}MB)`);
  }
  return {
    sql: fs.readFileSync(filepath, "utf8"),
    originalFilename: entry.originalFilename || entry.name || "backup.sql",
  };
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    const admin = await requireRealAdmin(req, res);
    if (!admin) return;

    let pool;
    try {
      pool = getPool();
    } catch (e) {
      res.setHeader("Content-Type", "application/json");
      return res.status(500).json({ error: e.message || "Database not configured" });
    }

    try {
      const sql = await generatePayrollBackupSql(pool);
      const filename = backupFilename();

      res.setHeader("Content-Type", "application/sql; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).send(sql);
    } catch (e) {
      res.setHeader("Content-Type", "application/json");
      return res.status(500).json({ error: e.message || "Backup failed" });
    }
  }

  if (req.method === "POST") {
    res.setHeader("Content-Type", "application/json");

    const admin = await requireRealAdmin(req, res);
    if (!admin) return;

    let uploaded;
    try {
      const { files } = await parseForm(req);
      uploaded = readUploadedSql(files.file);
    } catch (e) {
      return res.status(400).json({ error: e.message || "Could not read upload" });
    }

    if (!uploaded?.sql) {
      return res.status(400).json({ error: "Upload a .sql backup file (field name: file)." });
    }

    let pool;
    try {
      pool = getPool();
    } catch (e) {
      return res.status(500).json({ error: e.message || "Database not configured" });
    }

    try {
      await restorePayrollBackupSql(pool, uploaded.sql);
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(400).json({ error: e.message || "Restore failed" });
    }
  }

  res.setHeader("Allow", "GET, POST");
  res.setHeader("Content-Type", "application/json");
  return res.status(405).json({ error: "Method not allowed" });
}
