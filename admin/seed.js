#!/usr/bin/env node
/**
 * Seed the admin database with demo data so the dashboard has something to
 * show during development. Run:  node seed.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const SITES = ['myworkdayjobs.com', 'boards.greenhouse.io', 'jobs.lever.co', 'careers.example.com', 'jobs.smartrecruiters.com'];
const EVENTS = ['page_detected', 'autofill_started', 'page_filled', 'resume_saved', 'install'];

function rnd(n) { return Math.floor(Math.random() * n); }

function seed() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const users = {};
  const events = [];
  const now = Date.now();

  for (let u = 1; u <= 24; u++) {
    const userId = 'user-' + String(u).padStart(3, '0') + '-' + Math.random().toString(36).slice(2, 10);
    const firstSeen = now - rnd(30) * 86400000;
    let lastSeen = firstSeen;
    const userEvents = 5 + rnd(60);
    const sites = {};
    let autofills = 0;

    for (let i = 0; i < userEvents; i++) {
      const event = EVENTS[rnd(EVENTS.length)];
      const site = SITES[rnd(SITES.length)];
      const ts = Math.min(now, firstSeen + rnd(now - firstSeen));
      if (ts > lastSeen) lastSeen = ts;
      sites[site] = (sites[site] || 0) + 1;
      if (event === 'autofill_started' || event === 'page_filled') autofills++;

      events.push({
        id: Math.random().toString(36).slice(2, 12),
        ts,
        userId,
        event,
        site,
        filled: event === 'page_filled' ? String(4 + rnd(22)) : undefined,
        total: event === 'page_filled' ? String(6 + rnd(30)) : undefined
      });
    }

    users[userId] = { userId, firstSeen, lastSeen, events: userEvents, autofills, sites };
  }

  events.sort((a, b) => a.ts - b.ts);
  fs.writeFileSync(DB_FILE, JSON.stringify({ users, events }));
  console.log(`Seeded ${Object.keys(users).length} users and ${events.length} events -> ${DB_FILE}`);
}

seed();
