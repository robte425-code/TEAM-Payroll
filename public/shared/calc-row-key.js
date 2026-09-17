/**
 * The identity of one billable line — the single copy.
 *
 * It lives under public/ because both sides need it and only public/ is
 * reachable from both: the analyzer is a plain <script> in index.html and
 * cannot require() from lib/, while the API can require() its way in here.
 *
 * Why one copy matters: the browser builds the key and stores it, the server
 * keys the row by it, and a hold only applies when the two agree exactly. Two
 * implementations that merely look the same will drift, and when they do the
 * failure is silent — the stored hold stops matching and the line it was meant
 * to keep out of pay is paid.
 *
 * Units are part of the identity on purpose. If billing changes the hours on a
 * held line, that is a different line and the hold does not carry over onto a
 * figure nobody has looked at; it reappears and has to be judged again.
 *
 * `occurrence` separates lines that are otherwise identical within one pull,
 * so holding one of two matching rows does not hold both.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CalcRowKey = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function normalizeName(value) {
    return String(value || "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  }

  function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function normalizeEmployeeKey(row) {
    const providerId = String(row.providerId ?? row.provider_id ?? "").trim();
    if (providerId) return providerId;
    return normalizeName(row.employeeName ?? row.employee_name);
  }

  function buildCalcRowKey(row, occurrence) {
    return [
      normalizeEmployeeKey(row),
      String(row.referralNumber ?? row.referral_number ?? "").trim(),
      String(row.rateCode ?? row.rate_code ?? "").trim().toUpperCase(),
      String(row.dateFrom ?? row.date_from ?? "").trim(),
      String(row.dateTo ?? row.date_to ?? "").trim(),
      toNumber(row.units).toFixed(4),
      String(occurrence || 0),
    ].join("\x1e");
  }

  return { buildCalcRowKey, normalizeName, normalizeEmployeeKey };
});
