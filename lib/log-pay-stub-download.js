async function logPayStubDownload(pool, {
  payStubId,
  payStubEmployeeId,
  stubEmployeeName,
  checkDate,
  payPeriodStart,
  payPeriodEnd,
  sessionEmail,
  effectiveEmail,
  impersonating,
  userAgent,
}) {
  await pool.query(
    `INSERT INTO payroll.pay_stub_download_log (
       pay_stub_id,
       pay_stub_employee_id,
       stub_employee_name,
       check_date,
       pay_period_start,
       pay_period_end,
       session_email,
       effective_email,
       impersonating,
       user_agent
     ) VALUES (
       $1::uuid,
       $2::uuid,
       $3,
       $4::date,
       $5::date,
       $6::date,
       $7,
       $8,
       $9,
       $10
     )`,
    [
      payStubId,
      payStubEmployeeId || null,
      String(stubEmployeeName || "").slice(0, 500),
      checkDate || null,
      payPeriodStart || null,
      payPeriodEnd || null,
      String(sessionEmail || "").trim().toLowerCase().slice(0, 320),
      String(effectiveEmail || "").trim().toLowerCase().slice(0, 320),
      Boolean(impersonating),
      userAgent ? String(userAgent).slice(0, 1000) : null,
    ]
  );
}

module.exports = {
  logPayStubDownload,
};
