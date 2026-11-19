// ── NetRecon — Admin HTTP Handlers ───────────────────────────────
// HTTP route handlers for all /admin/* endpoints.
//
// Routes registered in server.js:
//   POST /admin/login           - checks the password, returns a session token (public)
//   POST /admin/logout          - ends the session
//   GET  /admin/session         - confirms the token is still valid
//   GET  /admin/config          - returns runtime config (sanitized)
//   PUT  /admin/config          - updates runtime config
//   POST /admin/password        - changes the admin password
//   GET  /admin/notify-log      - returns notification delivery log
//   POST /admin/notify/test     - sends a test notification to one channel
//   GET  /admin/watched         - returns watched domains list
//   POST /admin/watched         - adds a watched domain
//   POST /admin/watched/:id/check - checks one entry right now
//   DELETE /admin/watched/:id   - removes a watched domain
//
// Auth: every route except /admin/login requires a session token sent as
// "Authorization: Bearer <token>". See session.js.
//
// Adding a new admin route:
//   1. Add a handler function here
//   2. Export it
//   3. Register it in server.js

'use strict';

const { getConfig, saveConfig }    = require('./config-store');
const { verifyPassword, changePassword, isUsingDefaultPassword } = require('./password');
const session                      = require('./session');
const audit                        = require('./audit');
const { getLog }                   = require('../notify/log');
const { dispatch }                 = require('../notify/dispatcher');
const { getWatched, saveWatched }  = require('../watcher/snapshot');
const { normalizeWarnDays, normalizePort } = require('../watcher/cert');
const { normalizeWarnDays: normalizeExpiryWarnDays } = require('../watcher/domain-expiry');
const { normalizeDomain } = require('../rdap');
const watcher                     = require('../watcher');
const { parseIPv4, isPrivateAddress } = require('../net-guard');
const { jsonSafe }                 = require('../handlers');

// Session guard shared by every admin route. See session.js.
const requireAuth = session.requireAuth;
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

// ── POST /admin/login ─────────────────────────────────────────────
/**
 * Checks the password and starts a session.
 * Body: { username: "admin", password: string }
 * Returns: { ok, token, expiresInSec, usingDefault, clientIp }
 *
 * Public route, so it is throttled per IP (see session.js). Wrong attempts
 * are also slowed by a short delay.
 */
async function handleLogin(req, res) {
  const ip   = session.clientIp(req);
  const gate = session.checkLogin(ip);
  if (!gate.allowed) {
    res.setHeader('Retry-After', String(gate.retryAfterSec));
    audit.record('login_blocked', { ip, actor: 'anonymous', detail: 'attempt while locked out' });
    return jsonSafe(res, 429, {
      error: `Too many failed attempts. Try again in ${Math.ceil(gate.retryAfterSec / 60)} minute(s).`,
    });
  }

  let body;
  try { body = JSON.parse(await readBody(req)); }
  catch { return jsonSafe(res, 400, { error: 'Invalid JSON body' }); }
  if (!body || typeof body !== 'object') body = {};

  // Check the password first so a wrong username takes as long as a wrong password
  const passwordOk = await verifyPassword(typeof body.password === 'string' ? body.password : '');
  const ok         = passwordOk && body.username === 'admin';

  if (!ok) {
    session.recordFailure(ip);
    audit.record('login_failed', { ip, actor: 'anonymous', detail: `username: ${body.username}` });
    if (!session.checkLogin(ip).allowed) audit.record('login_locked', { ip, actor: 'anonymous', detail: 'too many wrong passwords' });
    await new Promise(r => setTimeout(r, 300));
    console.warn(`[WARN] Failed admin login from ${ip}`);
    return jsonSafe(res, 401, { error: 'Incorrect username or password' });
  }

  session.recordSuccess(ip);
  audit.record('login_ok', { ip, actor: 'admin', detail: isUsingDefaultPassword() ? 'still using the default password' : '' });
  return jsonSafe(res, 200, {
    ok:           true,
    token:        session.createSession(),
    expiresInSec: session.SESSION_IDLE_MS / 1000,
    usingDefault: isUsingDefaultPassword(),
    clientIp:     ip,
  });
}

// ── POST /admin/logout ────────────────────────────────────────────
/** Ends the caller's session. Always succeeds. */
function handleLogout(req, res) {
  const token = session.getToken(req);
  if (session.validateSession(token)) audit.record('logout', { ip: session.clientIp(req) });
  session.revokeSession(token);
  return jsonSafe(res, 200, { ok: true });
}

