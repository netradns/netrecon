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
//   5. An entry can watch DNS records, a TLS certificate, a domain registration, or any mix
//
// This "single timer, per-domain interval check" pattern avoids
// creating one timer per domain (which would be hard to manage as
// domains are added/removed via the UI).

'use strict';

const { getWatched, saveWatched }          = require('./snapshot');
const { pollDomain }                       = require('./poller');
const { diffRecords }                      = require('./diff');
const { checkCertificate }                 = require('./cert-check');
const { checkDomainExpiry }                = require('./expiry-check');
const { alertRecordChanged, alertRecovered, alertError } = require('./alerts');
const { MAX_CHANGE_HISTORY }               = require('../config');
const audit                               = require('../admin/audit');

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
    const typesAtStart = (entry.recordTypes || []).join(',');
    const current  = await pollDomain(entry);
    // The record types were edited while this poll ran, so these results are for the old types.
    // Storing them would make the next poll report the difference as a change. A new check is already queued.
    if ((entry.recordTypes || []).join(',') !== typesAtStart) return;
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
      audit.record('watch_failing', { actor: 'system', detail: `${domain}: ${err.message}` });
      alertError(entry, err.message).catch(() => {});
    }

    saveWatched(watched);
  }
}

// ── One watched entry ─────────────────────────────────────────────
// Entries currently being checked, so a scheduled check and a "check now"
// request for the same entry never run at the same time.
const _inFlight = new Set();
// Entries that were asked for a forced check while one was running (an edit, or Check now).
// They are checked again as soon as the running check ends, so the request is not lost.
const _rerun = new Set();

// What the main Status column shows for an entry with no DNS records, from its certificate
// and registration state. When both are watched, the worse one wins.
const CERT_ENTRY_STATUS = {
  ok: 'stable', expiring: 'changed', expired: 'error', error: 'error', pending: 'pending',
  notfound: 'error', unsupported: 'error', noexpiry: 'changed',
};
const STATUS_RANK = { stable: 0, pending: 1, changed: 2, error: 3 };

/**
 * Runs every check an entry asks for: DNS records, TLS certificate, or both.
 *
 * @param {Object}  entry   - Watched entry
 * @param {Object}  watched - Full watched state (mutated in place)
 * @param {Object}  [opts]
 * @param {boolean} [opts.force] - Check the certificate now even if it was checked recently
 */
async function checkEntry(entry, watched, opts) {
  if (_inFlight.has(entry.id)) {
    if (opts && opts.force) _rerun.add(entry.id);
    return;
  }
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

    if (entry.expiry && entry.expiry.enabled) {
      try {
        await checkDomainExpiry(entry, watched, { force: !!(opts && opts.force) });
      } catch (err) {
        console.error(`[watcher] Registration check failed for ${entry.domain}: ${err.message}`);
      }
    }

    // An entry with no DNS poll takes its status from the certificate and registration checks
    if (!watchesDns) {
      const states = [entry.cert && entry.certStatus, entry.expiry && entry.expiryStatus]
        .filter(Boolean).map(s => CERT_ENTRY_STATUS[s] || 'pending');
      entry.lastChecked = Date.now();
      entry.status      = states.sort((a, b) => STATUS_RANK[b] - STATUS_RANK[a])[0] || 'pending';
    }
    saveWatched(watched);

  } finally {
    _inFlight.delete(entry.id);
  }
  // Not for an entry that was removed meanwhile
  if (_rerun.delete(entry.id) && watched.domains.includes(entry)) {
    await checkEntry(entry, watched, { force: true });
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
