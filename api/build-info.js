/**
 * Deployment fingerprint (no secrets). Use to verify Vercel runs latest Git commit.
 */
module.exports = (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  return res.status(200).json({
    project: "TEAM-Payroll",
    buildTag: "team-payroll-v4",
    vercelGitCommit: process.env.VERCEL_GIT_COMMIT_SHA || null,
    vercelDeployment: process.env.VERCEL_DEPLOYMENT_ID || null,
    vercelUrl: process.env.VERCEL_URL || null,
  });
};
