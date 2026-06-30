const { fetchRolloverSettings } = require("./leave-rollover");
const { emailConfigured, sendEmail } = require("./email");

const PTO_HIGH_BALANCE_THRESHOLD_HOURS = 152;

function payrollMyLeaveUrl() {
  const base = String(process.env.NEXTAUTH_URL || "https://team-payroll.vercel.app").replace(/\/$/, "");
  return `${base}/my-leave.html`;
}

function formatHours(n) {
  return (Math.round((Number(n) + Number.EPSILON) * 100) / 100).toFixed(2);
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildPtoHighBalanceNotice({ ptoAvailableHours, ptoMaxCarryoverHours, employeeName }) {
  const available = Number(ptoAvailableHours) || 0;
  if (available <= PTO_HIGH_BALANCE_THRESHOLD_HOURS) return null;

  const carryover = Number(ptoMaxCarryoverHours) || 0;
  const forfeited = Math.max(0, available - carryover);
  const name = String(employeeName || "").trim() || "there";
  const myLeaveUrl = payrollMyLeaveUrl();

  const summary = `You currently have ${formatHours(available)} hours of PTO available. At year-end, only ${formatHours(carryover)} hours can carry over to the next year; any PTO above ${formatHours(carryover)} hours will be forfeited.${
    forfeited > 0
      ? ` At your current balance, up to ${formatHours(forfeited)} hours could be forfeited if unused before year-end.`
      : ""
  }`;

  const text = [
    `Hi ${name},`,
    "",
    `Your TEAM Payroll PTO balance is currently ${formatHours(available)} hours available for use.`,
    "",
    `At year-end, only ${formatHours(carryover)} hours of PTO can carry over to the next year. Any PTO above ${formatHours(carryover)} hours will be forfeited.`,
    forfeited > 0
      ? `At your current balance, up to ${formatHours(forfeited)} hours could be forfeited if unused before year-end.`
      : "",
    "",
    `View your balance: ${myLeaveUrl}`,
  ]
    .filter(Boolean)
    .join("\n");

  const html = `<!doctype html>
<html lang="en"><body style="font-family:Inter,Segoe UI,sans-serif;line-height:1.5;color:#1c1917">
  <p>Hi ${escapeHtml(name)},</p>
  <p>Your TEAM Payroll PTO balance is currently <strong>${formatHours(available)} hours</strong> available for use.</p>
  <p>At year-end, only <strong>${formatHours(carryover)} hours</strong> of PTO can carry over to the next year. Any PTO above ${formatHours(carryover)} hours will be forfeited.</p>
  ${
    forfeited > 0
      ? `<p>At your current balance, up to <strong>${formatHours(forfeited)} hours</strong> could be forfeited if unused before year-end.</p>`
      : ""
  }
  <p><a href="${escapeHtml(myLeaveUrl)}">View your PTO balance</a></p>
</body></html>`;

  return {
    ptoAvailableHours: available,
    ptoMaxCarryoverHours: carryover,
    forfeitedHours: forfeited,
    message: summary,
    subject: "TEAM Payroll: PTO balance notice",
    text,
    html,
  };
}

async function sendPtoHighBalanceEmail({ to, employeeName, ptoAvailableHours, ptoMaxCarryoverHours }) {
  if (!emailConfigured()) {
    return { sent: false, reason: "not_configured" };
  }

  const notice = buildPtoHighBalanceNotice({
    ptoAvailableHours,
    ptoMaxCarryoverHours,
    employeeName,
  });
  if (!notice) return { sent: false, reason: "below_threshold" };

  const email = String(to || "").trim().toLowerCase();
  if (!email.includes("@")) return { sent: false, reason: "no_email" };

  await sendEmail({
    to: email,
    subject: notice.subject,
    html: notice.html,
    text: notice.text,
  });

  return { sent: true, to: email };
}

async function getPtoHighBalanceNoticeForEmployee(pool, emp) {
  const rollover = await fetchRolloverSettings(pool);
  const ptoAvailable =
    (Number(emp.pto_ytd_hours_accrued) || 0) - (Number(emp.pto_ytd_hours_used) || 0);
  return buildPtoHighBalanceNotice({
    ptoAvailableHours: ptoAvailable,
    ptoMaxCarryoverHours: rollover.ptoMaxHours,
    employeeName: emp.display_name,
  });
}

module.exports = {
  PTO_HIGH_BALANCE_THRESHOLD_HOURS,
  buildPtoHighBalanceNotice,
  sendPtoHighBalanceEmail,
  getPtoHighBalanceNoticeForEmployee,
};
