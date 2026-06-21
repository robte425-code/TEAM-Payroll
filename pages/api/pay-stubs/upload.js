const fs = require("fs");
const os = require("os");
const path = require("path");
const { IncomingForm } = require("formidable");
const { getPool } = require("../../../lib/db");
const { splitPayStubPdf } = require("../../../lib/pay-stub-pdf");
const { matchEmployeeByName } = require("../../../lib/match-employee-name");
const { respondAuthMisconfigured } = require("../../../lib/authConfig");
const { requireRealAdmin } = require("../../../lib/apiAuth");

export const config = {
  api: {
    bodyParser: false,
  },
};

function parseForm(req) {
  return new Promise((resolve, reject) => {
    const form = new IncomingForm({
      maxFileSize: 15 * 1024 * 1024,
      keepExtensions: true,
    });
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

function readUploadedFile(file) {
  const entry = Array.isArray(file) ? file[0] : file;
  if (!entry) return null;
  const filepath = entry.filepath || entry.path;
  if (!filepath) return null;
  return {
    buffer: fs.readFileSync(filepath),
    originalFilename: entry.originalFilename || entry.name || "paystubs.pdf",
  };
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (respondAuthMisconfigured(res)) return;

  const admin = await requireRealAdmin(req, res);
  if (!admin) return;

  let uploaded;
  try {
    const { files } = await parseForm(req);
    uploaded = readUploadedFile(files.file || files.pdf);
  } catch (e) {
    return res.status(400).json({ error: e.message || "Could not read upload" });
  }

  if (!uploaded?.buffer?.length) {
    return res.status(400).json({ error: "Upload a PDF file (field name: file)." });
  }

  if (!String(uploaded.originalFilename).toLowerCase().endsWith(".pdf")) {
    return res.status(400).json({ error: "Only PDF files are supported." });
  }

  let split;
  try {
    split = await splitPayStubPdf(uploaded.buffer);
  } catch (e) {
    return res.status(400).json({ error: e.message || "Could not parse PDF" });
  }

  if (!split.pages.length) {
    return res.status(400).json({ error: "PDF has no pages." });
  }

  if (!split.checkDate) {
    return res.status(400).json({ error: "Could not detect check date in PDF." });
  }

  let pool;
  try {
    pool = getPool();
  } catch (e) {
    return res.status(500).json({ error: e.message || "Database not configured" });
  }

  const empR = await pool.query(
    `SELECT id, display_name, login_email FROM payroll.employees ORDER BY display_name ASC`
  );
  const employees = empR.rows;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const batchR = await client.query(
      `INSERT INTO payroll.pay_stub_batches
         (check_date, pay_period_start, pay_period_end, source_filename, uploaded_by_email, page_count)
       VALUES ($1::date, $2::date, $3::date, $4, $5, $6)
       ON CONFLICT (check_date, pay_period_start, pay_period_end)
       DO UPDATE SET
         source_filename = EXCLUDED.source_filename,
         uploaded_by_email = EXCLUDED.uploaded_by_email,
         page_count = EXCLUDED.page_count,
         created_at = now()
       RETURNING id`,
      [
        split.checkDate,
        split.payPeriodStart,
        split.payPeriodEnd,
        uploaded.originalFilename,
        String(token.email || "").toLowerCase(),
        split.pageCount,
      ]
    );
    const batchId = batchR.rows[0].id;

    await client.query(`DELETE FROM payroll.pay_stubs WHERE batch_id = $1::uuid`, [batchId]);

    const results = [];
    for (const page of split.pages) {
      const { employee, score } = matchEmployeeByName(page.extractedName, employees);
      const insertR = await client.query(
        `INSERT INTO payroll.pay_stubs
           (batch_id, employee_id, page_number, extracted_name, payroll_relief_emp_no, pdf_data)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)
         RETURNING id`,
        [
          batchId,
          employee?.id || null,
          page.pageNumber,
          page.extractedName || "",
          page.payrollReliefEmpNo || null,
          page.pdfBytes,
        ]
      );

      results.push({
        id: insertR.rows[0].id,
        pageNumber: page.pageNumber,
        extractedName: page.extractedName,
        payrollReliefEmpNo: page.payrollReliefEmpNo,
        employeeId: employee?.id || null,
        employeeName: employee?.display_name || null,
        matchScore: score,
        matched: Boolean(employee?.id),
      });
    }

    await client.query("COMMIT");

    const unmatched = results.filter((r) => !r.matched);

    return res.status(200).json({
      batchId,
      checkDate: split.checkDate,
      payPeriodStart: split.payPeriodStart,
      payPeriodEnd: split.payPeriodEnd,
      pageCount: split.pageCount,
      stubs: results,
      unmatchedCount: unmatched.length,
      message:
        unmatched.length === 0
          ? `Saved ${results.length} pay stubs for check date ${split.checkDate}.`
          : `Saved ${results.length} pages; ${unmatched.length} could not be matched to an employee — check names on Employee pay rates.`,
    });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    if (e.code === "42P01") {
      return res.status(500).json({
        error: "Pay stub tables are not set up yet. Run db/migrations/017_pay_stubs.sql.",
      });
    }
    return res.status(500).json({ error: e.message || "Upload failed" });
  } finally {
    client.release();
  }
}
