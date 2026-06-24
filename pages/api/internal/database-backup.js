const { getPool } = require("../../../lib/db");
const {
  MAX_RESTORE_BYTES,
  generatePayrollBackupSql,
  restorePayrollBackupSql,
} = require("../../../lib/payroll-db-backup");
const {
  downloadSharePointBackup,
  isSharePointConfigured,
  uploadSharePointBackup,
} = require("../../../lib/sharepointBackupUpload");

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
  return `${APP_NAME}-${day}_${time.replace(/:/g, "-")}${EXTENSION}`;
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function readJsonBody(req) {
  const raw = await readRawBody(req);
  if (raw.length === 0) return {};
  return JSON.parse(raw.toString("utf8"));
}

export default async function handler(req, res) {
  if (!verifyInternalAccess(req)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const pool = getPool();

  try {
    if (req.method === "GET") {
      const target = String(req.query.target || "");
      const sql = await generatePayrollBackupSql(pool);

      if (target === "sharepoint") {
        if (!isSharePointConfigured()) {
          return res.status(500).json({ error: "SHAREPOINT_SITE_URL is not configured on Payroll" });
        }

        const filename = backupFilename();
        const uploaded = await uploadSharePointBackup(
          filename,
          Buffer.from(sql, "utf8"),
          CONTENT_TYPE
        );
        return res.status(200).json({
          ok: true,
          filename: uploaded.name,
          size: uploaded.size,
          id: uploaded.id,
          webUrl: uploaded.webUrl,
        });
      }

      res.setHeader("Content-Type", CONTENT_TYPE);
      res.setHeader("Content-Disposition", `attachment; filename="${backupFilename()}"`);
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).send(sql);
    }

    if (req.method === "POST") {
      const contentType = String(req.headers["content-type"] || "");
      if (contentType.includes("application/json")) {
        const body = await readJsonBody(req);
        if (body.source === "sharepoint") {
          if (!isSharePointConfigured()) {
            return res.status(500).json({ error: "SHAREPOINT_SITE_URL is not configured on Payroll" });
          }
          if (!body.backupId) {
            return res.status(400).json({ error: "backupId is required" });
          }

          const downloaded = await downloadSharePointBackup(String(body.backupId));
          await restorePayrollBackupSql(pool, downloaded.content.toString("utf8"));
          return res.status(200).json({ ok: true, filename: downloaded.name });
        }
      }

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
