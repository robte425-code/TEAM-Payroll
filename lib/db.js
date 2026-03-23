const { neon } = require("@neondatabase/serverless");

/**
 * @returns {import('@neondatabase/serverless').NeonQueryFunction}
 */
function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url || !String(url).trim()) {
    throw new Error("DATABASE_URL is not set");
  }
  return neon(url);
}

module.exports = { getSql };
