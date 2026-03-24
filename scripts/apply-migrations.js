/**
 * Apply SQL files in db/migrations/ in lexical order using DATABASE_URL (or POSTGRES_*).
 * Loads .env from project root when present (does not require the dotenv package).
 */
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const { getDatabaseUrl } = require("../lib/db");

function loadDotEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function normalizeConnectionString(rawUrl) {
  try {
    const u = new URL(rawUrl);
    u.searchParams.delete("sslmode");
    u.searchParams.delete("ssl");
    return u.toString();
  } catch {
    return rawUrl;
  }
}

async function main() {
  loadDotEnv();
  const url = getDatabaseUrl();
  if (!url) {
    console.error("No DATABASE_URL or POSTGRES_URL. Set it in .env or the environment.");
    process.exit(1);
  }

  const migrationsDir = path.join(__dirname, "..", "db", "migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const client = new Client({
    connectionString: normalizeConnectionString(url),
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    for (const file of files) {
      const full = path.join(migrationsDir, file);
      const sql = fs.readFileSync(full, "utf8");
      console.log("Applying:", file);
      await client.query(sql);
    }
    console.log("Done. Applied", files.length, "migration file(s).");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
