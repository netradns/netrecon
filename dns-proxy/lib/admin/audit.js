// ── NetRecon — Admin Audit Trail ─────────────────────────────────
// A record of who signed in and what was changed in the admin panel, kept in
// /data/audit.json and shown on the admin Activity page.
//
// What is recorded: sign-ins (successful, failed, locked out), sign-outs,
// password changes and resets, settings changes (the NAMES of the settings,
// never their values), watched domains added or removed, test notifications,
// clearing stats, and the first-run setup.
//
// What is never recorded: passwords, hashes, tokens, webhook URLs, SMTP
// credentials, or any other setting value.
//
// Design notes:
//   - Event types are a fixed list (CATEGORY below). Anything else is ignored,
//     so a typo in a call site cannot invent a new kind of event.
//   - Repeated failed sign-ins from the same address are merged into one entry
//     with a count, so a password-guessing bot cannot flush real history out
//     of the log.
//   - Free text (such as a typed username) is reduced to printable ASCII and
//     length-limited before it is stored.
//   - Command-line tools run while the server is stopped cannot touch the
//     server's in-memory log, so they queue events in a side file that the
//     server picks up when it starts (see queueCliEvent).

'use strict';

const fs   = require('fs');
const path = require('path');
const { AUDIT_FILE, PENDING_AUDIT_FILE, MAX_AUDIT_LOG } = require('../config');

// Every event type and the group it belongs to in the UI filter
const CATEGORY = {
  login_ok:                'signin',
  login_failed:            'signin',
  login_locked:            'signin',
  login_blocked:           'signin',
  logout:                  'signin',
  password_changed:        'security',
  password_change_failed:  'security',
  password_reset_cli:      'security',
  setup_completed:         'security',
  settings_changed:        'config',
  server_settings_changed: 'config',
  notify_test:             'config',
  watched_added:           'watch',
  watched_removed:         'watch',
  stats_cleared:           'data',
};

// Event types whose repeats within the window are merged into one entry
const MERGE_TYPES     = new Set(['login_failed', 'login_blocked']);
const MERGE_WINDOW_MS = 5 * 60 * 1000;
const MERGE_LOOKBACK  = 50;      // only the newest entries are checked for a match
const FLUSH_DELAY_MS  = 1000;

let _log   = null;               // loaded on first use
let _timer = null;

// ── Helpers ───────────────────────────────────────────────────────

/** Printable ASCII only, trimmed to `max` characters. */
function clean(value, max) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/[^\x20-\x7E]/g, '?')
    .slice(0, max);
}

// ── Load ──────────────────────────────────────────────────────────

/** Move events queued by command-line tools into the log, then delete the queue file. */
function ingestPending(log) {
  let text;
  try { text = fs.readFileSync(PENDING_AUDIT_FILE, 'utf8'); } catch { return false; }

  let added = false;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (!CATEGORY[e.type]) continue;
      log.push({
        ts: Number(e.ts) || Date.now(), type: e.type, actor: 'cli', ip: '',
        detail: clean(e.detail, 200), count: 1,
      });
      added = true;
    } catch { /* skip a damaged line */ }
  }
  try { fs.unlinkSync(PENDING_AUDIT_FILE); } catch { /* already gone */ }

  if (added) log.sort((a, b) => a.ts - b.ts);
  return added;
}

function load() {
  if (_log) return _log;

  try {
    const parsed = JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf8'));
    _log = Array.isArray(parsed) ? parsed : [];
  } catch {
    _log = [];
  }

  if (ingestPending(_log)) {
    if (_log.length > MAX_AUDIT_LOG) _log.splice(0, _log.length - MAX_AUDIT_LOG);
    schedule();
  }
  return _log;
}

// ── Write ─────────────────────────────────────────────────────────

/** Write the log to disk atomically. */
function flush() {
  if (!_log) return;
  try {
    const dir = path.dirname(AUDIT_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = AUDIT_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(_log), 'utf8');
    fs.renameSync(tmp, AUDIT_FILE);
  } catch (err) {
    console.error(`[ERROR] Failed to save audit log: ${err.message}`);
  }
}

/** Save soon, but not on every single event. */
function schedule() {
  if (_timer) return;
  _timer = setTimeout(() => { _timer = null; flush(); }, FLUSH_DELAY_MS);
  _timer.unref();
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Record an event.
 *
 * @param {string} type         - One of the keys of CATEGORY
 * @param {Object} [info]
 * @param {string} [info.ip]    - Address of the person who did it
 * @param {string} [info.actor] - 'admin' (signed in), 'anonymous' (not signed in) or 'cli'
 * @param {string} [info.detail] - Short description. Never put secrets here.
 */
function record(type, info) {
  if (!CATEGORY[type]) return;

  const i      = info || {};
  const log    = load();
  const now    = Date.now();
  const ip     = clean(i.ip, 64);
  const detail = clean(i.detail, 200);

  if (MERGE_TYPES.has(type)) {
    for (let k = log.length - 1; k >= 0 && k >= log.length - MERGE_LOOKBACK; k--) {
      const e = log[k];
      if (e.type === type && e.ip === ip && e.detail === detail && now - e.ts < MERGE_WINDOW_MS) {
        e.count = (e.count || 1) + 1;
        e.ts    = now;
        schedule();
        return;
      }
    }
  }

  log.push({ ts: now, type, actor: clean(i.actor || 'admin', 16), ip, detail, count: 1 });
  if (log.length > MAX_AUDIT_LOG) log.splice(0, log.length - MAX_AUDIT_LOG);
  schedule();
}

/**
 * Events, newest first.
 *
 * @param {Object} [opts]
 * @param {string} [opts.category] - signin | security | config | watch | data
 * @param {number} [opts.limit]    - Maximum number of events (default 200)
 * @returns {Array}
 */
function getLog(opts) {
  const o     = opts || {};
  const limit = Math.min(Math.max(parseInt(o.limit, 10) || 200, 1), MAX_AUDIT_LOG);
  const out   = [];
  const log   = load();

  for (let k = log.length - 1; k >= 0 && out.length < limit; k--) {
    const e = log[k];
    if (o.category && CATEGORY[e.type] !== o.category) continue;
    out.push(Object.assign({ category: CATEGORY[e.type] || 'other' }, e));
  }
  return out;
}

/**
 * Queue an event from a separate process (a command-line tool). The running
 * server picks it up the next time it starts.
 */
function queueCliEvent(type, detail) {
  if (!CATEGORY[type]) return;
  try {
    fs.mkdirSync(path.dirname(PENDING_AUDIT_FILE), { recursive: true });
    fs.appendFileSync(PENDING_AUDIT_FILE, JSON.stringify({ ts: Date.now(), type, detail: clean(detail, 200) }) + '\n');
  } catch (err) {
    console.error(`[WARN] Could not queue audit event: ${err.message}`);
  }
}

module.exports = { CATEGORY, record, getLog, flush, queueCliEvent };
