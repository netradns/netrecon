// ── NetRecon — Admin HTTP Handlers ───────────────────────────────
// HTTP route handlers for all /admin/* endpoints.
//
// Routes registered in server.js:
//   GET  /admin/config          — returns runtime config (sanitized)
//   PUT  /admin/config          — updates runtime config
//   POST /admin/password        — changes the admin password
//   GET  /admin/notify-log      — returns notification delivery log
//   POST /admin/notify/test     — sends a test notification to one channel
//   GET  /admin/watched         — returns watched domains list
//   POST /admin/watched         — adds a watched domain
//   DELETE /admin/watched/:id   — removes a watched domain
//
// Auth: all routes require the X-Admin-Hash header to match the
// active password hash. This is the same hash the browser computes
// client-side during login — it's checked on every mutating request.
//
// Adding a new admin route:
//   1. Add a handler function here
//   2. Export it
//   3. Register it in server.js

'use strict';

const crypto = require('crypto');
const { getConfig, saveConfig }    = require('./config-store');
const { getActiveHash, changePassword } = require('./password');
const { getLog }                   = require('../notify/log');
const { dispatch }                 = require('../notify/dispatcher');
const { getWatched, saveWatched }  = require('../watcher/snapshot');
const { jsonSafe }                 = require('../handlers');

// ── Auth middleware ───────────────────────────────────────────────
/**
 * Checks the X-Admin-Hash request header against the active password hash.
 * Uses timing-safe comparison to prevent side-channel attacks.
 * Returns true if authorized, false if not (and sends a 401 response).
 */
function requireAuth(req, res) {
  const submitted = (req.headers['x-admin-hash'] || '').trim().toLowerCase();
  const active    = getActiveHash().toLowerCase();

  // Length check first — timingSafeEqual requires equal-length buffers
  if (!submitted || submitted.length !== active.length) {
    jsonSafe(res, 401, { error: 'Unauthorized' });
    return false;
  }

  const match = crypto.timingSafeEqual(Buffer.from(submitted), Buffer.from(active));
  if (!match) {
    jsonSafe(res, 401, { error: 'Unauthorized' });
    return false;
  }
  return true;
}

// ── Read body helper ──────────────────────────────────────────────
// Reused from the main handlers pattern — reads the request body as JSON.
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    const timer = setTimeout(() => { req.destroy(); reject(new Error('Body read timeout')); }, 10000);
    req.on('data', chunk => {
      body += chunk;
      // 32k limit — matches the nginx client_max_body_size for /api/admin/
      if (body.length > 32768) { clearTimeout(timer); req.destroy(); reject(new Error('Body too large')); }
    });
    req.on('end',   () => { clearTimeout(timer); resolve(body); });
    req.on('error', err => { clearTimeout(timer); reject(err); });
  });
}

// ── GET /admin/config ─────────────────────────────────────────────
/**
 * Returns the current runtime config.
 * SMTP password is redacted — never sent to the browser.
 * statsPasswordHash is omitted — the browser already has it from /app-config.
 */
function handleGetConfig(req, res) {
  if (!requireAuth(req, res)) return;

  const cfg = getConfig();

  // Sanitize before sending — strip secrets
  const safe = {
    internalDnsEnabled: cfg.internalDnsEnabled === false ? false : true,
    notifyChannels:     cfg.notifyChannels || [],
    dnsQuickLinks:      cfg.dnsQuickLinks  || [],
    idnsQuickLinks:     cfg.idnsQuickLinks || [],
    webhookSecret:      cfg.webhookSecret  || '',
    smtpConfig: cfg.smtpConfig ? {
      host:   cfg.smtpConfig.host   || '',
      port:   cfg.smtpConfig.port   || 587,
      secure: cfg.smtpConfig.secure || false,
      user:   cfg.smtpConfig.user   || '',
      from:   cfg.smtpConfig.from   || '',
    } : null,
  };

  return jsonSafe(res, 200, safe);
}

// ── PUT /admin/config ─────────────────────────────────────────────
/**
 * Updates one or more runtime config fields.
 * Only whitelisted fields are accepted — unknown fields are ignored.
 * SMTP password is only updated if explicitly provided (non-empty string).
 */
