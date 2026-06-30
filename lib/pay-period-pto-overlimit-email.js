const { emailConfigured, sendEmail } = require("./email");
const { fetchPayrollAdminEmails } = require("./payroll-admin-emails");
const { formatHours } = require("./pay-period-pto-billed-check");

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildPayPeriodPtoOverlimitEmail({ violations, payrollEndDate }) {
  const periodNote = payrollEndDate ? ` for payroll ending ${payrollEndDate}` : "";
  const workingDays = violations[0]?.workingDays ?? 0;
  const maxHours = violations[0]?.maxHours ?? 0;
  const subject = `TEAM Payroll: pay-period billed + PTO hours over limit${periodNote}`;

  const textLines = [
    `The following employee(s) claimed PTO and exceed the pay-period limit of ${formatHours(maxHours)} hours (${workingDays} working day(s) × 8)${periodNote}:`,
    "Billed hours = case work + travel/wait + report + NB TT training + non-bill time.",
    "",
  ];
  for (const v of violations) {
    textLines.push(
      `- ${v.employeeName}: billed ${formatHours(v.billedHours)} hr, PTO ${formatHours(v.ptoHours)} hr (total ${formatHours(v.totalHours)} hr; limit ${formatHours(v.maxHours)} hr)`
    );
  }
  const text = textLines.join("\n");

  const rowsHtml = violations
    .map(
      (v) =>
        `<tr><td>${escapeHtml(v.employeeName)}</td><td style="text-align:right">${formatHours(v.billedHours)}</td><td style="text-align:right">${formatHours(v.ptoHours)}</td><td style="text-align:right">${formatHours(v.totalHours)}</td><td style="text-align:right">${formatHours(v.maxHours)}</td></tr>`
    )
    .join("");

  const html = `<!doctype html>
<html lang="en"><body style="font-family:Inter,Segoe UI,sans-serif;line-height:1.5;color:#1c1917">
  <p>The following employee(s) claimed PTO and exceed the pay-period limit of <strong>${formatHours(maxHours)} hours</strong> (${workingDays} working day(s) × 8)${escapeHtml(periodNote)}.</p>
  <p>Billed hours = case work + travel/wait + report + NB TT training + non-bill time.</p>
  <table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;font-size:14px">
    <thead><tr><th>Employee</th><th>Billed (hr)</th><th>PTO (hr)</th><th>Total (hr)</th><th>Limit (hr)</th></tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
</body></html>`;

  return { subject, text, html };
}

async function sendPayPeriodPtoOverlimitAdminEmail(pool, { violations, payrollEndDate }) {
  if (!violations?.length) {
    return { sent: false, reason: "no_violations", recipientCount: 0 };
  }
  if (!emailConfigured()) {
    return { sent: false, reason: "not_configured", recipientCount: 0, violationCount: violations.length };
  }

  const admins = await fetchPayrollAdminEmails(pool);
  if (!admins.length) {
    return { sent: false, reason: "no_admins", recipientCount: 0, violationCount: violations.length };
  }

  const { subject, text, html } = buildPayPeriodPtoOverlimitEmail({ violations, payrollEndDate });
  await sendEmail({
    to: admins.join(","),
    subject,
    html,
    text,
  });

  return {
    sent: true,
    recipientCount: admins.length,
    violationCount: violations.length,
    recipients: admins,
  };
}

module.exports = {
  buildPayPeriodPtoOverlimitEmail,
  sendPayPeriodPtoOverlimitAdminEmail,
};
