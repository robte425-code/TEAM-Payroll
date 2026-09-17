const { buffer } = require("node:stream/consumers");
const { getPool } = require("../../lib/db");
const { requireRealAdmin } = require("../../lib/apiAuth");
const {
  listExcludedRows,
  excludeRow,
  includeRow,
} = require("../../lib/payroll-row-exclusions");

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

/**
 * Billable lines held out of pay for one payroll period.
 *
 * For work the firm is rebilling that the employee has already been paid for —
 * billing moved to a different authorization arrives as ordinary new billing
 * with no Adj/Resub flag, so nothing else takes it out.
 */
export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store, max-age=0");

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
      const rows = await listExcludedRows(pool, payrollEndDate);
      return res.status(200).json({
        ok: true,
        payrollEndDate: String(payrollEndDate || "").slice(0, 10),
        rows,
      });
    }

    if (req.method === "PUT") {
      const body = await readJsonBody(req);
      // One endpoint both ways, so the toggle cannot half-apply: excluded=false
      // removes the row rather than leaving a flag behind to be misread later.
      if (body.excluded === false) {
        const result = await includeRow(pool, {
          payrollEndDate: body.payrollEndDate,
          rowKey: body.row?.rowKey || body.rowKey,
        });
        return res.status(200).json({ ok: true, excluded: false, ...result });
      }
      const row = await excludeRow(pool, {
        payrollEndDate: body.payrollEndDate,
        row: body.row,
        reason: body.reason,
        excludedByEmail: admin.email || admin.name || "",
      });
      return res.status(200).json({ ok: true, excluded: true, row });
    }

    res.setHeader("Allow", "GET, PUT, OPTIONS");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    // A bad request is the caller's to fix and says so; anything else is ours,
    // and its internals do not belong in the operator's error bar.
    if (e?.status === 400) {
      return res.status(400).json({ error: e.message });
    }
    console.error("payroll-row-exclusions failed:", e);
    return res
      .status(500)
      .json({ error: "Could not update that billing line. Please try again." });
  }
}
