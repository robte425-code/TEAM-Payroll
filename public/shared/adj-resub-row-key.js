/**
 * The identity of one adjustment/resubmission line — the single copy.
 *
 * Lives under public/ for the same reason as calc-row-key.js: the analyzer is
 * a plain <script> and cannot require() from lib/, while the API can require()
 * its way in here.
 *
 * The browser builds this key and sends it; the server stores the row under
 * it; a saved adjustment is re-applied only when the two agree exactly. There
 * were two copies, and they already disagreed on a provider ID of numeric 0 —
 * harmless only because one side never reached the other's code path. When
 * copies like that drift for real, the failure is silent: a saved adjustment
 * stops matching its line and is quietly not paid.
 *
 * Changing anything here changes the key of every row already stored. Check it
 * against the rows in payroll.payroll_adj_resub_rows before shipping.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AdjResubRowKey = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function normalizeName(value) {
    return String(value || "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  }

  // Accepts the page's camelCase rows and the database's snake_case rows.
  function pick(row, camel, snake) {
    return row[camel] ?? row[snake] ?? "";
  }

  function employeeKey(row) {
    const providerId = String(pick(row, "providerId", "provider_id")).trim();
    if (providerId) return providerId;
    return normalizeName(pick(row, "employeeName", "employee_name"));
  }

  function buildAdjResubRowKey(row) {
    const letters = String(pick(row, "adjResub", "adj_resub"))
      .replace(/[^a-z]/gi, "")
      .toUpperCase();
    return [
      employeeKey(row),
      String(pick(row, "referralNumber", "referral_number")).trim(),
      String(pick(row, "rateCode", "rate_code")).trim().toUpperCase(),
      String(pick(row, "dateFrom", "date_from")).trim(),
      String(pick(row, "dateTo", "date_to")).trim(),
      letters,
    ].join("\x1e");
  }

  return { buildAdjResubRowKey, normalizeName };
});
