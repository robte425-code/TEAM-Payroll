const { getPool } = require("../../../lib/db");
const {
  MAX_RESTORE_BYTES,
  generatePayrollBackupSql,
  restorePayrollBackupSql,
} = require("../../../lib/payroll-db-backup");

const APP_NAME = "Payroll";
const EXTENSION = ".sql";
const CONTENT_TYPE = "application/sql";

function verifyInternalAccess(req) {
  const secret = process.env.TEAM_INTERNAL_ACCESS_SECRET?.trim();
  if (!secret) return false;
  const auth = req.headers.authorization || "";
  return auth === `Bearer ${secret}`;
}

function backupFilename() {
  const iso = new Date().toISOString().slice(0, 19);
  const [day, time] = iso.split("T");
  return `${APP_NAME}-${day} ${time.replace(/:/g, "-")}${EXTENSION}`;
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (!verifyInternalAccess(req)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const pool = getPool();

  try {
    if (req.method === "GET") {
      const sql = await generatePayrollBackupSql(pool);
      res.setHeader("Content-Type", CONTENT_TYPE);
      res.setHeader("Content-Disposition", `attachment; filename="${backupFilename()}"`);
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).send(sql);
    }

    if (req.method === "POST") {
      const contentLength = Number(req.headers["content-length"] || "0");
      if (contentLength > MAX_RESTORE_BYTES) {
        return res.status(400).json({
          error: `Backup file too large (max ${Math.round(MAX_RESTORE_BYTES / (1024 * 1024))} MB).`,
        });
      }

      const body = await readRawBody(req);
      const sql = body.toString("utf8");
      await restorePayrollBackupSql(pool, sql);
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    return res.status(400).json({ error: e.message || "Request failed" });
  }
}

export const config = {
  api: {
    bodyParser: false,
  },
};
