const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  content: { type: String, default: '' },
  fileUrl: { type: String, default: '' },
  fileType: { type: String, enum: ['pdf', 'xlsx', 'docx', 'manual', ''], default: '' },
  // null = the document sits at the root of Documents, which is where every
  // document created before folders existed stays.
  folderId: { type: mongoose.Schema.Types.ObjectId, ref: 'DocumentFolder', default: null, index: true },
  order: { type: Number, default: 0 },
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
  // Set when the document went to the Trash because the folder holding it was
  // deleted, so it is restored together with that folder rather than on its own.
  deletedWith: { type: mongoose.Schema.Types.ObjectId, ref: 'DocumentFolder', default: null },
}, {
  timestamps: true,
});

module.exports = mongoose.model('Document', documentSchema);
