const DEFAULT_UPDATES_URL = "https://teamvoc-updates.vercel.app";

async function isSuperAdminEmailRemote(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return false;
  const secret = process.env.TEAM_INTERNAL_ACCESS_SECRET?.trim();
  const updatesBase = (process.env.NEXT_PUBLIC_UPDATES_URL || DEFAULT_UPDATES_URL).replace(/\/$/, "");
  if (!secret) return false;
  try {
    const url = `${updatesBase}/api/internal/is-super-admin?email=${encodeURIComponent(normalized)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${secret}` },
      cache: "no-store",
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data.superAdmin === true;
  } catch {
    return false;
  }
}

module.exports = { isSuperAdminEmailRemote };
