/**
 * The server side of adjustments and holds, against a real Postgres.
 *
 *   npm run test:server
 *
 * Runs on PGlite — Postgres compiled to run inside Node — so it needs no
 * database server and never touches the production one. The schema comes from
 * db/migrations, applied exactly as the build applies them: every file, in
 * name order. It is applied twice, over rows already in place, because every
 * production deploy re-runs every migration against live data.
 *
 * The browser test stubs the API, so it cannot see any of this: the audit
 * trail written in the same statement as each change, the refusals that keep a
 * mis-sent request from overwriting a saved value, and which failures are the
 * caller's (400) rather than ours (500).
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");

const ROOT = path.join(__dirname, "..");
const adj = require(path.join(ROOT, "lib", "payroll-adj-resub"));
const holds = require(path.join(ROOT, "lib", "payroll-row-exclusions"));
const { sendError } = require(path.join(ROOT, "lib", "api-errors"));
const { ValidationError } = require(path.join(ROOT, "lib", "validation-error"));

const PERIOD = "2026-09-30";

/** The subset of a pg Pool the libraries use, over PGlite. */
function poolFor(db) {
  return {
    async query(sql, params = []) {
      const r = await db.query(sql, params);
      return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
    },
  };
}

async function applyMigrations(db) {
  const dir = path.join(ROOT, "db", "migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    try {
      await db.exec(fs.readFileSync(path.join(dir, file), "utf8"));
    } catch (e) {
      throw new Error(`${file}: ${e.message}`);
    }
  }
  return files.length;
}

/** Run fn and return the error it throws, failing if it doesn't. */
async function rejection(fn) {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  assert.fail("expected an error, but none was thrown");
}

const line = {
  employeeName: "MarLee Clyborne",
  providerId: "",
  claimant: "Gaspar Gaspar",
  referralNumber: "11029791",
  rateCode: "0830V",
  dateFrom: "9/16/2026",
  dateTo: "9/20/2026",
  adjResub: "A",
  units: 47,
};

const scenarios = [];
const scenario = (name, fn) => scenarios.push({ name, fn });

// --- the schema -----------------------------------------------------------

scenario("every migration applies, and re-applies over existing rows", async ({ db, pool }) => {
  // Real rows in the tables most likely to trip a re-run, then the whole set
  // again — what every deploy does to production.
  await adj.upsertAdjResubRow(pool, {
    payrollEndDate: PERIOD,
    row: { ...line, resolvedUnits: 4, unitsLocked: true },
    updatedByEmail: "julia@team-voc.com",
  });
  await holds.excludeRow(pool, {
    payrollEndDate: PERIOD,
    row: { ...line, units: 12 },
    reason: "Rebilled under 810",
    excludedByEmail: "julia@team-voc.com",
  });
  const count = await applyMigrations(db);
  assert.ok(count >= 28, `expected the full set, found ${count}`);
});

scenario("the audit table can find one line's history by its key", async ({ db }) => {
  const r = await db.query(
    `SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'payroll' AND tablename = 'payroll_adj_resub_audit'`
  );
  assert.ok(
    r.rows.some((x) => /\(row_key, created_at DESC\)/.test(x.indexdef)),
    "without it, a line's history scans every entry for the period"
  );
});

// --- adjustments: saving and clearing leave a record ----------------------

scenario("a save is stored under the shared key and logged with who and how much", async ({ pool }) => {
  await adj.upsertAdjResubRow(pool, {
    payrollEndDate: PERIOD,
    row: { ...line, resolvedUnits: 47, unitsLocked: true },
    updatedByEmail: "julia@team-voc.com",
  });
  const stored = await pool.query(`SELECT row_key FROM payroll.payroll_adj_resub_rows`);
  assert.equal(stored.rows.length, 1);
  assert.equal(stored.rows[0].row_key, adj.buildAdjResubRowKey(line), "the page must be able to find it again");

  const log = await pool.query(
    `SELECT action, resolved_units::float AS units, actor_email FROM payroll.payroll_adj_resub_audit`
  );
  assert.deepEqual(log.rows, [{ action: "saved", units: 47, actor_email: "julia@team-voc.com" }]);
});

