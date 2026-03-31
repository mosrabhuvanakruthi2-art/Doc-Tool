require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const dns = require('dns');
const multer = require('multer');
const jwt = require('jsonwebtoken');

const Feature = require('./models/Feature');
const Category = require('./models/Category');
const CompatibilityMatrix = require('./models/CompatibilityMatrix');
const ProductConfig = require('./models/ProductConfig');
const CloudInfo = require('./models/CloudInfo');
const DeletedCombination = require('./models/DeletedCombination');

const app = express();
const PORT = process.env.PORT || 5000;
const API_BODY_LIMIT = process.env.API_BODY_LIMIT || '200mb';
const SCREENSHOT_UPLOAD_LIMIT = Number(process.env.SCREENSHOT_UPLOAD_LIMIT || 50);
const CLOUD_INFO_MAX_PAGES = Number(process.env.CLOUD_INFO_MAX_PAGES || 50);
const CLOUD_INFO_MAX_IMAGES = Number(process.env.CLOUD_INFO_MAX_IMAGES || 200);

app.use(cors());
app.use(express.json({ limit: API_BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: API_BODY_LIMIT }));

// --------------- Admin Auth ---------------

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const JWT_SECRET = process.env.JWT_SECRET;

app.post('/api/admin/login', (req, res) => {
  const { email, password } = req.body;
  if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    const token = jwt.sign({ email, role: 'admin' }, JWT_SECRET, { expiresIn: '8h' });
    return res.json({ success: true, token });
  }
  res.status(401).json({ error: 'Invalid email or password' });
});

app.get('/api/admin/verify', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
    res.json({ success: true, email: decoded.email });
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
});

// --------------- MongoDB Connection ---------------

const mongoConnectOpts = { serverSelectionTimeoutMS: 15000 };

function applyMongoDnsServers() {
  const raw = process.env.MONGODB_DNS_SERVERS;
  if (raw) {
    dns.setServers(raw.split(',').map((s) => s.trim()).filter(Boolean));
    return true;
  }
  return false;
}

function connectMongoOnce() {
  return mongoose.connect(process.env.MONGODB_URI, mongoConnectOpts);
}

if (process.env.MONGODB_DNS_SERVERS) {
  applyMongoDnsServers();
}

connectMongoOnce()
  .catch((err) => {
    const msg = String(err.message);
    const uri = process.env.MONGODB_URI || '';
    const isSrv = uri.startsWith('mongodb+srv://');
    const skipRetry = process.env.MONGODB_SKIP_PUBLIC_DNS_RETRY === '1';
    if (msg.includes('querySrv') && isSrv && !skipRetry && !process.env.MONGODB_DNS_SERVERS) {
      console.warn('SRV DNS failed on default resolver; retrying with 8.8.8.8 / 1.1.1.1…');
      dns.setServers(['8.8.8.8', '1.1.1.1']);
      return mongoose.disconnect().catch(() => {}).then(() => connectMongoOnce());
    }
    throw err;
  })
  .then(async () => {
    console.log('Connected to MongoDB');
    const count = await ProductConfig.countDocuments();
    if (count === 0) {
      const seed = [
        { name: 'Message', combinations: ['Slack to Teams','Slack to Chat','Slack to Slack','Teams to Teams','Teams to Chat','Chat to Teams','Chat to Chat'], featureListUrl: 'https://cloudfuzecom-my.sharepoint.com/:x:/g/personal/bhuvana_mosra_cloudfuze_com/IQBw8o6KU3A5TKl4fifiRa17AR-FGG1MzGW0pbeIDXI-GXM?e=yGrOId', order: 0 },
        { name: 'Mail', combinations: ['Outlook to Outlook','Gmail to Gmail','Outlook to Gmail','Gmail to Outlook'], featureListUrl: '', order: 1 },
        { name: 'Content', combinations: ['Shared Drive to Shared Drive','SPO to SPO','OneDrive to OneDrive','Shared Drive to SPO','SPO to Shared Drive','Shared Drive to OneDrive','OneDrive to Shared Drive','SPO to OneDrive','OneDrive to SPO'], featureListUrl: '', order: 2 },
      ];
      await ProductConfig.insertMany(seed);
      console.log('Seeded product configurations');
    }
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err.message);
    if (String(err.message).includes('querySrv')) {
      console.error(`
SRV DNS lookup failed (often blocked by corporate DNS, VPN, or firewall).

Fix options:
  • Set MONGODB_DNS_SERVERS=8.8.8.8,1.1.1.1 in server/.env before starting (uses public DNS for SRV).
  • Local MongoDB: docker compose up -d  then  MONGODB_URI=mongodb://127.0.0.1:27017/docproject
  • Atlas: use standard mongodb://… connection string instead of mongodb+srv://
`);
    }
    process.exit(1);
  });

