/**
 * No DB, no imports — confirms Vercel is routing /api/* to this repo's functions.
 */
module.exports = (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  return res.status(200).json({
    ok: true,
    route: "ping",
    buildTag: "team-payroll-v4",
    time: new Date().toISOString(),
  });
};
