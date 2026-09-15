const mongoose = require('mongoose');

const rowSchema = new mongoose.Schema({
  feature: { type: String, required: true },
  values: [{ type: String }],
  description: { type: String, default: '' },
}, { _id: false });

const compatibilityMatrixSchema = new mongoose.Schema({
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  columns: [{ type: String }],
  rows: [rowSchema],
  notes: { type: String, default: '' },
  order: { type: Number, default: 0 },
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
}, {
  timestamps: true,
});

compatibilityMatrixSchema.index({ isDeleted: 1, order: 1 });

module.exports = mongoose.model('CompatibilityMatrix', compatibilityMatrixSchema);
