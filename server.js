'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
// Use Render persistent disk if available, otherwise fall back to local ./data
const DATA_DIR = process.env.RENDER_DISK_PATH || path.join(__dirname, 'data');

// ── Ensure data directory exists ──────────────────────────────────────────────
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── Seed from repo on first boot (disk is empty after first attach) ───────────
const SEED_DIR = path.join(__dirname, 'data');
['definitions.json', 'governance.json', 'sources.json', 'users.json'].forEach(file => {
  const target = path.join(DATA_DIR, file);
  const seed   = path.join(SEED_DIR, file);
  if (!fs.existsSync(target) && fs.existsSync(seed)) {
    fs.copyFileSync(seed, target);
    console.log('Seeded from repo:', file);
  }
});

const FILES = {
  definitions: path.join(DATA_DIR, 'definitions.json'),
  governance:  path.join(DATA_DIR, 'governance.json'),
  sources:     path.join(DATA_DIR, 'sources.json'),
  users:       path.join(DATA_DIR, 'users.json'),
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function readJSON(file, fallback = []) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error('readJSON error:', file, e.message);
    return fallback;
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// ── GET /api/data  →  load all data in one shot ───────────────────────────────
app.get('/api/data', (req, res) => {
  res.json({
    definitions: readJSON(FILES.definitions, []),
    governance:  readJSON(FILES.governance,  []),
    sources:     readJSON(FILES.sources,     []),
    users:       readJSON(FILES.users,       []),
  });
});

// ── POST /api/save/:collection  →  write a collection ─────────────────────────
const ALLOWED = new Set(['definitions', 'governance', 'sources', 'users']);

app.post('/api/save/:collection', (req, res) => {
  const { collection } = req.params;
  if (!ALLOWED.has(collection)) {
    return res.status(400).json({ error: 'Unknown collection: ' + collection });
  }
  if (!Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Body must be a JSON array' });
  }
  try {
    writeJSON(FILES[collection], req.body);
    res.json({ ok: true, count: req.body.length });
  } catch (e) {
    console.error('writeJSON error:', collection, e.message);
    res.status(500).json({ error: 'Write failed: ' + e.message });
  }
});

// ── GET /api/export/:collection  →  download a JSON file directly from disk ────
app.get('/api/export/:collection', (req, res) => {
  const { collection } = req.params;
  if (!ALLOWED.has(collection)) {
    return res.status(400).json({ error: 'Unknown collection: ' + collection });
  }
  const file = FILES[collection];
  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: 'File not found' });
  }
  res.setHeader('Content-Disposition', `attachment; filename="${collection}.json"`);
  res.setHeader('Content-Type', 'application/json');
  res.sendFile(file);
});

// ── POST /api/import/:collection  →  replace a collection entirely ────────────
app.post('/api/import/:collection', (req, res) => {
  const { collection } = req.params;
  if (!ALLOWED.has(collection)) {
    return res.status(400).json({ error: 'Unknown collection: ' + collection });
  }
  if (!Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Body must be a JSON array' });
  }
  try {
    // Backup existing file before overwrite
    const file = FILES[collection];
    if (fs.existsSync(file)) {
      fs.copyFileSync(file, file + '.bak');
    }
    writeJSON(file, req.body);
    res.json({ ok: true, count: req.body.length });
  } catch (e) {
    console.error('import error:', collection, e.message);
    res.status(500).json({ error: 'Import failed: ' + e.message });
  }
});

// ── Fallback: serve index.html for any non-API route ──────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`reg//nav running on port ${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
});