scenario("saving again replaces the value and logs the change", async ({ pool }) => {
  for (const units of [47, 14]) {
    await adj.upsertAdjResubRow(pool, {
      payrollEndDate: PERIOD,
      row: { ...line, resolvedUnits: units, unitsLocked: true },
      updatedByEmail: "julia@team-voc.com",
    });
  }
  const rows = await pool.query(`SELECT resolved_units::float AS units FROM payroll.payroll_adj_resub_rows`);
  assert.deepEqual(rows.rows, [{ units: 14 }], "one row, holding the latest value");
  const log = await pool.query(
    `SELECT resolved_units::float AS units FROM payroll.payroll_adj_resub_audit ORDER BY id`
  );
  assert.deepEqual(log.rows.map((r) => r.units), [47, 14]);
});

scenario("clearing removes the value and records who removed it and what it was", async ({ pool }) => {
  await adj.upsertAdjResubRow(pool, {
    payrollEndDate: PERIOD,
    row: { ...line, resolvedUnits: 47, unitsLocked: true },
    updatedByEmail: "julia@team-voc.com",
  });
  const result = await adj.deleteAdjResubRow(pool, {
    payrollEndDate: PERIOD,
    rowKey: adj.buildAdjResubRowKey(line),
    clearedByEmail: "robert@team-voc.com",
  });
  assert.equal(result.removed, 1);

  const left = await pool.query(`SELECT count(*)::int AS n FROM payroll.payroll_adj_resub_rows`);
  assert.equal(left.rows[0].n, 0, "a value left behind is re-applied, and paid, on the next analyze");

  const log = await pool.query(
    `SELECT action, resolved_units::float AS units, actor_email
       FROM payroll.payroll_adj_resub_audit ORDER BY id`
  );
  assert.deepEqual(log.rows.at(-1), { action: "cleared", units: 47, actor_email: "robert@team-voc.com" });
});

scenario("clearing something that isn't there removes nothing and logs nothing", async ({ pool }) => {
  const result = await adj.deleteAdjResubRow(pool, {
    payrollEndDate: PERIOD,
    rowKey: adj.buildAdjResubRowKey(line),
    clearedByEmail: "robert@team-voc.com",
  });
  assert.equal(result.removed, 0, "the page reports a failure on 0; a false 1 would hide it");
  const log = await pool.query(`SELECT count(*)::int AS n FROM payroll.payroll_adj_resub_audit`);
  assert.equal(log.rows[0].n, 0);
});

scenario("clearing under the wrong period leaves the value in place", async ({ pool }) => {
  await adj.upsertAdjResubRow(pool, {
    payrollEndDate: PERIOD,
    row: { ...line, resolvedUnits: 47, unitsLocked: true },
    updatedByEmail: "julia@team-voc.com",
  });
  const result = await adj.deleteAdjResubRow(pool, {
    payrollEndDate: "2026-10-15",
    rowKey: adj.buildAdjResubRowKey(line),
    clearedByEmail: "robert@team-voc.com",
  });
  assert.equal(result.removed, 0);
  const left = await pool.query(`SELECT count(*)::int AS n FROM payroll.payroll_adj_resub_rows`);
  assert.equal(left.rows[0].n, 1);
});

// --- adjustments: a mis-sent request can't overwrite a saved value -------

scenario("a row with nothing but a key is refused, and nothing is written", async ({ pool }) => {
  await adj.upsertAdjResubRow(pool, {
    payrollEndDate: PERIOD,
    row: { ...line, resolvedUnits: 47, unitsLocked: true },
    updatedByEmail: "julia@team-voc.com",
  });
  // What a clear looks like if it is read as a save: the key and nothing else.
  const e = await rejection(() =>
    adj.upsertAdjResubRow(pool, {
      payrollEndDate: PERIOD,
      row: { rowKey: adj.buildAdjResubRowKey(line) },
      updatedByEmail: "x",
    })
  );
  assert.equal(e.status, 400);
  const kept = await pool.query(
    `SELECT employee_name, resolved_units::float AS units FROM payroll.payroll_adj_resub_rows`
  );
  assert.deepEqual(kept.rows, [{ employee_name: "MarLee Clyborne", units: 47 }], "the saved value survives intact");
});