// --------------- Upload Config (Cloudinary or Local) ---------------

const assetsDir = path.join("/var/www/doc360tool/client/dist/", 'assets');
const screenshotsDir = path.join(assetsDir, 'screenshots');
[assetsDir, screenshotsDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});
app.use('/assets', express.static(assetsDir));

let upload;

// --- Cloudinary storage (commented out — uncomment .env vars + this block to re-enable) ---
// const useCloudinary = process.env.CLOUDINARY_CLOUD_NAME
//   && process.env.CLOUDINARY_API_KEY
//   && process.env.CLOUDINARY_API_SECRET
//   && process.env.CLOUDINARY_CLOUD_NAME !== 'your_cloud_name';
//
// if (useCloudinary) {
//   const { v2: cloudinary } = require('cloudinary');
//   const { CloudinaryStorage } = require('multer-storage-cloudinary');
//
//   cloudinary.config({
//     cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
//     api_key: process.env.CLOUDINARY_API_KEY,
//     api_secret: process.env.CLOUDINARY_API_SECRET,
//   });
//
//   const cloudinaryStorage = new CloudinaryStorage({
//     cloudinary,
//     params: {
//       folder: 'docproject-screenshots',
//       allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
//       resource_type: 'image',
//     },
//   });
//
//   upload = multer({ storage: cloudinaryStorage });
//   console.log('Using Cloudinary for image storage');
// } else { ... }
// --- End Cloudinary block ---

const localStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const productType = (req.body.productType || 'general').replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_');
    const combination = (req.body.combination || 'general').replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_');
    const destDir = path.join(screenshotsDir, productType, combination);
    fs.mkdirSync(destDir, { recursive: true });
    cb(null, destDir);
  },
  filename: (req, file, cb) => {
    const featureName = req.body.featureName || 'screenshot';
    const safe = featureName.replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_');
    const ext = path.extname(file.originalname) || '.png';
    const idx = req.fileIndex = (req.fileIndex || 0) + 1;
    cb(null, `${safe}_${idx}_${Date.now()}${ext}`);
  },
});

upload = multer({
  storage: localStorage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files allowed'));
  },
});
console.log('Using local disk for image storage (organized by productType/combination)');

// --------------- Data Migration Helper ---------------

async function migrateLocalData() {
  const dataFile = path.join(assetsDir, 'data.json');
  if (!fs.existsSync(dataFile)) return;

  const existingCount = await Feature.countDocuments();
  if (existingCount > 0) {
    console.log(`MongoDB already has ${existingCount} features — skipping migration`);
    return;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));

    if (raw.categories && raw.categories.length > 0) {
      await Category.insertMany(raw.categories, { ordered: false }).catch(() => {});
      console.log(`Migrated ${raw.categories.length} categories`);
    }

    if (raw.features && raw.features.length > 0) {
      const docs = raw.features.map(f => ({
        productType: f.productType || f.categorySlug,
        scope: f.scope,
        combination: f.combination || '',
        name: f.name,
        description: f.description || '',
        family: f.family || '',
        screenshots: f.screenshots || [],
      }));
      await Feature.insertMany(docs);
      console.log(`Migrated ${docs.length} features`);
    }

    const backupPath = dataFile + '.bak';
    fs.renameSync(dataFile, backupPath);
    console.log(`Local data.json backed up to data.json.bak`);
  } catch (err) {
    console.error('Migration error:', err.message);
  }
}

mongoose.connection.once('open', () => {
  migrateLocalData();
});

// --------------- Categories ---------------

