const { getAuthContext } = require("../../../lib/pay-stub-auth");

function formatBatch(row) {
  return {
    id: row.batch_id,
    checkDate: row.check_date,
    payPeriodStart: row.pay_period_start,
    payPeriodEnd: row.pay_period_end,
    sourceFilename: row.source_filename,
    createdAt: row.batch_created_at,
  };
}

function formatStub(row) {
  return {
    id: row.id,
    batchId: row.batch_id,
    checkDate: row.check_date,
    payPeriodStart: row.pay_period_start,
    payPeriodEnd: row.pay_period_end,
    extractedName: row.extracted_name,
    employeeId: row.employee_id,
    employeeName: row.display_name,
    downloadUrl: `/api/pay-stubs/download?id=${row.id}`,
  };
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const ctx = await getAuthContext(req, res);
  if (ctx.error) {
    return res.status(ctx.error.status).json({ error: ctx.error.message });
  }

  const { pool, isAdmin, impersonating, employeeId } = ctx;

  try {
    if (isAdmin && !impersonating) {
      const batchesR = await pool.query(
        `SELECT id AS batch_id, check_date, pay_period_start, pay_period_end, source_filename, created_at AS batch_created_at
         FROM payroll.pay_stub_batches
         ORDER BY check_date DESC, created_at DESC`
      );

      const stubsR = await pool.query(
        `SELECT s.id, s.batch_id, s.employee_id, s.extracted_name, e.display_name,
                b.check_date, b.pay_period_start, b.pay_period_end
         FROM payroll.pay_stubs s
         JOIN payroll.pay_stub_batches b ON b.id = s.batch_id
         LEFT JOIN payroll.employees e ON e.id = s.employee_id
         ORDER BY b.check_date DESC, s.page_number ASC`
      );

      return res.status(200).json({
        isAdmin: true,
        batches: batchesR.rows.map(formatBatch),
        stubs: stubsR.rows.map(formatStub),
      });
    }

    if (!employeeId) {
      return res.status(200).json({ stubs: [] });
    }

    const stubsR = await pool.query(
      `SELECT s.id, s.batch_id, s.employee_id, s.extracted_name, e.display_name,
              b.check_date, b.pay_period_start, b.pay_period_end
       FROM payroll.pay_stubs s
       JOIN payroll.pay_stub_batches b ON b.id = s.batch_id
       LEFT JOIN payroll.employees e ON e.id = s.employee_id
       WHERE s.employee_id = $1::uuid
       ORDER BY b.check_date DESC`,
      [employeeId]
    );

    return res.status(200).json({
      stubs: stubsR.rows.map(formatStub),
    });
  } catch (e) {
    if (e.code === "42P01") {
      return res.status(200).json({ stubs: [], batches: [] });
    }
    return res.status(500).json({ error: e.message || "Request failed" });
  }
}
