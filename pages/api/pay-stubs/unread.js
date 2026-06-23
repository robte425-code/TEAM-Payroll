const { getAuthContext } = require("../../../lib/pay-stub-auth");
const { getPayStubUnreadStatus } = require("../../../lib/pay-stub-unread");

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

  const { pool, employee, employeeId } = ctx;
  const loginEmail =
    employee?.login_email != null ? String(employee.login_email).trim() : ctx.effectiveEmail;

  try {
    const status = await getPayStubUnreadStatus(pool, employeeId, loginEmail);
    return res.status(200).json(status);
  } catch (e) {
    if (e.code === "42P01") {
      return res.status(200).json({ hasUnreadPayStub: false, latestStubId: null, checkDate: null });
    }
    return res.status(500).json({ error: e.message || "Request failed" });
  }
}
