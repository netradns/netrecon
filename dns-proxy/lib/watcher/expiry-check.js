// ── NetRecon — Domain Registration Check Runner ──────────────────
// Runs one registration check for a watched entry and records the outcome.
//
// This file connects the pieces and holds no rules of its own:
//   rdap.js            asks the registry (RDAP) about the domain
//   domain-expiry.js   decides what the answer means (state + events)
//   expiry-alerts.js   turns each event into a notification

'use strict';

const { evaluateExpiry, describeEvent, CHECK_INTERVAL_MS, ERROR_RETRY_MS } = require('./domain-expiry');
const { MAX_CHANGE_HISTORY } = require('../config');

/**
 * Check the registration of a watched entry, update its state in `watched`,
 * log any events and send alerts. The caller saves the watched state.
 *
 * @param {Object}   entry            - Watched entry with entry.expiry = { warnDays }
 * @param {Object}   watched          - Full watched state (mutated in place)
 * @param {Object}   [deps]           - Overrides for tests
 * @param {Function} [deps.lookup]    - Replaces rdap.lookupDomain(domain, { fresh })
 * @param {Function} [deps.alert]     - Replaces expiry-alerts.alertExpiry
 * @param {number}   [deps.now]       - Current time in ms
 * @param {boolean}  [deps.force]     - Check now, ignoring the schedule and any cached answer
 * @returns {Promise<{ state: Object, events: Object[] }|null>} null when the check was not due
 */
async function checkDomainExpiry(entry, watched, deps) {
  const d      = deps || {};
  const now    = d.now !== undefined ? d.now : Date.now();
  const lookup = d.lookup || require('../rdap').lookupDomain;
  const alert  = d.alert  || require('./expiry-alerts').alertExpiry;

  watched.expiries = watched.expiries || {};
  const prev = watched.expiries[entry.id] || null;

  // Registrations change slowly, so check twice a day. After a failure, try again sooner.
  const wait = prev && prev.ok === false ? ERROR_RETRY_MS : CHECK_INTERVAL_MS;
  if (!d.force && prev && now - prev.ts < wait) return null;

  let result;
  try {
    result = await lookup(entry.domain, { fresh: !!d.force });
  } catch (err) {
    result = { status: 'error', message: err.message };
  }

  const { state, events } = evaluateExpiry(prev, result, entry.expiry.warnDays, now);
  watched.expiries[entry.id] = state;
  entry.expiryStatus = state.status;

  if (events.length) {
    // History shown in the detail panel, in the same list as DNS and certificate events
    watched.changeLog = watched.changeLog || [];
    watched.changeLog.push({
      watchId: entry.id, domain: entry.domain, ts: now, kind: 'expiry', changes: [],
      expiryEvents: events.map(e => ({ type: e.type, message: describeEvent(e, state) })),
    });
    if (watched.changeLog.length > MAX_CHANGE_HISTORY) {
      watched.changeLog = watched.changeLog.slice(-MAX_CHANGE_HISTORY);
    }

    for (const event of events) {
      Promise.resolve(alert(entry, event, state)).catch(err =>
        console.error(`[watcher] Registration alert failed for ${entry.domain}: ${err.message}`)
      );
    }
    console.log(`[watcher] ${entry.domain} registration: ${events.map(e => e.type).join(', ')}`);
  }

  return { state, events };
}

module.exports = { checkDomainExpiry };
