const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  email:       { type: String, required: true, lowercase: true, trim: true },
  name:        { type: String, default: '' },
  status:      { type: String, enum: ['pending', 'approved', 'denied', 'revoked'], default: 'pending' },
  requestedAt: { type: Date, default: Date.now },
  respondedAt: { type: Date },
});

module.exports = mongoose.model('AccessRequest', schema);
