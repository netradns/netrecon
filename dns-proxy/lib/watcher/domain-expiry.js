// ── NetRecon — Domain Registration Watch Rules ───────────────────
// Pure decision logic for watched domain registrations. No network, no disk,
// no clock of its own, so every rule can be tested exactly.
//
// Given the previous state and the latest RDAP lookup (see ../rdap.js),
// evaluateExpiry() returns the new state and the events to alert on.
//
// Events:
//   expiring      the registration crossed a warning threshold (once per threshold)
//   expired       the registration has passed its expiry date (repeated daily)
//   renewed       the expiry date moved later
//   reregistered  the registration date changed: the domain lapsed and was registered again
//   lifecycle     the registry put the domain on hold, in redemption, or pending delete
//   notfound      the domain is no longer registered
//   error         lookups kept failing
//   recovered     lookups work again after an error was reported
//
// States that are not problems with the domain but facts about its registry:
//   unsupported   the TLD has no RDAP server, so nothing can be watched
//   noexpiry      the registry answers but does not publish an expiry date

'use strict';

const { DAY_MS } = require('./cert');

const DEFAULT_WARN_DAYS     = [60, 30, 14, 7];
const MAX_WARN_THRESHOLDS   = 6;
const ERROR_THRESHOLD       = 3;                     // failed lookups in a row before an error alert
const EXPIRED_REMINDER_MS   = DAY_MS;
const CHECK_INTERVAL_MS     = 12 * 60 * 60 * 1000;   // registrations change slowly
const ERROR_RETRY_MS        = 60 * 60 * 1000;        // look again sooner after a failure
const RENEWAL_MIN_SHIFT_MS  = 12 * 60 * 60 * 1000;   // ignore tiny changes in the expiry timestamp
const REREGISTERED_MIN_MS   = DAY_MS;

/**
 * Clean up a list of warning thresholds (days before expiry).
 * Whole numbers from 1 to 365, no duplicates, largest first, at most six.
 * Falls back to the default when nothing usable is given.
 */
function normalizeWarnDays(input) {
  const list = Array.isArray(input) ? input : [];
  const days = [...new Set(list.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 365))]
    .sort((a, b) => b - a)
    .slice(0, MAX_WARN_THRESHOLDS);
  return days.length ? days : DEFAULT_WARN_DAYS.slice();
}

const dateOnly = ms => new Date(ms).toISOString().slice(0, 10);

/** Names of the lifecycle problems in a lookup result, for display and for change detection. */
function lifecycleProblems(flags) {
  const f = flags || {};
  return [f.pendingDelete && 'pending delete', f.redemption && 'redemption period', f.onHold && 'on hold'].filter(Boolean);
}

/**
 * Work out the new state and which events need an alert.
 *
 * @param {Object|null} prev     - State after the previous check, or null the first time
 * @param {Object}      result   - Output of rdap.lookupDomain()
 * @param {number[]}    warnDays - Warning thresholds, largest first
 * @param {number}      [now]    - Current time in ms (injectable for tests)
 * @returns {{ state: Object, events: Object[] }}
 */
