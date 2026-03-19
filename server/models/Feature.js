const mongoose = require('mongoose');

const featureSchema = new mongoose.Schema({
  productType: { type: String, required: true, index: true },
  scope: { type: String, required: true, index: true },
  combination: { type: String, default: '' },
  name: { type: String, required: true },
  description: { type: String, default: '' },
  family: { type: String, default: '' },
  screenshots: [{ type: String }],
  order: { type: Number, default: 0 },
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
}, {
  timestamps: true,
});

featureSchema.index({ productType: 1, scope: 1, combination: 1 });

module.exports = mongoose.model('Feature', featureSchema);
