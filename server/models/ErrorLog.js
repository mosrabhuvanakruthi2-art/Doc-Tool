const mongoose = require('mongoose');

// A record of every failure the system can see: handled HTTP errors (4xx/5xx),
// silent failures caught by post-condition checks, and errors reported from the
// browser. Separate from AuditLog (who did what) — this answers "what went
// wrong, where, and why".
const errorLogSchema = new mongoose.Schema({
  at: { type: Date, default: Date.now },

  // Short reference shown to the user and quoted in support ("ref A1B2C3D4").
  refId: { type: String, default: '', index: true },

  // Where the failure was observed.
  source: { type: String, enum: ['backend', 'frontend', 'canary'], default: 'backend', index: true },

  // What kind of failure. Human/expected vs code/server is derived from this.
  //  validation|auth|permission|conflict|payload|ratelimit|notfound|client  -> human/expected
  //  server|dependency|silent-failure|frontend|unknown                      -> code/server (our bug)
  category: { type: String, default: 'unknown', index: true },

  status: { type: Number, default: 0 },     // HTTP status, 0 for non-HTTP
  method: { type: String, default: '' },
  route: { type: String, default: '' },

  message: { type: String, default: '' },   // raw error message
  reason: { type: String, default: '' },    // human-readable reason / failed check
  stack: { type: String, default: '' },

  actorEmail: { type: String, default: '', index: true },
  userAgent: { type: String, default: '' },
  ip: { type: String, default: '' },

  context: { type: mongoose.Schema.Types.Mixed }, // input summary, ids, etc.
  resolved: { type: Boolean, default: false, index: true },
});

errorLogSchema.index({ at: -1 });
errorLogSchema.index({ category: 1, at: -1 });
errorLogSchema.index({ source: 1, at: -1 });
// Keep the collection bounded: entries self-expire after 30 days.
errorLogSchema.index({ at: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

module.exports = mongoose.model('ErrorLog', errorLogSchema);
