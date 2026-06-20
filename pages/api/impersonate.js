const { getToken } = require("next-auth/jwt");
const { getPool } = require("../../lib/db");
const { findEmployeeByEmail, findEmployeeById } = require("../../lib/my-leave-data");
const {
  readImpersonateEmail,
  setCookieHeader,
  clearCookieHeader,
} = require("../../lib/impersonation");

async function requireAdmin(req) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token || token.role !== "admin") {
    return { ok: false, token: null };
  }
  return { ok: true, token };
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  const admin = await requireAdmin(req);
  const token = admin.token;

  if (req.method === "GET") {
    if (!admin.ok) {
      return res.status(200).json({
        canImpersonate: false,
        impersonating: false,
        real: { email: "", name: "" },
        effective: { email: "", name: "", role: "member" },
        target: null,
      });
    }
    const realEmail = String(token.email || "").toLowerCase();
    const targetEmail = readImpersonateEmail(req);
    const impersonating = Boolean(targetEmail && targetEmail !== realEmail);
    let effectiveName = token.name || realEmail;
    if (impersonating) {
      try {
        const pool = getPool();
        const emp = await findEmployeeByEmail(pool, targetEmail);
        if (emp?.display_name) effectiveName = emp.display_name;
      } catch {
        /* ignore */
      }
    }
    return res.status(200).json({
      canImpersonate: !impersonating,
      impersonating,
      real: { email: realEmail, name: token.name || realEmail },
      effective: {
        email: impersonating ? targetEmail : realEmail,
        name: effectiveName,
        role: impersonating ? "member" : "admin",
      },
      target: impersonating ? { email: targetEmail, name: effectiveName } : null,
    });
  }

  if (req.method === "POST") {
    if (!admin.ok) return res.status(403).json({ error: "Forbidden" });
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const employeeId = body.employeeId ? String(body.employeeId) : "";
    let email = body.email ? String(body.email).trim().toLowerCase() : "";
    if (employeeId) {
      const pool = getPool();
      const emp = await findEmployeeById(pool, employeeId);
      const signIn = emp?.login_email;
      if (!signIn) {
        return res.status(400).json({ error: "Employee has no sign-in email." });
      }
      email = String(signIn).trim().toLowerCase();
    }
    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "A valid email or employeeId is required." });
    }
    if (email === String(token.email).toLowerCase()) {
      return res.status(400).json({ error: "That's already you" });
    }
    res.setHeader("Set-Cookie", setCookieHeader(email));
    return res.status(200).json({ ok: true, email });
  }

  if (req.method === "DELETE") {
    res.setHeader("Set-Cookie", clearCookieHeader());
    return res.status(200).json({ ok: true });
  }

  res.setHeader("Allow", "GET, POST, DELETE");
  return res.status(405).json({ error: "Method not allowed" });
}