// ── GET /admin/session ────────────────────────────────────────────
/**
 * Tells the browser whether its saved token still works (it stops working
 * after a restart or a long idle time). Also reports whether the default
 * password is still in use, so the UI can remind the admin to change it, and the
 * address the server sees for this visitor, which shows whether a proxy or load
 * balancer in front of NetRecon is set up correctly.
 */
function handleSession(req, res) {
  if (!requireAuth(req, res)) return;
  return jsonSafe(res, 200, { ok: true, usingDefault: isUsingDefaultPassword(), clientIp: session.clientIp(req) });
}

// ── GET /admin/config ─────────────────────────────────────────────
/**
 * Returns the current runtime config.
 * SMTP password is redacted — never sent to the browser.
 * No password hash is ever included.
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
  audit.record('settings_changed', { ip: session.clientIp(req), detail: Object.keys(update).join(', ') });
  return jsonSafe(res, 200, { ok: true });
}

// ── POST /admin/password ──────────────────────────────────────────
/**
 * Changes the admin password.
 * Body: { currentPassword: string, newPassword: string }
 *
 * Other sessions are ended, so anyone who had the old password is logged
 * out. The caller stays logged in.
 */
async function handleChangePassword(req, res) {
  if (!requireAuth(req, res)) return;

  let body;
  try { body = JSON.parse(await readBody(req)); }
  catch { return jsonSafe(res, 400, { error: 'Invalid JSON body' }); }

  const result = await changePassword(
    typeof body.currentPassword === 'string' ? body.currentPassword : '',
    typeof body.newPassword     === 'string' ? body.newPassword     : ''
  );

  if (result.ok) {
    session.revokeOtherSessions(session.getToken(req));
    audit.record('password_changed', { ip: session.clientIp(req), detail: 'other sessions signed out' });
  } else if (/incorrect/i.test(result.error || '')) {
    audit.record('password_change_failed', { ip: session.clientIp(req), detail: 'wrong current password' });
  }
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
    audit.record('notify_test', { ip: session.clientIp(req), detail: String(ch.service) });
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
 * Adds a new entry to the watch list.
 * Body: { domain, source, recordTypes, interval, cert? }
 *   domain:      string  - domain name or IPv4 address (e.g. "example.com", "10.0.0.5")
 *   source:      string  - "public" or "internal"
 *   recordTypes: Array   - e.g. ["A", "MX", "TXT"] or ["ALL"]. May be empty when cert is set.
 *   interval:    number  - poll interval in minutes (5, 15, 60, 360, 1440)
 *   cert:        object  - optional { enabled, port, warnDays } to watch the TLS certificate
 *   expiry:      object  - optional { enabled, warnDays } to watch the domain registration
 *                          (public domains only: internal names and IP addresses are not registered)
 *
 * Entries can watch DNS records, a certificate, a registration, or any mix. An IP
 * address has no DNS records or registration, so it must be a certificate watch.
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

  // Certificate watch (optional)
  let cert = null;
  if (body.cert && body.cert.enabled) {
    const port = normalizePort(body.cert.port);
    if (port === null) return jsonSafe(res, 400, { error: 'Invalid port. Use a number from 1 to 65535.' });
    cert = { enabled: true, port, warnDays: normalizeWarnDays(body.cert.warnDays) };
  }

  // Domain registration watch (optional). Internal names and IP addresses are not registered anywhere.
  let expiry = null;
  if (body.expiry && body.expiry.enabled) {
    if (source === 'internal') {
      return jsonSafe(res, 400, { error: 'Registration expiry applies to public domains. Choose the Public source.' });
    }
    if (!normalizeDomain(domain)) {
      return jsonSafe(res, 400, { error: 'Registration expiry needs a registered domain name, such as example.com.' });
    }
    expiry = { enabled: true, warnDays: normalizeExpiryWarnDays(body.expiry.warnDays) };
  }

  const VALID_TYPES = new Set(['A','AAAA','MX','TXT','NS','CNAME','SOA','CAA','SRV','ALL']);
  let recordTypes = Array.isArray(body.recordTypes)
    ? body.recordTypes.filter(t => VALID_TYPES.has(String(t).toUpperCase())).map(t => String(t).toUpperCase())
    : (cert || expiry ? [] : ['A', 'MX', 'TXT', 'NS']);

  // An IP address is not a DNS name: watch its certificate only
  const isIp = !!parseIPv4(domain);
  if (!isIp && /^\d+(\.\d+){0,3}$/.test(domain)) {
    return jsonSafe(res, 400, { error: 'That looks like an IP address but is not valid. Use four numbers from 0 to 255, like 10.0.0.5.' });
  }
  if (isIp) {
    if (!cert) return jsonSafe(res, 400, { error: 'An IP address has no DNS records to watch. Turn on certificate monitoring instead.' });
    if (expiry) return jsonSafe(res, 400, { error: 'An IP address has no domain registration to watch.' });
    recordTypes = [];
    if (source === 'public' && isPrivateAddress(domain)) {
      return jsonSafe(res, 400, { error: 'That is a private address. Choose the Internal source to watch it.' });
    }
  }

  if (!recordTypes.length && !cert && !expiry) {
    return jsonSafe(res, 400, { error: 'Choose at least one record type, or turn on certificate or registration monitoring.' });
  }

  // Allowed poll intervals in minutes
  const VALID_INTERVALS = new Set([5, 15, 60, 360, 1440]);
  const interval = VALID_INTERVALS.has(Number(body.interval)) ? Number(body.interval) : 60;

  const watched = getWatched();

  // Reject duplicates: the same host and source may not watch DNS twice,
  // or watch the same certificate port twice.
  const clash = watched.domains.find(d => d.domain === domain && d.source === source && (
    ((d.recordTypes || []).length > 0 && recordTypes.length > 0) ||
    (d.cert && cert && d.cert.port === cert.port) ||
    (d.expiry && expiry)
  ));
  if (clash) {
    return jsonSafe(res, 409, { error: `Already watching ${domain} (${source})` });
  }

  const entry = {
    id:          Date.now().toString(16), // hex timestamp as unique ID
    domain,
    source,
    recordTypes,
    cert,
    expiry,
    interval,
    addedAt:     Date.now(),
    lastChecked: null,
    lastChanged: null,
    status:      'pending', // pending | stable | changed | error
    certStatus:  cert ? 'pending' : null,
    expiryStatus: expiry ? 'pending' : null,
  };

  watched.domains.push(entry);
  saveWatched(watched);
  audit.record('watched_added', {
    ip: session.clientIp(req),
    detail: `${domain} (${source}): ` + [recordTypes.length ? 'DNS records' : '', cert ? 'certificate' : '', expiry ? 'domain registration' : ''].filter(Boolean).join(' + '),
  });

  // First check right away, so the admin sees a result without waiting for the next tick
  watcher.checkNow(entry).catch(err => console.error(`[watcher] First check failed for ${domain}: ${err.message}`));

  return jsonSafe(res, 201, { ok: true, entry });
}
// ── POST /admin/watched/:id/check ─────────────────────────────────
/**
 * Runs the checks for one entry immediately (the "Check now" button).
 * Waits for the result and returns the refreshed entry and certificate state.
 */
