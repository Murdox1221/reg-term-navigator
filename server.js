'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const Database = require('better-sqlite3');

const app     = express();
const PORT    = process.env.PORT || 3000;
// DATA_DIR: where the SQLite db lives (persistent, writable)
// Set RENDER_DISK_PATH to the exact directory you want the db in e.g. /data/db
// SEED_DIR: where the seed JSON files live (in the repo, read-only)
const DATA_DIR = process.env.RENDER_DISK_PATH || path.join(__dirname, 'db');
const DB_PATH  = path.join(DATA_DIR, 'regnav.db');
const SEED_DIR = path.join(__dirname, 'data');

// ── Ensure db directory exists ─────────────────────────────────────────────────
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── Open / create database ────────────────────────────────────────────────────
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS definitions (
    id       TEXT PRIMARY KEY,
    data     TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS governance (
    id       TEXT PRIMARY KEY,
    position INTEGER NOT NULL DEFAULT 0,
    data     TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sources (
    id       TEXT PRIMARY KEY,
    data     TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    data     TEXT NOT NULL
  );
`);

// ── Seed from JSON files on first boot ────────────────────────────────────────
function seedTable(table, jsonFile, getId) {
  const count = db.prepare('SELECT COUNT(*) as n FROM ' + table).get().n;
  if (count > 0) return;

  const file = path.join(SEED_DIR, jsonFile);
  if (!fs.existsSync(file)) return;

  try {
    const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(rows) || rows.length === 0) return;

    const sql = table === 'governance'
      ? 'INSERT OR IGNORE INTO ' + table + ' (id, position, data) VALUES (?, ?, ?)'
      : 'INSERT OR IGNORE INTO ' + table + ' (id, data) VALUES (?, ?)';
    const insert = db.prepare(sql);

    const insertMany = db.transaction((items) => {
      items.forEach((item, i) => {
        const id = getId(item);
        if (!id) return;
        if (table === 'governance') {
          insert.run(id, i, JSON.stringify(item));
        } else {
          insert.run(id, JSON.stringify(item));
        }
      });
    });

    insertMany(rows);
    console.log('Seeded ' + rows.length + ' rows into ' + table + ' from ' + jsonFile);
  } catch (e) {
    console.error('Seed error (' + table + '):', e.message);
  }
}

seedTable('definitions', 'definitions.json', r => r.id);
seedTable('governance',  'governance.json',  r => r.id);
seedTable('sources',     'sources.json',     r => r.id);
seedTable('users',       'users.json',       r => r.username);

// ── Helpers ───────────────────────────────────────────────────────────────────
function readTable(table) {
  const orderBy = table === 'governance' ? 'ORDER BY position'
                : table === 'users'      ? 'ORDER BY username'
                : 'ORDER BY id';
  return db.prepare('SELECT data FROM ' + table + ' ' + orderBy)
           .all()
           .map(r => JSON.parse(r.data));
}

function replaceTable(table, rows, getId) {
  const replace = db.transaction((items) => {
    db.prepare('DELETE FROM ' + table).run();
    const sql = table === 'governance'
      ? 'INSERT INTO ' + table + ' (id, position, data) VALUES (?, ?, ?)'
      : 'INSERT INTO ' + table + ' (id, data) VALUES (?, ?)';
    const insert = db.prepare(sql);
    items.forEach((item, i) => {
      const id = getId(item);
      if (!id) return;
      if (table === 'governance') {
        insert.run(id, i, JSON.stringify(item));
      } else {
        insert.run(id, JSON.stringify(item));
      }
    });
  });
  replace(rows);
}

const TABLE_META = {
  definitions: { getId: r => r.id,       table: 'definitions' },
  governance:  { getId: r => r.id,       table: 'governance'  },
  sources:     { getId: r => r.id,       table: 'sources'     },
  users:       { getId: r => r.username, table: 'users'       },
};
const ALLOWED = new Set(Object.keys(TABLE_META));

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// ── GET /api/data ──────────────────────────────────────────────────────────────
app.get('/api/data', (req, res) => {
  try {
    res.json({
      definitions: readTable('definitions'),
      governance:  readTable('governance'),
      sources:     readTable('sources'),
      users:       readTable('users'),
    });
  } catch (e) {
    console.error('/api/data error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/save/:collection ─────────────────────────────────────────────────
app.post('/api/save/:collection', (req, res) => {
  const { collection } = req.params;
  if (!ALLOWED.has(collection))
    return res.status(400).json({ error: 'Unknown collection: ' + collection });
  if (!Array.isArray(req.body))
    return res.status(400).json({ error: 'Body must be a JSON array' });
  try {
    const { table, getId } = TABLE_META[collection];
    replaceTable(table, req.body, getId);
    res.json({ ok: true, count: req.body.length });
  } catch (e) {
    console.error('save error:', collection, e.message);
    res.status(500).json({ error: 'Save failed: ' + e.message });
  }
});

// ── GET /api/export/:collection ────────────────────────────────────────────────
app.get('/api/export/:collection', (req, res) => {
  const { collection } = req.params;
  if (!ALLOWED.has(collection))
    return res.status(400).json({ error: 'Unknown collection: ' + collection });
  try {
    const data = readTable(TABLE_META[collection].table);
    res.setHeader('Content-Disposition', 'attachment; filename="' + collection + '.json"');
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(data, null, 2));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/import/:collection?mode=replace|merge ──────────────────────────
// replace (default): wipe and replace entire collection
// merge (definitions): new term → insert; same term+source → overwrite; same term diff source → add as alsoIn
// merge (governance):  new section → insert; existing section → overwrite; others preserved
const MERGE_SUPPORTED = new Set(['definitions', 'governance']);

app.post('/api/import/:collection', (req, res) => {
  const { collection } = req.params;
  const mode = req.query.mode === 'merge' && MERGE_SUPPORTED.has(collection) ? 'merge' : 'replace';
  if (!ALLOWED.has(collection))
    return res.status(400).json({ error: 'Unknown collection: ' + collection });
  if (!Array.isArray(req.body))
    return res.status(400).json({ error: 'Body must be a JSON array' });
  try {
    const { table, getId } = TABLE_META[collection];

    if (mode === 'merge' && collection === 'definitions') {
      const stats = { inserted: 0, updated: 0, alsoIn: 0 };
      const mergeMany = db.transaction((items) => {
        items.forEach((incoming) => {
          const termId = (incoming.term || incoming.id || '').trim();
          if (!termId) return;
          // Find existing by term name (case-insensitive)
          const existing = db.prepare(
            "SELECT id, data FROM definitions WHERE LOWER(id) = LOWER(?)"
          ).get(termId);
          if (!existing) {
            // Brand new — insert
            const id = incoming.id || incoming.term;
            const clean = {...incoming, id};
            delete clean._new;
            db.prepare('INSERT OR REPLACE INTO definitions (id, data) VALUES (?, ?)').run(id, JSON.stringify(clean));
            stats.inserted++;
          } else {
            const existingData = JSON.parse(existing.data);
            const incomingSource = (incoming.source || '').trim();
            const existingSource = (existingData.source || '').trim();
            if (!incomingSource || incomingSource === existingSource) {
              // Same source — overwrite
              const merged = {...existingData, ...incoming, id: existing.id};
              delete merged._new;
              db.prepare('UPDATE definitions SET data = ? WHERE id = ?').run(JSON.stringify(merged), existing.id);
              stats.updated++;
            } else {
              // Different source — add as alsoIn if not already present for this source
              const alsoIn = existingData.alsoIn || [];
              const alreadyThere = alsoIn.some(a => a.source === incomingSource);
              if (!alreadyThere) {
                alsoIn.push({
                  source: incomingSource,
                  section: incoming.section || '',
                  rawDef: incoming.rawDef || '',
                  authoritative: incoming.authoritative === true
                });
                existingData.alsoIn = alsoIn;
                // Merge aliases without duplicating
                if (incoming.aliases && incoming.aliases.length) {
                  const aliasSet = new Set(existingData.aliases || []);
                  incoming.aliases.forEach(a => aliasSet.add(a));
                  existingData.aliases = [...aliasSet];
                }
                db.prepare('UPDATE definitions SET data = ? WHERE id = ?').run(JSON.stringify(existingData), existing.id);
                stats.alsoIn++;
              }
            }
          }
        });
      });
      mergeMany(req.body);
      const total = db.prepare('SELECT COUNT(*) as n FROM definitions').get().n;
      res.json({ ok: true, ...stats, total, mode: 'merge' });

    } else if (mode === 'merge' && collection === 'governance') {
      // Governance merge — upsert, preserve unlisted sections
      const upsert = db.prepare('INSERT OR REPLACE INTO governance (id, position, data) VALUES (?, ?, ?)');
      const mergeGov = db.transaction((items) => {
        const maxPos = db.prepare('SELECT COALESCE(MAX(position),0) as m FROM governance').get().m;
        items.forEach((item, i) => {
          const id = getId(item);
          if (!id) return;
          const existingRow = db.prepare('SELECT position FROM governance WHERE id = ?').get(id);
          const pos = existingRow ? existingRow.position : maxPos + i + 1;
          upsert.run(id, pos, JSON.stringify(item));
        });
      });
      mergeGov(req.body);
      const total = db.prepare('SELECT COUNT(*) as n FROM governance').get().n;
      res.json({ ok: true, count: req.body.length, total, mode: 'merge' });

    } else {
      replaceTable(table, req.body, getId);
      res.json({ ok: true, count: req.body.length, mode: 'replace' });
    }
  } catch (e) {
    console.error('import error:', collection, e.message);
    res.status(500).json({ error: 'Import failed: ' + e.message });
  }
});


// ── Fallback