scenario("only the boolean true means clear", async () => {
  assert.equal(adj.parseClearFlag(true), true);
  assert.equal(adj.parseClearFlag(false), false);
  assert.equal(adj.parseClearFlag(undefined), false);
  for (const ambiguous of ["true", 1, null, "yes", {}]) {
    const e = await rejection(() => adj.parseClearFlag(ambiguous));
    assert.equal(e.status, 400, `${JSON.stringify(ambiguous)} must be refused, not guessed at`);
  }
});

scenario("bad requests are the caller's to fix: 400, not 500", async ({ pool }) => {
  const cases = [
    ["no period", () => adj.upsertAdjResubRow(pool, { payrollEndDate: "", row: line })],
    ["a malformed period", () => adj.upsertAdjResubRow(pool, { payrollEndDate: "09/30/2026", row: line })],
    ["no row", () => adj.upsertAdjResubRow(pool, { payrollEndDate: PERIOD, row: null })],
    ["clearing with no period", () => adj.deleteAdjResubRow(pool, { payrollEndDate: "", rowKey: "k" })],
    ["clearing with no key", () => adj.deleteAdjResubRow(pool, { payrollEndDate: PERIOD, rowKey: "" })],
  ];
  for (const [label, fn] of cases) {
    const e = await rejection(fn);
    assert.ok(e instanceof ValidationError, `${label}: expected a ValidationError, got ${e.name}`);
    assert.equal(e.status, 400, label);
  }
});

// --- holds ----------------------------------------------------------------

scenario("a hold needs a reason", async ({ pool }) => {
  const e = await rejection(() =>
    holds.excludeRow(pool, { payrollEndDate: PERIOD, row: { ...line, units: 12 }, reason: "  " })
  );
  assert.equal(e.status, 400);
  const n = await pool.query(`SELECT count(*)::int AS n FROM payroll.payroll_excluded_rows`);
  assert.equal(n.rows[0].n, 0);
});

scenario("a hold is listed for its period and released cleanly", async ({ pool }) => {
  const row = { ...line, units: 12, rowKey: holds.buildCalcRowKey({ ...line, units: 12 }, 0) };
  await holds.excludeRow(pool, {
    payrollEndDate: PERIOD,
    row,
    reason: "Rebilled under 810; already paid on the 800.",
    excludedByEmail: "julia@team-voc.com",
  });
  const listed = await holds.listExcludedRows(pool, PERIOD);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].reason, "Rebilled under 810; already paid on the 800.");
  assert.equal((await holds.listExcludedRows(pool, "2026-10-15")).length, 0, "holds belong to their period");

  assert.equal((await holds.includeRow(pool, { payrollEndDate: PERIOD, rowKey: row.rowKey })).removed, 1);
  assert.equal((await holds.includeRow(pool, { payrollEndDate: PERIOD, rowKey: row.rowKey })).removed, 0);
});

// --- the API's answer to a failure ---------------------------------------

function fakeRes() {
  return {
    code: null,
    body: null,
    status(code) {
      this.code = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

scenario("a validation failure comes back as 400 with its message", async () => {
  const res = fakeRes();
  sendError(res, new ValidationError("A reason is required."), { label: "t", fallback: "generic" });
  assert.equal(res.code, 400);
  assert.deepEqual(res.body, { error: "A reason is required." });
});

scenario("anything else comes back as 500, without the database's internals", async () => {
  const res = fakeRes();
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args);
  try {
    sendError(res, new Error('relation "payroll.secret" does not exist'), {
      label: "t",
      fallback: "Could not save that adjustment. Please try again.",
    });
  } finally {
    console.error = original;
  }
  assert.equal(res.code, 500);
  assert.deepEqual(res.body, { error: "Could not save that adjustment. Please try again." });
  assert.equal(logged.length, 1, "the real cause is still logged server-side");
});

// ---------------------------------------------------------------------------

(async () => {
  let failed = 0;
  for (const { name, fn } of scenarios) {
    // A fresh database per scenario, so no scenario depends on another's rows.
    const db = new PGlite();
    try {
      await applyMigrations(db);
      await fn({ db, pool: poolFor(db) });
      console.log(`  ✓ ${name}`);
    } catch (e) {
      failed += 1;
      console.log(`  ✗ ${name}\n      ${String(e.message).split("\n").join("\n      ")}`);
    } finally {
      await db.close();
    }
  }
  console.log(`\n${scenarios.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