async function handleCheckWatched(req, res, id) {
  if (!requireAuth(req, res)) return;

  const watched = getWatched();
  const entry   = watched.domains.find(d => d.id === id);
  if (!entry) return jsonSafe(res, 404, { error: 'Watched domain not found' });

  await watcher.checkNow(entry);
  return jsonSafe(res, 200, { ok: true, entry, cert: (watched.certs || {})[id] || null, expiry: (watched.expiries || {})[id] || null });
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
  const removed = watched.domains.find(d => d.id === id);
  watched.domains = watched.domains.filter(d => d.id !== id);

  if (watched.domains.length === before) {
    return jsonSafe(res, 404, { error: 'Watched domain not found' });
  }

  // Clean up associated snapshot and change log
  delete watched.snapshots[id];
  if (watched.certs) delete watched.certs[id];
  if (watched.expiries) delete watched.expiries[id];
  watched.changeLog = (watched.changeLog || []).filter(e => e.watchId !== id);

  saveWatched(watched);
  audit.record('watched_removed', { ip: session.clientIp(req), detail: removed ? `${removed.domain} (${removed.source})` : String(id) });
  return jsonSafe(res, 200, { ok: true });
}

module.exports = {
  requireAuth,
  handleLogin,
  handleLogout,
  handleSession,
  handleGetConfig,
  handlePutConfig,
  handleChangePassword,
  handleGetNotifyLog,
  handleTestNotify,
  handleGetWatched,
  handleAddWatched,
  handleCheckWatched,
  handleRemoveWatched,
};
