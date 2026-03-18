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
}, {
  timestamps: true,
});

module.exports = mongoose.model('CompatibilityMatrix', compatibilityMatrixSchema);