function evaluateExpiry(prev, result, warnDays, now = Date.now()) {
  const base   = prev || {};
  const events = [];
  const r      = result || { status: 'error', message: 'No answer' };

  // ── Facts about the registry: not a problem, no alerts ──────────
  if (r.status === 'unsupported') {
    return { state: { ts: now, ok: true, status: 'unsupported', tld: r.tld, errorStreak: 0, alerted: {} }, events };
  }

  // ── The lookup failed ───────────────────────────────────────────
  if (r.status === 'error' || r.status === 'invalid') {
    const message = r.message || 'The registration lookup failed';
    const streak  = (base.errorStreak || 0) + 1;
    if (streak === ERROR_THRESHOLD) events.push({ type: 'error', message });

    const state = Object.assign({}, base, {
      ts: now, ok: false, error: message, errorStreak: streak,
      status: streak >= ERROR_THRESHOLD ? 'error' : (base.status || 'pending'),
    });
    return { state, events };
  }

  const recovered = (base.errorStreak || 0) >= ERROR_THRESHOLD;
  if (recovered) events.push({ type: 'recovered' });

  const alerted = Object.assign({}, base.alerted);

  // ── The domain is not registered ────────────────────────────────
  if (r.status === 'notfound') {
    if (!alerted.notfound && base.registered !== undefined) events.push({ type: 'notfound' });   // it was there before
    alerted.notfound = true;
    return {
      state: Object.assign({}, base, { ts: now, ok: true, error: null, errorStreak: 0, status: 'notfound', alerted }),
      events,
    };
  }
  delete alerted.notfound;

  // ── Found ───────────────────────────────────────────────────────
  const expires  = r.expires || null;
  let lastExpiredAlert = base.lastExpiredAlert || 0;
  let flagsAlerted     = base.flagsAlerted || '';

  // The registration date changing means someone registered the name again
  if (base.registered && r.registered && Math.abs(r.registered - base.registered) > REREGISTERED_MIN_MS) {
    events.push({ type: 'reregistered', previousRegistered: base.registered, registrar: r.registrar, previousRegistrar: base.registrar });
  }

  // The expiry date moving later means the registration was renewed
  const renewed = !!(base.expires && expires && expires > base.expires + RENEWAL_MIN_SHIFT_MS);
  if (renewed) {
    events.push({ type: 'renewed', previousExpires: base.expires });
    for (const k of Object.keys(alerted)) delete alerted[k];
    lastExpiredAlert = 0;
  }

  // Hold, redemption or pending delete: alert when the set of problems changes
  const problems = lifecycleProblems(r.flags);
  const key      = problems.join('|');
  if (key && key !== flagsAlerted) events.push({ type: 'lifecycle', problems });
  flagsAlerted = key;

  // Expiry thresholds
  let status = 'ok';
  let daysLeft = null;
  if (!expires) {
    status = 'noexpiry';
  } else {
    daysLeft = Math.floor((expires - now) / DAY_MS);
    if (daysLeft < 0) {
      status = 'expired';
      if (now - lastExpiredAlert >= EXPIRED_REMINDER_MS) { events.push({ type: 'expired' }); lastExpiredAlert = now; }
    } else {
      const crossed = warnDays.filter(t => daysLeft <= t);
      if (crossed.length) status = 'expiring';
      if (crossed.some(t => !alerted[t])) {
        events.push({ type: 'expiring' });
        crossed.forEach(t => { alerted[t] = true; });
      }
    }
  }
  if (problems.length && status === 'ok') status = 'expiring';     // a hold needs attention even with time left

  const state = {
    ts: now, ok: true, error: null, errorStreak: 0, status,
    registeredDomain: r.registeredDomain, registrar: r.registrar || '', server: r.server || '',
    registered: r.registered || null, expires, updated: r.updated || null, daysLeft,
    statuses: r.statuses || [], nameservers: r.nameservers || [], flags: r.flags || {},
    alerted, lastExpiredAlert, flagsAlerted,
  };
  return { state, events };
}

/** One-line description of an event for the change history. */
function describeEvent(event, state) {
  const d = state || {};
  switch (event.type) {
    case 'expiring':     return `Registration expires in ${d.daysLeft} day${d.daysLeft === 1 ? '' : 's'} (${dateOnly(d.expires)})`;
    case 'expired':      return `Registration expired ${Math.abs(d.daysLeft)} day${Math.abs(d.daysLeft) === 1 ? '' : 's'} ago (${dateOnly(d.expires)})`;
    case 'renewed':      return `Renewed: now expires ${dateOnly(d.expires)}` + (event.previousExpires ? ` (was ${dateOnly(event.previousExpires)})` : '');
    case 'reregistered': return `The domain was registered again (new registration date ${d.registered ? dateOnly(d.registered) : 'unknown'}). It may have lapsed.`;
    case 'lifecycle':    return `The registry marked the domain: ${event.problems.join(', ')}`;
    case 'notfound':     return 'The domain is no longer registered';
    case 'error':        return `Could not check the registration: ${event.message}`;
    case 'recovered':    return 'Registration checks are working again';
    default:             return event.type;
  }
}

module.exports = {
  DEFAULT_WARN_DAYS, CHECK_INTERVAL_MS, ERROR_RETRY_MS, ERROR_THRESHOLD,
  normalizeWarnDays, evaluateExpiry, describeEvent, lifecycleProblems,
};