async function handlePutConfig(req, res) {
  if (!requireAuth(req, res)) return;

  let body;
  try { body = JSON.parse(await readBody(req)); }
  catch { return jsonSafe(res, 400, { error: 'Invalid JSON body' }); }

  const update = {};

  // internalDnsEnabled — boolean toggle for the Internal DNS tool
  if (typeof body.internalDnsEnabled === 'boolean') {
    update.internalDnsEnabled = body.internalDnsEnabled;
    console.log(`[INFO] Internal DNS ${body.internalDnsEnabled ? 'enabled' : 'disabled'} via admin UI`);
  }

  // notifyChannels — array of { id, service, url, name }
  if (Array.isArray(body.notifyChannels)) {
    const VALID_SERVICES = new Set(['slack', 'teams', 'discord', 'webhook', 'email']);
    update.notifyChannels = body.notifyChannels.filter(ch =>
      ch && VALID_SERVICES.has(ch.service) && typeof ch.url === 'string' && ch.url.length > 0
    );
  }

  // webhookSecret — string, included as X-Webhook-Secret header
  if (typeof body.webhookSecret === 'string') {
    update.webhookSecret = body.webhookSecret.slice(0, 256);
  }

  // dnsQuickLinks / idnsQuickLinks — array of { label, value }
  for (const key of ['dnsQuickLinks', 'idnsQuickLinks']) {
    if (Array.isArray(body[key])) {
      update[key] = body[key]
        .filter(l => l && typeof l.label === 'string' && typeof l.value === 'string' && l.value.length > 0)
        .slice(0, 10)
        .map(l => ({ label: String(l.label).slice(0, 60), value: String(l.value).slice(0, 253) }));
    }
  }

  // smtpConfig — merge with existing so password isn't wiped on every save.
  // Use explicit type checks instead of || to handle empty strings and 0 correctly.
  if (body.smtpConfig && typeof body.smtpConfig === 'object') {
    const existing = getConfig().smtpConfig || {};
    update.smtpConfig = {
      host:   typeof body.smtpConfig.host   === 'string' ? body.smtpConfig.host   : (existing.host   || ''),
      port:   typeof body.smtpConfig.port   === 'number' ? body.smtpConfig.port   : (parseInt(body.smtpConfig.port, 10) || existing.port || 587),
      secure: typeof body.smtpConfig.secure === 'boolean' ? body.smtpConfig.secure : (existing.secure || false),
      user:   typeof body.smtpConfig.user   === 'string' ? body.smtpConfig.user   : (existing.user   || ''),
      from:   typeof body.smtpConfig.from   === 'string' ? body.smtpConfig.from   : (existing.from   || ''),
      // Only update password if a non-empty value was explicitly sent
      pass:   (typeof body.smtpConfig.pass === 'string' && body.smtpConfig.pass.length > 0)
                ? body.smtpConfig.pass
                : (existing.pass || ''),
    };
  }

  if (!Object.keys(update).length) {
    return jsonSafe(res, 400, { error: 'No valid fields to update' });
  }

  saveConfig(update);
  return jsonSafe(res, 200, { ok: true });
}

// ── POST /admin/password ──────────────────────────────────────────
/**
 * Changes the admin password.
 * Body: { currentHash: string, newHash: string }
 * Both values are SHA-256 hashes — plaintext never sent over the wire.
 */
async function handleChangePassword(req, res) {
  if (!requireAuth(req, res)) return;

  let body;
  try { body = JSON.parse(await readBody(req)); }
  catch { return jsonSafe(res, 400, { error: 'Invalid JSON body' }); }

  const result = changePassword(
    String(body.currentHash || ''),
    String(body.newHash     || '')
  );

  return jsonSafe(res, result.ok ? 200 : 400, result);
}

// ── GET /admin/notify-log ─────────────────────────────────────────
/**
 * Returns the notification delivery log (last 200 attempts).
 * Used by the Settings → Notifications delivery log panel.
 */
function handleGetNotifyLog(req, res) {
  if (!requireAuth(req, res)) return;
  return jsonSafe(res, 200, getLog());
}

// ── POST /admin/notify/test ───────────────────────────────────────
/**
 * Sends a test notification to a single channel.
 * Body: { channel: { service, url, name? } }
 * Used by the "Test" button next to each configured channel.
 */
