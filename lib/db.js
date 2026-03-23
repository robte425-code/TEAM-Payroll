const { neon } = require("@neondatabase/serverless");

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

/**
 * @returns {import('@neondatabase/serverless').NeonQueryFunction}
 */
function getSql() {
  const url = getDatabaseUrl();
  if (!url) {
    throw new Error(
      "No Postgres URL found. Set DATABASE_URL (or POSTGRES_URL from Neon) in " +
        "Vercel → Project → Settings → Environment Variables for this environment " +
        "(Production / Preview / Development), then redeploy. " +
        "If testing locally, add it to a .env file and load it with vercel dev, or export it in the shell."
    );
  }
  return neon(url);
}

module.exports = { getSql, getDatabaseUrl };
