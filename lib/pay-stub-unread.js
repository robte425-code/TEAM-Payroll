async function getLatestPayStubForEmployee(pool, employeeId) {
  const r = await pool.query(
    `SELECT s.id, b.check_date
     FROM payroll.pay_stubs s
     JOIN payroll.pay_stub_batches b ON b.id = s.batch_id
     WHERE s.employee_id = $1::uuid
     ORDER BY b.check_date DESC, s.created_at DESC
     LIMIT 1`,
    [employeeId]
  );
  return r.rows[0] || null;
}

async function hasEmployeeDownloadedStub(pool, payStubId, employeeLoginEmail) {
  const email = String(employeeLoginEmail || "").trim().toLowerCase();
  if (!email) return false;

  const r = await pool.query(
    `SELECT 1
     FROM payroll.pay_stub_download_log
     WHERE pay_stub_id = $1::uuid
       AND impersonating = false
       AND lower(trim(effective_email)) = $2
     LIMIT 1`,
    [payStubId, email]
  );
  return r.rows.length > 0;
}

async function getPayStubUnreadStatus(pool, employeeId, employeeLoginEmail) {
  if (!employeeId) {
    return { hasUnreadPayStub: false, latestStubId: null, checkDate: null };
  }

  const latest = await getLatestPayStubForEmployee(pool, employeeId);
  if (!latest) {
    return { hasUnreadPayStub: false, latestStubId: null, checkDate: null };
  }

  const downloaded = await hasEmployeeDownloadedStub(pool, latest.id, employeeLoginEmail);
  return {
    hasUnreadPayStub: !downloaded,
    latestStubId: latest.id,
    checkDate: latest.check_date,
  };
}

module.exports = {
  getPayStubUnreadStatus,
};
