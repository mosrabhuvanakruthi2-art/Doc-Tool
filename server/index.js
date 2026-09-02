require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
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
const User = require('./models/User');
const DocModel = require('./models/Document');
const AccessRequest = require('./models/AccessRequest');
const Revision = require('./models/Revision');
const AuditLog = require('./models/AuditLog');
const { buildChanges, buildInitialChanges } = require('./utils/revisionDiff');
const { buildFieldChains } = require('./utils/revisionHistory');
const { buildFeatureTableDocx } = require('./utils/featureDocx');

const app = express();
const PORT = process.env.PORT || 5000;
const API_BODY_LIMIT = process.env.API_BODY_LIMIT || '200mb';
const SCREENSHOT_UPLOAD_LIMIT = Number(process.env.SCREENSHOT_UPLOAD_LIMIT || 50);
const CLOUD_INFO_MAX_PAGES = Number(process.env.CLOUD_INFO_MAX_PAGES || 50);
const CLOUD_INFO_MAX_IMAGES = Number(process.env.CLOUD_INFO_MAX_IMAGES || 200);

app.use(cors());
app.use(express.json({ limit: API_BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: API_BODY_LIMIT }));

// --------------- Auth ---------------

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const JWT_SECRET = process.env.JWT_SECRET;

const FULL_PERMISSIONS = { productTypes: true, compatibility: true, cloudInfo: true, documents: true };

function decodeToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  try { return jwt.verify(authHeader.split(' ')[1], JWT_SECRET); } catch { return null; }
}

