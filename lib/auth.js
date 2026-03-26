import AzureADProvider from "next-auth/providers/azure-ad";
import { getPool } from "./db";

const clientId = process.env.AZURE_AD_CLIENT_ID;
const clientSecret = process.env.AZURE_AD_CLIENT_SECRET;
const tenantId = process.env.AZURE_AD_TENANT_ID || "common";

const azureConfigured = Boolean(clientId && clientId.trim() && clientSecret && clientSecret.trim());

const adminEmails = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

const allowedDomains = (process.env.ALLOWED_DOMAIN || "team-voc.com")
  .split(",")
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

function isAdmin(email) {
  if (!email) return false;
  return adminEmails.includes(String(email).toLowerCase());
}

async function isAdminEmail(email) {
  if (isAdmin(email)) return true;
  if (!email) return false;
  const normalized = String(email).trim().toLowerCase();
  try {
    const pool = getPool();
    const r = await pool.query(
      `SELECT 1
       FROM payroll.app_access_emails
       WHERE email = $1 AND is_admin = true
       LIMIT 1`,
      [normalized]
    );
    return Boolean(r.rows && r.rows.length);
  } catch {
    return false;
  }
}

function isAllowedDomain(email) {
  if (!email) return false;
  const domain = String(email).split("@")[1]?.toLowerCase();
  return domain ? allowedDomains.includes(domain) : false;
}

async function isAllowedEmail(email) {
  if (!email) return false;
  const normalized = String(email).trim().toLowerCase();

  try {
    const pool = getPool();
    const r = await pool.query(
      `SELECT 1
       FROM payroll.app_access_emails
       WHERE email = $1 AND is_enabled = true
       LIMIT 1`,
      [normalized]
    );
    if (r.rows && r.rows.length) return true;
    return false;
  } catch {
    // If the DB/table isn't ready yet (e.g. migrations not run),
    // fall back to the old domain-based allow.
    return isAllowedDomain(normalized);
  }
}

export const authOptions = {
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: "/login", error: "/login" },
  providers: azureConfigured
    ? [
        AzureADProvider({
          clientId: clientId.trim(),
          clientSecret: clientSecret.trim(),
          tenantId: tenantId.trim(),
          authorization: {
            params: {
              scope: "openid profile email",
            },
          },
          profile(profile) {
            return {
              id: profile.sub,
              name: profile.name || null,
              email: profile.email || profile.preferred_username || null,
              image: null,
            };
          },
        }),
      ]
    : [],
  callbacks: {
    async signIn({ user }) {
      const email = user?.email || null;
      return isAllowedEmail(email);
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id || token.sub;
        token.email = user.email || token.email;
        token.role = (await isAdminEmail(user.email)) ? "admin" : "member";
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id || token.sub;
        session.user.role = token.role || "member";
      }
      return session;
    },
  },
};

