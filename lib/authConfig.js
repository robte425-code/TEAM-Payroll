/** Shared auth environment checks — fail closed in production when Azure AD is missing. */

function isProduction() {
  return process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
}

function hasAzureAuthConfig() {
  return Boolean(
    process.env.NEXTAUTH_SECRET &&
      process.env.AZURE_AD_CLIENT_ID &&
      process.env.AZURE_AD_CLIENT_SECRET
  );
}

const authEnabled = hasAzureAuthConfig();

function authMisconfiguredInProduction() {
  return isProduction() && !authEnabled;
}

function allowLocalDevAuthBypass() {
  return !isProduction() && !authEnabled;
}

function respondAuthMisconfigured(res) {
  if (authMisconfiguredInProduction()) {
    res.status(503).json({ error: "Authentication is not configured" });
    return true;
  }
  return false;
}

module.exports = {
  authEnabled,
  authMisconfiguredInProduction,
  allowLocalDevAuthBypass,
  respondAuthMisconfigured,
};
