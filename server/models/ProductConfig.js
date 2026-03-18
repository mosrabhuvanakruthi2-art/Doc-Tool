const mongoose = require('mongoose');

const productConfigSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  combinations: [{ type: String }],
  featureListUrl: { type: String, default: '' },
  order: { type: Number, default: 0 },
}, {
  timestamps: true,
});

module.exports = mongoose.model('ProductConfig', productConfigSchema);
