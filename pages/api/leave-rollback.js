const { getPool } = require("../../lib/db");
const { requireRealAdmin } = require("../../lib/apiAuth");
const { BATCH_COLUMNS, latestRollbackableSql } = require("../../lib/leave-batch-order");

/**
 * Undo one PTO/Sick change batch.
 *
 * Any batch may be chosen, not only the most recent. That matters: the
 * duplicate recorded on 26 Aug 2026 had a later payroll stacked on top of it,
 * so "roll back the last change" would have undone the wrong fortnight and the
 * real fix had to be written by hand.
 *
 * The undo subtracts the batch's own delta from current balances rather than
 * restoring its before-snapshot. Restoring a snapshot is only correct when
 * nothing has happened since — otherwise it silently erases every later change.
 * Subtracting the delta is correct in both cases, and it also preserves any
 * manual correction made outside the batch system.
 */

function asUuidArray(v) {
  if (Array.isArray(v)) return v;
  if (v == null) return [];
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function readBody(req) {
  try {
    if (typeof req.body === "string") return JSON.parse(req.body || "{}");
    return req.body || {};
  } catch {
    return {};
  }
}

/** What undoing this batch would do to each employee, and what it would break. */
async function previewBatch(db, batchId) {
  const r = await db.query(
    `SELECT e.display_name AS name,
            e.pto_ytd_hours_accrued  AS pa_now,
            e.pto_ytd_hours_used     AS pu_now,
            e.sick_ytd_hours_accrued AS sa_now,
            e.sick_ytd_hours_used    AS su_now,
            e.pto_ytd_hours_accrued  - (d.pto_ytd_hours_accrued_after  - d.pto_ytd_hours_accrued_before)  AS pa_after,
            e.pto_ytd_hours_used     - (d.pto_ytd_hours_used_after     - d.pto_ytd_hours_used_before)     AS pu_after,
            e.sick_ytd_hours_accrued - (d.sick_ytd_hours_accrued_after - d.sick_ytd_hours_accrued_before) AS sa_after,
            e.sick_ytd_hours_used    - (d.sick_ytd_hours_used_after    - d.sick_ytd_hours_used_before)    AS su_after
       FROM payroll.leave_change_batch_details d
       JOIN payroll.employees e ON e.id = d.employee_id
      WHERE d.batch_id = $1
      ORDER BY e.display_name`,
    [batchId]
  );

  const rows = r.rows.map((x) => ({
    name: x.name,
    ptoAccrued: { from: Number(x.pa_now), to: Number(x.pa_after) },
    ptoUsed: { from: Number(x.pu_now), to: Number(x.pu_after) },
    sickAccrued: { from: Number(x.sa_now), to: Number(x.sa_after) },
    sickUsed: { from: Number(x.su_now), to: Number(x.su_after) },
  }));

  // Checked up front and named. These columns are CHECK (>= 0), so without this
  // the transaction would fail partway with a constraint error that says
  // nothing about who or why.
  const blocked = [];
  for (const row of rows) {
    for (const field of ["ptoAccrued", "ptoUsed", "sickAccrued", "sickUsed"]) {
      if (row[field].to < 0) {
        blocked.push({ name: row.name, field, resulting: row[field].to });
      }
    }
  }
  return { rows, blocked };
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store, max-age=0");

  if (req.method !== "POST" && req.method !== "GET") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const admin = await requireRealAdmin(req, res);
  if (!admin) return;

  let pool;
  try {
    pool = getPool();
  } catch (e) {
    return res.status(500).json({ error: e.message || "Database not configured" });
  }

  // ---- Preview -------------------------------------------------------------
  // Nobody should approve an undo without seeing which balances move. Read-only.
  if (req.method === "GET") {
    try {
      const wanted = String(req.query?.batchId || "").trim();
      const batchR = wanted
        ? await pool.query(
            `SELECT ${BATCH_COLUMNS} FROM payroll.leave_change_batches b WHERE b.id = $1::uuid`,
            [wanted]
          )
        : await pool.query(latestRollbackableSql(false));

      const batch = batchR.rows[0];
      if (!batch) return res.status(200).json({ batch: null });
      if (batch.rolled_back_at) {
        return res.status(409).json({ error: "That change has already been rolled back." });
      }

      const { rows, blocked } = await previewBatch(pool, batch.id);
      return res.status(200).json({
        batch: {
          batchId: batch.id,
          operationType: batch.operation_type,
          createdAt: batch.created_at,
          detailRows: rows.length,
        },
        rows,
        blocked,
      });
    } catch (e) {
      return res.status(500).json({ error: e?.message || "Request failed" });
    }
  }

  // ---- Apply ---------------------------------------------------------------
  const body = await readBody(req);
  const wantedBatchId = body.batchId ? String(body.batchId) : null;
  const expectedBatchId = body.expectedBatchId ? String(body.expectedBatchId) : null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Batches that never got detail rows can never be undone; retire them so
    // they stop shadowing the real one.
    await client.query(
      `UPDATE payroll.leave_change_batches b
          SET rolled_back_at = now()
        WHERE b.rolled_back_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM payroll.leave_change_batch_details d WHERE d.batch_id = b.id
          )`
    );

    const batchR = wantedBatchId
      ? await client.query(
          `SELECT ${BATCH_COLUMNS} FROM payroll.leave_change_batches b
            WHERE b.id = $1::uuid FOR UPDATE OF b`,
          [wantedBatchId]
        )
      : await client.query(latestRollbackableSql(true));

    const batch = batchR.rows[0];
    if (!batch) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "No change batch to roll back" });
    }
    if (batch.rolled_back_at) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "That change has already been rolled back." });
    }

    // What the caller was looking at when they agreed. If it has moved on,
    // refuse rather than undo something they did not see.
    if (expectedBatchId && String(batch.id) !== expectedBatchId) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error:
          "The change you confirmed is no longer the one this would undo — someone " +
          "has recorded since. Nothing has been rolled back. Reload and try again.",
        wouldRollBack: { batchId: batch.id, createdAt: batch.created_at },
      });
    }

    const detailsR = await client.query(
      `SELECT * FROM payroll.leave_change_batch_details WHERE batch_id = $1 ORDER BY id DESC`,
      [batch.id]
    );
    if (!detailsR.rows.length) {
      await client.query(
        `UPDATE payroll.leave_change_batches SET rolled_back_at = now() WHERE id = $1`,
        [batch.id]
      );
      await client.query("COMMIT");
      return res.status(404).json({ error: "That change has nothing to roll back." });
    }

    const { blocked } = await previewBatch(client, batch.id);
    if (blocked.length) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error:
          "Rolling this back would take some balances below zero, so nothing has been " +
          "changed. Those hours have already been used or adjusted since.",
        blocked,
      });
    }

    const upd = await client.query(
      `UPDATE payroll.employees e
          SET pto_ytd_hours_accrued  = e.pto_ytd_hours_accrued  - (d.pto_ytd_hours_accrued_after  - d.pto_ytd_hours_accrued_before),
              pto_ytd_hours_used     = e.pto_ytd_hours_used     - (d.pto_ytd_hours_used_after     - d.pto_ytd_hours_used_before),
              sick_ytd_hours_accrued = e.sick_ytd_hours_accrued - (d.sick_ytd_hours_accrued_after - d.sick_ytd_hours_accrued_before),
              sick_ytd_hours_used    = e.sick_ytd_hours_used    - (d.sick_ytd_hours_used_after    - d.sick_ytd_hours_used_before),
              updated_at = now()
         FROM payroll.leave_change_batch_details d
        WHERE d.batch_id = $1 AND e.id = d.employee_id`,
      [batch.id]
    );

    const ptoIds = [];
    const sickIds = [];
    for (const d of detailsR.rows) {
      ptoIds.push(...asUuidArray(d.pto_log_ids));
      sickIds.push(...asUuidArray(d.sick_log_ids));
    }
    if (ptoIds.length) {
      await client.query(`DELETE FROM payroll.pto_log WHERE id = ANY($1::uuid[])`, [ptoIds]);
    }
    if (sickIds.length) {
      await client.query(`DELETE FROM payroll.sick_time_log WHERE id = ANY($1::uuid[])`, [
        sickIds,
      ]);
    }

    await client.query(
      `UPDATE payroll.leave_change_batches SET rolled_back_at = now() WHERE id = $1`,
      [batch.id]
    );

    await client.query("COMMIT");
    return res.status(200).json({
      ok: true,
      batchId: batch.id,
      operationType: batch.operation_type,
      batchCreatedAt: batch.created_at,
      detailRows: detailsR.rows.length,
      employeesUpdated: upd.rowCount || 0,
      ptoLogRowsDeleted: ptoIds.length,
      sickLogRowsDeleted: sickIds.length,
    });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore
    }
    return res.status(500).json({ error: e?.message || "Request failed" });
  } finally {
    client.release();
  }
}
