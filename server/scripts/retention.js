// Audit-log & revision retention.
//
//   AUDIT_RETENTION_DAYS=365 node server/scripts/retention.js
//
// Creates a TTL index on `auditlogs.at` so entries older than the retention
// window are removed automatically by MongoDB. REQUIRES an explicit
// AUDIT_RETENTION_DAYS value — it will not guess, because it deletes data.
//
// Revisions are NOT TTL-deleted: they power version history and may carry
// compliance value. Instead this script reports how many are older than the
// window so you can archive them to cold storage on your own schedule.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const mongoose = require('mongoose');
if (process.env.MONGODB_DNS_SERVERS) {
  require('dns').setServers(process.env.MONGODB_DNS_SERVERS.split(',').map(s => s.trim()).filter(Boolean));
}

const days = Number(process.env.AUDIT_RETENTION_DAYS);
if (!days || days < 1) {
  console.error('Set AUDIT_RETENTION_DAYS (e.g. 365) to apply the audit-log TTL. Aborting — nothing changed.');
  process.exit(1);
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const auditlogs = mongoose.connection.collection('auditlogs');

  // Drop an existing TTL index if the window changed, then (re)create it.
  const existing = await auditlogs.indexes();
  const ttl = existing.find(i => i.name === 'audit_ttl_at');
  if (ttl && ttl.expireAfterSeconds !== days * 86400) {
    await auditlogs.dropIndex('audit_ttl_at');
    console.log('dropped stale TTL index');
  }
  await auditlogs.createIndex({ at: 1 }, { name: 'audit_ttl_at', expireAfterSeconds: days * 86400 });
  console.log(`audit-log TTL set: entries older than ${days} days auto-expire.`);

  const cutoff = new Date(Date.now() - days * 86400 * 1000);
  const oldRevisions = await mongoose.connection.collection('revisions')
    .countDocuments({ changedAt: { $lt: cutoff } });
  console.log(`revisions older than ${days} days: ${oldRevisions} (archive these to cold storage; not auto-deleted).`);

  await mongoose.disconnect();
})().catch(e => { console.error(e); process.exit(1); });
