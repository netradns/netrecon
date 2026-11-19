// ── NetRecon — Domain Watcher Scheduler ──────────────────────────
// Orchestrates the domain monitoring polling loop.
// This file is the scheduler only — it decides when to poll.
// What to poll, how to diff, and how to alert are in separate files.
//
// How it works:
//   1. start() is called once from server.js after startup
//   2. A single setInterval ticks every TICK_MS (default 60s)
//   3. On each tick, every watched domain is checked against its
//      configured interval — if enough time has passed, it's polled
//   4. Polling, diffing, and alerting are delegated to their modules
//   5. An entry can watch DNS records, a TLS certificate, or both
//
// This "single timer, per-domain interval check" pattern avoids
// creating one timer per domain (which would be hard to manage as
// domains are added/removed via the UI).

'use strict';

const { getWatched, saveWatched }          = require('./snapshot');
const { pollDomain }                       = require('./poller');
const { diffRecords }                      = require('./diff');
const { checkCertificate }                 = require('./cert-check');
const { alertRecordChanged, alertRecovered, alertError } = require('./alerts');
const { MAX_CHANGE_HISTORY }               = require('../config');

// How often the scheduler ticks (checks which domains are due for polling)
// 60 seconds is fine — the minimum watch interval is 5 minutes anyway
const TICK_MS = 60 * 1000;

// Track consecutive error counts per domain ID to avoid alert spam
// Only alert on error after ERROR_THRESHOLD consecutive failures
const _errorCounts = {};
const ERROR_THRESHOLD = 3;

// ── Main poll function ────────────────────────────────────────────
/**
 * Polls a single watched domain entry:
 *   1. Resolves current DNS records via poller.js
 *   2. Diffs against the stored snapshot via diff.js
 *   3. If changed, appends to change log and fires alert via alerts.js
 *   4. Updates the domain's status, lastChecked, and lastChanged fields
 *   5. Saves the updated state to disk
 *
 * @param {Object} entry   - Watched domain entry from snapshot.js
 * @param {Object} watched - Full watched state (mutated in place)
 */
async function checkDomain(entry, watched) {
  const { id, domain } = entry;

  try {
    // Resolve current records
    const current  = await pollDomain(entry);
    const previous = watched.snapshots[id]?.records || null;

    // First poll — just store the snapshot, no diff yet
    if (previous === null) {
      watched.snapshots[id] = { ts: Date.now(), records: current };
      entry.lastChecked = Date.now();
      entry.status      = 'stable';
      console.log(`[watcher] Initial snapshot for ${domain} (${current.length} records)`);
      saveWatched(watched);
      return;
    }

    // Subsequent polls — diff against previous snapshot
    const changes = diffRecords(previous, current);

    entry.lastChecked = Date.now();

    if (changes.length > 0) {
      // Records changed — update snapshot, log the change, alert
      console.log(`[watcher] ${domain}: ${changes.length} change(s) detected`);

      watched.snapshots[id] = { ts: Date.now(), records: current };
      entry.lastChanged     = Date.now();
      entry.status          = 'changed';

      // Append to change log — capped at MAX_CHANGE_HISTORY total entries
      watched.changeLog = watched.changeLog || [];
      watched.changeLog.push({ watchId: id, domain, ts: Date.now(), changes });
      if (watched.changeLog.length > MAX_CHANGE_HISTORY) {
        watched.changeLog = watched.changeLog.slice(-MAX_CHANGE_HISTORY);
      }

      // Fire notification — non-blocking, errors are caught inside dispatch
      alertRecordChanged(entry, changes).catch(err =>
        console.error(`[watcher] Alert failed for ${domain}: ${err.message}`)
      );

    } else {
      // No changes — update status to stable if it was previously changed/error
      if (entry.status !== 'stable') {
        // Recovered from error state — send recovery notification
        if (entry.status === 'error') {
          alertRecovered(entry).catch(() => {});
        }
        entry.status = 'stable';
      }
    }

    // Reset error counter on successful poll
    _errorCounts[id] = 0;

    saveWatched(watched);

  } catch (err) {
    // Poll failed — increment error counter
    _errorCounts[id] = (_errorCounts[id] || 0) + 1;
    entry.lastChecked = Date.now();
    entry.status      = 'error';

    console.error(`[watcher] Poll failed for ${domain}: ${err.message}`);

    // Only alert after ERROR_THRESHOLD consecutive failures to avoid spam
    if (_errorCounts[id] === ERROR_THRESHOLD) {
      alertError(entry, err.message).catch(() => {});
    }

    saveWatched(watched);
  }
}

