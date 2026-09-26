// One-time: make exactly one account the admin, and every other admin a viewer.
//
// Sign-in is Microsoft only and admin status comes solely from the database, so
// this is how the first admin is set (e.g. right after deploying). It previews by
// default and changes nothing until --apply is given. Safe to re-run.
//
//   node server/scripts/set-sole-admin.js you@cloudfuze.com            # preview
//   node server/scripts/set-sole-admin.js you@cloudfuze.com --apply    # do it
//
// In the production container (uses the container's own env / database):
//   docker compose exec server node scripts/set-sole-admin.js you@cloudfuze.com --apply
//
// If the account has never signed in, it is created as an admin; the person just
// signs in with Microsoft. Nothing else about any account (document grants,
// permissions, notifications) is touched.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const crypto = require('crypto');
const mongoose = require('mongoose');
if (process.env.MONGODB_DNS_SERVERS) {
  require('dns').setServers(process.env.MONGODB_DNS_SERVERS.split(',').map(s => s.trim()).filter(Boolean));
}
const User = require('../models/User');

const email = String(process.argv[2] || '').toLowerCase().trim();
const apply = process.argv.includes('--apply');

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Usage: node scripts/set-sole-admin.js <email> [--apply]');
  process.exit(1);
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const target = await User.findOne({ email });
  const others = await User.find({ role: 'admin', email: { $ne: email } }).select('email isActive').lean();

  console.log(`\nTarget admin: ${email}`);
  if (!target) console.log('  - account does not exist yet: it will be CREATED as an active admin');
  else if (target.role === 'admin' && target.isActive !== false) console.log('  - already an active admin: no change');
  else console.log(`  - currently role="${target.role}", active=${target.isActive !== false}: will become an ACTIVE ADMIN`);

  console.log(`\nOther admins to change to viewer: ${others.length}`);
  others.forEach((u) => console.log(`  - ${u.email}${u.isActive === false ? ' (deactivated)' : ''}`));

  if (!apply) {
    console.log('\nPreview only — nothing changed. Re-run with --apply to make these changes.\n');
    await mongoose.disconnect();
    return;
  }

  // Promote first, so there is never a moment with no admin at all.
  if (!target) {
    await User.create({
      email,
      role: 'admin',
      isActive: true,
      password: crypto.randomBytes(32).toString('hex'), // never used: Microsoft sign-in only
      notificationsSeenAt: new Date(),
    });
  } else if (target.role !== 'admin' || target.isActive === false) {
    await User.updateOne({ _id: target._id }, { $set: { role: 'admin', isActive: true } });
  }
  const demoted = others.length
    ? (await User.updateMany({ role: 'admin', email: { $ne: email } }, { $set: { role: 'viewer' } })).modifiedCount
    : 0;

  const admins = await User.find({ role: 'admin' }).select('email').lean();
  console.log(`\nDone. ${demoted} admin(s) changed to viewer.`);
  console.log(`Admins now: ${admins.map((a) => a.email).join(', ')}\n`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
