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
  isActive: { type: Boolean, default: true },
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
