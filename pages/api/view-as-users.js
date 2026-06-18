const { getToken } = require("next-auth/jwt");
const { getPool } = require("../../lib/db");

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token || token.role !== "admin") {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    const pool = getPool();
    const { rows } = await pool.query(`
      select id, provider_id, display_name, login_email
      from payroll.employees
      where login_email is not null and trim(login_email) <> ''
      order by display_name nulls last, provider_id
    `);
    const users = rows.map((row) => ({
      id: row.id,
      providerId: row.provider_id,
      displayName: row.display_name,
      loginEmail: row.login_email != null ? String(row.login_email) : "",
    }));
    return res.status(200).json({ users });
  } catch (err) {
    console.error("view-as-users:", err);
    return res.status(500).json({ error: "Could not load users" });
  }
}
