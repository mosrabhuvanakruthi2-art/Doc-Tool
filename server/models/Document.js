const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  content: { type: String, default: '' },
  fileUrl: { type: String, default: '' },
  fileType: { type: String, enum: ['pdf', 'xlsx', 'docx', 'manual', ''], default: '' },
  order: { type: Number, default: 0 },
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
}, {
  timestamps: true,
});

module.exports = mongoose.model('Document', documentSchema);
