const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const src = fs.readFileSync(path.join(__dirname, "../pages/api/impersonate.js"), "utf8");
assert.match(src, /findEmployeeByEmail/);
assert.match(src, /not available to view as/);
console.log("Payroll High-slice checks passed");
