// Small validation helpers. Throw HttpError(400, …) for bad input so the
// central error handler turns it into a clean 400 instead of a runtime 500.

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.expose = true; // this message is safe to show the client
  }
}

// Require a non-empty string; rejects objects/arrays (also stops the
// "email.toLowerCase is not a function" class of 500s).
function requireString(v, field) {
  if (typeof v !== 'string' || !v.trim()) {
    throw new HttpError(400, `${field} is required.`);
  }
  return v.trim();
}

module.exports = { HttpError, requireString };
