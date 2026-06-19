const { getAuthContext } = require("../../../lib/pay-stub-auth");
const { logPayStubDownload } = require("../../../lib/log-pay-stub-download");

function getStubId(req) {
  const raw = req.query?.id;
  if (raw != null && String(raw).trim()) return String(raw).trim();
  try {
    const host = req.headers?.host || "localhost";
    const proto = req.headers?.["x-forwarded-proto"] || "http";
    const u = new URL(req.url || "", `${proto}://${host}`);
    return String(u.searchParams.get("id") || "").trim();
  } catch {
    return "";
  }
}

function safeFilename(name, checkDate) {
  const base = String(name || "pay-stub")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 80);
  return `${base}_${checkDate || "stub"}.pdf`;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.setHeader("Content-Type", "application/json");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const stubId = getStubId(req);
  if (!stubId) {
    res.setHeader("Content-Type", "application/json");
    return res.status(400).json({ error: "Missing id" });
  }

  const ctx = await getAuthContext(req);
  if (ctx.error) {
    res.setHeader("Content-Type", "application/json");
    return res.status(ctx.error.status).json({ error: ctx.error.message });
  }

  const { pool, isAdmin, impersonating, employeeId, realEmail, effectiveEmail } = ctx;

  try {
    const r = await pool.query(
      `SELECT s.id, s.pdf_data, s.extracted_name, s.employee_id,
              b.check_date, b.pay_period_start, b.pay_period_end,
              e.display_name AS employee_name
       FROM payroll.pay_stubs s
       JOIN payroll.pay_stub_batches b ON b.id = s.batch_id
       LEFT JOIN payroll.employees e ON e.id = s.employee_id
       WHERE s.id = $1::uuid
       LIMIT 1`,
      [stubId]
    );
    const row = r.rows[0];
    if (!row) {
      res.setHeader("Content-Type", "application/json");
      return res.status(404).json({ error: "Pay stub not found" });
    }

    const ownsStub = row.employee_id && employeeId && row.employee_id === employeeId;
    const adminDirect = isAdmin && !impersonating;
    if (!ownsStub && !adminDirect) {
      res.setHeader("Content-Type", "application/json");
      return res.status(403).json({ error: "Forbidden" });
    }

    try {
      await logPayStubDownload(pool, {
        payStubId: row.id,
        payStubEmployeeId: row.employee_id,
        stubEmployeeName: row.employee_name || row.extracted_name,
        checkDate: row.check_date,
        payPeriodStart: row.pay_period_start,
        payPeriodEnd: row.pay_period_end,
        sessionEmail: realEmail,
        effectiveEmail,
        impersonating,
        userAgent: req.headers["user-agent"],
      });
    } catch (logErr) {
      if (logErr.code !== "42P01") {
        console.error("pay stub download log failed:", logErr);
      }
    }

    const pdf = row.pdf_data;
    const buffer = Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);
    const filename = safeFilename(row.extracted_name, row.check_date);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).send(buffer);
  } catch (e) {
    if (e.code === "42P01") {
      res.setHeader("Content-Type", "application/json");
      return res.status(404).json({ error: "Pay stub not found" });
    }
    res.setHeader("Content-Type", "application/json");
    return res.status(500).json({ error: e.message || "Download failed" });
  }
}
