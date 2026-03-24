const { Pool } = require("pg");

/**
 * Neon / Vercel often use different names for the same connection string.
 * Prefer pooled `DATABASE_URL` when present.
 */
function getDatabaseUrl() {
  const candidates = [
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL,
    process.env.POSTGRES_PRISMA_URL,
    process.env.POSTGRES_URL_NON_POOLING,
  ];
  for (const c of candidates) {
    const s = c && String(c).trim();
    if (s) return s;
  }
  return "";
}

let cachedPool = null;

function getPool() {
  const url = getDatabaseUrl();
  if (!url) {
    throw new Error(
      "TPAYROLL_NO_DB_URL: No Postgres connection string in env. Set DATABASE_URL or POSTGRES_URL " +
        "in Vercel → Project → Settings → Environment Variables for Production (and Preview if needed), " +
        "then Redeploy. Open /api/build-info to confirm the deployment commit. " +
        "If you still see the old text DATABASE_URL is not set, you are on a stale deployment."
    );
  }

  if (!cachedPool) {
    cachedPool = new Pool({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
      max: 3,
    });
  }
  return cachedPool;
}

module.exports = { getPool, getDatabaseUrl };
