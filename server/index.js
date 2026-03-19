require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const multer = require('multer');
const jwt = require('jsonwebtoken');

const Feature = require('./models/Feature');
const Category = require('./models/Category');
const CompatibilityMatrix = require('./models/CompatibilityMatrix');
const ProductConfig = require('./models/ProductConfig');
const CloudInfo = require('./models/CloudInfo');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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

mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('Connected to MongoDB Atlas');
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
  .catch(err => {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
  });

// --------------- Upload Config (Cloudinary or Local) ---------------

const assetsDir = path.join(__dirname, 'assets');
const screenshotsDir = path.join(assetsDir, 'screenshots');
[assetsDir, screenshotsDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});
app.use('/assets', express.static(assetsDir));

let upload;
const useCloudinary = process.env.CLOUDINARY_CLOUD_NAME
  && process.env.CLOUDINARY_API_KEY
  && process.env.CLOUDINARY_API_SECRET
  && process.env.CLOUDINARY_CLOUD_NAME !== 'your_cloud_name';

if (useCloudinary) {
  const { v2: cloudinary } = require('cloudinary');
  const { CloudinaryStorage } = require('multer-storage-cloudinary');

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });

  const cloudinaryStorage = new CloudinaryStorage({
    cloudinary,
    params: {
      folder: 'docproject-screenshots',
      allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
      resource_type: 'image',
    },
  });

  upload = multer({ storage: cloudinaryStorage });
  console.log('Using Cloudinary for image storage');
} else {
  const localStorage = multer.diskStorage({
    destination: screenshotsDir,
    filename: (req, file, cb) => {
      const featureName = req.body.featureName || '';
      const ext = path.extname(file.originalname) || '.png';
      if (featureName) {
        const safe = featureName.replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_');
        const idx = req.fileIndex = (req.fileIndex || 0) + 1;
        cb(null, `${safe}_screenshot_${idx}_${Date.now()}${ext}`);
      } else {
        const safeName = decodeURIComponent(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
        cb(null, `${Date.now()}-${safeName}`);
      }
    },
  });

  upload = multer({
    storage: localStorage,
    fileFilter: (req, file, cb) => {
      if (file.mimetype.startsWith('image/')) cb(null, true);
      else cb(new Error('Only image files allowed'));
    },
  });
  console.log('Using local disk for image storage (set CLOUDINARY_ env vars for cloud storage)');
}

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

    const features = await Feature.find(filter).sort({ order: 1, createdAt: -1 }).lean();

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
    const maxOrderDoc = await Feature.findOne({ productType: pt, scope, combination: combination || '' })
      .sort({ order: -1 }).lean();
    const nextOrder = maxOrderDoc ? (maxOrderDoc.order || 0) + 1 : 0;
    const feature = await Feature.create({
      productType: pt,
      scope,
      combination: combination || '',
      name,
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
    const docs = featureList
      .filter(f => (f.productType || f.categorySlug) && f.scope && f.name)
      .map(f => ({
        productType: f.productType || f.categorySlug,
        scope: f.scope,
        combination: f.combination || '',
        name: f.name,
        description: f.description || '',
        family: f.family || '',
        screenshots: f.screenshots || [],
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

app.post('/api/screenshots', upload.array('screenshots', 20), (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }
    const paths = req.files.map(f => {
      if (f.path && f.path.startsWith('http')) return f.path;
      return `/assets/screenshots/${f.filename}`;
    });
    res.json({ success: true, paths });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
    let slug = slugifyCloudInfo(name);
    const existing = await CloudInfo.findOne({ slug }).lean();
    if (existing) slug = slug + '-' + Date.now();
    const count = await CloudInfo.countDocuments();
    const item = await CloudInfo.create({ name, slug, content: content || '', order: count });
    res.json({ success: true, item: { ...item.toObject(), id: item._id.toString() } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/cloud-info/:id', async (req, res) => {
  try {
    const { name, content } = req.body;
    const update = {};
    if (name !== undefined) {
      update.name = name;
      update.slug = slugifyCloudInfo(name);
      const existing = await CloudInfo.findOne({ slug: update.slug, _id: { $ne: req.params.id } }).lean();
      if (existing) update.slug = update.slug + '-' + Date.now();
    }
    if (content !== undefined) update.content = content;
    const item = await CloudInfo.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true }).lean();
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, item: { ...item, id: item._id.toString() } });
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
    const [features, productConfigs, matrices, cloudInfos] = await Promise.all([
      Feature.find({ isDeleted: true }).sort({ deletedAt: -1 }).lean(),
      ProductConfig.find({ isDeleted: true }).sort({ deletedAt: -1 }).lean(),
      CompatibilityMatrix.find({ isDeleted: true }).select('name slug deletedAt').sort({ deletedAt: -1 }).lean(),
      CloudInfo.find({ isDeleted: true }).select('name slug deletedAt').sort({ deletedAt: -1 }).lean(),
    ]);
    res.json({
      features: features.map(f => ({ ...mapFeature(f), deletedAt: f.deletedAt })),
      productConfigs: productConfigs.map(c => ({ id: c._id.toString(), name: c.name, combinations: c.combinations, deletedAt: c.deletedAt })),
      matrices: matrices.map(m => ({ id: m._id.toString(), name: m.name, slug: m.slug, deletedAt: m.deletedAt })),
      cloudInfos: cloudInfos.map(i => ({ id: i._id.toString(), name: i.name, slug: i.slug, deletedAt: i.deletedAt })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/trash/restore/:type/:id', async (req, res) => {
  try {
    const { type, id } = req.params;
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
    let Model;
    if (type === 'feature') Model = Feature;
    else if (type === 'productConfig') Model = ProductConfig;
    else if (type === 'compatibility') Model = CompatibilityMatrix;
    else if (type === 'cloudInfo') Model = CloudInfo;
    else return res.status(400).json({ error: 'Invalid type' });

    const doc = await Model.findById(id);
    if (!doc) return res.status(404).json({ error: 'Not found' });
    if (!doc.isDeleted) return res.status(400).json({ error: 'Item is not in trash' });

    if (type === 'feature' && useCloudinary) {
      const { v2: cloudinary } = require('cloudinary');
      for (const url of (doc.screenshots || [])) {
        if (url.includes('cloudinary.com')) {
          const parts = url.split('/');
          const filenameWithExt = parts.pop();
          const folder = parts.pop();
          const publicId = `${folder}/${filenameWithExt.split('.')[0]}`;
          await cloudinary.uploader.destroy(publicId).catch(() => {});
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
