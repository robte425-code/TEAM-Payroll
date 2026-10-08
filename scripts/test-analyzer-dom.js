/**
 * Runs the real payroll analyzer page and clicks its real controls.
 *
 *   npm run test:dom
 *
 * public/index.html is loaded into jsdom as shipped. Only the network is
 * replaced, by an in-memory stand-in for the API, so every function exercised
 * here is the code that runs in production — not a copy of it.
 *
 * Why this exists: the payroll analyzer's worst bugs have all been silent.
 * Undo controls that reported success while the value survived, totals that
 * counted an invoice twice, saves that never reached the database. Each one
 * read correctly in a diff review and failed the moment the page was run.
 * These scenarios are the ones that have actually gone wrong.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const XLSX = require("xlsx");

const ROOT = path.join(__dirname, "..");
const HTML = fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8");
const CalcRowKey = require(path.join(ROOT, "public", "shared", "calc-row-key.js"));
const SESSION_KEY = "TEAM_PAYROLL_SESSION_V1";
const PERIOD = "2026-09-30";

// ---------------------------------------------------------------------------
// A stand-in for the API, keyed the way the server keys its rows.
// ---------------------------------------------------------------------------

// The same key the page and the server use — not a copy of it.
const AdjResubRowKey = require(path.join(ROOT, "public", "shared", "adj-resub-row-key.js"));
const adjKey = (row) => AdjResubRowKey.buildAdjResubRowKey(row);

function fakeApi() {
  const adj = new Map(); // `${period}|${rowKey}` -> stored adjustment
  const calls = [];
  let gate = null; // while set, PUTs wait for it: a save held in flight


  function respond(status, body) {
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    });
  }

  function fetch(url, opts = {}) {
    const u = new URL(String(url), "https://payroll.test/");
    const method = (opts.method || "GET").toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ method, path: u.pathname, body });

    if (u.pathname === "/api/payroll-adj-resub" && method === "PUT" && gate) {
      const held = gate;
      return held.then(() => answerAdj(method, u, body));
    }
    return answerAdj(method, u, body);
  }

  function answerAdj(method, u, body) {
    if (u.pathname === "/api/payroll-adj-resub") {
      if (method === "GET") {
        const period = u.searchParams.get("payrollEndDate");
        const rows = [...adj.entries()]
          .filter(([k]) => k.startsWith(`${period}|`))
          .map(([, v]) => v);
        return respond(200, { ok: true, rows });
      }
      const key = `${body.payrollEndDate}|${body.row.rowKey}`;
      if (body.clear === true) {
        return respond(200, { ok: true, cleared: true, removed: adj.delete(key) ? 1 : 0 });
      }
      adj.set(key, {
        rowKey: body.row.rowKey,
        resolvedUnits: body.row.resolvedUnits,
        unitsLocked: body.row.unitsLocked,
      });
      return respond(200, { ok: true, row: { resolvedUnits: body.row.resolvedUnits } });
    }
    if (u.pathname === "/api/payroll-row-exclusions") return respond(200, { ok: true, rows: [] });
    if (u.pathname === "/api/employees") return respond(200, { employees: [] });
    return respond(200, {});
  }

  return {
    fetch,
    adj,
    calls,
    puts: () => calls.filter((c) => c.method === "PUT"),
    /** Hold every save until the returned function is called. */
    holdSaves() {
      let release;
      gate = new Promise((r) => (release = r));
      return () => {
        gate = null;
        release();
      };
    },
  };
}

// ---------------------------------------------------------------------------
// The page.
// ---------------------------------------------------------------------------

async function loadPage({ session = null, api = fakeApi() } = {}) {
  const dom = new JSDOM(HTML, {
    url: "https://payroll.test/index.html",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(window) {
      window.TeamShell = { mount() {} };
      window.CalcRowKey = CalcRowKey;
      window.AdjResubRowKey = AdjResubRowKey;
      window.XLSX = XLSX;
      window.fetch = api.fetch;
      window.confirm = () => true;
      window.alert = () => {};
      window.prompt = () => "";
      window.scrollTo = () => {};
      if (session) window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    },
  });
  const page = makeDriver(dom.window, api);
  await page.settle(60);
  return page;
}

