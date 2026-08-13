const mongoose = require('mongoose');

// One recorded change to a single content record.
//
// Deliberately stores a *computed* diff rather than before/after snapshots:
// cloud-info content runs to several MB of inline base64 images, so a pair of
// raw copies would blow past the 16 MB BSON document limit. Large fields are
// reduced to added/removed blocks with images represented by a hash and a byte
// count; only small fields keep their literal before/after values.
const changeSchema = new mongoose.Schema({
  field: { type: String, required: true },
  label: { type: String, default: '' },
  // text | longtext | html | images | list | rows | number
  kind: { type: String, required: true },
  before: { type: mongoose.Schema.Types.Mixed },
  after: { type: mongoose.Schema.Types.Mixed },
  added: { type: [mongoose.Schema.Types.Mixed], default: undefined },
  removed: { type: [mongoose.Schema.Types.Mixed], default: undefined },
  changed: { type: [mongoose.Schema.Types.Mixed], default: undefined },
  renamed: { type: [mongoose.Schema.Types.Mixed], default: undefined },
  summary: { type: String, default: '' },
  truncated: { type: Boolean, default: false },
}, { _id: false });

const revisionSchema = new mongoose.Schema({
  entityType: {
    type: String,
    required: true,
    enum: ['feature', 'compatibility', 'cloudInfo', 'document', 'productConfig'],
    index: true,
  },
  entityId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  entityName: { type: String, default: '' },
  action: { type: String, enum: ['created', 'updated', 'deleted', 'restored'], default: 'updated' },
  changedAt: { type: Date, default: Date.now, index: true },
  changes: { type: [changeSchema], default: [] },
});

revisionSchema.index({ entityType: 1, entityId: 1, changedAt: -1 });

module.exports = mongoose.model('Revision', revisionSchema);
