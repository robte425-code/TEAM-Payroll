const { getSql } = require("../lib/db");

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const sql = getSql();
    await sql`SELECT 1 AS ok`;
    return res.status(200).json({ ok: true, database: "connected" });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e && e.message ? e.message : "Database not configured",
    });
  }
};
