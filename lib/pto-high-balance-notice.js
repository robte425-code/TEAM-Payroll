const { fetchRolloverSettings } = require("./leave-rollover");

const PTO_HIGH_BALANCE_THRESHOLD_HOURS = 152;

function formatHours(n) {
  return (Math.round((Number(n) + Number.EPSILON) * 100) / 100).toFixed(2);
}

function buildPtoHighBalanceNotice({ ptoAvailableHours, ptoMaxCarryoverHours }) {
  const available = Number(ptoAvailableHours) || 0;
  if (available <= PTO_HIGH_BALANCE_THRESHOLD_HOURS) return null;

  const carryover = Number(ptoMaxCarryoverHours) || 0;

  return {
    ptoAvailableHours: available,
    ptoMaxCarryoverHours: carryover,
    message: `You currently have ${formatHours(available)} hours of PTO available. At year-end, only ${formatHours(carryover)} hours will carry over to the next year.`,
  };
}

async function getPtoHighBalanceNoticeForEmployee(pool, emp) {
  const rollover = await fetchRolloverSettings(pool);
  const ptoAvailable =
    (Number(emp.pto_ytd_hours_accrued) || 0) - (Number(emp.pto_ytd_hours_used) || 0);
  return buildPtoHighBalanceNotice({
    ptoAvailableHours: ptoAvailable,
    ptoMaxCarryoverHours: rollover.ptoMaxHours,
  });
}

module.exports = {
  PTO_HIGH_BALANCE_THRESHOLD_HOURS,
  buildPtoHighBalanceNotice,
  getPtoHighBalanceNoticeForEmployee,
};
