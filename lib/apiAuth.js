const { getToken } = require("next-auth/jwt");
const { respondAuthMisconfigured } = require("./authConfig");

async function isAdminEmail(email) {
  const { isAdminEmail: check } = await import("./auth.js");
  return check(email);
}

async function getTokenEmail(req) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) return null;
  try {
    const token = await getToken({ req, secret });
    const email = String(token?.email || "").trim().toLowerCase();
    return email || null;
  } catch {
    return null;
  }
}

/** Fresh DB + env check; do not trust JWT role alone. */
async function resolveIsAdmin(email) {
  if (!email) return false;
  return isAdminEmail(String(email).trim().toLowerCase());
}

/**
 * Guard for admin-only APIs (view-as, pay stub upload, etc.).
 * Uses the real signed-in account, not impersonation target.
 */
async function requireRealAdmin(req, res) {
  if (respondAuthMisconfigured(res)) return null;
  const email = await getTokenEmail(req);
  if (!email) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  if (!(await resolveIsAdmin(email))) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }
  return { email };
}

module.exports = {
  getTokenEmail,
  resolveIsAdmin,
  requireRealAdmin,
};