function makeDriver(window, api) {
  const doc = window.document;
  const settle = async (n = 30) => {
    for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
  };
  const q = (sel) => doc.querySelector(sel);
  const session = () => JSON.parse(window.sessionStorage.getItem(SESSION_KEY) || "{}");

  return {
    window,
    api,
    settle,
    q,
    session,
    adjRow: (id) => (session().sessionAdjResubRows || []).find((r) => r._adjId === id) || {},
    error: () => q("#error").textContent.trim(),
    status: () => q("#status").textContent.trim(),

    /** Case-work hours per employee, read from the rendered summary table. */
    caseWork() {
      const out = {};
      for (const tr of doc.querySelectorAll("#summaryTable tbody tr")) {
        const cells = tr.querySelectorAll("td");
        if (cells.length > 1) out[cells[0].textContent.trim()] = Number(cells[1].textContent);
      }
      return out;
    },

    setPeriod(value) {
      q("#payrollEndDateInput").value = value;
    },

    /** Select files exactly as the analyzer reads them, and click Analyze. */
    async analyze(files) {
      Object.defineProperty(q("#fileInput"), "files", { value: files, configurable: true });
      q("#analyzeBtn").click();
      await settle(80);
    },
  };
}

/** A real .xlsx, built and parsed by the same SheetJS version the page loads. */
function invoice(name, lines) {
  const header = [
    "Work Done By", "Provider ID", "Claimant", "Referral #", "Rate Code",
    "Date From", "Date To", "Units", "Adj/ Resub",
  ];
  const data = lines.map((l) => [
    l.employee, "", l.claimant || "Claimant", l.referral, l.rate,
    l.from || "9/16/2026", l.to || "9/20/2026", l.units, l.adj || "",
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...data]), "Invoice");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return { name, arrayBuffer: async () => buf };
}

/** A session as the page saves it, with adjustment rows already analyzed. */
function adjRow(id, employee, rate, units, extra = {}) {
  return {
    _adjId: id,
    sourceFile: "invoice-101.xlsx",
    employeeName: employee,
    providerId: "",
    claimant: "Claimant",
    referralNumber: String(11000000 + id),
    rateCode: rate,
    rateCodeCategory: "case_work",
    dateFrom: "9/16/2026",
    dateTo: "9/20/2026",
    units,
    adjResub: "A",
    unitsLocked: false,
    ...extra,
  };
}

function savedSession(overrides = {}) {
  return {
    payrollEndDate: PERIOD,
    sessionCalcSummary: [],
    sessionAdjResubRows: [],
    nextAdjRowId: 1,
    sessionSourceFiles: [],
    lastPayroll10Results: null,
    lastPayroll20Results: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Scenarios.
// ---------------------------------------------------------------------------

const scenarios = [];
const scenario = (name, fn) => scenarios.push({ name, fn });

// --- Adjustment units: the 8 Oct accidental commit, and its undo ----------

scenario("clicking into a Units box and out again saves nothing", async () => {
  const page = await loadPage({
    session: savedSession({
      sessionAdjResubRows: [adjRow(1, "MarLee Clyborne", "0830V", 47)],
      nextAdjRowId: 2,
    }),
  });
  const input = page.q('.adj-units-input[data-adj-id="1"]');
  input.focus();
  input.blur();
  await page.settle();
  assert.equal(page.api.puts().length, 0, "a focus and blur with no change must not save");
  assert.notEqual(page.adjRow(1).unitsLocked, true, "the row must stay unconfirmed");
});

scenario("Confirm accepts an unchanged figure, under the session's period", async () => {
  const page = await loadPage({
    session: savedSession({
      sessionAdjResubRows: [adjRow(1, "MarLee Clyborne", "0830V", 47)],
      nextAdjRowId: 2,
    }),
  });
  assert.ok(page.q('.adj-units-confirm[data-adj-id="1"]'), "an unconfirmed row needs a Confirm button");
  page.q('.adj-units-confirm[data-adj-id="1"]').click();
  await page.settle();
  const saved = page.api.puts();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].body.row.resolvedUnits, 47);
  assert.equal(saved[0].body.payrollEndDate, PERIOD);
  assert.equal(page.adjRow(1).unitsLocked, true);
  assert.equal(page.adjRow(1).storedPeriod, PERIOD, "the row must remember where it was saved");
});