// ── One watched entry ─────────────────────────────────────────────
// Entries currently being checked, so a scheduled check and a "check now"
// request for the same entry never run at the same time.
const _inFlight = new Set();

// What the main Status column shows for a certificate-only entry
const CERT_ENTRY_STATUS = { ok: 'stable', expiring: 'changed', expired: 'error', error: 'error', pending: 'pending' };

/**
 * Runs every check an entry asks for: DNS records, TLS certificate, or both.
 *
 * @param {Object}  entry   - Watched entry
 * @param {Object}  watched - Full watched state (mutated in place)
 * @param {Object}  [opts]
 * @param {boolean} [opts.force] - Check the certificate now even if it was checked recently
 */
async function checkEntry(entry, watched, opts) {
  if (_inFlight.has(entry.id)) return;
  _inFlight.add(entry.id);

  try {
    const watchesDns = Array.isArray(entry.recordTypes) && entry.recordTypes.length > 0;

    if (watchesDns) await checkDomain(entry, watched);

    if (entry.cert && entry.cert.enabled) {
      try {
        await checkCertificate(entry, watched, { force: !!(opts && opts.force) });
      } catch (err) {
        console.error(`[watcher] Certificate check failed for ${entry.domain}: ${err.message}`);
      }
    }

    // A certificate-only entry has no DNS poll, so its status comes from the certificate
    if (!watchesDns) {
      entry.lastChecked = Date.now();
      entry.status      = CERT_ENTRY_STATUS[entry.certStatus] || 'pending';
    }
    saveWatched(watched);

  } finally {
    _inFlight.delete(entry.id);
  }
}

/**
 * Checks one entry immediately. Used right after an entry is added, so the
 * admin sees a first result without waiting for the next scheduler tick.
 */
function checkNow(entry) {
  return checkEntry(entry, getWatched(), { force: true });
}

// ── Scheduler tick ────────────────────────────────────────────────
/**
 * Called on every TICK_MS interval.
 * Checks each watched domain to see if it's due for a poll.
 *
 * Design note: getWatched() returns the live in-memory cache object.
 * checkDomain() mutates entry fields (lastChecked, status, etc.) directly
 * on that object and calls saveWatched() to persist. This is intentional —
 * it avoids copying large snapshot objects on every tick. The cache is
 * always consistent because we're single-threaded (Node.js event loop).
 */
async function tick() {
  const watched = getWatched();
  if (!watched.domains.length) return;

  const now = Date.now();

  for (const entry of watched.domains) {
    const intervalMs  = (entry.interval || 60) * 60 * 1000;
    const lastChecked = entry.lastChecked || 0;

    // Check if this domain is due for a poll
    if (now - lastChecked >= intervalMs) {
      // Await each domain sequentially to avoid hammering DNS servers
      // when many domains are due at the same time
      await checkEntry(entry, watched);
    }
  }
}

// ── Start ─────────────────────────────────────────────────────────
/**
 * Starts the watcher scheduler.
 * Called once from server.js after startup.
 * The first tick is delayed 30 seconds to let the server fully initialise.
 */
function start() {
  console.log('[watcher] Domain monitoring started');

  // Delay first tick to avoid hammering DNS on startup
  setTimeout(() => {
    tick().catch(err => console.error(`[watcher] Tick error: ${err.message}`));
  }, 30000);

  // Regular interval — .unref() prevents this from blocking graceful shutdown
  setInterval(() => {
    tick().catch(err => console.error(`[watcher] Tick error: ${err.message}`));
  }, TICK_MS).unref();
}

module.exports = { start, tick, checkDomain, checkEntry, checkNow };
