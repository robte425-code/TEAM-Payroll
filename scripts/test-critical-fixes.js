const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

console.log("== Payroll: requireRealAdmin wired ==");
const apiDir = path.join(__dirname, "..", "pages", "api");
const files = [
  "leave-record.js",
  "leave-ytd.js",
  "leave-logs.js",
  "leave-log-entry.js",
  "leave-rollback.js",
  "employees.js",
  "employees-ensure.js",
  "settings.js",
];

for (const f of files) {
  const src = fs.readFileSync(path.join(apiDir, f), "utf8");
  assert.match(src, /requireRealAdmin/, `${f} must call requireRealAdmin`);
  assert.match(src, /const admin = await requireRealAdmin/, `${f} must await guard`);
}

console.log("== Payroll: whitespace regex escaped ==");
for (const f of ["leave-record.js", "leave-logs.js"]) {
  const src = fs.readFileSync(path.join(apiDir, f), "utf8");
  assert.match(src, /\\\\s\+/, `${f} must use \\\\s+ in JS string for SQL`);
  assert.doesNotMatch(src, /regexp_replace\([^)]*'\\s\+'/, `${f} must not use broken '\\s+'`);
}

console.log("Payroll wiring checks passed");
