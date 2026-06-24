const PAY_STUB_UNREAD_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

async function getLatestPayStubForEmployee(pool, employeeId) {
  const r = await pool.query(
    `SELECT s.id, b.check_date, s.created_at
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

function isPayStubWithinUnreadWindow(createdAt) {
  const uploadedAt = createdAt ? new Date(createdAt) : null;
  if (!uploadedAt || Number.isNaN(uploadedAt.getTime())) return false;
  return Date.now() - uploadedAt.getTime() < PAY_STUB_UNREAD_MAX_AGE_MS;
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
  const withinWindow = isPayStubWithinUnreadWindow(latest.created_at);
  return {
    hasUnreadPayStub: !downloaded && withinWindow,
    latestStubId: latest.id,
    checkDate: latest.check_date,
  };
}

module.exports = {
  PAY_STUB_UNREAD_MAX_AGE_MS,
  getPayStubUnreadStatus,
};