async function handleTestNotify(req, res) {
  if (!requireAuth(req, res)) return;

  let body;
  try { body = JSON.parse(await readBody(req)); }
  catch { return jsonSafe(res, 400, { error: 'Invalid JSON body' }); }

  const ch = body.channel;
  if (!ch || !ch.service || !ch.url) {
    return jsonSafe(res, 400, { error: 'channel.service and channel.url are required' });
  }

  try {
    await dispatch({
      title:  '🔔 NetRecon Test Notification',
      level:  'info',
      fields: [
        { label: 'Status',  value: 'This is a test notification from NetRecon.' },
        { label: 'Channel', value: ch.name || ch.service },
        { label: 'Time',    value: new Date().toISOString() },
      ],
      _channelOverride: [ch],
      _event: 'test',
    });
    return jsonSafe(res, 200, { ok: true });
  } catch (err) {
    return jsonSafe(res, 500, { error: err.message });
  }
}

// ── GET /admin/watched ────────────────────────────────────────────
/**
 * Returns the full watched domains list including snapshots and change log.
 * Used by the Watched Domains page on initial load and refresh.
 */
function handleGetWatched(req, res) {
  if (!requireAuth(req, res)) return;
  return jsonSafe(res, 200, getWatched());
}

// ── POST /admin/watched ───────────────────────────────────────────
/**
 * Adds a new domain to the watch list.
 * Body: { domain, source, recordTypes, interval }
 *   domain:      string  — domain name to watch (e.g. "example.com")
 *   source:      string  — "public" or "internal"
 *   recordTypes: Array   — e.g. ["A", "MX", "TXT"] or ["ALL"]
 *   interval:    number  — poll interval in minutes (5, 15, 60, 360, 1440)
 */
async function handleAddWatched(req, res) {
  if (!requireAuth(req, res)) return;

  let body;
  try { body = JSON.parse(await readBody(req)); }
  catch { return jsonSafe(res, 400, { error: 'Invalid JSON body' }); }

  const domain = String(body.domain || '').trim().toLowerCase().replace(/\.$/, '');
  if (!domain || domain.length > 253 || !/^[a-z0-9._-]+$/.test(domain)) {
    return jsonSafe(res, 400, { error: 'Invalid domain name' });
  }

  const VALID_SOURCES = new Set(['public', 'internal']);
  const source = VALID_SOURCES.has(body.source) ? body.source : 'public';

  const VALID_TYPES = new Set(['A','AAAA','MX','TXT','NS','CNAME','SOA','CAA','SRV','ALL']);
  const recordTypes = Array.isArray(body.recordTypes)
    ? body.recordTypes.filter(t => VALID_TYPES.has(String(t).toUpperCase())).map(t => t.toUpperCase())
    : ['A', 'MX', 'TXT', 'NS'];

  // Allowed poll intervals in minutes
  const VALID_INTERVALS = new Set([5, 15, 60, 360, 1440]);
  const interval = VALID_INTERVALS.has(Number(body.interval)) ? Number(body.interval) : 60;

  const watched = getWatched();

  // Prevent duplicate entries for the same domain + source combination
  const exists = watched.domains.some(d => d.domain === domain && d.source === source);
  if (exists) {
    return jsonSafe(res, 409, { error: `Already watching ${domain} (${source})` });
  }

  const entry = {
    id:          Date.now().toString(16), // hex timestamp as unique ID
    domain,
    source,
    recordTypes,
    interval,
    addedAt:     Date.now(),
    lastChecked: null,
    lastChanged: null,
    status:      'pending', // pending | stable | changed | error
  };

  watched.domains.push(entry);
  saveWatched(watched);

  return jsonSafe(res, 201, { ok: true, entry });
}

// ── DELETE /admin/watched/:id ─────────────────────────────────────
/**
 * Removes a watched domain by its ID.
 * Also removes its snapshot and change log entries.
 */
function handleRemoveWatched(req, res, id) {
  if (!requireAuth(req, res)) return;

  if (!id) return jsonSafe(res, 400, { error: 'id is required' });

  const watched = getWatched();
  const before  = watched.domains.length;

  // Remove the domain entry
  watched.domains = watched.domains.filter(d => d.id !== id);

  if (watched.domains.length === before) {
    return jsonSafe(res, 404, { error: 'Watched domain not found' });
  }

  // Clean up associated snapshot and change log
  delete watched.snapshots[id];
  watched.changeLog = (watched.changeLog || []).filter(e => e.watchId !== id);

  saveWatched(watched);
  return jsonSafe(res, 200, { ok: true });
}

module.exports = {
  requireAuth,
  handleGetConfig,
  handlePutConfig,
  handleChangePassword,
  handleGetNotifyLog,
  handleTestNotify,
  handleGetWatched,
  handleAddWatched,
  handleRemoveWatched,
};