scenario("typing a new figure and leaving the box still saves it", async () => {
  const page = await loadPage({
    session: savedSession({
      sessionAdjResubRows: [adjRow(1, "Richelle Dickens", "0840V", 52)],
      nextAdjRowId: 2,
    }),
  });
  const input = page.q('.adj-units-input[data-adj-id="1"]');
  input.focus();
  input.value = "14";
  input.blur();
  await page.settle();
  assert.equal(page.api.puts().length, 1);
  assert.equal(page.api.puts()[0].body.row.resolvedUnits, 14);
});

scenario("the payroll end date survives navigation", async () => {
  const page = await loadPage({ session: savedSession() });
  assert.equal(page.q("#payrollEndDateInput").value, PERIOD);
});

scenario("Clear removes the saved value and says so", async () => {
  const api = fakeApi();
  const row = adjRow(1, "Linda Kimm", "0810V", 10, {
    unitsLocked: true, resolvedUnits: 4, previousResolvedUnits: 4, storedPeriod: PERIOD,
  });
  api.adj.set(`${PERIOD}|${adjKey(row)}`, { rowKey: adjKey(row), resolvedUnits: 4, unitsLocked: true });
  const page = await loadPage({ api, session: savedSession({ sessionAdjResubRows: [row], nextAdjRowId: 2 }) });

  page.q('.adj-units-clear[data-adj-id="1"]').click();
  await page.settle();
  assert.equal(api.puts().length, 1, "Clear must actually ask the server");
  assert.equal(api.puts()[0].body.payrollEndDate, PERIOD);
  assert.equal(api.adj.size, 0, "the saved value must be gone, or it is paid again next analyze");
  assert.notEqual(page.adjRow(1).unitsLocked, true);
  assert.match(page.status(), /Cleared the saved units for Linda Kimm/);
});

scenario("Clear aims at the period a value was saved under, not the date field", async () => {
  const api = fakeApi();
  const row = adjRow(1, "Linda Kimm", "0810V", 10, {
    unitsLocked: true, resolvedUnits: 4, storedPeriod: PERIOD,
  });
  api.adj.set(`${PERIOD}|${adjKey(row)}`, { rowKey: adjKey(row), resolvedUnits: 4, unitsLocked: true });
  const page = await loadPage({ api, session: savedSession({ sessionAdjResubRows: [row], nextAdjRowId: 2 }) });

  page.setPeriod("2026-10-15"); // the field drifts; no change event
  page.q('.adj-units-clear[data-adj-id="1"]').click();
  await page.settle();
  assert.equal(api.puts()[0].body.payrollEndDate, PERIOD);
  assert.equal(api.adj.size, 0);
});

scenario("Clear refuses, rather than pretending, when it can't know the period", async () => {
  const row = adjRow(1, "Lisa McLeod", "0810V", 12, { unitsLocked: true, resolvedUnits: 6 });
  const page = await loadPage({ session: savedSession({ sessionAdjResubRows: [row], nextAdjRowId: 2 }) });
  page.q('.adj-units-clear[data-adj-id="1"]').click();
  await page.settle();
  assert.equal(page.api.puts().length, 0, "nothing to aim at, so nothing may be sent");
  assert.equal(page.adjRow(1).unitsLocked, true, "and nothing may be shown as cleared");
  assert.match(page.error(), /analyze the invoice again/i);
});

scenario("Clear treats 'removed nothing' as a failure", async () => {
  const row = adjRow(1, "Richelle Dickens", "0840V", 52, {
    unitsLocked: true, resolvedUnits: 14, storedPeriod: PERIOD,
  });
  // Nothing stored server-side for this row.
  const page = await loadPage({ session: savedSession({ sessionAdjResubRows: [row], nextAdjRowId: 2 }) });
  page.q('.adj-units-clear[data-adj-id="1"]').click();
  await page.settle();
  assert.equal(page.api.puts().length, 1);
  assert.equal(page.adjRow(1).unitsLocked, true);
  assert.match(page.error(), /nothing was removed/i);
});

scenario("double-clicking Clear sends one delete", async () => {
  const api = fakeApi();
  const row = adjRow(1, "Linda Kimm", "0810V", 10, {
    unitsLocked: true, resolvedUnits: 4, storedPeriod: PERIOD,
  });
  api.adj.set(`${PERIOD}|${adjKey(row)}`, { rowKey: adjKey(row), resolvedUnits: 4, unitsLocked: true });
  const page = await loadPage({ api, session: savedSession({ sessionAdjResubRows: [row], nextAdjRowId: 2 }) });
  const btn = page.q('.adj-units-clear[data-adj-id="1"]');
  btn.click();
  btn.click();
  await page.settle();
  assert.equal(api.puts().length, 1);
});

