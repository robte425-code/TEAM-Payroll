const { getAuthContext } = require("../../../lib/pay-stub-auth");

function formatRow(row) {
  return {
    id: row.id,
    payStubId: row.pay_stub_id,
    stubEmployeeName: row.stub_employee_name,
    checkDate: row.check_date,
    payPeriodStart: row.pay_period_start,
    payPeriodEnd: row.pay_period_end,
    downloadedAt: row.downloaded_at,
    sessionEmail: row.session_email,
    effectiveEmail: row.effective_email,
    impersonating: row.impersonating,
    userAgent: row.user_agent,
  };
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const ctx = await getAuthContext(req, res);
  if (ctx.error) {
    return res.status(ctx.error.status).json({ error: ctx.error.message });
  }

  const { pool, isAdmin, impersonating } = ctx;
  if (!isAdmin || impersonating) {
    return res.status(403).json({ error: "Admin access required" });
  }

  const limitRaw = parseInt(String(req.query?.limit || "200"), 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 200;

  try {
    const r = await pool.query(
      `SELECT id, pay_stub_id, stub_employee_name, check_date,
              pay_period_start, pay_period_end, downloaded_at,
              session_email, effective_email, impersonating, user_agent
       FROM payroll.pay_stub_download_log
       ORDER BY downloaded_at DESC
       LIMIT $1`,
      [limit]
    );

    return res.status(200).json({
      entries: r.rows.map(formatRow),
    });
  } catch (e) {
    if (e.code === "42P01") {
      return res.status(200).json({ entries: [] });
    }
    return res.status(500).json({ error: e.message || "Request failed" });
  }
}
