const { getToken } = require("next-auth/jwt");
const { getPool } = require("./db");
const { findEmployeeByEmail } = require("./my-leave-data");
const { readImpersonateEmail } = require("./impersonation");

async function getAuthContext(req) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    return { error: { status: 500, message: "Auth not configured" } };
  }

  let token;
  try {
    token = await getToken({ req, secret });
  } catch {
    token = null;
  }

  const realEmail = String(token?.email || "").trim().toLowerCase();
  if (!realEmail) {
    return { error: { status: 401, message: "Unauthorized" } };
  }

  const isAdmin = token?.role === "admin";
  let effectiveEmail = realEmail;
  let impersonating = false;

  if (isAdmin) {
    const impEmail = readImpersonateEmail(req);
    if (impEmail && impEmail !== realEmail) {
      effectiveEmail = impEmail;
      impersonating = true;
    }
  }

  let pool;
  try {
    pool = getPool();
  } catch (e) {
    return { error: { status: 500, message: e.message || "Database not configured" } };
  }

  const employee = await findEmployeeByEmail(pool, effectiveEmail);

  return {
    token,
    pool,
    realEmail,
    effectiveEmail,
    isAdmin,
    impersonating,
    employee,
    employeeId: employee?.id || null,
  };
}

module.exports = {
  getAuthContext,
};
