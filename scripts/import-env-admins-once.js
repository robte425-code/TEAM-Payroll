/**
 * One-time import of ADMIN_EMAILS into payroll.app_access_emails as admins.
 */
const ENV_ADMINS_IMPORTED_KEY = "env_admins_imported";

function envAdminEmails() {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

async function ensureMetaTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS payroll.app_meta (
      key text PRIMARY KEY,
      value text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function importEnvAdminsOnce(client) {
  await ensureMetaTable(client);
  const done = await client.query(`SELECT value FROM payroll.app_meta WHERE key = $1`, [
    ENV_ADMINS_IMPORTED_KEY,
  ]);
  if (done.rows[0]?.value === "1") return 0;

  const emails = envAdminEmails();
  for (const email of emails) {
    await client.query(
      `INSERT INTO payroll.app_access_emails (email, is_enabled, is_admin)
       VALUES ($1, true, true)
       ON CONFLICT (email) DO UPDATE SET is_enabled = true, is_admin = true`,
      [email]
    );
  }

  await client.query(
    `INSERT INTO payroll.app_meta (key, value) VALUES ($1, '1')
     ON CONFLICT (key) DO UPDATE SET value = '1', updated_at = now()`,
    [ENV_ADMINS_IMPORTED_KEY]
  );
  return emails.length;
}

module.exports = { importEnvAdminsOnce };
