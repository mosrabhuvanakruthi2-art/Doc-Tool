const mongoose = require('mongoose');

// A folder in the Documents tree.
//
// Nesting is expressed with a parent pointer rather than a materialised path:
// the whole tree is small enough to fetch flat and assemble in memory, and a
// rename or a move then touches exactly one record instead of every descendant.
// `parentId: null` means the folder sits at the root of Documents.
const documentFolderSchema = new mongoose.Schema({
  name: { type: String, required: true },
  slug: { type: String, required: true },
  parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'DocumentFolder', default: null, index: true },
  order: { type: Number, default: 0 },
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
  // Set when this folder went to the Trash as part of deleting a folder above
  // it. The Trash lists only the folder that was actually deleted, and restoring
  // that folder brings its whole subtree back with it.
  deletedWith: { type: mongoose.Schema.Types.ObjectId, ref: 'DocumentFolder', default: null },
}, {
  timestamps: true,
});

documentFolderSchema.index({ parentId: 1, order: 1 });

module.exports = mongoose.model('DocumentFolder', documentFolderSchema);
