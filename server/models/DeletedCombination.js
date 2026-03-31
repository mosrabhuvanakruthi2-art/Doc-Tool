const mongoose = require('mongoose');

const deletedCombinationSchema = new mongoose.Schema({
  productConfigId: { type: String, required: true, index: true },
  productType: { type: String, required: true, index: true },
  combination: { type: String, required: true, index: true },
  comboIndex: { type: Number, default: -1 },
  featureIds: [{ type: String }],
  isDeleted: { type: Boolean, default: true },
  deletedAt: { type: Date, default: Date.now },
}, {
  timestamps: true,
});

module.exports = mongoose.model('DeletedCombination', deletedCombinationSchema);
