const { getPool } = require("../../lib/db");
const { requireRealAdmin } = require("../../lib/apiAuth");
const { generatePayrollBackupSql, backupFilename } = require("../../lib/payroll-db-backup");

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.setHeader("Content-Type", "application/json");
    return res.status(405).json({ error: "Method not allowed" });
  }

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
