const { getPool } = require("../../lib/db");

function verifyInternalAccess(req) {
  const secret = process.env.TEAM_INTERNAL_ACCESS_SECRET?.trim();
  if (!secret) return false;
  const auth = req.headers.authorization || "";
  return auth === `Bearer ${secret}`;
}

async function listAccessUsers(pool) {
  const r = await pool.query(
    `SELECT email, is_enabled, is_admin FROM payroll.app_access_emails ORDER BY email`
  );
  return r.rows.map((row) => ({
    email: row.email,
    displayName: "",
    signInEnabled: Boolean(row.is_enabled),
    isAdmin: Boolean(row.is_admin),
  }));
}

async function replaceAccessUsers(pool, users) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM payroll.app_access_emails`);
    for (const u of users) {
      const email = String(u.email || "")
        .trim()
        .toLowerCase();
      if (!email.includes("@")) continue;
      await client.query(
        `INSERT INTO payroll.app_access_emails (email, is_enabled, is_admin) VALUES ($1, $2, $3)`,
        [email, u.signInEnabled !== false, u.isAdmin === true]
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  if (!verifyInternalAccess(req)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const pool = getPool();
  try {
    if (req.method === "GET") {
      const users = await listAccessUsers(pool);
      return res.status(200).json({ users });
    }
    if (req.method === "PUT") {
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const users = Array.isArray(body.users) ? body.users : null;
      if (!users) return res.status(400).json({ error: "users array required" });
      await replaceAccessUsers(pool, users);
      return res.status(200).json({ users: await listAccessUsers(pool) });
    }
    res.setHeader("Allow", "GET, PUT");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Request failed" });
  }
}
