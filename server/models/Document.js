const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  content: { type: String, default: '' },
  fileUrl: { type: String, default: '' },
  // Any uploaded extension (pdf, docx, png, mp4, csv, …) or 'manual' for
  // rich-text documents. Kept as a short free-form string, lower-cased.
  fileType: { type: String, default: '', lowercase: true, trim: true, maxlength: 12 },
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

// Trash groups documents by the folder whose deletion swept them up.
documentSchema.index({ deletedWith: 1 });
// The tree lists a folder's live documents in order.
documentSchema.index({ folderId: 1, isDeleted: 1, order: 1 });
module.exports = mongoose.model('Document', documentSchema);