function requireAdmin(req, res, next) {
  const decoded = decodeToken(req);
  if (!decoded || decoded.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  req.user = decoded;
  next();
}

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    if (email.toLowerCase().trim() === ADMIN_EMAIL?.toLowerCase().trim() && password === ADMIN_PASSWORD) {
      const payload = { email: ADMIN_EMAIL, role: 'admin', permissions: FULL_PERMISSIONS };
      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
      await audit(req, {
        action: 'auth.login', category: 'auth',
        actorEmail: ADMIN_EMAIL, actorName: 'Admin', actorRole: 'admin',
        summary: `${ADMIN_EMAIL} signed in (password, environment admin)`,
        details: { method: 'password', via: 'env-admin' },
      });
      return res.json({ success: true, token, user: { email: ADMIN_EMAIL, name: 'Admin', role: 'admin', permissions: FULL_PERMISSIONS } });
    }

    const attempted = String(email).toLowerCase().trim();
    const user = await User.findOne({ email: attempted });
    if (!user) {
      await audit(req, {
        action: 'auth.login_failed', category: 'auth', outcome: 'failure',
        actorEmail: attempted, actorName: '', actorRole: '',
        summary: `Failed sign-in for ${attempted} — no such account`,
        details: { reason: 'unknown_account' },
      });
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (!user.isActive) {
      await audit(req, {
        action: 'auth.login_failed', category: 'auth', outcome: 'failure',
        actorEmail: attempted, actorName: user.name || '', actorRole: user.role || '',
        summary: `Failed sign-in for ${attempted} — account is deactivated`,
        details: { reason: 'deactivated' },
      });
      return res.status(401).json({ error: 'Account is deactivated. Contact admin.' });
    }
    const valid = await user.comparePassword(password);
    if (!valid) {
      await audit(req, {
        action: 'auth.login_failed', category: 'auth', outcome: 'failure',
        actorEmail: attempted, actorName: user.name || '', actorRole: user.role || '',
        summary: `Failed sign-in for ${attempted} — wrong password`,
        details: { reason: 'bad_password' },
      });
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const perms = user.role === 'admin' ? FULL_PERMISSIONS : (user.permissions || FULL_PERMISSIONS);
    const payload = { userId: user._id.toString(), email: user.email, role: user.role, permissions: perms };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
    await audit(req, {
      action: 'auth.login', category: 'auth',
      actorEmail: user.email, actorName: user.name || '', actorRole: user.role,
      summary: `${user.email} signed in (password)`,
      details: { method: 'password', role: user.role },
    });
    res.json({ success: true, token, user: { email: user.email, name: user.name, role: user.role, permissions: perms } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/auth/verify', async (req, res) => {
  const decoded = decodeToken(req);
  if (!decoded) return res.status(401).json({ error: 'Invalid or expired token' });

  // Admin email uses env credentials — no DB lookup needed
  if (decoded.role === 'admin' && decoded.email?.toLowerCase() === ADMIN_EMAIL?.toLowerCase()) {
    return res.json({ success: true, user: { email: decoded.email, name: decoded.name || 'Admin', role: 'admin', permissions: FULL_PERMISSIONS } });
  }

  // For all other users, fetch latest permissions from DB so hard-refresh picks up changes immediately
  try {
    const dbUser = await User.findOne({ email: decoded.email?.toLowerCase() });
    if (dbUser) {
      if (!dbUser.isActive) return res.status(401).json({ error: 'Account is deactivated. Contact admin.' });
      const perms = dbUser.role === 'admin' ? FULL_PERMISSIONS : (dbUser.permissions || {});
      return res.json({ success: true, user: { email: dbUser.email, name: dbUser.name || decoded.name || '', role: dbUser.role, permissions: perms } });
    }
  } catch (_) {}

  // Fallback to JWT if DB unavailable
  const perms = decoded.role === 'admin' ? FULL_PERMISSIONS : (decoded.permissions || {});
  res.json({ success: true, user: { email: decoded.email, name: decoded.name || '', role: decoded.role, permissions: perms } });
});

app.post('/api/admin/login', async (req, res) => {
  const { email, password } = req.body;
  const attempted = String(email || '').toLowerCase().trim();
  if (attempted === ADMIN_EMAIL?.toLowerCase().trim() && password === ADMIN_PASSWORD) {
    const token = jwt.sign({ email: ADMIN_EMAIL, role: 'admin', permissions: FULL_PERMISSIONS }, JWT_SECRET, { expiresIn: '8h' });
    await audit(req, {
      action: 'auth.admin_login', category: 'auth',
      actorEmail: ADMIN_EMAIL, actorName: 'Admin', actorRole: 'admin',
      summary: `${ADMIN_EMAIL} opened the Admin Panel (environment admin)`,
      details: { via: 'env-admin' },
    });
    return res.json({ success: true, token });
  }
  const user = await User.findOne({ email: attempted, role: 'admin', isActive: true });
  if (user && await user.comparePassword(password)) {
    const token = jwt.sign({ userId: user._id.toString(), email: user.email, role: 'admin', permissions: FULL_PERMISSIONS }, JWT_SECRET, { expiresIn: '8h' });
    await audit(req, {
      action: 'auth.admin_login', category: 'auth',
      actorEmail: user.email, actorName: user.name || '', actorRole: 'admin',
      summary: `${user.email} opened the Admin Panel`,
    });
    return res.json({ success: true, token });
  }
  await audit(req, {
    action: 'auth.admin_login_failed', category: 'auth', outcome: 'failure',
    actorEmail: attempted, actorName: '', actorRole: '',
    summary: `Failed Admin Panel sign-in for ${attempted || '(no email given)'}`,
  });
  res.status(401).json({ error: 'Invalid email or password' });
});

app.get('/api/admin/verify', (req, res) => {
  const decoded = decodeToken(req);
  if (!decoded) return res.status(401).json({ error: 'Invalid or expired token' });
  res.json({ success: true, email: decoded.email });
});

function graphRequest(accessToken) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'graph.microsoft.com',
      path: '/v1.0/me',
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, data: body }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function httpsPost(hostname, path, body) {
  return new Promise((resolve, reject) => {
    const data = new URLSearchParams(body).toString();
    const options = {
      hostname, path, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) },
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, data: raw }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

app.post('/api/auth/microsoft/exchange', async (req, res) => {
  const { code, verifier, redirectUri } = req.body;
  if (!code || !verifier || !redirectUri) return res.status(400).json({ error: 'code, verifier and redirectUri are required' });

  const tenantId = process.env.AZURE_TENANT_ID || '66d8848d-26b6-4147-8124-127624d7b3a6';
  const clientId = process.env.AZURE_CLIENT_ID || '861e696d-f41c-41ee-a7c2-c838fd185d6d';

  try {
    const tokenBody = {
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    };
    const clientSecret = process.env.AZURE_CLIENT_SECRET;
    if (clientSecret && clientSecret !== 'paste-your-secret-here') {
      tokenBody.client_secret = clientSecret;
    }
    const tokenRes = await httpsPost('login.microsoftonline.com', `/${tenantId}/oauth2/v2.0/token`, tokenBody);

    if (tokenRes.status !== 200 || !tokenRes.data.access_token) {
      await audit(req, {
        action: 'auth.microsoft_login_failed', category: 'auth', outcome: 'failure',
        actorEmail: '', actorName: '', actorRole: '',
        summary: `Microsoft sign-in failed — ${tokenRes.data.error_description || 'token exchange rejected'}`,
        details: { stage: 'token_exchange' },
      });
      return res.status(401).json({ error: tokenRes.data.error_description || 'Token exchange failed' });
    }

    const graph = await graphRequest(tokenRes.data.access_token);
    if (graph.status !== 200) return res.status(401).json({ error: 'Could not fetch user from Microsoft Graph' });

    const email = ((graph.data.mail || graph.data.userPrincipalName) || '').toLowerCase().trim();
    const name = graph.data.displayName || '';
    if (!email) return res.status(400).json({ error: 'Could not retrieve email from Microsoft account' });

    const isAdminEmail = email === ADMIN_EMAIL?.toLowerCase().trim();
    let role = isAdminEmail ? 'admin' : 'viewer';
    const DEFAULT_MS_PERMISSIONS = { productTypes: true, compatibility: true, cloudInfo: true, documents: false };
    let permissions = isAdminEmail ? FULL_PERMISSIONS : DEFAULT_MS_PERMISSIONS;

    try {
      let dbUser = await User.findOne({ email });
      if (dbUser) {
        if (!dbUser.isActive) return res.status(401).json({ error: 'Account is deactivated. Contact admin.' });
        role = dbUser.role;
        permissions = dbUser.role === 'admin' ? FULL_PERMISSIONS : (dbUser.permissions || DEFAULT_MS_PERMISSIONS);
      } else if (!isAdminEmail) {
        // Create DB record for new MS user so verify can always read fresh permissions
        dbUser = await User.create({
          email,
          name,
          role: 'viewer',
          permissions: DEFAULT_MS_PERMISSIONS,
          password: crypto.randomBytes(32).toString('hex'), // random — MS login only, never used
          isActive: true,
          notificationsSeenAt: new Date(),
        });
      }
    } catch {}

    const payload = { email, name, role, permissions };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
    await audit(req, {
      action: 'auth.microsoft_login', category: 'auth',
      actorEmail: email, actorName: name || '', actorRole: role,
      summary: `${email} signed in with Microsoft`,
      details: { method: 'microsoft', role },
    });
    res.json({ success: true, token, user: { email, name, role, permissions } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/microsoft', async (req, res) => {
  const { accessToken } = req.body;
  if (!accessToken) return res.status(400).json({ error: 'Access token required' });

  try {
    const graph = await graphRequest(accessToken);
    if (graph.status !== 200) return res.status(401).json({ error: 'Invalid Microsoft token' });

    const email = ((graph.data.mail || graph.data.userPrincipalName) || '').toLowerCase().trim();
    const name = graph.data.displayName || '';

    if (!email) return res.status(400).json({ error: 'Could not retrieve email from Microsoft account' });

    const isAdminEmail = email === ADMIN_EMAIL?.toLowerCase().trim();
    let role = isAdminEmail ? 'admin' : 'viewer';
    let permissions = FULL_PERMISSIONS;

    try {
      const dbUser = await User.findOne({ email });
      if (dbUser) {
        if (!dbUser.isActive) return res.status(401).json({ error: 'Account is deactivated. Contact admin.' });
        role = dbUser.role;
        permissions = dbUser.role === 'admin' ? FULL_PERMISSIONS : (dbUser.permissions || FULL_PERMISSIONS);
      }
    } catch {}

    const payload = { email, name, role, permissions };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
    await audit(req, {
      action: 'auth.microsoft_login', category: 'auth',
      actorEmail: email, actorName: name || '', actorRole: role,
      summary: `${email} signed in with Microsoft`,
      details: { method: 'microsoft-token' },
    });
    res.json({ success: true, token, user: { email, name, role, permissions } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --------------- Email via Microsoft Graph API ---------------

function httpsPostJson(hostname, path, body, bearerToken) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname, path, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
      },
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: raw ? JSON.parse(raw) : {} }); }
        catch { resolve({ status: res.statusCode, data: raw }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function getGraphAccessToken() {
  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('Azure credentials not configured in server .env');
  }

  const result = await httpsPost('login.microsoftonline.com', `/${tenantId}/oauth2/v2.0/token`, {
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
  });

  if (result.status !== 200 || !result.data.access_token) {
    throw new Error(result.data.error_description || 'Failed to get Graph access token');
  }
  return result.data.access_token;
}

async function sendMail(to, subject, htmlBody) {
  try {
    const senderEmail = 'bhuvana.mosra@cloudfuze.com';
    const token = await getGraphAccessToken();

    const result = await httpsPostJson(
      'graph.microsoft.com',
      `/v1.0/users/${encodeURIComponent(senderEmail)}/sendMail`,
      {
        message: {
          subject,
          body: { contentType: 'HTML', content: htmlBody },
          toRecipients: [{ emailAddress: { address: to } }],
        },
        saveToSentItems: false,
      },
      token
    );

    if (result.status !== 202 && result.status !== 200) {
      console.error('Graph sendMail error:', result.status, result.data);
    } else {
      console.log(`Email sent via Graph to ${to}`);
    }
  } catch (err) {
    console.error('sendMail error:', err.message);
  }
}

// --------------- Access Requests ---------------

app.post('/api/access-requests', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    let email = '', name = '';
    if (authHeader) {
      try {
        const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
        email = decoded.email || '';
        name = decoded.name || '';
      } catch {}
    }
    if (!email) return res.status(401).json({ error: 'Authentication required' });

    const existing = await AccessRequest.findOne({ email }).sort({ requestedAt: -1 });
    if (existing) {
      if (existing.status === 'pending') return res.status(400).json({ error: 'You already have a pending access request' });
      if (existing.status === 'approved') return res.status(400).json({ error: 'You already have access to the Documents tab' });
      // denied or revoked — reset the existing record to pending instead of creating a duplicate
      existing.status = 'pending';
      existing.requestedAt = new Date();
      existing.respondedAt = undefined;
      await existing.save();
    }

    const request = existing || await AccessRequest.create({ email, name });

    // Notify admin via email
    await sendMail(
      ADMIN_EMAIL,
      `Documents Access Request from ${name || email}`,
      `<p><strong>${name || email}</strong> (${email}) has requested access to the <strong>Documents</strong> tab on Migration Docs.</p>
       <p>Log in to the <a href="${process.env.FRONTEND_URL || 'http://localhost:4002'}/admin?tab=users">Admin Panel → Users</a> to approve or deny this request.</p>`
    );

    await audit(req, {
      action: 'access_request.created', category: 'access',
      actorEmail: email, actorName: name || '', actorRole: 'viewer',
      targetType: 'accessRequest', targetId: request._id, targetName: email,
      summary: `${name || email} requested access to the Documents tab`,
    });
    res.json({ success: true, requestId: request._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/access-requests', requireAdmin, async (req, res) => {
  try {
    const requests = await AccessRequest.find().sort({ requestedAt: -1 }).lean();
    res.json({ requests });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/access-requests/:id/approve', requireAdmin, async (req, res) => {
  try {
    const request = await AccessRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ error: 'Request not found' });

    request.status = 'approved';
    request.respondedAt = new Date();
    await request.save();

    // Update user permissions in DB (create if missing — safety net)
    const user = await User.findOne({ email: request.email });
    if (user) {
      user.permissions = { ...user.permissions, documents: true };
      await user.save();
    } else {
      await User.create({
        email: request.email,
        name: request.name || '',
        role: 'viewer',
        permissions: { productTypes: true, compatibility: true, cloudInfo: true, documents: true },
        password: crypto.randomBytes(32).toString('hex'),
        isActive: true,
        notificationsSeenAt: new Date(),
      });
    }

    // Notify user
    await sendMail(
      request.email,
      'Documents Access Approved – Migration Docs',
      `<p>Hi ${request.name || request.email},</p>
       <p>Your request to access the <strong>Documents</strong> tab on Migration Docs has been <strong>approved</strong>.</p>
       <p><a href="${process.env.FRONTEND_URL || 'http://localhost:4002'}">Click here to access Migration Docs</a></p>`
    );

    await audit(req, {
      action: 'access_request.approved', category: 'access',
      targetType: 'accessRequest', targetId: request._id, targetName: request.email,
      summary: `Admin granted Documents access to ${request.email}`,
      details: { requestEmail: request.email, requestName: request.name || null },
    });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/access-requests/:id/deny', requireAdmin, async (req, res) => {
  try {
    const request = await AccessRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ error: 'Request not found' });

    request.status = 'denied';
    request.respondedAt = new Date();
    await request.save();

    await sendMail(
      request.email,
      'Documents Access Denied – Migration Docs',
      `<p>Hi ${request.name || request.email},</p>
       <p>Your request to access the <strong>Documents</strong> tab on Migration Docs has been <strong>denied</strong>.</p>
       <p>If you believe this is a mistake, please contact your administrator.</p>`
    );

    await audit(req, {
      action: 'access_request.denied', category: 'access',
      targetType: 'accessRequest', targetId: request._id, targetName: request.email,
      summary: `Admin denied the Documents access request from ${request.email}`,
      details: { requestEmail: request.email, requestName: request.name || null },
    });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/access-requests/:id/revoke', requireAdmin, async (req, res) => {
  try {
    const request = await AccessRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.status !== 'approved') return res.status(400).json({ error: 'Only approved requests can be revoked' });

    request.status = 'revoked';
    request.respondedAt = new Date();
    await request.save();

    const user = await User.findOne({ email: request.email });
    if (user) {
      user.permissions = { ...user.permissions, documents: false };
      await user.save();
    }

    await audit(req, {
      action: 'access_request.revoked', category: 'access',
      targetType: 'accessRequest', targetId: request._id, targetName: request.email,
      summary: `Admin revoked Documents access for ${request.email}`,
      details: { requestEmail: request.email, requestName: request.name || null },
    });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --------------- User Management (Admin only) ---------------

app.get('/api/users', requireAdmin, async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 }).lean();
    res.json({ users: users.map(u => ({ ...u, id: u._id.toString() })) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/users', requireAdmin, async (req, res) => {
  try {
    const { email, password, name, role, permissions } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    const existing = await User.findOne({ email: email.toLowerCase().trim() });
    if (existing) return res.status(400).json({ error: 'A user with this email already exists' });
    const user = await User.create({
      email: email.toLowerCase().trim(),
      password,
      name: name || '',
      role: role || 'viewer',
      permissions: permissions || {},
      notificationsSeenAt: new Date(),
    });
    const obj = user.toObject();
    delete obj.password;
    await audit(req, {
      action: 'user.created', category: 'user',
      targetType: 'user', targetId: user._id, targetName: user.email,
      summary: `Created ${user.role} account for ${user.email}`,
      details: { role: user.role, permissions: user.permissions },
    });
    res.json({ success: true, user: { ...obj, id: obj._id.toString() } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/users/:id', requireAdmin, async (req, res) => {
  try {
    const { name, role, permissions, password, isActive } = req.body;
    const update = {};
    if (name !== undefined) update.name = name;
    if (role !== undefined) update.role = role;
    if (permissions !== undefined) update.permissions = permissions;
    if (isActive !== undefined) update.isActive = isActive;

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    Object.assign(user, update);
    if (password) user.password = password;
    await user.save();

    const obj = user.toObject();
    delete obj.password;
    await audit(req, {
      action: 'user.updated', category: 'user',
      targetType: 'user', targetId: user._id, targetName: user.email,
      summary: `Updated account ${user.email}` + (Object.keys(update).length ? ` — ${Object.keys(update).join(", ")}` : "") + (password ? " — password reset" : ""),
      details: { changed: Object.keys(update), passwordChanged: !!password, role: user.role, isActive: user.isActive },
    });
    res.json({ success: true, user: { ...obj, id: obj._id.toString() } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/users/:id', requireAdmin, async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    await audit(req, {
      action: 'user.deleted', category: 'user',
      targetType: 'user', targetId: user._id, targetName: user.email,
      summary: `Deleted account ${user.email}`,
      details: { role: user.role },
    });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
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
    console.error('Server will continue without MongoDB — admin login still works, but DB-dependent features will fail.');
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
    await audit(req, {
      action: 'content.category_saved', category: 'content',
      targetType: 'category',
      targetName: (req.body && req.body.name) || '',
      summary: `Category "${(req.body && req.body.name) || ''}" saved`,
    });
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
    await recordLifecycle('productConfig', config.toObject(), 'created', req);
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
    await audit(req, {
      action: 'content.reordered', category: 'content',
      targetType: 'productConfig', targetName: 'display order',
      summary: `Reordered ${(orderedIds || []).length} product types`,
      details: { count: (orderedIds || []).length },
    });
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
    const before = await ProductConfig.findById(req.params.id).lean();
    const config = await ProductConfig.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true }).lean();
    if (!config) return res.status(404).json({ error: 'Not found' });
    await recordRevision('productConfig', before, config, req);
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
    await audit(req, {
      action: 'content.combinations_reordered', category: 'content',
      targetType: 'productConfig', targetId: config._id, targetName: config.name,
      summary: `Reordered the combinations of ${config.name}`,
      details: { combinations },
    });
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
    const before = config.toObject();
    config.combinations.push(combination);
    await config.save();
    await recordRevision('productConfig', before, config.toObject(), req);
    res.json({ success: true, config: { id: config._id.toString(), name: config.name, combinations: config.combinations } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/product-config/:id', async (req, res) => {
  try {
    const config = await ProductConfig.findByIdAndUpdate(req.params.id, { isDeleted: true, deletedAt: new Date() }, { new: true });
    if (!config) return res.status(404).json({ error: 'Not found' });
    await audit(req, {
      action: 'content.product_type_deleted', category: 'content',
      targetType: 'productConfig', targetId: req.params.id,
      targetName: (config && config.name) || '',
      summary: `Product type "${(config && config.name) || req.params.id}" deleted`,
    });
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
    const before = config.toObject();
    config.combinations = config.combinations.filter(c => c !== combo);
    await config.save();
    await recordRevision('productConfig', before, config.toObject(), req);
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

    await audit(req, {
      action: 'content.combination_deleted', category: 'content',
      targetType: 'productConfig',
      targetName: combination,
      summary: `Combination "${combination}"${productType ? ' in ' + productType : ''} deleted — ${deletedFeatures} feature(s) moved to Trash`,
      details: { combination, productType: productType || null, deletedFeatures },
    });
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

    await audit(req, {
      action: 'content.combination_renamed', category: 'content',
      targetType: 'productConfig',
      targetName: newName,
      summary: `Combination "${oldName}" renamed to "${newName}"` + (productType ? ` in ${productType}` : '') + `, ${configs.length} product type(s) affected`,
      details: { from: oldName, to: newName, productType: productType || null, productTypesAffected: configs.length },
    });
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
    const affected = await Feature.find(filter).select('_id name').lean();
    const result = await Feature.updateMany(filter, { isDeleted: true, deletedAt: new Date() });
    await recordRevisions('feature', affected.map(doc => ({ after: doc })), 'deleted', req);
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
    const allFeatures = await Feature.find(tagFilter).select('family name updatedAt createdAt').lean();
    const allTags = new Set();
    // Most recent activity across the whole scope — built from tagFilter, which ignores
    // search/tag, so the date stays stable while the user filters. Both stamps are sent so
    // the client can tell a creation (createdAt === updatedAt) from a later edit.
    let newest = null;
    allFeatures.forEach(f => {
      if (f.family) allTags.add(f.family);
      const stamp = f.updatedAt || f.createdAt;
      if (!stamp) return;
      const best = newest && (newest.updatedAt || newest.createdAt);
      if (!best || stamp > best) newest = f;
    });

    res.json({
      features: features.map(mapFeature),
      tags: ['All', ...Array.from(allTags).sort()],
      lastActivity: newest ? {
        createdAt: newest.createdAt,
        updatedAt: newest.updatedAt,
        entityType: 'feature',
        entityId: newest._id.toString(),
        entityName: newest.name,
      } : null,
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
    await recordLifecycle('feature', feature.toObject(), 'created', req);
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
    await recordRevisions('feature', saved.map(f => ({ after: f.toObject() })), 'created', req);
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
    // Snapshot first: this rename runs before the per-row saves, so if it is not
    // recorded here the family change is lost to history entirely.
    const affected = await Feature.find(filter).lean();
    const result = await Feature.updateMany(filter, { family: newFamily });
    await recordRevisions('feature', affected.map(doc => ({
      before: doc,
      after: { ...doc, family: newFamily },
    })), 'updated', req);
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
    await audit(req, {
      action: 'content.reordered', category: 'content',
      targetType: 'feature', targetName: 'display order',
      summary: `Reordered ${(orderedIds || []).length} features`,
      details: { count: (orderedIds || []).length },
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/features/:id', async (req, res) => {
  try {
    const before = await Feature.findById(req.params.id).lean();
    const feature = await Feature.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).lean();
    if (!feature) return res.status(404).json({ error: 'Feature not found' });
    await recordRevision('feature', before, feature, req);
    res.json({ success: true, feature: mapFeature(feature) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/features/:id', async (req, res) => {
  try {
    const feature = await Feature.findByIdAndUpdate(req.params.id, { isDeleted: true, deletedAt: new Date() }, { new: true });
    if (!feature) return res.status(404).json({ error: 'Feature not found' });
    await recordLifecycle('feature', feature.toObject(), 'deleted', req);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --------------- Internal API (product types & combinations) ---------------
//
// For the companion application, not the public. Scope is deliberately narrow: it
// lists product types with their combinations, and returns a Word document of the
// feature table (name + description only) for one of them.
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;
// While true the endpoints answer without a key, so a URL can be opened straight in
// a browser. Set INTERNAL_API_PUBLIC=false to require the key again.
const INTERNAL_API_PUBLIC = String(process.env.INTERNAL_API_PUBLIC || '').toLowerCase() === 'true';

function safeEquals(a, b) {
  // Hash both sides first: timingSafeEqual needs equal lengths, and comparing
  // lengths up front would leak the secret's length.
  const hashA = crypto.createHash('sha256').update(String(a)).digest();
  const hashB = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

// Two optional allowlists, both comma-separated in .env:
//
//   INTERNAL_API_ALLOWED_ORIGINS=https://sprintboard.cftools.live
//     Applies to calls made by browser JavaScript, which carry an Origin header.
//     Leave empty to accept any origin.
//
//   INTERNAL_API_ALLOWED_IPS=203.0.113.7
//     Applies to server-to-server calls, which carry no Origin at all — the only
//     thing to check there is the address the request came from.
const splitList = (value) => String(value || '').split(',').map(s => s.trim()).filter(Boolean);
const INTERNAL_API_ALLOWED_ORIGINS = splitList(process.env.INTERNAL_API_ALLOWED_ORIGINS)
  .map(o => o.replace(/\/$/, '').toLowerCase());
const INTERNAL_API_ALLOWED_IPS = splitList(process.env.INTERNAL_API_ALLOWED_IPS);

function callerIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = forwarded || req.socket.remoteAddress || '';
  return ip.replace(/^::ffff:/, ''); // normalise IPv4-mapped IPv6
}

function requireInternalKey(req, res, next) {
  const origin = String(req.headers.origin || '').replace(/\/$/, '').toLowerCase();

  // A browser call from an origin that is not on the list gets nothing, key or not.
  if (origin && INTERNAL_API_ALLOWED_ORIGINS.length
    && !INTERNAL_API_ALLOWED_ORIGINS.includes(origin)) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  // Echo the specific origin so the browser accepts the response. The app-wide
  // cors() sets a wildcard, which is too loose for this endpoint.
  if (origin && INTERNAL_API_ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
    res.setHeader('Vary', 'Origin');
  }

  // No Origin means a server-to-server caller: check the address instead.
  if (!origin && INTERNAL_API_ALLOWED_IPS.length && !INTERNAL_API_ALLOWED_IPS.includes(callerIp(req))) {
    return res.status(403).json({ error: 'Caller address not allowed', seenIp: callerIp(req) });
  }

  if (INTERNAL_API_PUBLIC) return next();
  if (!INTERNAL_API_KEY) {
    return res.status(503).json({ error: 'Internal API is not configured on this server' });
  }
  // Header for server-to-server calls; ?key= so the URL also works in a browser.
  const provided = req.headers['x-internal-key'] || req.query.key || '';
  if (!provided || !safeEquals(provided, INTERNAL_API_KEY)) {
    return res.status(401).json({ error: 'Invalid or missing key (send X-Internal-Key header or ?key=)' });
  }
  next();
}

const internalSiteUrl = () => String(process.env.FRONTEND_URL || 'http://localhost:4002').replace(/\/$/, '');

function featurePageUrl({ productType, combination, scope }) {
  const query = new URLSearchParams();
  if (productType) query.set('product', productType);
  if (combination) query.set('combination', combination);
  query.set('section', scope || 'inscope');
  return `${internalSiteUrl()}/?${query.toString()}`;
}

// Product types, their combinations, and which of those actually have a document.
app.get('/api/internal/v1/product-types', requireInternalKey, async (req, res) => {
  try {
    const [configs, features] = await Promise.all([
      ProductConfig.find({ isDeleted: { $ne: true } }).sort({ order: 1 }).lean(),
      Feature.find({ isDeleted: { $ne: true } }).select('productType combination scope updatedAt').lean(),
    ]);

    // Count features per product type / combination / scope so the caller knows in
    // advance whether a request will produce a document.
    const counts = new Map();
    features.forEach((f) => {
      const key = `${f.productType}|${f.combination || ''}|${f.scope}`;
      const entry = counts.get(key);
      if (entry) {
        entry.features += 1;
        if (new Date(f.updatedAt) > new Date(entry.updatedAt)) entry.updatedAt = f.updatedAt;
      } else {
        counts.set(key, { features: 1, updatedAt: f.updatedAt });
      }
    });

    // Build docUrl from the host that was actually called, so a request to
    // localhost:4002 gets localhost:4002 links rather than the production site.
    // pageUrl still comes from FRONTEND_URL, since that points at the docs site.
    const apiOrigin = `${req.headers['x-forwarded-proto'] || req.protocol}://${req.headers.host}`;
    const docUrl = (productType, combination, scope) => {
      const query = new URLSearchParams({ productType, scope });
      if (combination) query.set('combination', combination);
      return `${apiOrigin}/api/internal/v1/word-doc?${query.toString()}`;
    };

    const productTypes = configs.map((config) => ({
      productType: config.name,
      combinations: (config.combinations || []).map((combination) => ({
        combination,
        scopes: ['inscope', 'outscope'].map((scope) => {
          const entry = counts.get(`${config.name}|${combination}|${scope}`);
          return {
            scope,
            features: entry ? entry.features : 0,
            // An empty table is not a document.
            wordDoc: !!entry,
            updatedAt: entry ? entry.updatedAt : null,
            docUrl: entry ? docUrl(config.name, combination, scope) : null,
            pageUrl: featurePageUrl({ productType: config.name, combination, scope }),
          };
        }),
      })),
    }));

    const body = { generatedAt: new Date().toISOString(), productTypes };
    if (req.query.pretty !== undefined) {
      res.setHeader('Content-Type', 'application/json');
      return res.send(JSON.stringify(body, null, 2));
    }
    res.json(body);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// The Word document for one product type / combination / scope.
app.get('/api/internal/v1/word-doc', requireInternalKey, async (req, res) => {
  try {
    const productType = String(req.query.productType || '').trim();
    const combination = String(req.query.combination || '').trim();
    const scope = String(req.query.scope || 'inscope').trim().toLowerCase();

    if (!productType) {
      return res.status(400).json({
        error: 'productType is required',
        example: `${internalSiteUrl()}/api/internal/v1/word-doc?productType=Message&combination=Slack to Chat&scope=inscope`,
      });
    }
    if (!['inscope', 'outscope'].includes(scope)) {
      return res.status(400).json({ error: 'scope must be inscope or outscope' });
    }

    const filter = { productType, scope, isDeleted: { $ne: true } };
    if (combination) filter.combination = combination;

    const features = await Feature.find(filter)
      .select('name description order createdAt')
      .sort({ order: 1, createdAt: 1 })
      .lean();

    // Nothing to tabulate — report unavailable rather than sending an empty table.
    if (!features.length) {
      return res.status(404).json({
        available: false,
        reason: `No ${scope} features found for ${productType}${combination ? ' / ' + combination : ''}`,
        productType,
        combination: combination || undefined,
        scope,
        pageUrl: featurePageUrl({ productType, combination, scope }),
      });
    }

    const built = await buildFeatureTableDocx({ features, productType, combination, scope });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${built.filename}"`);
    res.setHeader('Content-Length', built.buffer.length);
    res.setHeader('X-Doc-Filename', built.filename);
    res.setHeader('X-Doc-Stats', JSON.stringify(built.stats));
    await audit(req, {
      action: 'api.word_doc_downloaded', category: 'api',
      actorEmail: '', actorName: '', actorRole: 'internal-api',
      targetType: 'features', targetName: `${productType}${combination ? ' / ' + combination : ''} (${scope})`,
      summary: `Word document downloaded through the internal API — ${productType}${combination ? " / " + combination : ""} (${scope}), ${built.stats.features} features`,
      details: { productType, combination, scope, ...built.stats },
    });
    res.end(built.buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Identity of whoever made a change, read from the Bearer token the client sends.
// The content routes accept unauthenticated writes, so this can legitimately be
// empty — the history then shows the change without an author rather than failing.
function actorFrom(req) {
  const decoded = req ? decodeToken(req) : null;
  if (!decoded) return { actorEmail: '', actorName: '' };
  return {
    actorEmail: String(decoded.email || '').toLowerCase().trim(),
    actorName: decoded.name || '',
  };
}

// --------------- Audit Log ---------------
//
// Every entry answers "who did this, and when". Writes never throw and never block
// the request: an action must not fail just because logging it failed.
function requestIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return (forwarded || req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}

async function audit(req, entry) {
  try {
    const fromToken = req ? decodeToken(req) : null;
    await AuditLog.create({
      at: new Date(),
      action: entry.action,
      category: entry.category,
      outcome: entry.outcome || 'success',
      // An explicit actor wins: during a login the actor is the person attempting
      // it, who has no token yet.
      actorEmail: String(entry.actorEmail != null ? entry.actorEmail : (fromToken && fromToken.email) || '').toLowerCase().trim(),
      actorName: entry.actorName != null ? entry.actorName : (fromToken && fromToken.name) || '',
      actorRole: entry.actorRole != null ? entry.actorRole : (fromToken && fromToken.role) || '',
      targetType: entry.targetType || '',
      targetId: entry.targetId ? String(entry.targetId) : '',
      targetName: entry.targetName || '',
      summary: entry.summary || '',
      details: entry.details,
      ip: req ? requestIp(req) : '',
      userAgent: req ? String(req.headers['user-agent'] || '').slice(0, 300) : '',
    });
  } catch (err) {
    console.error('Audit write failed:', err.message);
  }
}

// Shared by the listing and the CSV export.
function buildAuditFilter(query) {
  const { q, action, category, outcome, actorEmail, from, to, targetType } = query;
  const filter = {};
  if (action) filter.action = action;
  if (category) filter.category = category;
  if (outcome) filter.outcome = outcome;
  if (targetType) filter.targetType = targetType;
  if (actorEmail) filter.actorEmail = String(actorEmail).toLowerCase().trim();
  if (from || to) {
    filter.at = {};
    if (from) filter.at.$gte = new Date(from);
    if (to) {
      const end = new Date(to);
      // A bare date means the whole of that day.
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(to))) end.setHours(23, 59, 59, 999);
      filter.at.$lte = end;
    }
  }
  if (q) {
    const rx = new RegExp(escapeRegex(String(q).trim()), 'i');
    filter.$or = [{ summary: rx }, { actorEmail: rx }, { actorName: rx }, { targetName: rx }, { action: rx }];
  }
  return filter;
}

// Admin-only listing, newest first.
// The export buttons build their file in the browser, so no request would
// otherwise reach the server. The UI reports a completed download here.
//
// Deliberately narrow: the action is chosen from a fixed list and the actor is
// taken from the token, so a caller cannot forge arbitrary audit entries.
const DOWNLOAD_KINDS = {
  features: 'Feature list',
  compatibility: 'Compatibility matrix',
  cloudInfo: 'Cloud info page',
  document: 'Document',
  export: 'Combined export',
};
const DOWNLOAD_FORMATS = ['docx', 'xlsx', 'pdf'];

app.post('/api/audit/download', async (req, res) => {
  try {
    const { kind, format, productType, combination, scope, name } = req.body || {};
    if (!DOWNLOAD_KINDS[kind] || !DOWNLOAD_FORMATS.includes(format)) {
      return res.status(400).json({ error: 'Unknown download kind or format' });
    }

    const where = kind === 'features'
      ? `${productType || ''}${combination ? ' / ' + combination : ''}${scope ? ' (' + scope + ')' : ''}`
      : (name || '');

    await audit(req, {
      action: `download.${kind}`,
      category: 'download',
      targetType: kind,
      targetName: where,
      summary: `${DOWNLOAD_KINDS[kind]} downloaded as ${String(format).toUpperCase()}${where ? ' — ' + where : ''}`,
      details: { format, productType, combination, scope, name },
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Signing out happens in the browser (the token is simply discarded), so there is
// no request to record unless the client says so. Called before the token is
// cleared, which is what identifies who left.
app.post('/api/audit/logout', async (req, res) => {
  try {
    const decoded = decodeToken(req);
    if (!decoded) return res.json({ success: true, recorded: false });
    await audit(req, {
      action: 'auth.logout', category: 'auth',
      actorEmail: decoded.email || '', actorName: decoded.name || '', actorRole: decoded.role || '',
      summary: `${decoded.email || "someone"} signed out`,
      details: { surface: (req.body && req.body.surface) || null },
    });
    res.json({ success: true, recorded: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/audit-logs', requireAdmin, async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const filter = buildAuditFilter(req.query);

    const [logs, total] = await Promise.all([
      AuditLog.find(filter).sort({ at: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      AuditLog.countDocuments(filter),
    ]);

    res.json({
      logs: logs.map(l => ({ ...l, id: String(l._id) })),
      total,
      page,
      limit,
      pages: Math.max(Math.ceil(total / limit), 1),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Values for the filter dropdowns, so they only offer what actually exists.
app.get('/api/audit-logs/filters', requireAdmin, async (req, res) => {
  try {
    const [actions, categories, actors, targetTypes, total, oldest] = await Promise.all([
      AuditLog.distinct('action'),
      AuditLog.distinct('category'),
      AuditLog.aggregate([
        { $match: { actorEmail: { $ne: '' } } },
        { $group: { _id: '$actorEmail', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 200 },
      ]),
      AuditLog.distinct('targetType'),
      AuditLog.countDocuments({}),
      AuditLog.findOne({}).sort({ at: 1 }).select('at').lean(),
    ]);
    res.json({
      actions: actions.sort(),
      categories: categories.sort(),
      actors: actors.map(a => ({ email: a._id, count: a.count })),
      targetTypes: targetTypes.filter(Boolean).sort(),
      total,
      trackingSince: oldest ? oldest.at : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CSV of whatever the current filter selects, for answering someone outside the tool.
app.get('/api/audit-logs/export', requireAdmin, async (req, res) => {
  try {
    const logs = await AuditLog.find(buildAuditFilter(req.query)).sort({ at: -1 }).limit(5000).lean();
    const cell = (v) => '"' + String(v == null ? '' : v).split('"').join('""') + '"';
    const header = ['When', 'Who', 'Role', 'Action', 'Outcome', 'Target', 'Summary', 'IP'];
    const rows = [header.map(cell).join(',')];
    logs.forEach((l) => {
      rows.push([
        new Date(l.at).toISOString(),
        l.actorEmail,
        l.actorRole,
        l.action,
        l.outcome,
        l.targetType + (l.targetName ? ': ' + l.targetName : ''),
        l.summary,
        l.ip,
      ].map(cell).join(','));
    });

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-log-' + stamp + '.csv"');
    res.send(rows.join('\n'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --------------- Revision History ---------------

// Records what changed on a content record. Never throws into the request path:
// failing to log history must not fail the edit itself.
// Human labels for audit summaries, so the log reads as sentences.
const ENTITY_LABEL = {
  feature: 'Feature',
  compatibility: 'Compatibility matrix',
  cloudInfo: 'Cloud info page',
  document: 'Document',
  productConfig: 'Product type',
};

async function recordRevision(entityType, before, after, req) {
  try {
    if (!before || !after) return;
    const changes = buildChanges(entityType, before, after);
    if (!changes.length) return;
    await Revision.create({
      entityType,
      entityId: after._id || before._id,
      entityName: after.name || before.name || '',
      action: 'updated',
      ...actorFrom(req),
      changedAt: new Date(),
      changes,
    });

    const name = after.name || before.name || '';
    const fields = changes.map(c => c.label || c.field).join(', ');
    // A feature name alone is ambiguous — the same name exists under other
    // combinations — so the summary carries the place it lives.
    const scopeWord = after.scope === 'outscope' ? 'Out of Scope' : 'In Scope';
    const where = entityType === 'feature' && after.productType
      ? ` in ${after.productType}${after.combination ? ' / ' + after.combination : ''} (${scopeWord})`
      : '';
    await audit(req, {
      action: 'content.updated',
      category: 'content',
      targetType: entityType,
      targetId: after._id || before._id,
      targetName: name,
      summary: `${ENTITY_LABEL[entityType] || entityType} "${name}"${where} updated — ${fields}`,
      details: {
        fields: changes.map(c => c.label || c.field),
        ...(entityType === 'feature' ? {
          productType: after.productType,
          combination: after.combination,
          scope: after.scope,
        } : {}),
      },
    });
  } catch (err) {
    console.error(`Failed to record ${entityType} revision:`, err.message);
  }
}

// --------------- Notifications ---------------
//
// Derived from the revision log rather than stored per user: a notification is just
// "something you can see changed after the last time you looked". Each entity type
// maps to the tab permission that governs it, so a viewer without Documents access
// never hears about document edits.
const NOTIFY_PERMISSION = {
  feature: 'productTypes',
  productConfig: 'productTypes',
  compatibility: 'compatibility',
  cloudInfo: 'cloudInfo',
  document: 'documents',
};

const ACTION_VERB = { created: 'was added', deleted: 'was removed', restored: 'was restored', updated: 'was updated' };

// Arrivals and removals get their own notification so a later edit cannot bury them.
function lifecycleSuffix(action) {
  return action && action !== 'updated' ? `|${action}` : '';
}

async function resolveNotificationUser(req) {
  const decoded = decodeToken(req);
  if (!decoded) return null;

  const email = String(decoded.email || '').toLowerCase().trim();
  const isEnvAdmin = !!ADMIN_EMAIL && email === ADMIN_EMAIL.toLowerCase().trim();
  let dbUser = null;
  try { dbUser = await User.findOne({ email }); } catch { /* history still works read-only */ }

  const isAdmin = isEnvAdmin || decoded.role === 'admin' || (dbUser && dbUser.role === 'admin');
  const permissions = isAdmin
    ? FULL_PERMISSIONS
    : ((dbUser && dbUser.permissions) || decoded.permissions || {});

  const readAt = new Map();
  if (dbUser && Array.isArray(dbUser.notificationReads)) {
    dbUser.notificationReads.forEach(entry => { if (entry && entry.key) readAt.set(entry.key, entry.at); });
  }

  return {
    email, dbUser, permissions,
    seenAt: dbUser ? dbUser.notificationsSeenAt : null,
    readAt,
  };
}

// Unread until the change is newer than both the global "mark all read" mark and
// any dismissal of that specific notification.
function isUnread(changedAt, seenAt, dismissedAt) {
  const changed = new Date(changedAt).getTime();
  if (seenAt && changed <= new Date(seenAt).getTime()) return false;
  if (dismissedAt && changed <= new Date(dismissedAt).getTime()) return false;
  return true;
}

app.get('/api/notifications', async (req, res) => {
  try {
    const account = await resolveNotificationUser(req);
    if (!account) return res.status(401).json({ error: 'Invalid or expired token' });
    const { permissions, seenAt, readAt } = account;

    // Two windows, merged: the recent log for context, plus *everything* since this
    // user last cleared their notifications. A busy day must never push an unread
    // change out of a fixed-size window and silently lose it.
    const [recent, sinceSeen] = await Promise.all([
      Revision.find({}).sort({ changedAt: -1 }).limit(400).lean(),
      seenAt
        ? Revision.find({ changedAt: { $gt: new Date(seenAt) } }).sort({ changedAt: -1 }).limit(2000).lean()
        : Promise.resolve([]),
    ]);
    const merged = new Map();
    [...sinceSeen, ...recent].forEach(r => merged.set(String(r._id), r));
    const revisions = [...merged.values()].sort((a, b) => new Date(b.changedAt) - new Date(a.changedAt));

    // Only changes to tabs this user is allowed to see. An absent flag counts as
    // allowed, matching how the sidebar decides what to show.
    const visible = revisions.filter((revision) => {
      const key = NOTIFY_PERMISSION[revision.entityType];
      return key && permissions[key] !== false;
    });

    // Feature rows carry no location of their own, so fetch the page each belongs to.
    const featureIds = visible.filter(r => r.entityType === 'feature').map(r => r.entityId);
    const features = featureIds.length
      ? await Feature.find({ _id: { $in: featureIds } }).select('productType combination scope').lean()
      : [];
    const featureById = new Map(features.map(f => [String(f._id), f]));

    // Slugs for the pages a notification can link to.
    const idsOf = (type) => visible.filter(r => r.entityType === type).map(r => r.entityId);
    const [matrices, infos, documents] = await Promise.all([
      CompatibilityMatrix.find({ _id: { $in: idsOf('compatibility') } }).select('slug name').lean(),
      CloudInfo.find({ _id: { $in: idsOf('cloudInfo') } }).select('slug name').lean(),
      DocModel.find({ _id: { $in: idsOf('document') } }).select('slug name').lean(),
    ]);
    const slugById = new Map([...matrices, ...infos, ...documents].map(d => [String(d._id), d.slug]));

    // Group so ten edits to one page read as one notification, not ten.
    const groups = new Map();
    visible.forEach((revision) => {
      let key;
      let title;
      let message;
      let link = null;

      if (revision.entityType === 'feature') {
        const feature = featureById.get(String(revision.entityId));
        if (!feature) return; // hard-deleted row, nothing to point at
        // Lead with the product type, then the combination, so the message reads
        // like the place it happened: In Message, "Slack to Chat" was updated.
        // Say where it happened, which row it was, and what changed about it.
        // "Slack to Chat was updated" is true but tells the reader nothing.
        const scopeWord = feature.scope === 'outscope' ? 'Out of Scope' : 'In Scope';
        const place = `${feature.productType}${feature.combination ? ' / ' + feature.combination : ''} (${scopeWord})`;
        const fieldList = (revision.changes || []).map(c => c.label || c.field).filter(Boolean);
        key = `feature|${feature.productType}|${feature.combination}|${feature.scope}`;
        title = feature.combination || feature.productType;
        if (revision.action === 'created') {
          message = `${place}: new feature "${revision.entityName}" added`;
        } else if (revision.action === 'deleted') {
          message = `${place}: feature "${revision.entityName}" removed`;
        } else if (revision.action === 'restored') {
          message = `${place}: feature "${revision.entityName}" restored from Trash`;
        } else {
          message = `${place}: "${revision.entityName}"` + (fieldList.length ? ` — ${fieldList.join(', ')} updated` : ' updated');
        }
        link = { product: feature.productType, combination: feature.combination, section: feature.scope };
      } else if (revision.entityType === 'productConfig') {
        // "Something new appeared" and "it was later edited" are different events.
        // Keeping them under one key let a subsequent edit overwrite the arrival.
        key = `productConfig|${revision.entityId}${lifecycleSuffix(revision.action)}`;
        title = revision.entityName;
        // Name the combinations that came or went — "the product type was updated"
        // says nothing about what to go and look at.
        const comboChange = (revision.changes || []).find(c => c.field === 'combinations');
        const addedCombos = (comboChange && comboChange.added) || [];
        const removedCombos = (comboChange && comboChange.removed) || [];
        const listOf = (values) => values.map(v => `"${v}"`).join(', ');

        if (revision.action === 'created') {
          message = `New product type "${revision.entityName}" was added`;
        } else if (addedCombos.length) {
          message = `In ${revision.entityName}, new combination ${listOf(addedCombos)} was added`
            + (removedCombos.length ? ` and ${listOf(removedCombos)} removed` : '');
        } else if (removedCombos.length) {
          message = `In ${revision.entityName}, combination ${listOf(removedCombos)} was removed`;
        } else {
          message = `Product type "${revision.entityName}" ${ACTION_VERB[revision.action] || 'was updated'}`;
        }

        // Point straight at the new combination when there is exactly one.
        link = addedCombos.length === 1
          ? { product: revision.entityName, combination: addedCombos[0] }
          : { product: revision.entityName };
      } else {
        const slug = slugById.get(String(revision.entityId));
        const label = {
          compatibility: 'Compatibility matrix',
          cloudInfo: 'Cloud info',
          document: 'Document',
        }[revision.entityType];
        key = `${revision.entityType}|${revision.entityId}${lifecycleSuffix(revision.action)}`;
        title = revision.entityName;
        message = `${label} "${revision.entityName}" ${ACTION_VERB[revision.action] || 'was updated'}`;
        if (slug) {
          link = revision.entityType === 'compatibility' ? { view: 'compatibility', matrix: slug }
            : revision.entityType === 'cloudInfo' ? { view: 'cloudinfo', info: slug }
              : { view: 'documents', doc: slug };
        }
      }

      const existing = groups.get(key);
      if (existing) {
        // Count only what is new to this reader: without this, one edit reported the
        // entire recorded history of the page.
        const revisionIsNew = isUnread(revision.changedAt, seenAt, readAt.get(key));
        if (revisionIsNew) existing.count += 1;
        // Newest first, so the message is already set. Note the other rows the
        // group covers so the reader sees the scale.
        if (revisionIsNew && revision.entityName && revision.entityName !== existing.entityName
          && !existing.alsoChanged.includes(revision.entityName)) {
          existing.alsoChanged.push(revision.entityName);
        }
        return; // revisions arrive newest first, so the first one already set the time
      }
      groups.set(key, {
        key,
        entityType: revision.entityType,
        entityName: revision.entityName,
        alsoChanged: [],
        title,
        message,
        at: revision.changedAt,
        count: isUnread(revision.changedAt, seenAt, readAt.get(key)) ? 1 : 0,
        link,
        unread: isUnread(revision.changedAt, seenAt, readAt.get(key)),
      });
    });

    // Unread entries are never dropped by the display cap; read ones fill what is
    // left. The final list stays in newest-first order.
    // A group can cover several rows; name one more and count the rest.
    groups.forEach((item) => {
      const others = item.alsoChanged || [];
      if (!others.length) return;
      item.message += others.length === 1
        ? ` · also "${others[0]}"`
        : ` · also "${others[0]}" and ${others.length - 1} more`;
    });

    const all = [...groups.values()].sort((a, b) => new Date(b.at) - new Date(a.at));
    const unreadItems = all.filter(i => i.unread);
    const readItems = all.filter(i => !i.unread);
    const items = [...unreadItems, ...readItems.slice(0, Math.max(0, 50 - unreadItems.length))]
      .sort((a, b) => new Date(b.at) - new Date(a.at));

    res.json({
      items,
      unreadCount: items.filter(i => i.unread).length,
      // Without a users row (env-only admin) read state cannot be remembered.
      canPersistRead: !!account.dbUser,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Dismiss one notification — opening it clears just that entry.
app.post('/api/notifications/read', async (req, res) => {
  try {
    const account = await resolveNotificationUser(req);
    if (!account) return res.status(401).json({ error: 'Invalid or expired token' });

    const { key, at } = req.body || {};
    if (!key) return res.status(400).json({ error: 'key is required' });
    if (!account.dbUser) return res.json({ success: true, persisted: false });

    // Dismiss up to the change the user actually saw, not the moment they clicked.
    // Anything that lands between rendering the list and the click stays unread
    // instead of being silently swallowed.
    const now = Date.now();
    const seenChange = at ? new Date(at).getTime() : NaN;
    const dismissAt = new Date(!isNaN(seenChange) && seenChange <= now ? seenChange : now);

    const user = account.dbUser;
    const reads = (user.notificationReads || []).filter(entry => entry && entry.key !== key);
    reads.push({ key, at: dismissAt });

    // Entries older than the global mark are already covered by it, and the list
    // should not grow without bound.
    const seen = user.notificationsSeenAt ? new Date(user.notificationsSeenAt).getTime() : 0;
    user.notificationReads = reads
      .filter(entry => new Date(entry.at).getTime() > seen)
      .slice(-200);

    await user.save();
    res.json({ success: true, persisted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mark everything read.
app.post('/api/notifications/read-all', async (req, res) => {
  try {
    const account = await resolveNotificationUser(req);
    if (!account) return res.status(401).json({ error: 'Invalid or expired token' });
    if (!account.dbUser) return res.json({ success: true, persisted: false });

    account.dbUser.notificationsSeenAt = new Date();
    account.dbUser.notificationReads = []; // subsumed by the new mark
    await account.dbUser.save();
    res.json({ success: true, persisted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Full version history for every feature row on one page (product / combination /
// scope). Each row reports one chain per field: created -> updated to -> current.
app.get('/api/feature-history', async (req, res) => {
  try {
    const { productType, combination, scope } = req.query;
    const filter = {};
    if (productType) filter.productType = productType;
    if (scope) filter.scope = scope;
    if (combination) filter.combination = combination;

    // Soft-deleted rows are included so a removal is still visible in the history.
    const features = await Feature.find(filter).sort({ order: 1, createdAt: 1 }).lean();
    if (!features.length) return res.json({ rows: [] });

    const revisions = await Revision.find({
      entityType: 'feature',
      entityId: { $in: features.map(f => f._id) },
    }).sort({ changedAt: 1 }).lean();

    const byEntity = new Map();
    revisions.forEach((revision) => {
      const key = String(revision.entityId);
      if (!byEntity.has(key)) byEntity.set(key, []);
      byEntity.get(key).push(revision);
    });

    const rows = features.map((feature) => {
      const history = byEntity.get(String(feature._id)) || [];
      const fields = buildFieldChains('feature', history, feature);
      const lastChange = history.length ? history[history.length - 1] : null;
      return {
        entityId: String(feature._id),
        name: feature.name,
        isDeleted: !!feature.isDeleted,
        createdAt: feature.createdAt,
        updatedAt: feature.updatedAt,
        lastAction: lastChange ? lastChange.action : null,
        lastChangedAt: lastChange ? lastChange.changedAt : null,
        tracked: history.length > 0,
        fields,
      };
    }).filter(row => row.fields.length > 0);

    res.json({ rows, totalFeatures: features.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Same chain view for a single record (a matrix, cloud info page or document).
app.get('/api/history/:entityType/:entityId', async (req, res) => {
  try {
    const { entityType, entityId } = req.params;
    if (!mongoose.isValidObjectId(entityId)) return res.status(400).json({ error: 'Invalid id' });

    const MODELS = {
      feature: Feature,
      compatibility: CompatibilityMatrix,
      cloudInfo: CloudInfo,
      document: DocModel,
      productConfig: ProductConfig,
    };
    const Model = MODELS[entityType];
    if (!Model) return res.status(400).json({ error: 'Unknown entity type' });

    const liveDoc = await Model.findById(entityId).lean();
    const revisions = await Revision.find({ entityType, entityId }).sort({ changedAt: 1 }).lean();
    const fields = buildFieldChains(entityType, revisions, liveDoc);
    const lastChange = revisions.length ? revisions[revisions.length - 1] : null;

    res.json({
      rows: fields.length ? [{
        entityId,
        name: liveDoc ? liveDoc.name : '',
        isDeleted: liveDoc ? !!liveDoc.isDeleted : false,
        createdAt: liveDoc ? liveDoc.createdAt : null,
        updatedAt: liveDoc ? liveDoc.updatedAt : null,
        lastAction: lastChange ? lastChange.action : null,
        lastChangedAt: lastChange ? lastChange.changedAt : null,
        tracked: revisions.length > 0,
        fields,
      }] : [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk equivalent of recordRevision for routes that write many documents at once
// (family rename, bulk import, delete-by-scope). Without this, a bulk write is
// invisible to history — and worse, it can swallow a change that a later per-row
// save would otherwise have recorded.
async function recordRevisions(entityType, pairs, action = 'updated', req) {
  try {
    const docs = [];
    pairs.forEach(({ before, after }) => {
      if (!after) return;
      const changes = action === 'updated'
        ? buildChanges(entityType, before, after)
        : (action === 'created' ? buildInitialChanges(entityType, after) : []);
      if (action === 'updated' && !changes.length) return;
      docs.push({
        entityType,
        entityId: after._id || (before && before._id),
        entityName: after.name || (before && before.name) || '',
        action,
        ...actorFrom(req),
        changedAt: new Date(),
        changes,
      });

    });
    if (docs.length) await Revision.insertMany(docs, { ordered: false });

    if (docs.length) {
      const names = docs.map(d => d.entityName).filter(Boolean);
      // A bulk save always targets one product type / scope / combination, so the
      // whole batch shares a location.
      const firstDoc = (pairs.find(p => p && p.after) || {}).after || {};
      const bulkScope = firstDoc.scope === 'outscope' ? 'Out of Scope' : 'In Scope';
      const bulkWhere = entityType === 'feature' && firstDoc.productType
        ? ` in ${firstDoc.productType}${firstDoc.combination ? ' / ' + firstDoc.combination : ''} (${bulkScope})`
        : ''
      ;
      await audit(req, {
        action: `content.bulk_${action}`,
        category: 'content',
        targetType: entityType,
        targetName: names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3} more` : ''),
        // One row reads like a single create; several are listed by name.
        summary: docs.length === 1
          ? `${ENTITY_LABEL[entityType] || entityType} "${names[0] || ''}"${bulkWhere} ${action}`
          : `${docs.length} ${ENTITY_LABEL[entityType] || entityType} records ${action}${bulkWhere}`
            + (names.length ? ` — ${names.slice(0, 5).join(', ')}${names.length > 5 ? ` and ${names.length - 5} more` : ''}` : ''),
        details: {
          count: docs.length,
          names: names.slice(0, 50),
          productType: firstDoc.productType,
          combination: firstDoc.combination,
          scope: firstDoc.scope,
        },
      });
    }
  } catch (err) {
    console.error(`Failed to record ${entityType} ${action} revisions:`, err.message);
  }
}

// Records a record being added or removed. A 'created' entry carries the values the
// record started with, which is what anchors the "created: …" step of every chain.
async function recordLifecycle(entityType, doc, action, req) {
  try {
    if (!doc) return;
    await Revision.create({
      entityType,
      entityId: doc._id,
      entityName: doc.name || '',
      action,
      ...actorFrom(req),
      changedAt: new Date(),
      changes: action === 'created' ? buildInitialChanges(entityType, doc) : [],
    });

    // Same reasoning as content.updated: a name on its own does not say where the
    // row lives, and the same name exists under other combinations.
    const lifecycleScope = doc.scope === 'outscope' ? 'Out of Scope' : 'In Scope';
    const lifecycleWhere = entityType === 'feature' && doc.productType
      ? ` in ${doc.productType}${doc.combination ? ' / ' + doc.combination : ''} (${lifecycleScope})`
      : '';
    await audit(req, {
      action: `content.${action}`,
      category: 'content',
      targetType: entityType,
      targetId: doc._id,
      targetName: doc.name || '',
      summary: `${ENTITY_LABEL[entityType] || entityType} "${doc.name || ''}"${lifecycleWhere} ${action}`,
    });
  } catch (err) {
    console.error(`Failed to record ${entityType} ${action}:`, err.message);
  }
}

// Latest revisions for one record, newest first.
app.get('/api/revisions/:entityType/:entityId', async (req, res) => {
  try {
    const { entityType, entityId } = req.params;
    if (!mongoose.isValidObjectId(entityId)) return res.status(400).json({ error: 'Invalid id' });
    const limit = Math.min(Number(req.query.limit) || 1, 20);
    const revisions = await Revision.find({ entityType, entityId })
      .sort({ changedAt: -1 })
      .limit(limit)
      .lean();
    res.json({ revisions: revisions.map(r => ({ ...r, id: r._id.toString() })) });
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
      audit(req, { // not awaited: this runs inside multer's synchronous callback
        action: 'upload.screenshots', category: 'content',
        targetType: 'screenshot', targetName: `${paths.length} file(s)`,
        summary: `Uploaded ${paths.length} screenshot(s)`,
        details: { paths },
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
    await recordLifecycle('compatibility', matrix.toObject(), 'created', req);
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
    await audit(req, {
      action: 'content.reordered', category: 'content',
      targetType: 'compatibility', targetName: 'display order',
      summary: `Reordered ${(orderedIds || []).length} compatibility matrices`,
      details: { count: (orderedIds || []).length },
    });
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
    const before = await CompatibilityMatrix.findById(req.params.id).lean();
    const matrix = await CompatibilityMatrix.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true }).lean();
    if (!matrix) return res.status(404).json({ error: 'Matrix not found' });
    await recordRevision('compatibility', before, matrix, req);
    res.json({ success: true, matrix: { ...matrix, id: matrix._id.toString() } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/compatibility/:id', async (req, res) => {
  try {
    const matrix = await CompatibilityMatrix.findByIdAndUpdate(req.params.id, { isDeleted: true, deletedAt: new Date() }, { new: true });
    if (!matrix) return res.status(404).json({ error: 'Matrix not found' });
    await recordLifecycle('compatibility', matrix.toObject(), 'deleted', req);
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
    await recordLifecycle('cloudInfo', item.toObject(), 'created', req);
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
    const before = await CloudInfo.findById(req.params.id).lean();
    const item = await CloudInfo.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true }).lean();
    if (!item) return res.status(404).json({ error: 'Not found' });
    await recordRevision('cloudInfo', before, item, req);
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
    await recordLifecycle('cloudInfo', item.toObject(), 'deleted', req);
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
    await audit(req, {
      action: 'content.reordered', category: 'content',
      targetType: 'cloudInfo', targetName: 'display order',
      summary: `Reordered ${(orderedIds || []).length} cloud info pages`,
      details: { count: (orderedIds || []).length },
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --------------- Documents ---------------

function slugifyDocument(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

app.get('/api/documents', async (req, res) => {
  try {
    const items = await DocModel.find({ isDeleted: { $ne: true } }).sort({ order: 1, createdAt: 1 }).lean();
    res.json({ items: items.map(i => ({ ...i, id: i._id.toString() })) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/documents/:slug', async (req, res) => {
  try {
    const item = await DocModel.findOne({ slug: req.params.slug, isDeleted: { $ne: true } }).lean();
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json({ item: { ...item, id: item._id.toString() } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/documents/reorder', async (req, res) => {
  try {
    const { orderedIds } = req.body;
    if (!Array.isArray(orderedIds)) return res.status(400).json({ error: 'orderedIds array required' });
    const ops = orderedIds.map((id, idx) => ({
      updateOne: { filter: { _id: id }, update: { $set: { order: idx } } }
    }));
    await DocModel.bulkWrite(ops);
    await audit(req, {
      action: 'content.reordered', category: 'content',
      targetType: 'document', targetName: 'display order',
      summary: `Reordered ${(orderedIds || []).length} documents`,
      details: { count: (orderedIds || []).length },
    });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/documents', async (req, res) => {
  try {
    const { name, content, fileType } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    let slug = slugifyDocument(name);
    const existing = await DocModel.findOne({ slug }).lean();
    if (existing) slug = slug + '-' + Date.now();
    const count = await DocModel.countDocuments();
    const item = await DocModel.create({
      name, slug, content: content || '', fileType: fileType || 'manual', order: count,
    });
    await recordLifecycle('document', item.toObject(), 'created', req);
    res.json({ success: true, item: { ...item.toObject(), id: item._id.toString() } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const docsDir = path.join(__dirname, 'assets', 'documents');
if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
app.use('/assets/documents', express.static(docsDir));

const docStorage = multer.diskStorage({
  destination: (req, file, cb) => { cb(null, docsDir); },
  filename: (req, file, cb) => {
    const safe = (req.body.name || 'document').replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_');
    const ext = path.extname(file.originalname) || '';
    cb(null, `${safe}_${Date.now()}${ext}`);
  },
});
const docUpload = multer({ storage: docStorage });

app.post('/api/documents/upload', docUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const name = req.body.name || path.parse(req.file.originalname).name;
    let slug = slugifyDocument(name);
    const existing = await DocModel.findOne({ slug }).lean();
    if (existing) slug = slug + '-' + Date.now();

    const ext = path.extname(req.file.originalname).toLowerCase().replace('.', '');
    const fileUrl = `/assets/documents/${req.file.filename}`;
    let content = '';
    let fileType = ext || 'manual';

    if (ext === 'docx') {
      try {
        const mammoth = require('mammoth');
        const result = await mammoth.convertToHtml({
          path: req.file.path,
        }, {
          convertImage: mammoth.images.imgElement(function (image) {
            return image.read('base64').then(function (imageBuffer) {
              return { src: 'data:' + image.contentType + ';base64,' + imageBuffer };
            });
          }),
        });
        content = result.value;
        fileType = 'docx';
      } catch (_) { fileType = 'docx'; }
    }

    const count = await DocModel.countDocuments();
    const item = await DocModel.create({ name, slug, content, fileUrl, fileType, order: count });
    await audit(req, {
      action: 'upload.document_file', category: 'content',
      targetType: 'document', targetName: (req.file && req.file.originalname) || '',
      summary: `Uploaded document file ${(req.file && req.file.originalname) || ''}`,
      details: { size: req.file && req.file.size, mimetype: req.file && req.file.mimetype },
    });
    res.json({ success: true, item: { ...item.toObject(), id: item._id.toString() } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/documents/:id', async (req, res) => {
  try {
    const { name, content, fileType } = req.body;
    const update = {};
    if (name !== undefined) {
      update.name = name;
      update.slug = slugifyDocument(name);
      const existing = await DocModel.findOne({ slug: update.slug, _id: { $ne: req.params.id } }).lean();
      if (existing) update.slug = update.slug + '-' + Date.now();
    }
    if (content !== undefined) update.content = content;
    if (fileType !== undefined) update.fileType = fileType;
    const before = await DocModel.findById(req.params.id).lean();
    const item = await DocModel.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true }).lean();
    if (!item) return res.status(404).json({ error: 'Not found' });
    await recordRevision('document', before, item, req);
    res.json({ success: true, item: { ...item, id: item._id.toString() } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/documents/:id', async (req, res) => {
  try {
    const item = await DocModel.findByIdAndUpdate(req.params.id, { isDeleted: true, deletedAt: new Date() }, { new: true });
    if (!item) return res.status(404).json({ error: 'Not found' });
    await recordLifecycle('document', item.toObject(), 'deleted', req);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --------------- Trash Management ---------------

app.get('/api/trash', async (req, res) => {
  try {
    const [features, productConfigs, matrices, cloudInfos, deletedCombinations, documents] = await Promise.all([
      Feature.find({ isDeleted: true }).sort({ deletedAt: -1 }).lean(),
      ProductConfig.find({ isDeleted: true }).sort({ deletedAt: -1 }).lean(),
      CompatibilityMatrix.find({ isDeleted: true }).select('name slug deletedAt').sort({ deletedAt: -1 }).lean(),
      CloudInfo.find({ isDeleted: true }).select('name slug deletedAt').sort({ deletedAt: -1 }).lean(),
      DeletedCombination.find({ isDeleted: true }).sort({ deletedAt: -1 }).lean(),
      DocModel.find({ isDeleted: true }).select('name slug deletedAt').sort({ deletedAt: -1 }).lean(),
    ]);
    res.json({
      features: features.map(f => ({ ...mapFeature(f), deletedAt: f.deletedAt })),
      productConfigs: productConfigs.map(c => ({ id: c._id.toString(), name: c.name, combinations: c.combinations, deletedAt: c.deletedAt })),
      matrices: matrices.map(m => ({ id: m._id.toString(), name: m.name, slug: m.slug, deletedAt: m.deletedAt })),
      cloudInfos: cloudInfos.map(i => ({ id: i._id.toString(), name: i.name, slug: i.slug, deletedAt: i.deletedAt })),
      documents: documents.map(d => ({ id: d._id.toString(), name: d.name, slug: d.slug, deletedAt: d.deletedAt })),
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
      await audit(req, {
        action: 'content.combination_restored', category: 'content',
        targetType: 'productConfig', targetId: comboTrash.productConfigId,
        targetName: comboTrash.combination,
        summary: `Combination "${comboTrash.combination}" restored from Trash in ${comboTrash.productType}` + ` — ${(comboTrash.featureIds || []).length} feature(s) brought back`,
        details: { combination: comboTrash.combination, productType: comboTrash.productType, features: (comboTrash.featureIds || []).length },
      });
      return res.json({ success: true });
    }

    let Model;
    if (type === 'feature') Model = Feature;
    else if (type === 'productConfig') Model = ProductConfig;
    else if (type === 'compatibility') Model = CompatibilityMatrix;
    else if (type === 'cloudInfo') Model = CloudInfo;
    else if (type === 'document') Model = DocModel;
    else return res.status(400).json({ error: 'Invalid type' });

    const doc = await Model.findByIdAndUpdate(id, { isDeleted: false, deletedAt: null }, { new: true });
    if (!doc) return res.status(404).json({ error: 'Not found' });

    // A restore is a content change: it belongs in the revision log so the row
    // reappears in version history and the people watching that page are told.
    await recordLifecycle(type, doc.toObject ? doc.toObject() : doc, 'restored', req);
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
      await audit(req, {
        action: 'content.permanently_deleted', category: 'content',
        targetType: String(req.params.type), targetId: req.params.id,
        summary: `Permanently deleted ${req.params.type} from Trash`,
      });
      return res.json({ success: true });
    }

    let Model;
    if (type === 'feature') Model = Feature;
    else if (type === 'productConfig') Model = ProductConfig;
    else if (type === 'compatibility') Model = CompatibilityMatrix;
    else if (type === 'cloudInfo') Model = CloudInfo;
    else if (type === 'document') Model = DocModel;
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
    if (url.startsWith('/assets/') || url.startsWith('assets/')) {
      const localPath = path.join(__dirname, url.startsWith('/') ? url.slice(1) : url);
      if (fs.existsSync(localPath)) {
        return res.sendFile(path.resolve(localPath));
      }
      return res.status(404).send('Local file not found');
    }
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