app.get('/api/categories', async (req, res) => {
  try {
    const categories = await Category.find().lean();
    const grouped = {};
    categories.forEach(cat => {
      if (!grouped[cat.group]) grouped[cat.group] = [];
      grouped[cat.group].push({ name: cat.name, slug: cat.slug });
    });
    res.json(grouped);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/categories', async (req, res) => {
  try {
    const { group, name, slug } = req.body;
    if (!group || !name || !slug) {
      return res.status(400).json({ error: 'group, name, and slug are required' });
    }
    await Category.findOneAndUpdate(
      { slug },
      { group, name, slug },
      { upsert: true, new: true }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --------------- Product Config ---------------

app.get('/api/product-config', async (req, res) => {
  try {
    const configs = await ProductConfig.find({ isDeleted: { $ne: true } }).sort({ order: 1 }).lean();
    res.json({
      productTypes: configs.map(c => c.name),
      combinationsByProduct: configs.reduce((acc, c) => { acc[c.name] = c.combinations; return acc; }, {}),
      featureListUrls: configs.reduce((acc, c) => { acc[c.name] = c.featureListUrl || ''; return acc; }, {}),
      configs: configs.map(c => ({ id: c._id.toString(), name: c.name, combinations: c.combinations, featureListUrl: c.featureListUrl || '', order: c.order })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/product-config', async (req, res) => {
  try {
    const { name, combinations, featureListUrl } = req.body;
    if (!name) return res.status(400).json({ error: 'Product type name is required' });
    const existing = await ProductConfig.findOne({ name }).lean();
    if (existing) return res.status(400).json({ error: 'Product type already exists' });
    const maxOrder = await ProductConfig.findOne().sort({ order: -1 }).lean();
    const order = maxOrder ? (maxOrder.order || 0) + 1 : 0;
    const config = await ProductConfig.create({ name, combinations: combinations || [], featureListUrl: featureListUrl || '', order });
    res.json({ success: true, config: { id: config._id.toString(), name: config.name, combinations: config.combinations, featureListUrl: config.featureListUrl, order: config.order } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/product-config/reorder', async (req, res) => {
  try {
    const { orderedIds } = req.body;
    if (!Array.isArray(orderedIds)) return res.status(400).json({ error: 'orderedIds array required' });
    const ops = orderedIds.map((id, idx) =>
      ProductConfig.findByIdAndUpdate(id, { order: idx })
    );
    await Promise.all(ops);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/product-config/:id', async (req, res) => {
  try {
    const { name, combinations, featureListUrl } = req.body;
    const update = {};
    if (name !== undefined) update.name = name;
    if (combinations !== undefined) update.combinations = combinations;
    if (featureListUrl !== undefined) update.featureListUrl = featureListUrl;
    const config = await ProductConfig.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true }).lean();
    if (!config) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, config: { id: config._id.toString(), name: config.name, combinations: config.combinations, featureListUrl: config.featureListUrl, order: config.order } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/product-config/:id/reorder-combinations', async (req, res) => {
  try {
    const { combinations } = req.body;
    if (!Array.isArray(combinations)) return res.status(400).json({ error: 'combinations array required' });
    const config = await ProductConfig.findById(req.params.id);
    if (!config) return res.status(404).json({ error: 'Not found' });
    config.combinations = combinations;
    await config.save();
    res.json({ success: true, config: { id: config._id.toString(), name: config.name, combinations: config.combinations } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/product-config/:id/combinations', async (req, res) => {
  try {
    const { combination } = req.body;
    if (!combination) return res.status(400).json({ error: 'Combination name is required' });
    const config = await ProductConfig.findById(req.params.id);
    if (!config) return res.status(404).json({ error: 'Not found' });
    if (config.combinations.includes(combination)) return res.status(400).json({ error: 'Combination already exists' });
    config.combinations.push(combination);
    await config.save();
    res.json({ success: true, config: { id: config._id.toString(), name: config.name, combinations: config.combinations } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/product-config/:id', async (req, res) => {
  try {
    const config = await ProductConfig.findByIdAndUpdate(req.params.id, { isDeleted: true, deletedAt: new Date() }, { new: true });
    if (!config) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/product-config/:id/combinations/:combo', async (req, res) => {
  try {
    const combo = decodeURIComponent(req.params.combo);
    const config = await ProductConfig.findById(req.params.id);
    if (!config) return res.status(404).json({ error: 'Not found' });
    config.combinations = config.combinations.filter(c => c !== combo);
    await config.save();
    res.json({ success: true, config: { id: config._id.toString(), name: config.name, combinations: config.combinations } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete(['/api/product-types/combination', '/product-types/combination'], async (req, res) => {
  try {
    const combination = resolveCombinationFromPayload(req.body);
    const productType = normalizeCombinationName(req.body.productType);
    if (!combination) {
      return res.status(400).json({ error: 'Provide combination or source/destination.' });
    }

    const configFilter = { isDeleted: { $ne: true }, combinations: combination };
    if (productType) configFilter.name = productType;
    const configs = await ProductConfig.find(configFilter);
    if (!configs.length) return res.status(404).json({ error: 'Combination not found.' });

    const now = new Date();
    let deletedFeatures = 0;
    const trashDocs = [];

    for (const config of configs) {
      const comboIndex = config.combinations.findIndex((c) => c === combination);
      const features = await Feature.find({
        productType: config.name,
        combination,
        isDeleted: { $ne: true },
      }).select('_id').lean();
      const featureIds = features.map((f) => f._id.toString());

      if (featureIds.length > 0) {
        const result = await Feature.updateMany(
          { _id: { $in: featureIds } },
          { isDeleted: true, deletedAt: now },
        );
        deletedFeatures += result.modifiedCount;
      }

      config.combinations = config.combinations.filter((c) => c !== combination);
      await config.save();

      trashDocs.push({
        productConfigId: config._id.toString(),
        productType: config.name,
        combination,
        comboIndex,
        featureIds,
        isDeleted: true,
        deletedAt: now,
      });
    }

    if (trashDocs.length > 0) {
      await DeletedCombination.insertMany(trashDocs);
    }

    res.json({
      success: true,
      combination,
      productTypesAffected: configs.length,
      deletedFeatures,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put(['/api/product-types/combination/rename', '/product-types/combination/rename'], async (req, res) => {
  try {
    const oldName = normalizeCombinationName(req.body.oldName);
    const newName = normalizeCombinationName(req.body.newName);
    const productType = normalizeCombinationName(req.body.productType);
    if (!oldName || !newName) {
      return res.status(400).json({ error: 'oldName and newName are required.' });
    }
    if (oldName.toLowerCase() === newName.toLowerCase()) {
      return res.status(400).json({ error: 'New combination name must be different.' });
    }

    const configFilter = { isDeleted: { $ne: true }, combinations: oldName };
    if (productType) configFilter.name = productType;
    const configs = await ProductConfig.find(configFilter);
    if (!configs.length) return res.status(404).json({ error: 'Combination not found.' });

    for (const config of configs) {
      const duplicate = config.combinations.some((c) => c.toLowerCase() === newName.toLowerCase() && c !== oldName);
      if (duplicate) {
        return res.status(400).json({ error: `"${newName}" already exists under ${config.name}.` });
      }
    }

    for (const config of configs) {
      config.combinations = config.combinations.map((c) => (c === oldName ? newName : c));
      await config.save();
      await Feature.updateMany(
        { productType: config.name, combination: oldName },
        { combination: newName },
      );
      await DeletedCombination.updateMany(
        { productType: config.name, combination: oldName, isDeleted: true },
        { combination: newName },
      );
    }

    res.json({ success: true, oldName, newName, productTypesAffected: configs.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/features/by-scope', async (req, res) => {
  try {
    const { productType, scope, combination } = req.query;
    if (!productType || !scope) return res.status(400).json({ error: 'productType and scope are required' });
    const filter = { productType, scope, isDeleted: { $ne: true } };
    if (combination) filter.combination = combination;
    const result = await Feature.updateMany(filter, { isDeleted: true, deletedAt: new Date() });
    res.json({ success: true, deletedCount: result.modifiedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --------------- Features ---------------

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeCombinationName(raw) {
  return String(raw || '').trim().replace(/\s+/g, ' ');
}

function resolveCombinationFromPayload(payload = {}) {
  if (payload.combination) {
    return normalizeCombinationName(payload.combination);
  }
  const source = normalizeCombinationName(payload.source);
  const destination = normalizeCombinationName(payload.destination);
  if (source && destination) return `${source} to ${destination}`;
  return '';
}

function estimateCloudInfoPageCount(html = '', text = '') {
  const pageBreakMatches = html.match(/page-break-(before|after)\s*:\s*always/gi) || [];
  const hardPageBreaks = html.match(/<br[^>]*style="[^"]*page-break/gi) || [];
  const explicitPages = Math.max(pageBreakMatches.length, hardPageBreaks.length) + 1;
  const textPages = Math.max(1, Math.ceil(String(text || '').length / 3200));
  return Math.max(explicitPages, textPages);
}

function getCloudInfoContentStats(content = '') {
  const html = String(content || '');
  const imageCount = (html.match(/<img\b/gi) || []).length;
  const plainText = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const pageCount = estimateCloudInfoPageCount(html, plainText);
  return { imageCount, pageCount };
}

function validateCloudInfoContent(content = '') {
  const stats = getCloudInfoContentStats(content);
  if (stats.pageCount > CLOUD_INFO_MAX_PAGES) {
    return {
      ok: false,
      message: `Document has ${stats.pageCount} pages. Maximum allowed is ${CLOUD_INFO_MAX_PAGES}.`,
      stats,
    };
  }
  if (stats.imageCount > CLOUD_INFO_MAX_IMAGES) {
    return {
      ok: false,
      message: `Document has ${stats.imageCount} images. Maximum allowed is ${CLOUD_INFO_MAX_IMAGES}.`,
      stats,
    };
  }
  return { ok: true, stats };
}

function mapFeature(f) {
  return {
    id: f._id.toString(),
    productType: f.productType,
    categorySlug: f.productType,
    scope: f.scope,
    combination: f.combination,
    name: f.name,
    description: f.description,
    family: f.family,
    screenshots: f.screenshots,
    order: f.order || 0,
    createdAt: f.createdAt,
  };
}

app.get('/api/features', async (req, res) => {
  try {
    const { category, productType, scope, combination, search, tag } = req.query;
    const filter = { isDeleted: { $ne: true } };

    const pt = productType || category;
    if (pt) filter.productType = pt;
    if (scope) filter.scope = scope;
    if (combination) filter.combination = combination;

    if (search) {
      const regex = new RegExp(search, 'i');
      filter.$or = [{ name: regex }, { description: regex }];
    }

    if (tag && tag !== 'All') {
      filter.family = tag;
    }

    const features = await Feature.find(filter).sort({ order: 1, createdAt: 1 }).lean();

    const tagFilter = { isDeleted: { $ne: true } };
    if (pt) tagFilter.productType = pt;
    if (scope) tagFilter.scope = scope;
    if (combination) tagFilter.combination = combination;
    const allFeatures = await Feature.find(tagFilter).select('family').lean();
    const allTags = new Set();
    allFeatures.forEach(f => { if (f.family) allTags.add(f.family); });

    res.json({
      features: features.map(mapFeature),
      tags: ['All', ...Array.from(allTags).sort()],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/features', async (req, res) => {
  try {
    const { categorySlug, productType, scope, combination, name, description, family, screenshots } = req.body;
    const pt = productType || categorySlug;
    if (!pt || !scope || !name) {
      return res.status(400).json({ error: 'productType, scope, and name are required' });
    }
    const nameTrimmed = String(name).trim();
    const dup = await Feature.findOne({
      productType: pt,
      scope,
      combination: combination || '',
      isDeleted: { $ne: true },
      name: new RegExp(`^${escapeRegex(nameTrimmed)}$`, 'i'),
    }).lean();
    if (dup) {
      return res.status(400).json({ error: 'A feature with this name already exists. Enter a different name.' });
    }

    const maxOrderDoc = await Feature.findOne({ productType: pt, scope, combination: combination || '' })
      .sort({ order: -1 }).lean();
    const nextOrder = maxOrderDoc ? (maxOrderDoc.order || 0) + 1 : 0;
    const feature = await Feature.create({
      productType: pt,
      scope,
      combination: combination || '',
      name: nameTrimmed,
      description: description || '',
      family: family || '',
      screenshots: screenshots || [],
      order: nextOrder,
    });
    res.json({ success: true, feature: mapFeature(feature.toObject()) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/features/bulk', async (req, res) => {
  try {
    const { features: featureList } = req.body;
    if (!Array.isArray(featureList) || featureList.length === 0) {
      return res.status(400).json({ error: 'features array is required' });
    }
    const filtered = featureList
      .filter(f => (f.productType || f.categorySlug) && f.scope && String(f.name || '').trim())
      .map(f => ({
        productType: f.productType || f.categorySlug,
        scope: f.scope,
        combination: f.combination || '',
        name: String(f.name).trim(),
        description: f.description || '',
        family: f.family || '',
        screenshots: f.screenshots || [],
      }));

    if (filtered.length === 0) {
      return res.status(400).json({ error: 'No valid features to save (each needs product type, scope, and name).' });
    }

    const first = filtered[0];
    for (const f of filtered) {
      if (f.productType !== first.productType || f.scope !== first.scope || f.combination !== first.combination) {
        return res.status(400).json({ error: 'All features in one save must use the same product type, scope, and combination.' });
      }
    }

    const seenLower = new Set();
    for (const f of filtered) {
      const nl = f.name.toLowerCase();
      if (seenLower.has(nl)) {
        return res.status(400).json({ error: 'A feature with this name already exists. Enter a different name.' });
      }
      seenLower.add(nl);
    }

    const comb = first.combination || '';
    const existingDocs = await Feature.find({
      productType: first.productType,
      scope: first.scope,
      combination: comb,
      isDeleted: { $ne: true },
    }).select('name').lean();

    const existingLower = new Set(existingDocs.map((d) => String(d.name || '').trim().toLowerCase()).filter(Boolean));
    for (const f of filtered) {
      if (existingLower.has(f.name.toLowerCase())) {
        return res.status(400).json({ error: 'A feature with this name already exists. Enter a different name.' });
      }
    }

    const maxOrderDoc = await Feature.findOne({
      productType: first.productType,
      scope: first.scope,
      combination: comb,
    }).sort({ order: -1 }).lean();
    let nextOrder = maxOrderDoc != null ? (maxOrderDoc.order ?? 0) + 1 : 0;

    const docs = filtered.map((f) => ({
      ...f,
      order: nextOrder++,
    }));

    const saved = await Feature.insertMany(docs);
    const mapped = saved.map(f => mapFeature(f.toObject()));
    res.json({ success: true, features: mapped, count: mapped.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/features/rename-family', async (req, res) => {
  try {
    const { productType, scope, combination, oldFamily, newFamily } = req.body;
    if (!productType || !scope || !oldFamily || !newFamily) {
      return res.status(400).json({ error: 'productType, scope, oldFamily, and newFamily are required' });
    }
    const filter = { productType, scope, family: oldFamily };
    if (combination) filter.combination = combination;
    const result = await Feature.updateMany(filter, { family: newFamily });
    res.json({ success: true, modified: result.modifiedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/features/reorder', async (req, res) => {
  try {
    const { orderedIds } = req.body;
    if (!Array.isArray(orderedIds)) {
      return res.status(400).json({ error: 'orderedIds array is required' });
    }
    const ops = orderedIds.map((id, index) => ({
      updateOne: {
        filter: { _id: id },
        update: { order: index },
      },
    }));
    await Feature.bulkWrite(ops);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/features/:id', async (req, res) => {
  try {
    const feature = await Feature.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).lean();
    if (!feature) return res.status(404).json({ error: 'Feature not found' });
    res.json({ success: true, feature: mapFeature(feature) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/features/:id', async (req, res) => {
  try {
    const feature = await Feature.findByIdAndUpdate(req.params.id, { isDeleted: true, deletedAt: new Date() }, { new: true });
    if (!feature) return res.status(404).json({ error: 'Feature not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --------------- Screenshot Upload ---------------

app.post('/api/screenshots', (req, res) => {
  upload.array('screenshots', SCREENSHOT_UPLOAD_LIMIT)(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({
          error: `You can upload up to ${SCREENSHOT_UPLOAD_LIMIT} screenshots at once.`,
        });
      }
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }

    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded' });
      }
      const paths = req.files.map(f => {
        // --- Cloudinary path (commented out) ---
        // if (f.path && f.path.startsWith('http')) return f.path;
        // return `/assets/screenshots/${f.filename}`;
        // --- End Cloudinary path ---
        const relativePath = path.relative(assetsDir, f.path).replace(/\\/g, '/');
        return `/assets/${relativePath}`;
      });
      res.json({ success: true, paths });
    } catch (innerErr) {
      res.status(500).json({ error: innerErr.message });
    }
  });
});

// --------------- Compatibility Matrix ---------------

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

app.get('/api/compatibility', async (req, res) => {
  try {
    const matrices = await CompatibilityMatrix.find({ isDeleted: { $ne: true } })
      .select('name slug order')
      .sort({ order: 1, createdAt: 1 })
      .lean();
    res.json({ matrices });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/compatibility/:slug', async (req, res) => {
  try {
    const matrix = await CompatibilityMatrix.findOne({ slug: req.params.slug, isDeleted: { $ne: true } }).lean();
    if (!matrix) return res.status(404).json({ error: 'Matrix not found' });
    res.json({ matrix: { ...matrix, id: matrix._id.toString() } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/compatibility', async (req, res) => {
  try {
    const { name, columns, rows, notes } = req.body;
    if (!name || !columns || !rows) {
      return res.status(400).json({ error: 'name, columns, and rows are required' });
    }
    let slug = slugify(name);
    const existing = await CompatibilityMatrix.findOne({ slug }).lean();
    if (existing) slug = slug + '-' + Date.now();
    const maxOrder = await CompatibilityMatrix.findOne().sort({ order: -1 }).lean();
    const order = maxOrder ? (maxOrder.order || 0) + 1 : 0;
    const matrix = await CompatibilityMatrix.create({ name, slug, columns, rows, notes: notes || '', order });
    res.json({ success: true, matrix: { ...matrix.toObject(), id: matrix._id.toString() } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Must be registered before PUT /api/compatibility/:id so "reorder" is not captured as an id.
app.put('/api/compatibility/reorder', async (req, res) => {
  try {
    const { orderedIds } = req.body;
    if (!Array.isArray(orderedIds)) return res.status(400).json({ error: 'orderedIds array required' });
    const ops = orderedIds.map((id, idx) => ({
      updateOne: { filter: { _id: id }, update: { $set: { order: idx } } }
    }));
    await CompatibilityMatrix.bulkWrite(ops);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/compatibility/:id', async (req, res) => {
  try {
    const { name, columns, rows, notes } = req.body;
    const update = {};
    if (name !== undefined) {
      update.name = name;
      update.slug = slugify(name);
      const existing = await CompatibilityMatrix.findOne({ slug: update.slug, _id: { $ne: req.params.id } }).lean();
      if (existing) update.slug = update.slug + '-' + Date.now();
    }
    if (columns !== undefined) update.columns = columns;
    if (rows !== undefined) update.rows = rows;
    if (notes !== undefined) update.notes = notes;
    const matrix = await CompatibilityMatrix.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true }).lean();
    if (!matrix) return res.status(404).json({ error: 'Matrix not found' });
    res.json({ success: true, matrix: { ...matrix, id: matrix._id.toString() } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/compatibility/:id', async (req, res) => {
  try {
    const matrix = await CompatibilityMatrix.findByIdAndUpdate(req.params.id, { isDeleted: true, deletedAt: new Date() }, { new: true });
    if (!matrix) return res.status(404).json({ error: 'Matrix not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --------------- Cloud Info ---------------

function slugifyCloudInfo(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

app.get('/api/cloud-info', async (req, res) => {
  try {
    const items = await CloudInfo.find({ isDeleted: { $ne: true } }).sort({ order: 1, createdAt: 1 }).lean();
    res.json({ items: items.map(i => ({ ...i, id: i._id.toString() })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/cloud-info/:slug', async (req, res) => {
  try {
    const item = await CloudInfo.findOne({ slug: req.params.slug, isDeleted: { $ne: true } }).lean();
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json({ item: { ...item, id: item._id.toString() } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/cloud-info', async (req, res) => {
  try {
    const { name, content } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const validation = validateCloudInfoContent(content || '');
    if (!validation.ok) {
      return res.status(400).json({ error: validation.message, stats: validation.stats });
    }
    let slug = slugifyCloudInfo(name);
    const existing = await CloudInfo.findOne({ slug }).lean();
    if (existing) slug = slug + '-' + Date.now();
    const count = await CloudInfo.countDocuments();
    const item = await CloudInfo.create({ name, slug, content: content || '', order: count });
    res.json({
      success: true,
      item: { ...item.toObject(), id: item._id.toString() },
      stats: validation.stats,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/cloud-info/:id', async (req, res) => {
  try {
    const { name, content } = req.body;
    const update = {};
    let contentStats = null;
    if (name !== undefined) {
      update.name = name;
      update.slug = slugifyCloudInfo(name);
      const existing = await CloudInfo.findOne({ slug: update.slug, _id: { $ne: req.params.id } }).lean();
      if (existing) update.slug = update.slug + '-' + Date.now();
    }
    if (content !== undefined) {
      const validation = validateCloudInfoContent(content || '');
      if (!validation.ok) {
        return res.status(400).json({ error: validation.message, stats: validation.stats });
      }
      update.content = content;
      contentStats = validation.stats;
    }
    const item = await CloudInfo.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true }).lean();
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json({
      success: true,
      item: { ...item, id: item._id.toString() },
      stats: contentStats || getCloudInfoContentStats(item.content || ''),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/cloud-info/:id', async (req, res) => {
  try {
    const item = await CloudInfo.findByIdAndUpdate(req.params.id, { isDeleted: true, deletedAt: new Date() }, { new: true });
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/cloud-info-reorder', async (req, res) => {
  try {
    const { orderedIds } = req.body;
    if (!Array.isArray(orderedIds)) return res.status(400).json({ error: 'orderedIds array required' });
    const ops = orderedIds.map((id, idx) => ({
      updateOne: { filter: { _id: id }, update: { $set: { order: idx } } }
    }));
    await CloudInfo.bulkWrite(ops);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --------------- Trash Management ---------------

app.get('/api/trash', async (req, res) => {
  try {
    const [features, productConfigs, matrices, cloudInfos, deletedCombinations] = await Promise.all([
      Feature.find({ isDeleted: true }).sort({ deletedAt: -1 }).lean(),
      ProductConfig.find({ isDeleted: true }).sort({ deletedAt: -1 }).lean(),
      CompatibilityMatrix.find({ isDeleted: true }).select('name slug deletedAt').sort({ deletedAt: -1 }).lean(),
      CloudInfo.find({ isDeleted: true }).select('name slug deletedAt').sort({ deletedAt: -1 }).lean(),
      DeletedCombination.find({ isDeleted: true }).sort({ deletedAt: -1 }).lean(),
    ]);
    res.json({
      features: features.map(f => ({ ...mapFeature(f), deletedAt: f.deletedAt })),
      productConfigs: productConfigs.map(c => ({ id: c._id.toString(), name: c.name, combinations: c.combinations, deletedAt: c.deletedAt })),
      matrices: matrices.map(m => ({ id: m._id.toString(), name: m.name, slug: m.slug, deletedAt: m.deletedAt })),
      cloudInfos: cloudInfos.map(i => ({ id: i._id.toString(), name: i.name, slug: i.slug, deletedAt: i.deletedAt })),
      combinations: deletedCombinations.map((c) => ({
        id: c._id.toString(),
        productType: c.productType,
        combination: c.combination,
        featureIds: c.featureIds || [],
        deletedAt: c.deletedAt,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/trash/restore/:type/:id', async (req, res) => {
  try {
    const { type, id } = req.params;
    if (type === 'combination') {
      const comboTrash = await DeletedCombination.findById(id);
      if (!comboTrash) return res.status(404).json({ error: 'Not found' });
      if (!comboTrash.isDeleted) return res.status(400).json({ error: 'Item is not in trash' });

      const config = await ProductConfig.findById(comboTrash.productConfigId);
      if (!config) return res.status(404).json({ error: 'Parent product type not found' });
      if (!config.combinations.includes(comboTrash.combination)) {
        const idx = Number.isInteger(comboTrash.comboIndex) ? comboTrash.comboIndex : -1;
        if (idx >= 0 && idx <= config.combinations.length) {
          config.combinations.splice(idx, 0, comboTrash.combination);
        } else {
          config.combinations.push(comboTrash.combination);
        }
        await config.save();
      }

      if (Array.isArray(comboTrash.featureIds) && comboTrash.featureIds.length > 0) {
        await Feature.updateMany(
          { _id: { $in: comboTrash.featureIds } },
          { isDeleted: false, deletedAt: null },
        );
      }

      comboTrash.isDeleted = false;
      comboTrash.deletedAt = null;
      await comboTrash.save();
      return res.json({ success: true });
    }

    let Model;
    if (type === 'feature') Model = Feature;
    else if (type === 'productConfig') Model = ProductConfig;
    else if (type === 'compatibility') Model = CompatibilityMatrix;
    else if (type === 'cloudInfo') Model = CloudInfo;
    else return res.status(400).json({ error: 'Invalid type' });

    const doc = await Model.findByIdAndUpdate(id, { isDeleted: false, deletedAt: null }, { new: true });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/trash/permanent/:type/:id', async (req, res) => {
  try {
    const { type, id } = req.params;
    if (type === 'combination') {
      const doc = await DeletedCombination.findById(id);
      if (!doc) return res.status(404).json({ error: 'Not found' });
      if (!doc.isDeleted) return res.status(400).json({ error: 'Item is not in trash' });
      await DeletedCombination.findByIdAndDelete(id);
      return res.json({ success: true });
    }

    let Model;
    if (type === 'feature') Model = Feature;
    else if (type === 'productConfig') Model = ProductConfig;
    else if (type === 'compatibility') Model = CompatibilityMatrix;
    else if (type === 'cloudInfo') Model = CloudInfo;
    else return res.status(400).json({ error: 'Invalid type' });

    const doc = await Model.findById(id);
    if (!doc) return res.status(404).json({ error: 'Not found' });
    if (!doc.isDeleted) return res.status(400).json({ error: 'Item is not in trash' });

    // --- Cloudinary cleanup (commented out — uncomment to re-enable with Cloudinary) ---
    // if (type === 'feature' && useCloudinary) {
    //   const { v2: cloudinary } = require('cloudinary');
    //   for (const url of (doc.screenshots || [])) {
    //     if (url.includes('cloudinary.com')) {
    //       const parts = url.split('/');
    //       const filenameWithExt = parts.pop();
    //       const folder = parts.pop();
    //       const publicId = `${folder}/${filenameWithExt.split('.')[0]}`;
    //       await cloudinary.uploader.destroy(publicId).catch(() => {});
    //     }
    //   }
    // }
    // --- End Cloudinary cleanup ---

    if (type === 'feature') {
      for (const screenshotPath of (doc.screenshots || [])) {
        if (screenshotPath.startsWith('/assets/')) {
          const filePath = path.join(__dirname, screenshotPath.replace('/assets/', 'assets/'));
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        }
      }
    }

    await Model.findByIdAndDelete(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --------------- Image Proxy (for DOCX export) ---------------

app.get('/api/image-proxy', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send('Missing url param');
  try {
    const response = await fetch(url);
    if (!response.ok) return res.status(response.status).send('Failed to fetch image');
    const contentType = response.headers.get('content-type') || 'image/png';
    res.set('Content-Type', contentType);
    const buffer = Buffer.from(await response.arrayBuffer());
    res.send(buffer);
  } catch (err) {
    res.status(500).send('Proxy error: ' + err.message);
  }
});

// --------------- Start Server ---------------

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
