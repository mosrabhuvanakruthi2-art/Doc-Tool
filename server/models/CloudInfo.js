const mongoose = require('mongoose');

const cloudInfoSchema = new mongoose.Schema({
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  content: { type: String, default: '' },
  order: { type: Number, default: 0 },
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
}, {
  timestamps: true,
});

module.exports = mongoose.model('CloudInfo', cloudInfoSchema);
