/**
 * Answer a failed API request.
 *
 * A ValidationError is the caller's to fix, so it comes back as 400 with its
 * message. Anything else is ours: logged in full server-side, and answered
 * with 500 and a generic message, because database internals do not belong in
 * the operator's error bar and a 400 during an outage misleads both the
 * operator and any monitoring that separates 4xx from 5xx.
 *
 * Shared by the API routes so the rule lives in one place; it was previously
 * copied into each catch block.
 */
function sendError(res, e, { label, fallback }) {
  if (e?.status === 400) {
    return res.status(400).json({ error: e.message });
  }
  console.error(`${label} failed:`, e);
  return res.status(500).json({ error: fallback });
}

module.exports = { sendError };
