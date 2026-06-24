const BACKUP_HEADER = "-- TEAM_PAYROLL_DB_BACKUP_V1";

/** Parent-first insert order; children truncated first on restore. */
const BACKUP_TABLES = [
  "employees",
  "app_kv",
  "app_access_emails",
  "leave_change_batches",
  "leave_change_batch_details",
  "pto_log",
  "sick_time_log",
  "pay_stub_batches",
  "pay_stubs",
  "pay_stub_download_log",
];

const TRUNCATE_TABLES = [...BACKUP_TABLES].reverse();

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlValue(value, dataType, udtName) {
  if (value === null || value === undefined) return "NULL";

  if (Buffer.isBuffer(value)) {
    return `'\\x${value.toString("hex")}'`;
  }

  if (dataType === "bytea" || udtName === "bytea") {
    if (typeof value === "string" && value.startsWith("\\x")) {
      return `'${value.replace(/'/g, "''")}'`;
    }
    return `'\\x${Buffer.from(value).toString("hex")}'`;
  }

  if (dataType === "jsonb" || udtName === "jsonb") {
    const json =
      typeof value === "string" ? value : JSON.stringify(value);
    return `${sqlString(json)}::jsonb`;
  }

  if (dataType === "ARRAY") {
    return sqlString(String(value));
  }

  if (value instanceof Date) {
    return sqlString(value.toISOString());
  }

  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "NULL";
  }

  if (typeof value === "object") {
    return sqlString(JSON.stringify(value));
  }

  return sqlString(value);
}

async function getTableColumns(pool, tableName) {
  const r = await pool.query(
    `SELECT column_name, data_type, udt_name
     FROM information_schema.columns
     WHERE table_schema = 'payroll' AND table_name = $1
     ORDER BY ordinal_position`,
    [tableName]
  );
  return r.rows;
}

async function tableExists(pool, tableName) {
  const r = await pool.query(
    `SELECT 1
     FROM information_schema.tables
     WHERE table_schema = 'payroll' AND table_name = $1
     LIMIT 1`,
    [tableName]
  );
  return r.rows.length > 0;
}

function insertStatements(tableName, columns, rows) {
  if (!rows.length) return [];
  const cols = columns.map((c) => `"${c.column_name}"`).join(", ");
  const qualified = `payroll."${tableName}"`;
  return rows.map((row) => {
    const values = columns
      .map((c) => sqlValue(row[c.column_name], c.data_type, c.udt_name))
      .join(", ");
    return `INSERT INTO ${qualified} (${cols}) VALUES (${values});`;
  });
}

async function generatePayrollBackupSql(pool) {
  const lines = [
    BACKUP_HEADER,
    `-- generated_at_utc: ${new Date().toISOString()}`,
    `-- schema: payroll`,
    "BEGIN;",
    `TRUNCATE TABLE ${TRUNCATE_TABLES.map((t) => `payroll."${t}"`).join(", ")} CASCADE;`,
  ];

  for (const tableName of BACKUP_TABLES) {
    const exists = await tableExists(pool, tableName);
    if (!exists) continue;

    const columns = await getTableColumns(pool, tableName);
    if (!columns.length) continue;

    const colNames = columns.map((c) => `"${c.column_name}"`).join(", ");
    const r = await pool.query(
      `SELECT ${colNames} FROM payroll."${tableName}"`
    );
    lines.push(`-- ${tableName}: ${r.rows.length} row(s)`);
    lines.push(...insertStatements(tableName, columns, r.rows));
  }

  lines.push("COMMIT;", "");
  return lines.join("\n");
}

function backupFilename() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `team-payroll-db-backup-${timestamp}.sql`;
}

module.exports = {
  BACKUP_HEADER,
  BACKUP_TABLES,
  generatePayrollBackupSql,
  backupFilename,
};
