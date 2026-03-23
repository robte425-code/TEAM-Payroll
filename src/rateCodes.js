const CASE_WORK_RATE_CODES = new Set([
  "0800V",
  "0801V",
  "0802V",
  "0803V",
  "0810V",
  "0811V",
  "0812V",
  "0813V",
  "0821V",
  "0823V",
  "0824V",
  "0830V",
  "0840V",
  "0841V",
  "0842V",
  "0845V",
]);

const MILEAGE_RATE_CODES = new Set(["0893V", "0894V"]);

const TRAVEL_WAIT_RATE_CODES = new Set(["0891V", "0892V"]);

const REPORT_RATE_CODES = new Set(["0910V"]);

function getRateCodeCategory(rateCode) {
  const code = String(rateCode || "").trim().toUpperCase();

  if (CASE_WORK_RATE_CODES.has(code)) return "case_work";
  if (TRAVEL_WAIT_RATE_CODES.has(code)) return "travel_wait";
  if (MILEAGE_RATE_CODES.has(code)) return "mileage";
  if (REPORT_RATE_CODES.has(code)) return "report";
  return "other";
}

module.exports = {
  CASE_WORK_RATE_CODES,
  MILEAGE_RATE_CODES,
  TRAVEL_WAIT_RATE_CODES,
  REPORT_RATE_CODES,
  getRateCodeCategory,
};
