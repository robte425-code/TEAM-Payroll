import AzureADProvider from "next-auth/providers/azure-ad";

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

function isAllowedDomain(email) {
  if (!email) return false;
  const domain = String(email).split("@")[1]?.toLowerCase();
  return domain ? allowedDomains.includes(domain) : false;
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
      return isAllowedDomain(email);
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id || token.sub;
        token.email = user.email || token.email;
        token.role = isAdmin(user.email) ? "admin" : "member";
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

