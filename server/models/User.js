const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  name: { type: String, default: '' },
  role: { type: String, enum: ['admin', 'viewer'], default: 'viewer' },
  permissions: {
    productTypes: { type: Boolean, default: true },
    compatibility: { type: Boolean, default: true },
    cloudInfo: { type: Boolean, default: true },
    documents: { type: Boolean, default: true },
  },
  // Access is granted per document. Folder grants remain as a shortcut: they
  // cover every document in that folder and below it, including ones added
  // later, which saves approving a long list one row at a time.
  documentAccess: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Document' }],
    default: [],
  },
  documentFolders: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'DocumentFolder' }],
    default: [],
  },
  isActive: { type: Boolean, default: true },
  // Everything changed after this instant counts as unread. Set to the moment of
  // creation for new accounts, so nobody starts with a backlog of old edits.
  // "Mark all as read" moves it forward.
  notificationsSeenAt: { type: Date, default: null },
  // Individually dismissed notifications, so opening one clears just that one.
  notificationReads: {
    type: [new mongoose.Schema({ key: String, at: Date }, { _id: false })],
    default: [],
  },
}, {
  timestamps: true,
});

userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 10);
});

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('User', userSchema);
