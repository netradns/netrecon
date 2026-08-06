// ── NetRecon — Notification Delivery Log ─────────────────────────
// Rolling in-memory log of notification delivery attempts.
// Flushed to /data/notify-log.json on the same interval as stats.
//
// Each log entry records:
//   { ts, channelId, service, event, ok, errorMsg, durationMs }
//
// The log is capped at MAX_NOTIFY_LOG entries (default 200).
// Shown in the admin Settings → Notifications panel.

'use strict';

const fs   = require('fs');
const path = require('path');
const { NOTIFY_LOG_FILE, MAX_NOTIFY_LOG } = require('../config');

// ── In-memory log ─────────────────────────────────────────────────
let _log   = null;  // Array of log entries, loaded lazily
let _dirty = false; // True when log has unsaved changes

// ── Load ──────────────────────────────────────────────────────────
/**
 * Returns the current delivery log array.
 * Reads from disk on first call, returns the in-memory cache thereafter.
 *
 * @returns {Array} Array of log entry objects
 */
function getLog() {
  if (_log) return _log;

  try {
    const raw = fs.readFileSync(NOTIFY_LOG_FILE, 'utf8');
    _log = JSON.parse(raw);
    if (!Array.isArray(_log)) _log = [];
  } catch {
    _log = [];
  }

  return _log;
}

// ── Append ────────────────────────────────────────────────────────
/**
 * Appends a delivery attempt to the log.
 * Trims the log to MAX_NOTIFY_LOG entries to prevent unbounded growth.
 *
 * @param {string}  channelId  - Channel ID or service name
 * @param {string}  service    - slack | teams | discord | webhook | email
 * @param {string}  event      - Event name (e.g. 'record_changed', 'test')
 * @param {boolean} ok         - Whether delivery succeeded
 * @param {string}  [errorMsg] - Error message if delivery failed
 * @param {number}  [durationMs] - Delivery duration in milliseconds
 */
function appendLog(channelId, service, event, ok, errorMsg, durationMs) {
  const log = getLog();

  log.push({
    ts:         Date.now(),
    channelId:  channelId || service,
    service,
    event,
    ok:         ok ? 1 : 0,
    errorMsg:   errorMsg  || null,
    durationMs: durationMs || null,
  });

  // Trim to keep only the most recent MAX_NOTIFY_LOG entries
  if (log.length > MAX_NOTIFY_LOG) {
    _log = log.slice(-MAX_NOTIFY_LOG);
  }

  _dirty = true;
}

// ── Flush ─────────────────────────────────────────────────────────
/**
 * Writes the in-memory log to disk atomically.
 * Called every 10 seconds by setInterval and on graceful shutdown.
 */
function flush() {
  if (!_dirty || !_log) return;
  _dirty = false;

  try {
    const dir = path.dirname(NOTIFY_LOG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const tmp = NOTIFY_LOG_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(_log), 'utf8');
    fs.renameSync(tmp, NOTIFY_LOG_FILE);
  } catch (err) {
    console.error(`[ERROR] Failed to flush notify log: ${err.message}`);
    _dirty = true; // retry on next interval
  }
}

// Flush every 10 seconds — .unref() prevents this from blocking shutdown
setInterval(flush, 10000).unref();

module.exports = { getLog, appendLog, flush };
