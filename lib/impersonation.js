const COOKIE_NAME = "team_impersonate";
const MAX_AGE_SECONDS = 8 * 60 * 60;

function isProd() {
  return process.env.NODE_ENV === "production";
}

function readImpersonateEmail(req) {
  const raw = req?.cookies?.[COOKIE_NAME];
  if (!raw) return null;
  const email = String(raw).trim().toLowerCase();
  return email.includes("@") ? email : null;
}

function setCookieHeader(email) {
  const secure = isProd() ? "; Secure" : "";
  return `${COOKIE_NAME}=${encodeURIComponent(email.toLowerCase())}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SECONDS}${secure}`;
}

function clearCookieHeader() {
  const secure = isProd() ? "; Secure" : "";
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

module.exports = {
  COOKIE_NAME,
  readImpersonateEmail,
  setCookieHeader,
  clearCookieHeader,
};
