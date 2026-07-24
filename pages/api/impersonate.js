const { getToken } = require("next-auth/jwt");
const { getPool } = require("../../lib/db");
const { findEmployeeByEmail, findEmployeeById } = require("../../lib/my-leave-data");
const {
  readImpersonateEmail,
  setCookieHeader,
  clearCookieHeader,
} = require("../../lib/impersonation");
const { respondAuthMisconfigured } = require("../../lib/authConfig");
const { requireRealAdmin, resolveIsAdmin } = require("../../lib/apiAuth");
const { isSuperAdminEmailRemote } = require("../../lib/super-admin");

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  if (respondAuthMisconfigured(res)) return;

  const secret = process.env.NEXTAUTH_SECRET;
  let token = null;
  if (secret) {
    try {
      token = await getToken({ req, secret });
    } catch {
      token = null;
    }
  }

  if (req.method === "GET") {
    const email = String(token?.email || "").trim().toLowerCase();
    const isAdmin = email ? await resolveIsAdmin(email) : false;
    const isSuperAdmin = email ? await isSuperAdminEmailRemote(email) : false;
    if (!isAdmin && !isSuperAdmin) {
      return res.status(200).json({
        canImpersonate: false,
        impersonating: false,
        real: { email: "", name: "", isSuperAdmin: false },
        effective: { email: "", name: "", role: "member" },
        target: null,
      });
    }
    const realEmail = email;
    const targetEmail = readImpersonateEmail(req);
    const impersonating = Boolean(targetEmail && targetEmail !== realEmail);
    let effectiveName = token.name || realEmail;
    let effectiveRole = "admin";
    if (impersonating) {
      try {
        const pool = getPool();
        const emp = await findEmployeeByEmail(pool, targetEmail);
        if (emp?.display_name) effectiveName = emp.display_name;
      } catch {
        /* ignore */
      }
      effectiveRole = (await resolveIsAdmin(targetEmail)) ? "admin" : "member";
    }
    return res.status(200).json({
      canImpersonate: !impersonating,
      impersonating,
      real: { email: realEmail, name: token.name || realEmail, isSuperAdmin },
      effective: {
        email: impersonating ? targetEmail : realEmail,
        name: effectiveName,
        role: effectiveRole,
      },
      target: impersonating ? { email: targetEmail, name: effectiveName } : null,
    });
  }

  if (req.method === "POST") {
    const admin = await requireRealAdmin(req, res);
    if (!admin) return;
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const employeeId = body.employeeId ? String(body.employeeId) : "";
    let email = body.email ? String(body.email).trim().toLowerCase() : "";
    const pool = getPool();
    if (employeeId) {
      const emp = await findEmployeeById(pool, employeeId);
      const signIn = emp?.login_email;
      if (!signIn) {
        return res.status(400).json({ error: "Employee has no sign-in email." });
      }
      email = String(signIn).trim().toLowerCase();
    } else if (email) {
      const emp = await findEmployeeByEmail(pool, email);
      if (!emp?.login_email) {
        return res.status(404).json({ error: "That person is not available to view as." });
      }
      email = String(emp.login_email).trim().toLowerCase();
    }
    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "A valid email or employeeId is required." });
    }
    if (email === admin.email) {
      return res.status(400).json({ error: "That's already you" });
    }
    res.setHeader("Set-Cookie", setCookieHeader(email));
    return res.status(200).json({ ok: true, email });
  }

  if (req.method === "DELETE") {
    const admin = await requireRealAdmin(req, res);
    if (!admin) return;
    res.setHeader("Set-Cookie", clearCookieHeader());
    return res.status(200).json({ ok: true });
  }

  res.setHeader("Allow", "GET, POST, DELETE");
  return res.status(405).json({ error: "Method not allowed" });
}
