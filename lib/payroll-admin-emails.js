function envAdminEmails() {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes("@"));
}

async function fetchPayrollAdminEmails(pool) {
  const emails = new Set(envAdminEmails());
  try {
    const r = await pool.query(
      `SELECT email FROM payroll.app_access_emails
       WHERE is_admin = true AND is_enabled = true`
    );
    for (const row of r.rows) {
      const email = String(row.email || "").trim().toLowerCase();
      if (email.includes("@")) emails.add(email);
    }
  } catch {
    /* table may not exist in some environments */
  }
  return [...emails];
}

module.exports = {
  fetchPayrollAdminEmails,
};
