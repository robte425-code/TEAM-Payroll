const { getPool } = require("../../../lib/db");
const { findEmployeeByEmail } = require("../../../lib/my-leave-data");
const { getPayStubUnreadStatus } = require("../../../lib/pay-stub-unread");

function verifyInternalAccess(req) {
  const secret = process.env.TEAM_INTERNAL_ACCESS_SECRET?.trim();
  if (!secret) return false;
  const auth = req.headers.authorization || "";
  return auth === `Bearer ${secret}`;
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!verifyInternalAccess(req)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const email = String(req.query?.email || "")
    .trim()
    .toLowerCase();
  if (!email.includes("@")) {
    return res.status(400).json({ error: "A valid email is required" });
  }

  let pool;
  try {
    pool = getPool();
  } catch (e) {
    return res.status(500).json({ error: e.message || "Database not configured" });
  }

  try {
    const emp = await findEmployeeByEmail(pool, email);
    if (!emp?.id) {
      return res.status(200).json({
        hasUnreadPayStub: false,
        latestStubId: null,
        checkDate: null,
      });
    }

    const loginEmail =
      emp.login_email != null ? String(emp.login_email).trim() : email;
    const status = await getPayStubUnreadStatus(pool, emp.id, loginEmail);
    return res.status(200).json(status);
  } catch (e) {
    if (e.code === "42P01") {
      return res.status(200).json({
        hasUnreadPayStub: false,
        latestStubId: null,
        checkDate: null,
      });
    }
    return res.status(500).json({ error: e.message || "Request failed" });
  }
}
