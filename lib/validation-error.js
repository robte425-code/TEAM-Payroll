/**
 * A problem with what the caller sent, as opposed to a problem with us.
 *
 * API handlers answer this with 400 and its message, and anything else with
 * 500 and a generic one. Without the distinction a database outage reaches the
 * operator as though they had typed something wrong, and monitoring that
 * separates 4xx from 5xx sees a client error during a real one.
 */
class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
    this.status = 400;
  }
}

module.exports = { ValidationError };
