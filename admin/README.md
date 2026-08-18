# JobMate AI - Admin Panel

Track the users of the JobMate AI extension from your own server.
Zero dependencies — just Node.js (>= 16).

## Quick start

```bash
cd admin
npm start            # or: node server.js
```

Open http://localhost:8787 — you'll be asked for the admin token
(default `change-me`; **set `ADMIN_TOKEN` in production**).

For demo data:

```bash
node seed.js
```

## How the extension talks to this server

1. The user opens the extension's **Settings** tab and enters your event
   endpoint, e.g. `https://admin.example.com/api/events`.
2. They enable **"Send anonymous usage statistics"** (default: off).
3. The extension batches events (install, resume saved, autofill started,
   pages filled, sites used) and POSTs them to the endpoint every ~4 seconds
   while the popup is open. Failures are silent — the extension never breaks
   when the server is down.

Events are **anonymous**: a random UUID generated on install + event name +
site host + small counters. No names, emails, or resume content are ever sent.

## Shared AI key (admin-managed)

The extension ships with a shared API key so every user gets autofill working
out of the box (see the **Shared AI Key** panel on the dashboard). The
precedence is:

1. The **user's own key** in the popup Settings (always wins).
2. The **admin-shared key** published here.
3. Heuristic-only mode if neither exists.

To rotate the key: open the dashboard → **Shared AI Key** → paste the new key
(and provider) → **Save**. The extension re-fetches `GET /api/admin/settings`
automatically (on install/update and then up to once every 10 minutes while in
use), so users pick up the new key without updating the extension.

- `GET /api/admin/settings` is **public by design** — the shared key is meant
  to be distributed to every install.
- `PUT /api/admin/settings?token=...` (admin token) saves a new key/provider.

## Endpoints

| Method | Path | Purpose |
| ------ | ---- | ------- |
| POST | `/api/events` | Ingest batched events (public; no auth) |
| GET | `/api/admin/settings` | Shared AI key published to extensions (public) |
| PUT | `/api/admin/settings?token=...` | Rotate the shared AI key/provider |
| GET | `/api/admin/stats?token=...` | Totals, active users, top sites, daily activity |
| GET | `/api/admin/users?token=...` | Per-user stats (first/last seen, autofills, sites) |
| GET | `/api/admin/events?token=...&limit=N` | Latest events |
| GET | `/` | Dashboard UI |

## Production checklist

1. Set a strong token: `ADMIN_TOKEN=something-long npm start`
2. Put it behind HTTPS (Caddy/nginx + certbot), or it will fail the extension's
   CSP (`connect-src` allows `https://*.jobmate-ai.com`, `http://localhost:*`,
   `http://127.0.0.1:*`, and `https://api.openai.com`). If you host elsewhere,
   add your domain to `connect-src` in `manifest.json`.
3. Back up `admin/data/db.json` (that's all the data the server stores).
4. The event log is capped at 200,000 events (see `MAX_EVENTS` in server.js).

## Files

```
admin/server.js         Zero-dependency HTTP server + storage
admin/public/index.html Dashboard UI (stats, users, events, shared AI key)
admin/seed.js           Demo data generator
admin/data/db.json      Created on first run (auto-persisted)
admin/data/settings.json Created on first save (shared AI key config)
```
