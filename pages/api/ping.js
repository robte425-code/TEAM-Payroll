/**
 * No DB — confirms /api routes are deployed (Next.js).
 */
export default function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  return res.status(200).json({
    ok: true,
    route: "ping",
    framework: "nextjs",
    buildTag: "team-payroll-next-v1",
    time: new Date().toISOString(),
  });
}
