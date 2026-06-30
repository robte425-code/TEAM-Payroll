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
    billedHours: 0,
    ptoHours: 0,
  };
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
    cur.billedHours += hours;
    if (!cur.providerId && row.providerId) cur.providerId = String(row.providerId).trim();
    map.set(key, cur);
  }
  return map;
}

function aggregateNonBillBilledHoursByEmployee(nonBillRows) {
  const map = new Map();
  for (const row of nonBillRows || []) {
    const bucket = String(row.bucket || "").trim();
    if (bucket !== "nb" && bucket !== "training") continue;
    const employeeName = String(row.timekeeper || row.employeeName || "").trim();
    if (!employeeName) continue;
    const hours = toNonNegativeNumber(row.profHours);
    if (hours <= 0) continue;
    const key = employeeMapKey(employeeName);
    const cur = map.get(key) || emptyEmployeeEntry(employeeName, row.providerId);
    cur.billedHours += hours;
    if (!cur.providerId && row.providerId) cur.providerId = String(row.providerId).trim();
    map.set(key, cur);
  }
  return map;
}

function aggregatePtoHoursByEmployee(nonBillRows) {
  const map = new Map();
  for (const row of nonBillRows || []) {
    if (String(row.bucket || "").trim() !== "pto") continue;
    const employeeName = String(row.timekeeper || row.employeeName || "").trim();
    if (!employeeName) continue;
    const hours = toNonNegativeNumber(row.profHours);
    if (hours <= 0) continue;
    const key = employeeMapKey(employeeName);
    const cur = map.get(key) || emptyEmployeeEntry(employeeName, row.providerId);
    cur.ptoHours += hours;
    if (!cur.providerId && row.providerId) cur.providerId = String(row.providerId).trim();
    map.set(key, cur);
  }
  return map;
}

function mergeEmployeeHourMaps(primaryMap, secondaryMap) {
  const merged = new Map(primaryMap);
  for (const [key, secondaryEntry] of secondaryMap.entries()) {
    if (merged.has(key)) {
      const cur = merged.get(key);
      cur.billedHours += toNonNegativeNumber(secondaryEntry.billedHours);
      cur.ptoHours += toNonNegativeNumber(secondaryEntry.ptoHours);
      if (!cur.providerId && secondaryEntry.providerId) cur.providerId = secondaryEntry.providerId;
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

function findPayPeriodPtoOverLimitViolations({ invoiceRows, nonBillRows, workingDays }) {
  const maxHours = resolveMaxPayPeriodHours(workingDays);
  if (maxHours <= 0) return [];

  const invoiceMap = aggregateInvoiceHoursByEmployee(invoiceRows);
  const nonBillBilledMap = aggregateNonBillBilledHoursByEmployee(nonBillRows);
  const ptoMap = aggregatePtoHoursByEmployee(nonBillRows);
  const merged = mergeEmployeeHourMaps(mergeEmployeeHourMaps(invoiceMap, nonBillBilledMap), ptoMap);
  const violations = [];

  for (const entry of merged.values()) {
    const billedHours = toNonNegativeNumber(entry.billedHours);
    const ptoHours = toNonNegativeNumber(entry.ptoHours);
    if (ptoHours <= 0) continue;
    const totalHours = billedHours + ptoHours;
    if (totalHours <= maxHours) continue;
    violations.push({
      employeeName: entry.employeeName,
      providerId: entry.providerId || "",
      billedHours,
      ptoHours,
      totalHours,
      maxHours,
      workingDays: Math.floor(toNonNegativeNumber(workingDays)),
    });
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
