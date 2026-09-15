// One-time migration: sanitize HTML content already stored before sanitize-on-write
// was added. Idempotent — DOMPurify returns identical output for clean HTML, and we
// only write rows whose content actually changes, so re-running is a no-op.
//
//   node server/scripts/sanitize-legacy.js
//
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const mongoose = require('mongoose');
if (process.env.MONGODB_DNS_SERVERS) {
  require('dns').setServers(process.env.MONGODB_DNS_SERVERS.split(',').map(s => s.trim()).filter(Boolean));
}
const { sanitizeHtml } = require('../utils/sanitizeHtml');
const Document = require('../models/Document');
const CloudInfo = require('../models/CloudInfo');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  let scanned = 0, changed = 0;
  for (const Model of [Document, CloudInfo]) {
    const rows = await Model.find({ content: { $exists: true, $nin: ['', null] } }).select('_id name content');
    for (const r of rows) {
      scanned++;
      const clean = sanitizeHtml(r.content);
      if (clean !== r.content) {
        await Model.updateOne({ _id: r._id }, { $set: { content: clean } });
        changed++;
        console.log(`  sanitized ${Model.modelName} "${r.name}" (${r.content.length} -> ${clean.length} bytes)`);
      }
    }
  }
  console.log(`\nscanned ${scanned} record(s), sanitized ${changed}.`);
  await mongoose.disconnect();
})().catch(e => { console.error(e); process.exit(1); });
