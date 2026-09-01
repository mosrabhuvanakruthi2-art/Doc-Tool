const mongoose = require('mongoose');

// A permanent, append-only record of who did what, and when.
//
// Separate from Revision: a revision answers "how did this document change", an
// audit entry answers "who performed which action" — including actions that touch
// no document at all, such as a login or a denied access request.
const auditLogSchema = new mongoose.Schema({
  at: { type: Date, default: Date.now, index: true },

  // Dotted action name, e.g. auth.login, access_request.approved, content.updated.
  action: { type: String, required: true, index: true },
  // Coarse grouping used by the filter bar.
  category: {
    type: String,
    required: true,
    enum: ['auth', 'access', 'user', 'content', 'download', 'api', 'system'],
    index: true,
  },
  outcome: { type: String, enum: ['success', 'failure'], default: 'success', index: true },

  // Who did it. Kept as plain strings so the entry stays readable even if the user
  // is later renamed or deleted.
  actorEmail: { type: String, default: '', index: true },
  actorName: { type: String, default: '' },
  actorRole: { type: String, default: '' },

  // What it was done to.
  targetType: { type: String, default: '' },
  targetId: { type: String, default: '' },
  targetName: { type: String, default: '' },

  // One sentence answering "what happened", so the page is readable without
  // expanding anything.
  summary: { type: String, default: '' },
  // Anything else worth keeping: changed fields, counts, reasons.
  details: { type: mongoose.Schema.Types.Mixed },

  ip: { type: String, default: '' },
  userAgent: { type: String, default: '' },
});

// The page is almost always "newest first, optionally filtered".
auditLogSchema.index({ at: -1 });
auditLogSchema.index({ category: 1, at: -1 });
auditLogSchema.index({ actorEmail: 1, at: -1 });
auditLogSchema.index({ action: 1, at: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
