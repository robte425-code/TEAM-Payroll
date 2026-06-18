const { getToken } = require("next-auth/jwt");
const { getPool } = require("../../lib/db");
const {
  isUuid,
  findEmployeeByEmail,
  findEmployeeById,
  fetchLeaveDataForEmployee,
} = require("../../lib/my-leave-data");
const { readImpersonateEmail } = require("../../lib/impersonation");

function getQueryEmployeeId(req) {
  const raw = req.query?.employeeId;
  if (raw != null && String(raw).trim()) return String(raw).trim();
  try {
    const host = req.headers?.host || "localhost";
    const proto = req.headers?.["x-forwarded-proto"] || "http";
    const u = new URL(req.url || "", `${proto}://${host}`);
    const fromUrl = u.searchParams.get("employeeId");
    return fromUrl ? String(fromUrl).trim() : "";
  } catch {
    return "";
  }
}

function viewerDisplayName(token, ownEmp) {
  if (token?.name?.trim()) return token.name.trim();
  if (ownEmp?.display_name?.trim()) return ownEmp.display_name.trim();
  const addr = String(token?.email || "").trim();
  if (addr.includes("@")) return addr.split("@")[0];
  return "Yourself";
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    return res.status(500).json({ error: "Auth not configured" });
  }

  let token;
  try {
    token = await getToken({ req, secret });
  } catch {
    token = null;
  }
  const email = String(token?.email || "").trim().toLowerCase();
  if (!email) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const isAdmin = token?.role === "admin";
  let impersonateId = getQueryEmployeeId(req);

  if (impersonateId && !isUuid(impersonateId)) {
    return res.status(400).json({ error: "Invalid employee id" });
  }
  if (impersonateId && !isAdmin) {
    return res.status(403).json({ error: "Admin access required" });
  }

  let pool;
  try {
    pool = getPool();
  } catch (e) {
    return res.status(500).json({ error: e.message || "Database not configured" });
  }

  if (isAdmin && !impersonateId) {
    const impEmail = readImpersonateEmail(req);
    if (impEmail && impEmail !== email) {
      const empByEmail = await findEmployeeByEmail(pool, impEmail);
      if (empByEmail?.id) impersonateId = empByEmail.id;
    }
  }

  try {
    let emp;
    let impersonating = false;
    const ownEmp = isAdmin ? await findEmployeeByEmail(pool, email) : null;
    const viewerInfo = isAdmin
      ? {
          viewerEmployeeId: ownEmp?.id ?? null,
          viewerDisplayName: viewerDisplayName(token, ownEmp),
        }
      : {};

    if (impersonateId) {
      emp = await findEmployeeById(pool, impersonateId);
      if (!emp) {
        return res.status(404).json({ error: "Employee not found" });
      }
      impersonating = true;
    } else {
      emp = ownEmp;
      if (!emp) {
        if (isAdmin) {
          return res.status(200).json({
            isAdmin: true,
            needsEmployeeSelection: true,
            ...viewerInfo,
          });
        }
        return res.status(404).json({
          error:
            "No employee record is linked to your sign-in email. Ask a payroll admin to set your Sign-in email on the Employee pay rates page.",
        });
      }
    }

    const payload = await fetchLeaveDataForEmployee(pool, emp);
    return res.status(200).json({
      ...payload,
      isAdmin,
      impersonating,
      ...viewerInfo,
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Request failed" });
  }
}
