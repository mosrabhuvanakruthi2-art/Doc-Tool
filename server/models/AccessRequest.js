const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  email:       { type: String, required: true, lowercase: true, trim: true },
  name:        { type: String, default: '' },
  // What is being asked for. A document request is the normal case; a folder
  // request grants everything inside it; both null means the request predates
  // per-item access and covers the Documents section as a whole.
  documentId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Document', default: null },
  documentName:{ type: String, default: '' },
  folderId:    { type: mongoose.Schema.Types.ObjectId, ref: 'DocumentFolder', default: null },
  // Names are kept alongside the ids so a decided request still reads correctly
  // after the document or folder is renamed or removed.
  folderName:  { type: String, default: '' },
  status:      { type: String, enum: ['pending', 'approved', 'denied', 'revoked'], default: 'pending' },
  requestedAt: { type: Date, default: Date.now },
  respondedAt: { type: Date },
});

module.exports = mongoose.model('AccessRequest', schema);
