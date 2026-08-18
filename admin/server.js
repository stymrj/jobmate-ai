#!/usr/bin/env node
/**
 * JobMate AI - Admin & Analytics Server
 *
 * Zero-dependency Node.js server that provides:
 *   POST /api/events       - ingest batched events from the extension
 *   GET  /api/admin/*      - dashboard stats, users, events (token protected)
 *   GET  /                 - serves the dashboard UI (admin/public/index.html)
 *
 * Storage: JSON files in ./data (created automatically).
 *
 * Environment variables:
 *   PORT        - port to listen on (default 8787)
 *   ADMIN_TOKEN - bearer token for /api/admin/* (default "change-me")
 *
 * Run:  npm start        (or: node server.js)
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.PORT || '8787', 10);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'change-me';
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const MAX_EVENTS = 200000; // retention cap for the event log

// Default shared AI config published to every extension install. The admin
// can change it any time from the dashboard ("Shared AI Key" section); the
// extension re-fetches it and users get the new key without an update.
const DEFAULT_ADMIN_SETTINGS = {
  apiKey: 'AQ.Ab8RN6LEtc1kI6Ex9D46yZkkPJe5tjBVk_zSN2kQFgkLkntD4g',
  aiProvider: 'gemini',
  aiModel: '',
  updatedAt: Date.now()
};

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

let db = null;

function loadDb() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(DB_FILE)) {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    }
  } catch (e) {
    console.warn('[admin] Could not load db.json, starting fresh:', e.message);
  }
  if (!db || typeof db !== 'object') {
    db = { users: {}, events: [] };
  }
  if (!db.users) db.users = {};
  if (!Array.isArray(db.events)) db.events = [];
}

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      if (saved && typeof saved === 'object' && ('apiKey' in saved || 'aiProvider' in saved)) {
        return { ...DEFAULT_ADMIN_SETTINGS, ...saved };
      }
    }
  } catch (e) {
    console.warn('[admin] Could not load settings.json, using defaults:', e.message);
  }
  return { ...DEFAULT_ADMIN_SETTINGS };
}

function saveSettings(settings) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  } catch (e) {
    console.error('[admin] Could not save settings.json:', e.message);
    throw e;
  }
}

let writeTimer = null;
function persist() {
  // Debounced write (max ~2s between saves).
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(db));
    } catch (e) {
      console.error('[admin] Failed to persist db.json:', e.message);
    }
  }, 1000);
}

// ---------------------------------------------------------------------------
// Event ingestion
// ---------------------------------------------------------------------------

function ingestEvents(payload, remoteAddr) {
  const raw = Array.isArray(payload) ? payload : (payload && Array.isArray(payload.events) ? payload.events : []);
  let added = 0;

  for (const ev of raw) {
    if (!ev || typeof ev !== 'object' || !ev.event) continue;

    const userId = String(ev.userId || 'unknown').slice(0, 64);
    const event = String(ev.event).slice(0, 64);
    const site = String(ev.site || '').slice(0, 200);
    const ts = typeof ev.ts === 'number' ? ev.ts : Date.now();

    // Upsert user
    const user = db.users[userId] || {
      userId,
      firstSeen: ts,
      lastSeen: ts,
      events: 0,
      autofills: 0,
      sites: {},
      install: false
    };
    user.lastSeen = Math.max(user.lastSeen, ts);
    user.events += 1;
    if (event.startsWith('autofill') || event === 'page_filled') user.autofills += 1;
    if (event === 'install') user.install = true;
    if (site) user.sites[site] = (user.sites[site] || 0) + 1;
    db.users[userId] = user;

    db.events.push({
      id: String(ev.id || Math.random().toString(36).slice(2, 10)),
      ts,
      userId,
      event,
      site,
      ip: remoteAddr
    });
    added += 1;
  }

  if (db.events.length > MAX_EVENTS) {
    db.events = db.events.slice(db.events.length - MAX_EVENTS);
  }
  if (added > 0) persist();
  return added;
}

// ---------------------------------------------------------------------------
// Aggregations
// ---------------------------------------------------------------------------

function dayBucket(ts) {
  const d = new Date(ts);
  return d.toISOString().slice(0, 10);
}

function daysAgoTs(days) {
  return Date.now() - days * 86400000;
}

function buildStats() {
  const users = Object.values(db.users);
  const now = Date.now();
  const dayAgo = daysAgoTs(1);
  const weekAgo = daysAgoTs(7);
  const monthAgo = daysAgoTs(30);

  const activeToday = users.filter((u) => u.lastSeen >= dayAgo).length;
  const active7d = users.filter((u) => u.lastSeen >= weekAgo).length;
  const active30d = users.filter((u) => u.lastSeen >= monthAgo).length;

  const siteCount = {};
  let fieldsFilled = 0;
  let totalAutofills = 0;
  for (const ev of db.events) {
    if (ev.site) siteCount[ev.site] = (siteCount[ev.site] || 0) + 1;
    if (ev.event === 'page_filled' && ev.filled !== undefined) fieldsFilled += parseInt(ev.filled, 10) || 0;
    if (ev.event === 'autofill_started') totalAutofills += 1;
  }

  const topSites = Object.entries(siteCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([site, count]) => ({ site, count }));

  // Activity by day (last 14 days)
  const daily = {};
  for (let i = 13; i >= 0; i--) {
    const key = dayBucket(now - i * 86400000);
    daily[key] = { date: key, events: 0, users: new Set() };
  }
  const start = dayBucket(now - 13 * 86400000);
  for (const ev of db.events) {
    const key = dayBucket(ev.ts);
    if (key < start || !daily[key]) continue;
    daily[key].events += 1;
    daily[key].users.add(ev.userId);
  }

  return {
    totalUsers: users.length,
    activeToday,
    active7d,
    active30d,
    totalEvents: db.events.length,
    totalAutofills,
    fieldsFilled,
    topSites,
    daily: Object.values(daily).map((d) => ({
      date: d.date,
      events: d.events,
      users: d.users.size
    }))
  };
}

function listUsers() {
  return Object.values(db.users)
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .slice(0, 500)
    .map((u) => ({
      userId: u.userId,
      firstSeen: u.firstSeen,
      lastSeen: u.lastSeen,
      events: u.events,
      autofills: u.autofills,
      topSite: Object.entries(u.sites).sort((a, b) => b[1] - a[1])[0] ? Object.entries(u.sites).sort((a, b) => b[1] - a[1])[0][0] : '',
      sites: Object.keys(u.sites).length
    }));
}

function listEvents(limit) {
  return db.events.slice(-limit).reverse();
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 2 * 1024 * 1024) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function unauthorized(res) {
  json(res, 401, { error: 'Unauthorized. Set the ADMIN_TOKEN env var and pass ?token=...' });
}

function authorized(req) {
  const url = new URL(req.url, 'http://localhost');
  const q = url.searchParams.get('token');
  if (ADMIN_TOKEN === 'change-me') {
    console.warn('[admin] WARNING: using default ADMIN_TOKEN. Set ADMIN_TOKEN for production.');
  }
  return q && q === ADMIN_TOKEN;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json'
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (urlPath === '/') urlPath = '/index.html';
  const file = path.join(__dirname, 'public', path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(path.join(__dirname, 'public'))) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404); res.end('Not found'); return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const method = req.method;
  const pathname = url.pathname;

  try {
    // CORS preflight
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS'
      });
      res.end();
      return;
    }

    // Event ingestion (public by design; endpoint is unguessable + configurable)
    if (method === 'POST' && pathname === '/api/events') {
      const payload = await readBody(req);
      const added = ingestEvents(payload, req.socket.remoteAddress);
      json(res, 200, { ok: true, accepted: added });
      return;
    }

    // Shared AI settings. GET is PUBLIC by design: the shared key is meant to
    // be distributed to every extension install. Changing it requires the
    // admin token.
    if (method === 'GET' && pathname === '/api/admin/settings') {
      json(res, 200, loadSettings());
      return;
    }
    if (method === 'PUT' && pathname === '/api/admin/settings') {
      if (!authorized(req)) { unauthorized(res); return; }
      const body = await readBody(req);
      const current = loadSettings();
      const next = {
        apiKey: typeof body.apiKey === 'string' ? body.apiKey.trim() : current.apiKey,
        aiProvider: typeof body.aiProvider === 'string' && body.aiProvider.trim() ? body.aiProvider.trim() : current.aiProvider,
        aiModel: typeof body.aiModel === 'string' ? body.aiModel.trim() : current.aiModel,
        updatedAt: Date.now()
      };
      saveSettings(next);
      json(res, 200, { ok: true, settings: next });
      return;
    }

    // Admin API
    if (pathname.startsWith('/api/admin/')) {
      if (!authorized(req)) { unauthorized(res); return; }
      if (method === 'GET' && pathname === '/api/admin/stats') {
        json(res, 200, buildStats());
        return;
      }
      if (method === 'GET' && pathname === '/api/admin/users') {
        json(res, 200, { users: listUsers() });
        return;
      }
      if (method === 'GET' && pathname === '/api/admin/events') {
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10) || 100, 1000);
        json(res, 200, { events: listEvents(limit) });
        return;
      }
      json(res, 404, { error: 'Unknown admin endpoint' });
      return;
    }

    // Dashboard UI
    if (method === 'GET' && (pathname === '/' || pathname.startsWith('/static/'))) {
      serveStatic(req, res);
      return;
    }

    // Health
    if (method === 'GET' && pathname === '/api/health') {
      json(res, 200, { ok: true, service: 'jobmate-ai-admin' });
      return;
    }

    json(res, 404, { error: 'Not found' });
  } catch (e) {
    console.error('[admin] Request error:', e);
    json(res, 500, { error: 'Internal error' });
  }
});

loadDb();
server.listen(PORT, () => {
  console.log('==========================================================');
  console.log('  JobMate AI - Admin & Analytics Server');
  console.log(`  Dashboard:   http://localhost:${PORT}`);
  console.log(`  Event API:   POST http://localhost:${PORT}/api/events`);
  console.log(`  Admin token: ${ADMIN_TOKEN === 'change-me' ? 'change-me (SET ADMIN_TOKEN IN PRODUCTION!)' : 'configured'}`);
  console.log('==========================================================');
});
