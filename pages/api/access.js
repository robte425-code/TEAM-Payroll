const UPDATES_ACCESS = "https://teamvoc-updates.vercel.app/manage/access";

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Allow", "GET, PATCH, OPTIONS");
  return res.status(410).json({
    error:
      "Payroll access is managed centrally in Updates. Use Admin → Access & Backups.",
    url: UPDATES_ACCESS,
  });
}
