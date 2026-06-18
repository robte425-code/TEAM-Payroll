function normalizeName(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nameTokens(value) {
  const n = normalizeName(value);
  return n ? n.split(" ").filter(Boolean) : [];
}

function matchScore(stubName, employeeName) {
  const a = nameTokens(stubName);
  const b = nameTokens(employeeName);
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  let overlap = 0;
  for (const t of a) {
    if (setB.has(t)) overlap += 1;
  }
  const lastA = a[a.length - 1];
  const lastB = b[b.length - 1];
  if (lastA && lastB && lastA === lastB) overlap += 0.5;
  return overlap / Math.max(a.length, b.length);
}

/**
 * @param {string} stubName
 * @param {{ id: string, display_name?: string, displayName?: string }[]} employees
 * @returns {{ employee: object|null, score: number }}
 */
function matchEmployeeByName(stubName, employees) {
  let best = null;
  let bestScore = 0;
  for (const emp of employees) {
    const display = emp.display_name || emp.displayName || "";
    const score = matchScore(stubName, display);
    if (score > bestScore) {
      bestScore = score;
      best = emp;
    }
  }
  if (bestScore < 0.5) return { employee: null, score: bestScore };
  return { employee: best, score: bestScore };
}

module.exports = {
  normalizeName,
  matchEmployeeByName,
};
