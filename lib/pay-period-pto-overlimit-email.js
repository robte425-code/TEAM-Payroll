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

function formatViolationLine(v) {
  return [
    `${v.employeeName}:`,
    `case work ${formatHours(v.caseWorkHours)} hr`,
    `travel/wait ${formatHours(v.travelWaitHours)} hr`,
    `report ${formatHours(v.reportHours)} hr`,
    `NB ${formatHours(v.nbHours)} hr`,
    `training ${formatHours(v.trainingHours)} hr`,
    `PTO ${formatHours(v.ptoHours)} hr`,
    `sick ${formatHours(v.sickHours)} hr`,
    `total ${formatHours(v.totalHours)} hr`,
    `(limit ${formatHours(v.maxHours)} hr)`,
  ].join(", ");
}

function buildPayPeriodPtoOverlimitEmail({ violations, payrollEndDate }) {
  const periodNote = payrollEndDate ? ` for payroll ending ${payrollEndDate}` : "";
  const workingDays = violations[0]?.workingDays ?? 0;
  const maxHours = violations[0]?.maxHours ?? 0;
  const subject = `TEAM Payroll: pay-period hours over limit${periodNote}`;

  const textLines = [
    `The following employee(s) claimed PTO and/or sick time and exceed the pay-period limit of ${formatHours(maxHours)} hours (${workingDays} working day(s) × 8)${periodNote}:`,
    "Total = case work + travel/wait + report + non-bill + NB TT training + PTO + sick time.",
    "",
  ];
  for (const v of violations) {
    textLines.push(`- ${formatViolationLine(v)}`);
  }
  const text = textLines.join("\n");

  const rowsHtml = violations
    .map(
      (v) =>
        `<tr>
          <td>${escapeHtml(v.employeeName)}</td>
          <td style="text-align:right">${formatHours(v.caseWorkHours)}</td>
          <td style="text-align:right">${formatHours(v.travelWaitHours)}</td>
          <td style="text-align:right">${formatHours(v.reportHours)}</td>
          <td style="text-align:right">${formatHours(v.nbHours)}</td>
          <td style="text-align:right">${formatHours(v.trainingHours)}</td>
          <td style="text-align:right">${formatHours(v.ptoHours)}</td>
          <td style="text-align:right">${formatHours(v.sickHours)}</td>
          <td style="text-align:right">${formatHours(v.billedHours)}</td>
          <td style="text-align:right">${formatHours(v.leaveHours)}</td>
          <td style="text-align:right"><strong>${formatHours(v.totalHours)}</strong></td>
          <td style="text-align:right">${formatHours(v.maxHours)}</td>
        </tr>`
    )
    .join("");

  const html = `<!doctype html>
<html lang="en"><body style="font-family:Inter,Segoe UI,sans-serif;line-height:1.5;color:#1c1917">
  <p>The following employee(s) claimed PTO and/or sick time and exceed the pay-period limit of <strong>${formatHours(maxHours)} hours</strong> (${workingDays} working day(s) × 8)${escapeHtml(periodNote)}.</p>
  <p>Total = case work + travel/wait + report + non-bill + NB TT training + PTO + sick time.</p>
  <table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;font-size:13px">
    <thead>
      <tr>
        <th>Employee</th>
        <th>Case work</th>
        <th>Travel/wait</th>
        <th>Report</th>
        <th>Non-bill</th>
        <th>Training</th>
        <th>PTO</th>
        <th>Sick</th>
        <th>Billed total</th>
        <th>Leave total</th>
        <th>Grand total</th>
        <th>Limit</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <p style="font-size:12px;color:#57534e;margin-top:12px">All values in hours. Billed total = case work + travel/wait + report + non-bill + training. Leave total = PTO + sick. Grand total = billed total + leave total.</p>
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
