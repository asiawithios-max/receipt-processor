require("dotenv").config();
const express    = require('express');
const bodyParser = require('body-parser');
const PDFDocument = require('pdfkit');
const { v4: uuidv4 } = require('uuid');
const fs         = require('fs');
const path       = require('path');
const { MongoClient } = require('mongodb');
const bcrypt     = require('bcryptjs');

const app        = express();
const PORT       = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const APP_URL    = process.env.APP_URL || 'https://recipt-processor-production.up.railway.app';

// ── Super admin accounts (hardcoded, never in DB) ────────────
const SUPER_ADMINS = [
  { id: 'superadmin-1', name: 'Asia Mims-Johnson',  role: 'superadmin' },
  { id: 'superadmin-2', name: 'Donovan Johnson',     role: 'superadmin' },
];
const SUPER_ADMIN_PASSWORD_HASH = bcrypt.hashSync('IOS2025!', 10); // fallback only

app.use(bodyParser.json({ limit: '20mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '20mb' }));
app.use(express.static('public'));
app.use('/pdfs', express.static('pdfs'));

if (!fs.existsSync(path.join(__dirname, 'pdfs'))) fs.mkdirSync(path.join(__dirname, 'pdfs'));

// ── MongoDB ──────────────────────────────────────────────────
let db;
async function connectDB() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  // Use database name from URI or default to 'receipts'
  const uri = process.env.MONGODB_URI || '';
  const dbName = uri.includes('/receipts-dev') ? 'receipts-dev'
               : uri.includes('/receipts-staging') ? 'receipts-staging'
               : 'receipts';
  db = client.db(dbName);
  console.log('Connected to MongoDB');

  // Migrate existing JSON data
  const DATA_FILE = path.join(__dirname, 'data', 'submissions.json');
  if (fs.existsSync(DATA_FILE)) {
    const existing = JSON.parse(fs.readFileSync(DATA_FILE));
    if (existing.length > 0) {
      const col = db.collection('submissions');
      for (const s of existing) {
        await col.updateOne({ id: s.id }, { $setOnInsert: s }, { upsert: true });
      }
      console.log('Migrated ' + existing.length + ' submissions');
    }
  }

  // Seed rep accounts if not already seeded
  await seedAccounts();

  // Run status migration: unsigned → unsent
  await migrateStatuses();

  // Run name migration: link submissions to rep accounts
  await migrateSubmissionAccounts();
}

function getCol()      { return db.collection('submissions'); }
function getReps()     { return db.collection('reps'); }
function getSessions() { return db.collection('sessions'); }

// ── Seed accounts ────────────────────────────────────────────
async function seedAccounts() {
  const reps = getReps();
  const accounts = [
    { name: 'Angela Johnson',   role: 'rep' },
    { name: 'Lynn Bynes',       role: 'rep' },
    { name: 'Ralph Concepcion', role: 'rep' },
    { name: 'Weston Ferguson',  role: 'rep' },
    { name: 'Randy Gohn',       role: 'cs'  },
    { name: 'Jimi Taft',        role: 'cs'  },
    { name: 'Bill Sivadon',     role: 'cs'  },
  ];
  const tempHash = bcrypt.hashSync('IOS2025!', 10);
  for (const acct of accounts) {
    const existing = await reps.findOne({ name: acct.name });
    if (!existing) {
      await reps.insertOne({
        id:                uuidv4(),
        name:              acct.name,
        role:              acct.role,
        passwordHash:      tempHash,
        mustChangePassword: true,
        active:            true,
        createdAt:         new Date().toISOString(),
        lastLoginAt:       null,
      });
      console.log('Created account: ' + acct.name);
    }
  }
}

// ── Status migration ─────────────────────────────────────────
async function migrateStatuses() {
  const result = await getCol().updateMany(
    { signatureStatus: 'unsigned' },
    { $set: { signatureStatus: 'unsent' } }
  );
  if (result.modifiedCount > 0) {
    console.log('Migrated ' + result.modifiedCount + ' submissions: unsigned → unsent');
  }
}

// ── Account migration ─────────────────────────────────────────
async function migrateSubmissionAccounts() {
  const submissions = await getCol().find({ repAccountId: { $exists: false } }).toArray();
  if (!submissions.length) return;

  const allReps = await getReps().find({}).toArray();
  let linked = 0;

  for (const s of submissions) {
    if (!s.salesRep) continue;
    // Find matching rep account - check if salesRep field contains the rep name
    const match = allReps.find(r =>
      s.salesRep === r.name ||
      s.salesRep.includes(r.name) ||
      // Randy Jones → Randy Gohn fix
      (r.name === 'Randy Gohn' && s.salesRep === 'Randy Jones') ||
      // Lynn Bynes → Stephani Hollis fix
      (r.name === 'Lynn Bynes' && s.salesRep === 'Stephani Hollis')
    );
    if (match) {
      await getCol().updateOne(
        { id: s.id },
        { $set: { repAccountId: match.id } }
      );
      linked++;
    }
  }
  if (linked > 0) console.log('Linked ' + linked + ' submissions to rep accounts');
}

// ── Auth middleware ───────────────────────────────────────────
async function requireAuth(roles) {
  return async (req, res, next) => {
    const token = req.headers['x-session-token'];
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    // Check super admin
    const superAdmin = SUPER_ADMINS.find(a => a.id === token.split(':')[0]);
    if (superAdmin) {
      const session = await getSessions().findOne({ token, active: true });
      if (!session) return res.status(401).json({ error: 'Session expired' });
      if (new Date() > new Date(session.expiresAt)) {
        await getSessions().updateOne({ token }, { $set: { active: false } });
        return res.status(401).json({ error: 'Session expired' });
      }
      if (roles && !roles.includes('superadmin')) return res.status(403).json({ error: 'Forbidden' });
      req.user = { ...superAdmin };
      return next();
    }

    // Check rep/cs
    const session = await getSessions().findOne({ token, active: true });
    if (!session) return res.status(401).json({ error: 'Session expired' });
    if (new Date() > new Date(session.expiresAt)) {
      await getSessions().updateOne({ token }, { $set: { active: false } });
      return res.status(401).json({ error: 'Session expired' });
    }
    const rep = await getReps().findOne({ id: session.repId });
    if (!rep || !rep.active) return res.status(401).json({ error: 'Account inactive' });
    if (roles && !roles.includes(rep.role)) return res.status(403).json({ error: 'Forbidden' });
    req.user = rep;
    next();
  };
}

// ── Static pages ─────────────────────────────────────────────
app.get('/',          (req, res) => res.redirect('/login'));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'views', 'dashboard.html')));
app.get('/help',      (req, res) => res.sendFile(path.join(__dirname, 'public', 'help.html')));
app.get('/login',     (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/rep',       (req, res) => res.sendFile(path.join(__dirname, 'public', 'rep.html')));
app.get('/cs',        (req, res) => res.sendFile(path.join(__dirname, 'public', 'cs.html')));
app.get('/sign/:token', (req, res) => res.sendFile(path.join(__dirname, 'public', 'sign.html')));

// ── Auth routes ───────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  try {
    const { name, password } = req.body;
    if (!name || !password) return res.status(400).json({ error: 'Name and password required' });

    // Check super admin
    const superAdmin = SUPER_ADMINS.find(a => a.name.toLowerCase() === name.toLowerCase());
    if (superAdmin) {
      // Check admin_passwords collection first, fall back to hardcoded hash
      let validHash = SUPER_ADMIN_PASSWORD_HASH;
      const adminPw = await db.collection('admin_passwords').findOne({ id: superAdmin.id });
      if (adminPw && adminPw.passwordHash) validHash = adminPw.passwordHash;
      const valid = bcrypt.compareSync(password, validHash);
      if (!valid) return res.status(401).json({ error: 'Invalid name or password' });
      const token = superAdmin.id + ':' + uuidv4();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      await getSessions().insertOne({
        token, repId: superAdmin.id, role: 'superadmin',
        active: true, createdAt: new Date().toISOString(), expiresAt
      });
      return res.json({
        success: true, token, expiresAt,
        user: { id: superAdmin.id, name: superAdmin.name, role: 'superadmin', mustChangePassword: false }
      });
    }

    // Check rep/cs
    const rep = await getReps().findOne({
      name: { $regex: new RegExp('^' + name.trim() + '$', 'i') },
      active: true
    });
    if (!rep) return res.status(401).json({ error: 'Invalid name or password' });
    const valid = bcrypt.compareSync(password, rep.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Invalid name or password' });

    const token = rep.id + ':' + uuidv4();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await getSessions().insertOne({
      token, repId: rep.id, role: rep.role,
      active: true, createdAt: new Date().toISOString(), expiresAt
    });
    await getReps().updateOne({ id: rep.id }, { $set: { lastLoginAt: new Date().toISOString() } });

    res.json({
      success: true, token, expiresAt,
      user: { id: rep.id, name: rep.name, role: rep.role, mustChangePassword: rep.mustChangePassword }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  const token = req.headers['x-session-token'];
  if (token) await getSessions().updateOne({ token }, { $set: { active: false } });
  res.json({ success: true });
});

app.get('/api/auth/session', async (req, res) => {
  const token = req.headers['x-session-token'];
  if (!token) return res.json({ valid: false });
  const session = await getSessions().findOne({ token, active: true });
  if (!session || new Date() > new Date(session.expiresAt)) return res.json({ valid: false });
  // Return user info
  if (session.role === 'superadmin') {
    const sa = SUPER_ADMINS.find(a => a.id === session.repId);
    return res.json({ valid: true, user: { name: sa.name, role: 'superadmin', mustChangePassword: false } });
  }
  const rep = await getReps().findOne({ id: session.repId });
  if (!rep) return res.json({ valid: false });
  res.json({ valid: true, user: { name: rep.name, role: rep.role, mustChangePassword: rep.mustChangePassword } });
});

app.post('/api/auth/change-password', async (req, res) => {
  try {
    const token = req.headers['x-session-token'];
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    const session = await getSessions().findOne({ token, active: true });
    if (!session) return res.status(401).json({ error: 'Session expired' });
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const hash = bcrypt.hashSync(newPassword, 10);
    await getReps().updateOne({ id: session.repId }, { $set: { passwordHash: hash, mustChangePassword: false } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin account management ──────────────────────────────────
app.get('/api/admin/accounts', async (req, res) => {
  // Accept old dashboard password OR super admin session token
  const dashPw = req.headers['x-dashboard-password'];
  const token  = req.headers['x-session-token'];
  const validDash = dashPw === 'receipt2024';
  if (!validDash && !token) return res.status(401).json({ error: 'Not authenticated' });
  if (token && !validDash) {
    const session = await getSessions().findOne({ token, active: true });
    if (!session || new Date() > new Date(session.expiresAt)) return res.status(401).json({ error: 'Session expired' });
    if (session.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
  }
  const accounts = await getReps().find({}).sort({ role: 1, name: 1 }).toArray();
  res.json(accounts.map(a => ({ ...a, passwordHash: undefined })));
});

app.post('/api/admin/accounts', async (req, res) => {
  const authMiddleware = await requireAuth(['superadmin']);
  authMiddleware(req, res, async () => {
    try {
      const { name, role, password } = req.body;
      if (!name || !role) return res.status(400).json({ error: 'Name and role required' });
      const existing = await getReps().findOne({ name: { $regex: new RegExp('^' + name + '$', 'i') } });
      if (existing) return res.status(400).json({ error: 'Account with this name already exists' });
      const tempPass = password || 'IOS2025!';
      const hash = bcrypt.hashSync(tempPass, 10);
      const account = {
        id: uuidv4(), name, role,
        passwordHash: hash, mustChangePassword: true,
        active: true, createdAt: new Date().toISOString(), lastLoginAt: null,
      };
      await getReps().insertOne(account);
      res.json({ success: true, id: account.id });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
});

app.patch('/api/admin/accounts/:id', async (req, res) => {
  const authMiddleware = await requireAuth(['superadmin']);
  authMiddleware(req, res, async () => {
    try {
      const { name, role, active, resetPassword } = req.body;
      const update = {};
      if (name !== undefined) update.name = name;
      if (role !== undefined) update.role = role;
      if (active !== undefined) update.active = active;
      if (resetPassword) {
        update.passwordHash = bcrypt.hashSync('IOS2025!', 10);
        update.mustChangePassword = true;
      }
      await getReps().updateOne({ id: req.params.id }, { $set: update });
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
});

app.delete('/api/admin/accounts/:id', async (req, res) => {
  const authMiddleware = await requireAuth(['superadmin']);
  authMiddleware(req, res, async () => {
    try {
      await getReps().deleteOne({ id: req.params.id });
      await getSessions().updateMany({ repId: req.params.id }, { $set: { active: false } });
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
});

// ── Storage health ────────────────────────────────────────────
app.get('/api/admin/storage-health', async (req, res) => {
  try {
    const stats = await db.command({ dbStats: 1 });
    const usedMB = (stats.dataSize / (1024 * 1024)).toFixed(2);
    const limitMB = 512;
    const pct = ((usedMB / limitMB) * 100).toFixed(1);
    res.json({ usedMB, limitMB, pct });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Rep submissions (filtered) ────────────────────────────────
app.get('/api/rep/submissions', async (req, res) => {
  const authMiddleware = await requireAuth(['rep']);
  authMiddleware(req, res, async () => {
    const subs = await getCol()
      .find({ repAccountId: req.user.id })
      .sort({ timestamp: -1 }).toArray();
    res.json(subs);
  });
});

// ── CS submissions (all, read-only) ──────────────────────────
app.get('/api/cs/submissions', async (req, res) => {
  const authMiddleware = await requireAuth(['cs', 'superadmin']);
  authMiddleware(req, res, async () => {
    const subs = await getCol().find({}).sort({ timestamp: -1 }).toArray();
    // Strip payment details for CS role
    if (req.user.role === 'cs') {
      res.json(subs.map(s => ({
        ...s,
        cardLast4: undefined, cardExp: undefined,
      })));
    } else {
      res.json(subs);
    }
  });
});

// ── Existing submissions route (dashboard) ────────────────────
app.get('/api/submissions', async (req, res) => {
  const submissions = await getCol().find({}).sort({ timestamp: -1 }).toArray();
  res.json(submissions);
});

app.get('/api/submissions/:id', async (req, res) => {
  const s = await getCol().findOne({ id: req.params.id });
  if (s) res.json(s);
  else res.status(404).json({ error: 'Not found' });
});

// ── Export CSV ────────────────────────────────────────────────
app.get('/api/export', async (req, res) => {
  const submissions = await getCol().find({}).sort({ timestamp: -1 }).toArray();
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="receipts_all.csv"');
  res.send(buildCSV(submissions));
});

app.get('/api/export/range', async (req, res) => {
  const { from, to } = req.query;
  const all = await getCol().find({}).sort({ timestamp: -1 }).toArray();
  const filtered = all.filter(s => {
    const d = s.saleDate || s.timestamp.slice(0, 10);
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
  const label = (from || 'start') + '_to_' + (to || 'end');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="receipts_' + label + '.csv"');
  res.send(buildCSV(filtered));
});

function buildCSV(submissions) {
  const headers = ['Date','Sale Date','ID','Status','Archived','CRM Confirmed','Sales Rep','Customer Name','Address','City/ZIP','Email','Company','Products','Amount','Payment #','of #','Payment Method','Card Last 4','Exp','Payment Plan','Rebate','Sales Notes','Link Sent At','First Opened','Last Viewed','View Count','Signed At','Last Edited By','Last Edited At'];
  const rows = submissions.map(s => [
    new Date(s.timestamp).toLocaleDateString('en-US'),
    s.saleDate || '', s.id,
    s.signatureStatus || 'unsent',
    s.archived ? 'Yes' : 'No',
    s.crmConfirmedAt ? 'Yes' : 'No',
    s.salesRep || '', s.customerName || '', s.customerAddress || '',
    s.customerCity || '', s.customerEmail || '', s.saleCompany || '',
    (s.products || []).join(' | '), s.transactionAmount || '',
    s.paymentNum || '', s.paymentOf || '', s.paymentMethod || '',
    s.cardLast4 || '', s.cardExp || '', s.paymentPlan || '',
    s.rebateDiscount || '', s.salesNotes || '',
    s.linkSentAt || '', s.linkOpenedAt || '', s.linkLastViewedAt || '',
    s.linkViewCount || 0, s.signedAt || '',
    s.lastEditedBy || '', s.lastEditedAt || '',
  ].map(v => '"' + String(v).replace(/"/g, '""') + '"'));
  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

// ── Submit new receipt ────────────────────────────────────────
app.post('/submit', async (req, res) => {
  try {
    const data = req.body;
    const id = uuidv4().slice(0, 8).toUpperCase();
    const timestamp = new Date().toISOString();
    const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    // Get rep account ID from session token if present
    let repAccountId = null;
    const token = req.headers['x-session-token'];
    if (token) {
      const session = await getSessions().findOne({ token, active: true });
      if (session) repAccountId = session.repId;
    }
    // Fallback: match by name
    if (!repAccountId && data.salesRep) {
      const rep = await getReps().findOne({ name: data.salesRep });
      if (rep) repAccountId = rep.id;
    }

    const submission = {
      id, timestamp, repAccountId,
      signatureStatus: 'unsent',
      signatureToken: null, signatureSentAt: null,
      signedAt: null, signatureImage: null, signerName: null, signDate: null,
      linkSentAt: null, linkOpenedAt: null, linkLastViewedAt: null, linkViewCount: 0,
      archived: false, archivedAt: null,
      crmConfirmedAt: null, crmConfirmedBy: null,
      lastEditedAt: null, lastEditedBy: null, editHistory: [],
      salesRep: data.salesRep || '',
      saleDate: data.saleDate || new Date().toISOString().slice(0, 10),
      customerName: data.customerName || '',
      customerAddress: data.customerAddress || '',
      customerCity: data.customerCity || '',
      customerEmail: data.customerEmail || '',
      products: Array.isArray(data.products) ? data.products : [data.products].filter(Boolean),
      productNotes: data.productNotes || {},
      saleCompany: data.saleCompany || '',
      saleCompanyOther: data.saleCompanyOther || '',
      rebateDiscount: data.rebateDiscount || '',
      transactionAmount: data.transactionAmount || '',
      paymentNum: data.paymentNum || '1',
      paymentOf: data.paymentOf || '1',
      paymentMethod: data.paymentMethod || '',
      cardLast4: data.cardLast4 || '',
      cardExp: data.cardExp || '',
      paymentPlan: data.paymentPlan || '',
      salesNotes: data.salesNotes || '',
    };

    await getCol().insertOne(submission);
    const filename = makePdfFilename(submission);
    const pdfPath = path.join(__dirname, 'pdfs', filename);
    generatePDF(submission, dateStr, pdfPath, () => {
      res.json({ success: true, filename, id });
    });
  } catch (err) {
    console.error('Submit error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Signed PDF on demand ──────────────────────────────────────
app.get('/api/pdf/:id', async (req, res) => {
  try {
    const s = await getCol().findOne({ id: req.params.id });
    if (!s) return res.status(404).send('Not found');
    const dateStr = new Date(s.timestamp).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const filename = makePdfFilename(s);
    const pdfPath = path.join(__dirname, 'pdfs', filename);
    generatePDF(s, dateStr, pdfPath, () => {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="' + filename + '"');
      fs.createReadStream(pdfPath).pipe(res);
    });
  } catch (err) { res.status(500).send('Error'); }
});

// ── Unsigned template PDF ─────────────────────────────────────
app.get('/api/pdf/original/:id', async (req, res) => {
  try {
    const s = await getCol().findOne({ id: req.params.id });
    if (!s) return res.status(404).send('Not found');
    const dateStr = new Date(s.timestamp).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const filename = 'UNSIGNED_' + makePdfFilename(s);
    const pdfPath = path.join(__dirname, 'pdfs', filename);
    const unsigned = Object.assign({}, s, { signatureImage: null, signedAt: null, signDate: null });
    generatePDF(unsigned, dateStr, pdfPath, () => {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="' + filename + '"');
      fs.createReadStream(pdfPath).pipe(res);
    });
  } catch (err) { res.status(500).send('Error'); }
});

// ── Get signing link ──────────────────────────────────────────
app.post('/api/send-signature/:id', async (req, res) => {
  try {
    const s = await getCol().findOne({ id: req.params.id });
    if (!s) return res.status(404).json({ error: 'Not found' });
    const token = s.signatureToken || uuidv4();
    const signingLink = APP_URL + '/sign/' + token;
    // Only save the token — never auto-advance status to 'sent'
    // Status only changes when rep explicitly clicks Mark Sent
    if (!s.signatureToken) {
      await getCol().updateOne({ id: req.params.id }, {
        $set: { signatureToken: token }
      });
    }
    res.json({ success: true, signingLink });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Mark link sent ────────────────────────────────────────────
app.post('/api/submissions/:id/mark-sent', async (req, res) => {
  try {
    const s = await getCol().findOne({ id: req.params.id });
    if (!s) return res.status(404).json({ error: 'Not found' });
    if (s.linkSentAt) return res.json({ success: true, linkSentAt: s.linkSentAt, alreadySet: true });
    const linkSentAt = new Date().toISOString();
    await getCol().updateOne({ id: req.params.id }, {
      $set: { linkSentAt, signatureStatus: s.signatureStatus === 'signed' ? 'signed' : 'sent' }
    });
    res.json({ success: true, linkSentAt });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── CRM Confirmed ─────────────────────────────────────────────
app.post('/api/submissions/:id/confirm-crm', async (req, res) => {
  try {
    const token = req.headers['x-session-token'];
    let confirmedBy = 'Admin';
    if (token) {
      const session = await getSessions().findOne({ token, active: true });
      if (session) {
        if (session.role === 'superadmin') {
          const sa = SUPER_ADMINS.find(a => a.id === session.repId);
          if (sa) confirmedBy = sa.name;
        } else {
          const rep = await getReps().findOne({ id: session.repId });
          if (rep) confirmedBy = rep.name;
        }
      }
    }
    await getCol().updateOne({ id: req.params.id }, {
      $set: { crmConfirmedAt: new Date().toISOString(), crmConfirmedBy: confirmedBy }
    });
    res.json({ success: true, confirmedBy });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Archive / Unarchive ───────────────────────────────────────
app.post('/api/submissions/:id/archive', async (req, res) => {
  try {
    await getCol().updateOne({ id: req.params.id }, {
      $set: { archived: true, archivedAt: new Date().toISOString() }
    });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/submissions/:id/unarchive', async (req, res) => {
  try {
    await getCol().updateOne({ id: req.params.id }, {
      $set: { archived: false, archivedAt: null }
    });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Set refund note ─────────────────────────────────────────
app.post('/api/submissions/:id/refund', async (req, res) => {
  try {
    const token = req.headers['x-session-token'];
    let setBy = 'Admin';
    if (token) {
      const session = await getSessions().findOne({ token, active: true });
      if (session) {
        if (session.role === 'superadmin') {
          const sa = SUPER_ADMINS.find(a => a.id === session.repId);
          if (sa) setBy = sa.name;
        } else {
          const rep = await getReps().findOne({ id: session.repId });
          if (rep) setBy = rep.name;
        }
      }
    }
    const { refundNote } = req.body;
    if (!refundNote || !refundNote.trim()) return res.status(400).json({ error: 'Refund note required' });
    await getCol().updateOne({ id: req.params.id }, {
      $set: { refundNote: refundNote.trim(), refundedAt: new Date().toISOString(), refundedBy: setBy }
    });
    res.json({ success: true, refundedBy: setBy });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Clear refund note ─────────────────────────────────────────
app.delete('/api/submissions/:id/refund', async (req, res) => {
  try {
    await getCol().updateOne({ id: req.params.id }, {
      $unset: { refundNote: '', refundedAt: '', refundedBy: '' }
    });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Manually set signature status (admin only) ───────────────
app.post('/api/submissions/:id/set-status', async (req, res) => {
  try {
    const { status } = req.body;
    const valid = ['unsent','sent','signed'];
    if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status. Use: unsent, sent, signed' });
    await getCol().updateOne({ id: req.params.id }, { $set: { signatureStatus: status } });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── CRM Profile URL ──────────────────────────────────────────
app.post('/api/submissions/:id/crm-url', async (req, res) => {
  try {
    const { crmProfileUrl } = req.body;
    await getCol().updateOne({ id: req.params.id }, {
      $set: { crmProfileUrl: (crmProfileUrl || '').trim() }
    });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Open Receipts pool ───────────────────────────────────────
// GET all submissions eligible for open pool (7+ days, not signed, not in pool exclusion)
app.get('/api/open-receipts', async (req, res) => {
  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const subs = await getCol().find({
      signatureStatus: { $in: ['unsent', 'sent', 'viewed'] },
      timestamp: { $lt: cutoff },
      excludeFromPool: { $ne: true }
    }).sort({ timestamp: 1 }).toArray();
    res.json(subs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST claim a receipt from open pool
app.post('/api/submissions/:id/claim', async (req, res) => {
  try {
    const token = req.headers['x-session-token'];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const session = await getSessions().findOne({ token, active: true });
    if (!session) return res.status(401).json({ error: 'Unauthorized' });
    let claimerName = 'Unknown';
    if (session.role === 'superadmin') {
      const sa = SUPER_ADMINS.find(function(a) { return a.id === session.repId; });
      if (sa) claimerName = sa.name;
    } else {
      const rep = await getReps().findOne({ id: session.repId });
      if (rep) claimerName = rep.name;
    }
    await getCol().updateOne({ id: req.params.id }, {
      $set: { closedBy: claimerName, closedAt: new Date().toISOString() }
    });
    res.json({ success: true, closedBy: claimerName });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// POST remove submission from open pool (admin/cs only)
app.post('/api/submissions/:id/pool-exclude', async (req, res) => {
  try {
    const { exclude } = req.body;
    await getCol().updateOne({ id: req.params.id }, {
      $set: { excludeFromPool: exclude === true }
    });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Global Banner (admin sends, reps dismiss) ───────────────

// POST send global banner (admin only)
app.post('/api/admin/notes', async (req, res) => {
  try {
    const token = req.headers['x-session-token'];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const session = await getSessions().findOne({ token, active: true });
    if (!session || (session.role !== 'superadmin' && session.role !== 'cs')) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const sa = SUPER_ADMINS.find(a => a.id === session.repId);
    const rep = sa ? null : await getReps().findOne({ id: session.repId });
    const senderName = sa ? sa.name : (rep ? rep.name : 'Admin');
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Message text required' });
    const note = {
      id: require('crypto').randomBytes(4).toString('hex').toUpperCase(),
      senderName,
      text: text.trim(),
      noteType: 'global',
      global: true,
      resolved: false,
      dismissedBy: [],
      createdAt: new Date().toISOString()
    };
    await db.collection('notes').insertOne(note);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET global banners for a rep (undismissed only)
app.get('/api/notes/global', async (req, res) => {
  try {
    const repId = req.query.repId;
    const banners = await db.collection('notes').find({
      noteType: 'global',
      resolved: { $ne: true },
      dismissedBy: { $not: { $elemMatch: { $eq: repId } } }
    }).sort({ createdAt: -1 }).toArray();
    res.json(banners);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST dismiss a banner (rep dismisses for themselves)
app.post('/api/notes/:id/dismiss', async (req, res) => {
  try {
    const token = req.headers['x-session-token'];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const session = await getSessions().findOne({ token, active: true });
    if (!session) return res.status(401).json({ error: 'Unauthorized' });
    await db.collection('notes').updateOne(
      { id: req.params.id },
      { $addToSet: { dismissedBy: session.repId } }
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Admin banner management ──────────────────────────────────
app.get('/api/admin/banners', async (req, res) => {
  try {
    const token = req.headers['x-session-token'];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const session = await getSessions().findOne({ token, active: true });
    if (!session || (session.role !== 'superadmin' && session.role !== 'cs')) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const banners = await db.collection('notes').find({ noteType: 'global', resolved: { $ne: true } }).sort({ createdAt: -1 }).toArray();
    res.json(banners);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/admin/banners/:id', async (req, res) => {
  try {
    const token = req.headers['x-session-token'];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const session = await getSessions().findOne({ token, active: true });
    if (!session || (session.role !== 'superadmin' && session.role !== 'cs')) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await db.collection('notes').deleteOne({ id: req.params.id });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Sign page — link tracking ─────────────────────────────────
app.get('/api/sign/:token', async (req, res) => {
  const s = await getCol().findOne({ signatureToken: req.params.token });
  if (!s) return res.json({ success: false, error: 'Invalid token' });

  // Track link views
  const now = new Date().toISOString();
  const update = {
    linkLastViewedAt: now,
    linkViewCount: (s.linkViewCount || 0) + 1,
    signatureStatus: s.signatureStatus === 'signed' ? 'signed' :
                     s.signatureStatus === 'sent' ? 'viewed' :
                     s.signatureStatus === 'viewed' ? 'viewed' : s.signatureStatus
  };
  if (!s.linkOpenedAt) update.linkOpenedAt = now;
  await getCol().updateOne({ signatureToken: req.params.token }, { $set: update });

  const updated = await getCol().findOne({ signatureToken: req.params.token });
  res.json({ success: true, submission: updated });
});

// ── Customer signs ────────────────────────────────────────────
app.post('/api/sign/:token', async (req, res) => {
  try {
    const s = await getCol().findOne({ signatureToken: req.params.token });
    if (!s) return res.status(404).json({ success: false, error: 'Invalid token' });
    if (s.signatureStatus === 'signed') return res.json({ success: false, error: 'Already signed' });
    const { signatureImage, signerName, signDate } = req.body;
    await getCol().updateOne({ signatureToken: req.params.token }, {
      $set: { signatureStatus: 'signed', signedAt: new Date().toISOString(), signatureImage, signerName, signDate }
    });
    const updated = await getCol().findOne({ signatureToken: req.params.token });
    const dateStr = new Date(s.timestamp).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const pdfPath = path.join(__dirname, 'pdfs', makePdfFilename(s));
    generatePDF(updated, dateStr, pdfPath, () => {
      res.json({ success: true, id: s.id });
    });
  } catch (err) {
    console.error('Sign error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Edit submission ───────────────────────────────────────────
app.patch('/api/submissions/:id', async (req, res) => {
  try {
    const original = await getCol().findOne({ id: req.params.id });
    if (!original) return res.status(404).json({ error: 'Not found' });

    const isRepEdit = req.body._repEdit === true;
    if (isRepEdit && original.signatureStatus === 'signed') {
      return res.status(403).json({ error: 'Cannot edit a signed receipt' });
    }

    let updateData = { ...req.body };
    delete updateData._repEdit;

    // Never allow edit to overwrite signature/link tracking fields
    const PROTECTED = ['signatureStatus','signatureToken','signatureSentAt','signedAt',
      'signatureImage','signerName','signDate','linkSentAt','linkOpenedAt',
      'linkLastViewedAt','linkViewCount','archived','archivedAt',
      'crmConfirmedAt','crmConfirmedBy','refundNote','refundedAt','refundedBy'];
    PROTECTED.forEach(function(k){ delete updateData[k]; });

    // Build edit history entry
    const changedFields = {};
    const editableFields = ['transactionAmount','paymentMethod','cardLast4','cardExp','paymentNum','paymentOf','paymentPlan','rebateDiscount','customerEmail','customerAddress','customerCity','salesNotes'];
    for (const field of editableFields) {
      if (updateData[field] !== undefined && updateData[field] !== original[field]) {
        changedFields[field] = { from: original[field], to: updateData[field] };
      }
    }

    if (isRepEdit) {
      delete updateData.customerName;
      delete updateData.products;
      delete updateData.saleCompany;
      delete updateData.saleDate;
    }

    // Get editor name
    let editorName = updateData.editedBy || 'Admin';
    delete updateData.editedBy;

    updateData.lastEditedAt = new Date().toISOString();
    updateData.lastEditedBy = editorName;

    const historyEntry = {
      editedAt: updateData.lastEditedAt,
      editedBy: editorName,
      changedFields
    };

    const updated = { ...original, ...updateData, id: original.id, timestamp: original.timestamp };
    await getCol().replaceOne({ id: req.params.id }, updated);
    await getCol().updateOne({ id: req.params.id }, { $push: { editHistory: historyEntry } });

    const dateStr = new Date(original.timestamp).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const pdfPath = path.join(__dirname, 'pdfs', makePdfFilename(updated));
    generatePDF(updated, dateStr, pdfPath, () => {
      res.json({ success: true });
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Delete submission ─────────────────────────────────────────
app.delete('/api/submissions/:id', async (req, res) => {
  try {
    const s = await getCol().findOne({ id: req.params.id });
    if (!s) return res.status(404).json({ error: 'Not found' });
    const pdfPath = path.join(__dirname, 'pdfs', makePdfFilename(s));
    if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
    await getCol().deleteOne({ id: req.params.id });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Helpers ───────────────────────────────────────────────────
function makePdfFilename(s) {
  const n = (s.customerName || 'Unknown').replace(/[^a-z0-9]/gi, '_');
  const c = (s.saleCompany || '').replace(/[^a-z0-9]/gi, '_');
  return n + '-' + c + '_receipt_' + s.id + '.pdf';
}

// ── PDF Generator ─────────────────────────────────────────────
function generatePDF(data, dateStr, outputPath, callback) {
  const doc = new PDFDocument({ margin: 0, size: 'LETTER', bufferPages: true });
  const stream = fs.createWriteStream(outputPath);
  doc.pipe(stream);

  const W = doc.page.width, L = 72, R = W - 72, TW = R - L;
  const isLimitless = data.saleCompany === 'Limitless';
  const isIOS = data.saleCompany === 'IOS';
  const companyName = isLimitless ? 'Limitless Business Solutions' : isIOS ? 'IOS' : data.saleCompanyOther || data.saleCompany;
  const shortName = isLimitless ? 'LBS' : isIOS ? 'IOS' : companyName;
  const logoFile = isLimitless
    ? path.join(__dirname, 'public', 'logos', 'limitless.png')
    : isIOS ? path.join(__dirname, 'public', 'logos', 'ios.png')
    : path.join(__dirname, 'public', 'logos', 'joint.png');

  const products = data.products || [];
  const np = products.length;
  const bs = np > 8 ? 8.5 : np > 6 ? 9 : 9.5;
  const ls = np > 8 ? 8 : np > 6 ? 8.5 : 9;
  const ps = np > 8 ? 8.5 : np > 6 ? 9 : 10;
  const rh = np > 8 ? 18 : np > 6 ? 20 : 22;

  doc.fontSize(8.5).font('Helvetica').fillColor('#000')
    .text('1351 N Alma School Rd.|Suite 205| Chandler, AZ 85224', 0, 24, { width: W, align: 'center' });

  const logoY = 40, logoH = 72;
  if (fs.existsSync(logoFile)) {
    doc.image(logoFile, { fit: [190, logoH], align: 'center', x: (W - 190) / 2, y: logoY });
  } else {
    doc.rect((W - 170) / 2, logoY, 170, logoH).stroke('#ccc');
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#999').text(companyName, (W - 170) / 2, logoY + 26, { width: 170, align: 'center' });
  }

  const titleY = logoY + logoH + 12;
  doc.fontSize(16).font('Helvetica-Bold').fillColor('#000')
    .text((data.customerName || 'Purchase') + ' - ' + companyName + ' Receipt', 0, titleY, { width: W, align: 'center' });

  let curY = titleY + 38;
  const displayDate = data.saleDate
    ? new Date(data.saleDate + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : dateStr;
  doc.fontSize(bs).font('Helvetica').fillColor('#000').text('Date:  ' + displayDate, L, curY);
  curY += 16;
  doc.fontSize(bs).font('Helvetica').fillColor('#000').text(data.customerName, L, curY);
  curY += 28;

  doc.fontSize(bs).font('Helvetica').fillColor('#000')
    .text('Thank you for your purchase with ' + companyName + ' and congratulations on taking an important step in developing a world-class website & services through our fun and informative training curriculum! We have included two copies of your purchase receipt, so please be sure to keep one copy in a safe place.', L, curY, { width: TW, lineGap: 1.5 });

  curY = doc.y + 14;
  doc.fontSize(bs + 0.5).font('Helvetica-Bold').fillColor('#000')
    .text('Your purchase of our Premier Package includes:', 0, curY, { width: W, align: 'center' });

  curY = doc.y + 10;
  const maxRows = Math.ceil(products.length / 2);
  for (let i = 0; i < products.length; i++) {
    const col = i % 2, row = Math.floor(i / 2);
    const x = col === 0 ? L + 10 : L + TW / 2 + 10;
    const y = curY + row * rh;
    const note = data.productNotes && data.productNotes[products[i]];
    const label = products[i] + (note ? ' (' + note + ')' : '');
    doc.fontSize(ps).font('Helvetica').fillColor('#000')
      .text('- ', x, y, { continued: true })
      .text(label, { underline: true, continued: false, width: TW / 2 - 24 });
  }

  curY = curY + maxRows * rh + 14;
  doc.moveTo(L, curY).lineTo(R, curY).lineWidth(0.5).stroke('#000');
  curY += 8;

  doc.fontSize(bs + 1).font('Helvetica-Bold').fillColor('#000')
    .text('Payment Information', 0, curY, { width: W, align: 'center' });
  curY += 16;

  const payNum = data.paymentNum || '1', payOf = data.paymentOf || '1', amount = data.transactionAmount || '___________';
  doc.fontSize(bs).font('Helvetica-Bold').fillColor('#000')
    .text('Payment  ' + payNum + '  of  ' + payOf, L, curY, { continued: true })
    .text('          $' + amount + '  USD', { continued: false });
  curY += 14;

  if (data.paymentMethod === 'Credit Card' || data.paymentMethod === 'Debit Card') {
    doc.fontSize(bs).font('Helvetica-Bold').fillColor('#000')
      .text('Payment Method: CC#XXX-' + (data.cardLast4 || '____') + '    Exp. ' + (data.cardExp || '__/__') + '    Total Payment: $' + amount, L, curY);
  } else {
    doc.fontSize(bs).font('Helvetica-Bold').fillColor('#000')
      .text('Payment Method: ' + (data.paymentMethod || '___________') + '          Total Payment: $' + amount, L, curY);
  }
  curY += 14;

  const planLabel = isLimitless ? 'Payment Plan/ Notes:' : 'Payment Arrangement:';
  doc.fontSize(bs).font('Helvetica-Bold').fillColor('#000').text(planLabel + '  ', L, curY, { continued: true });
  doc.fontSize(bs).font('Helvetica').fillColor('#000').text(data.paymentPlan || ' ', { continued: false, width: TW - 160 });

  curY = doc.y + 3;
  doc.moveTo(L, curY).lineTo(R, curY).lineWidth(0.5).stroke('#000');
  curY += 10;

  doc.fontSize(ls).font('Helvetica').fillColor('#000')
    .text(shortName + ' guarantees to deliver the products and services listed above upon our receipt of your signed purchase receipt. Your signature below is an accurate representation of your physical signature and affirms your acceptance of the above-captioned charges for the products and services described.', L, curY, { width: TW, lineGap: 1 });
  curY = doc.y + 7;
  doc.fontSize(ls).font('Helvetica').fillColor('#000')
    .text('Although we cannot make guarantees of income or specific results from the products and services we provide, we are committed to providing the best possible products and services of their kind and a dedication to providing the best possible learning experience. Please remember, we offer a 3-day right of rescission.', L, curY, { width: TW, lineGap: 1 });
  curY = doc.y + 7;
  doc.fontSize(ls).font('Helvetica').fillColor('#000')
    .text('If for any reason you are not happy with your purchase, please know we will do everything we can to resolve any concerns that may arise, up to and including prorated refunds for any unused portion of your training services. Please do not hesitate to call us at our direct, toll-free number, (844) 422-5371, if you have any questions or concerns or if you simply need assistance.', L, curY, { width: TW, lineGap: 1 });
  curY = doc.y + 12;

  doc.fontSize(ls + 0.5).font('Helvetica-Bold').fillColor('#000')
    .text('I have read, understand, and agree to the terms and conditions as detailed on this receipt.', L, curY, { width: TW, align: 'center' });
  curY = doc.y + 18;

  const sigX = L + TW / 2 + 10;
  const sigW = R - sigX;

  if (data.signatureImage && data.signatureImage.startsWith('data:image')) {
    try {
      const imgBuf = Buffer.from(data.signatureImage.replace(/^data:image\/png;base64,/, ''), 'base64');
      doc.image(imgBuf, sigX, curY, { width: sigW, height: 45 });
    } catch (e) {
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#000').text('X', sigX, curY + 10);
    }
    doc.moveTo(sigX, curY + 46).lineTo(R, curY + 46).lineWidth(0.75).stroke('#000');
    curY += 52;
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#000').text('Date: ' + (data.signDate || ''), sigX, curY);
    curY += 14;
    doc.fontSize(7).font('Helvetica').fillColor('#aaa')
      .text('Electronically signed on ' + (data.signDate || '') + '  |  Signature ID: ' + data.id, sigX, curY, { width: sigW });
    curY += 16;
  } else {
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#000').text('X', sigX, curY);
    doc.moveTo(sigX + 14, curY + 14).lineTo(R, curY + 14).lineWidth(0.75).stroke('#000');
    curY += 20;
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#000').text('Date:', sigX, curY);
    doc.moveTo(sigX + 32, curY + 12).lineTo(R, curY + 12).lineWidth(0.5).stroke('#000');
    curY += 20;
  }

  const lS = 20, lW = 230;
  [data.customerName || '', data.customerAddress || '', data.customerCity || '', data.customerEmail || ''].forEach((val, i) => {
    const y = curY + i * lS;
    doc.moveTo(L, y + 14).lineTo(L + lW, y + 14).lineWidth(0.5).stroke('#000');
    if (val && val.trim()) doc.fontSize(9).font('Helvetica').fillColor('#000').text(val, L, y, { width: lW });
  });

  doc.end();
  stream.on('finish', callback);
}

// ── Start ─────────────────────────────────────────────────────
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log('\nReceipt Processor running at http://localhost:' + PORT);
    console.log('Dashboard: http://localhost:' + PORT + '/dashboard\n');
  });
}).catch(err => {
  console.error('MongoDB connection failed:', err);
  process.exit(1);
});