scenario("the Units box is plain text, so the mouse wheel and arrow keys can't change it", async () => {
  const page = await loadPage({
    session: savedSession({ sessionAdjResubRows: [adjRow(1, "MarLee Clyborne", "0830V", 47)], nextAdjRowId: 2 }),
  });
  const input = page.q('.adj-units-input[data-adj-id="1"]');
  assert.equal(input.type, "text", "a number input steps its value on wheel and arrow keys");
  assert.equal(input.getAttribute("inputmode"), "decimal", "phones should still show a number pad");
});

scenario("text that isn't a number is refused, with a message, and nothing is saved", async () => {
  const page = await loadPage({
    session: savedSession({ sessionAdjResubRows: [adjRow(1, "MarLee Clyborne", "0830V", 47)], nextAdjRowId: 2 }),
  });
  const input = page.q('.adj-units-input[data-adj-id="1"]');
  input.focus();
  input.value = "12abc";
  input.blur();
  await page.settle();
  assert.equal(page.api.puts().length, 0, "parseFloat would have saved this as 12");
  assert.equal(page.q('.adj-units-input[data-adj-id="1"]').value, "47", "the box goes back to its figure");
  assert.match(page.error(), /isn't a number of units/);
});

scenario("zero is accepted, because it is how a line is excluded", async () => {
  const page = await loadPage({
    session: savedSession({ sessionAdjResubRows: [adjRow(1, "Melanie Funston", "0811V", 31)], nextAdjRowId: 2 }),
  });
  const input = page.q('.adj-units-input[data-adj-id="1"]');
  input.focus();
  input.value = "0";
  input.blur();
  await page.settle();
  assert.equal(page.api.puts().length, 1);
  assert.equal(page.api.puts()[0].body.row.resolvedUnits, 0);
});

scenario("Escape abandons an edit instead of saving it", async () => {
  const page = await loadPage({
    session: savedSession({ sessionAdjResubRows: [adjRow(1, "MarLee Clyborne", "0830V", 47)], nextAdjRowId: 2 }),
  });
  const input = page.q('.adj-units-input[data-adj-id="1"]');
  input.focus();
  input.value = "470"; // a slip of the finger
  input.dispatchEvent(new page.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await page.settle();
  assert.equal(page.api.puts().length, 0);
  assert.equal(page.q('.adj-units-input[data-adj-id="1"]').value, "47");
  assert.notEqual(page.adjRow(1).unitsLocked, true);
});

scenario("a save finishing elsewhere doesn't wipe a figure half-typed in another row", async () => {
  const page = await loadPage({
    session: savedSession({
      sessionAdjResubRows: [adjRow(1, "MarLee Clyborne", "0830V", 47), adjRow(2, "Richelle Dickens", "0840V", 52)],
      nextAdjRowId: 3,
    }),
  });
  const release = page.api.holdSaves();

  const first = page.q('.adj-units-input[data-adj-id="1"]');
  first.focus();
  first.value = "20";
  first.blur(); // row 1's save is now in flight

  const second = page.q('.adj-units-input[data-adj-id="2"]');
  second.focus();
  second.value = "15"; // still typing in row 2 when row 1's save lands

  release();
  await page.settle();

  const after = page.q('.adj-units-input[data-adj-id="2"]');
  assert.ok(after, "row 2 must still be editable");
  assert.equal(after.value, "15", "the half-typed figure must survive the table being rebuilt");
  assert.equal(page.window.document.activeElement, after, "and the cursor must still be in it");
  assert.equal(page.api.puts().length, 1, "only row 1 has been saved; row 2 is still being typed");

  after.blur();
  await page.settle();
  assert.equal(page.api.puts().length, 2, "leaving row 2 saves it, so it still counts as changed");
  assert.equal(page.api.puts()[1].body.row.resolvedUnits, 15);
});

// --- Re-analyzing: an invoice must count exactly once --------------------

const INVOICE = [
  { employee: "MarLee Clyborne", referral: "11029791", rate: "0830V", units: 40 },
  { employee: "MarLee Clyborne", referral: "11029792", rate: "0810V", units: 20 },
  { employee: "Richelle Dickens", referral: "11155051", rate: "0840V", units: 30 },
  { employee: "MarLee Clyborne", referral: "11142668", rate: "0830V", units: 9, adj: "A" },
];

scenario("analyzing the same invoice twice counts it once", async () => {
  const page = await loadPage();
  page.setPeriod(PERIOD);
  await page.analyze([invoice("invoice-101.xlsx", INVOICE)]);
  const once = page.caseWork();
  assert.equal(once["MarLee Clyborne"], 6, "40 + 20 units of case work is 6.0 hours");
  assert.equal(once["Richelle Dickens"], 3);

  await page.analyze([invoice("invoice-101.xlsx", INVOICE)]);
  assert.deepEqual(page.caseWork(), once, "a second analysis must replace the first, not add to it");
  assert.match(page.status(), /Replaced the earlier analysis of invoice-101\.xlsx/);
});

scenario("a confirmed adjustment is paid once, however often the invoice is analyzed", async () => {
  const page = await loadPage();
  page.setPeriod(PERIOD);
  await page.analyze([invoice("invoice-101.xlsx", INVOICE)]);

  const adjId = Number(page.q(".adj-units-confirm").dataset.adjId);
  page.q(`.adj-units-confirm[data-adj-id="${adjId}"]`).click(); // accept 9 units = 0.9 h
  await page.settle();
  assert.equal(page.caseWork()["MarLee Clyborne"], 6.9);

  await page.analyze([invoice("invoice-101.xlsx", INVOICE)]);
  assert.equal(
    page.caseWork()["MarLee Clyborne"],
    6.9,
    "the saved adjustment is re-applied to the new rows, not stacked on old ones"
  );
  assert.equal(
    (page.session().sessionAdjResubRows || []).length,
    1,
    "exactly one copy of the adjustment row may exist"
  );
});

scenario("a second, different invoice still adds to the session", async () => {
  const page = await loadPage();
  page.setPeriod(PERIOD);
  await page.analyze([invoice("invoice-101.xlsx", INVOICE)]);
  await page.analyze([
    invoice("invoice-102.xlsx", [
      { employee: "Richelle Dickens", referral: "11999999", rate: "0840V", units: 10 },
    ]),
  ]);
  assert.equal(page.caseWork()["Richelle Dickens"], 4, "3.0 h from 101 plus 1.0 h from 102");
});

scenario("after navigation, analyzing one file can't silently drop the others", async () => {
  const summary = [
    { employeeName: "MarLee Clyborne", providerId: "", totals: { case_work: 6, travel_wait: 0, mileage: 0, report: 0 }, otherCodes: {}, rowCount: 2 },
  ];
  const page = await loadPage({
    session: savedSession({
      sessionCalcSummary: summary,
      sessionSourceFiles: ["invoice-101.xlsx", "invoice-102.xlsx"],
    }),
  });
  await page.analyze([invoice("invoice-102.xlsx", INVOICE)]);
  assert.match(page.error(), /would drop invoice-101\.xlsx from the totals/);
  assert.deepEqual(
    page.session().sessionCalcSummary,
    summary,
    "refusing must leave the restored totals exactly as they were"
  );
});

scenario("after navigation, re-selecting every file is allowed", async () => {
  const page = await loadPage({
    session: savedSession({
      sessionCalcSummary: [
        { employeeName: "MarLee Clyborne", providerId: "", totals: { case_work: 99, travel_wait: 0, mileage: 0, report: 0 }, otherCodes: {}, rowCount: 1 },
      ],
      sessionSourceFiles: ["invoice-101.xlsx"],
    }),
  });
  await page.analyze([invoice("invoice-101.xlsx", INVOICE)]);
  assert.equal(page.error(), "");
  assert.equal(page.caseWork()["MarLee Clyborne"], 6, "rebuilt from the file, not added to the stale total");
});

// ---------------------------------------------------------------------------

(async () => {
  let failed = 0;
  for (const { name, fn } of scenarios) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (e) {
      failed += 1;
      console.log(`  ✗ ${name}\n      ${String(e.message).split("\n").join("\n      ")}`);
    }
  }
  console.log(`\n${scenarios.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
