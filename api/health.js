const { getSql, getDatabaseUrl } = require("../lib/db");

function envPresence() {
  const set = (k) => !!(process.env[k] && String(process.env[k]).trim());
  return {
    DATABASE_URL: set("DATABASE_URL"),
    POSTGRES_URL: set("POSTGRES_URL"),
    POSTGRES_PRISMA_URL: set("POSTGRES_PRISMA_URL"),
    POSTGRES_URL_NON_POOLING: set("POSTGRES_URL_NON_POOLING"),
  };
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  const meta = {
    commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
    deployment: process.env.VERCEL_DEPLOYMENT_ID || null,
    env: envPresence(),
    hasResolvedUrl: !!getDatabaseUrl(),
  };
  try {
    const sql = getSql();
    await sql`SELECT 1 AS ok`;
    return res.status(200).json({
      ok: true,
      database: "connected",
      ...meta,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e && e.message ? e.message : "Database not configured",
      ...meta,
    });
  }
};
