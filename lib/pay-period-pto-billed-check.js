const HOURS_PER_WORKING_DAY = 8;

function normalizeEmployeeName(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function toNonNegativeNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function formatHours(n) {
  return (Math.round((Number(n) + Number.EPSILON) * 100) / 100).toFixed(2);
}

function toActualHours(category, units) {
  if (category === "case_work") return units / 10;
  if (category === "travel_wait") return units / 10;
  if (category === "report") return units / 2;
  return 0;
}

function isBillableCategory(category) {
  return category === "case_work" || category === "travel_wait" || category === "report";
}

function employeeMapKey(employeeName) {
  return normalizeEmployeeName(employeeName);
}

function emptyEmployeeEntry(employeeName, providerId = "") {
  return {
    employeeName,
    providerId: String(providerId || "").trim(),
    caseWorkHours: 0,
    travelWaitHours: 0,
    reportHours: 0,
    nbHours: 0,
    trainingHours: 0,
    ptoHours: 0,
    sickHours: 0,
  };
}

function applyProviderId(entry, providerId) {
  if (!entry.providerId && providerId) entry.providerId = String(providerId).trim();
}

function aggregateInvoiceHoursByEmployee(invoiceRows) {
  const map = new Map();
  for (const row of invoiceRows || []) {
    const category = String(row.rateCodeCategory || "").trim();
    if (!isBillableCategory(category)) continue;
    const employeeName = String(row.employeeName || "").trim();
    if (!employeeName) continue;
    const hours = toActualHours(category, toNonNegativeNumber(row.units));
    if (hours <= 0) continue;
    const key = employeeMapKey(employeeName);
    const cur = map.get(key) || emptyEmployeeEntry(employeeName, row.providerId);
    if (category === "case_work") cur.caseWorkHours += hours;
    else if (category === "travel_wait") cur.travelWaitHours += hours;
    else if (category === "report") cur.reportHours += hours;
    applyProviderId(cur, row.providerId);
    map.set(key, cur);
  }
  return map;
}

function aggregateNonBillHoursByEmployee(nonBillRows) {
  const map = new Map();
  for (const row of nonBillRows || []) {
    const bucket = String(row.bucket || "").trim();
    if (bucket !== "nb" && bucket !== "training" && bucket !== "pto" && bucket !== "sick") continue;
    const employeeName = String(row.timekeeper || row.employeeName || "").trim();
    if (!employeeName) continue;
    const hours = toNonNegativeNumber(row.profHours);
    if (hours <= 0) continue;
    const key = employeeMapKey(employeeName);
    const cur = map.get(key) || emptyEmployeeEntry(employeeName, row.providerId);
    if (bucket === "nb") cur.nbHours += hours;
    else if (bucket === "training") cur.trainingHours += hours;
    else if (bucket === "pto") cur.ptoHours += hours;
    else if (bucket === "sick") cur.sickHours += hours;
    applyProviderId(cur, row.providerId);
    map.set(key, cur);
  }
  return map;
}

function mergeEmployeeHourMaps(primaryMap, secondaryMap) {
  const merged = new Map(primaryMap);
  for (const [key, secondaryEntry] of secondaryMap.entries()) {
    if (merged.has(key)) {
      const cur = merged.get(key);
      cur.caseWorkHours += toNonNegativeNumber(secondaryEntry.caseWorkHours);
      cur.travelWaitHours += toNonNegativeNumber(secondaryEntry.travelWaitHours);
      cur.reportHours += toNonNegativeNumber(secondaryEntry.reportHours);
      cur.nbHours += toNonNegativeNumber(secondaryEntry.nbHours);
      cur.trainingHours += toNonNegativeNumber(secondaryEntry.trainingHours);
      cur.ptoHours += toNonNegativeNumber(secondaryEntry.ptoHours);
      cur.sickHours += toNonNegativeNumber(secondaryEntry.sickHours);
      applyProviderId(cur, secondaryEntry.providerId);
    } else {
      merged.set(key, { ...secondaryEntry });
    }
  }
  return merged;
}

function resolveMaxPayPeriodHours(workingDays) {
  const days = Math.floor(toNonNegativeNumber(workingDays));
  if (days <= 0) return 0;
  return days * HOURS_PER_WORKING_DAY;
}

function sumBilledHours(entry) {
  return (
    toNonNegativeNumber(entry.caseWorkHours) +
    toNonNegativeNumber(entry.travelWaitHours) +
    toNonNegativeNumber(entry.reportHours) +
    toNonNegativeNumber(entry.nbHours) +
    toNonNegativeNumber(entry.trainingHours)
  );
}

function buildViolationEntry(entry, maxHours, workingDays) {
  const caseWorkHours = toNonNegativeNumber(entry.caseWorkHours);
  const travelWaitHours = toNonNegativeNumber(entry.travelWaitHours);
  const reportHours = toNonNegativeNumber(entry.reportHours);
  const nbHours = toNonNegativeNumber(entry.nbHours);
  const trainingHours = toNonNegativeNumber(entry.trainingHours);
  const ptoHours = toNonNegativeNumber(entry.ptoHours);
  const sickHours = toNonNegativeNumber(entry.sickHours);
  const billedHours = caseWorkHours + travelWaitHours + reportHours + nbHours + trainingHours;
  const leaveHours = ptoHours + sickHours;
  const totalHours = billedHours + leaveHours;

  return {
    employeeName: entry.employeeName,
    providerId: entry.providerId || "",
    caseWorkHours,
    travelWaitHours,
    reportHours,
    nbHours,
    trainingHours,
    ptoHours,
    sickHours,
    billedHours,
    leaveHours,
    totalHours,
    maxHours,
    workingDays: Math.floor(toNonNegativeNumber(workingDays)),
  };
}

function findPayPeriodPtoOverLimitViolations({ invoiceRows, nonBillRows, workingDays }) {
  const maxHours = resolveMaxPayPeriodHours(workingDays);
  if (maxHours <= 0) return [];

  const invoiceMap = aggregateInvoiceHoursByEmployee(invoiceRows);
  const nonBillMap = aggregateNonBillHoursByEmployee(nonBillRows);
  const merged = mergeEmployeeHourMaps(invoiceMap, nonBillMap);
  const violations = [];

  for (const entry of merged.values()) {
    const ptoHours = toNonNegativeNumber(entry.ptoHours);
    const sickHours = toNonNegativeNumber(entry.sickHours);
    if (ptoHours <= 0 && sickHours <= 0) continue;

    const violation = buildViolationEntry(entry, maxHours, workingDays);
    if (violation.totalHours <= maxHours) continue;
    violations.push(violation);
  }

  violations.sort((a, b) =>
    String(a.employeeName).localeCompare(String(b.employeeName), undefined, { sensitivity: "base" })
  );

  return violations;
}

module.exports = {
  HOURS_PER_WORKING_DAY,
  normalizeEmployeeName,
  formatHours,
  findPayPeriodPtoOverLimitViolations,
};
