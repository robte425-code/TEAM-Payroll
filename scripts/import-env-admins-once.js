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

async function countAdmins(client) {
  const r = await client.query(
    `SELECT count(*)::int AS n FROM payroll.app_access_emails WHERE is_admin = true`
  );
  return r.rows[0]?.n ?? 0;
}

async function importEmails(client, emails) {
  for (const email of emails) {
    await client.query(
      `INSERT INTO payroll.app_access_emails (email, is_enabled, is_admin)
       VALUES ($1, true, true)
       ON CONFLICT (email) DO UPDATE SET is_enabled = true, is_admin = true`,
      [email]
    );
  }
}

async function importEnvAdminsOnce(client) {
  await ensureMetaTable(client);
  const emails = envAdminEmails();
  const done = await client.query(`SELECT value FROM payroll.app_meta WHERE key = $1`, [
    ENV_ADMINS_IMPORTED_KEY,
  ]);

  if (done.rows[0]?.value === "1") {
    if ((await countAdmins(client)) === 0 && emails.length > 0) {
      await importEmails(client, emails);
      return emails.length;
    }
    return 0;
  }

  await importEmails(client, emails);
  await client.query(
    `INSERT INTO payroll.app_meta (key, value) VALUES ($1, '1')
     ON CONFLICT (key) DO UPDATE SET value = '1', updated_at = now()`,
    [ENV_ADMINS_IMPORTED_KEY]
  );
  return emails.length;
}

module.exports = { importEnvAdminsOnce };
