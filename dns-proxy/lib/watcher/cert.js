// ── NetRecon — Certificate Watch Rules ───────────────────────────
// Pure decision logic for watched TLS certificates. No network, no disk,
// no clock of its own, so every rule can be tested exactly.
//
// Given the previous state of a certificate and the latest check result,
// evaluateCert() returns the new state and the list of events to alert on.
//
// Events:
//   expiring   the certificate crossed a warning threshold (once per threshold)
//   expired    the certificate has expired (repeated once a day while it stays expired)
//   renewed    a different certificate with a later expiry replaced the old one
//   changed    a different certificate with an earlier or equal expiry replaced it
//   error      the check failed several times in a row
//   recovered  checks work again after an error was reported
//
// Why alerts fire once: each threshold is remembered in state.alerted, so a
// certificate that is 20 days from expiry produces one "expiring" alert, not
// one on every check. A replaced certificate resets that memory.

'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_WARN_DAYS    = [30, 14, 7];
const MAX_WARN_THRESHOLDS  = 6;
const ERROR_THRESHOLD      = 3;                 // failed checks in a row before an error alert
const EXPIRED_REMINDER_MS  = DAY_MS;            // an expired certificate is re-announced daily
const CHECK_MIN_INTERVAL_MS = 60 * 60 * 1000;   // certificates change slowly: at most one check per hour

// ── Input normalisation ───────────────────────────────────────────

/**
 * Clean up a list of warning thresholds (days before expiry).
 * Keeps whole numbers from 1 to 365, removes duplicates, sorts largest first.
 * Falls back to the default when nothing usable is given.
 *
 * @param {*} input
 * @returns {number[]}
 */
function normalizeWarnDays(input) {
  const list = Array.isArray(input) ? input : [];
  const days = [...new Set(list.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 365))]
    .sort((a, b) => b - a)
    .slice(0, MAX_WARN_THRESHOLDS);
  return days.length ? days : DEFAULT_WARN_DAYS.slice();
}

/**
 * Parse a TCP port. Returns the port, the default (443) when none is given,
 * or null when a value was given but is not a valid port.
 *
 * @param {*} input
 * @returns {number|null}
 */
function normalizePort(input) {
  if (input === undefined || input === null || input === '') return 443;
  const n = Number(input);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
}

// ── Evaluation ────────────────────────────────────────────────────

const dateOnly = ms => new Date(ms).toISOString().slice(0, 10);

/**
 * Work out the new certificate state and which events need an alert.
 *
 * @param {Object|null} prev     - State stored after the previous check, or null the first time
 * @param {Object}      result   - Output of checkCert(): certificate details, or { error }
 * @param {number[]}    warnDays - Warning thresholds, largest first
 * @param {number}      [now]    - Current time in ms (injectable for tests)
 * @returns {{ state: Object, events: Object[] }}
 */
function evaluateCert(prev, result, warnDays, now = Date.now()) {
  const base   = prev || {};
  const events = [];
  const validTo = result && !result.error ? Date.parse(result.validTo) : NaN;

  // ── The check failed (or returned nothing usable) ───────────────
  if (!result || result.error || !Number.isFinite(validTo)) {
    const message = (result && result.error) || 'The certificate has no readable expiry date';
    const streak  = (base.errorStreak || 0) + 1;

    if (streak === ERROR_THRESHOLD) events.push({ type: 'error', message });

    // Keep what we knew about the certificate so the UI still shows it
    const state = Object.assign({}, base, {
      ts: now, ok: false, error: message, errorStreak: streak,
      status: streak >= ERROR_THRESHOLD ? 'error' : (base.status || 'pending'),
    });
    return { state, events };
  }

  // ── The check worked ────────────────────────────────────────────
  const daysLeft = Math.floor((validTo - now) / DAY_MS);
  const replaced = !!(base.fingerprint && base.fingerprint !== result.fingerprint);

  // A new certificate starts with a clean slate of alerts
  const alerted = replaced ? {} : Object.assign({}, base.alerted);
  let lastExpiredAlert = replaced ? 0 : (base.lastExpiredAlert || 0);

  if ((base.errorStreak || 0) >= ERROR_THRESHOLD) events.push({ type: 'recovered' });

  if (replaced) {
    events.push({
      type:          validTo > (base.validTo || 0) ? 'renewed' : 'changed',
      previousValidTo: base.validTo || null,
      previousIssuer:  base.issuer || '',
      issuerChanged:   !!base.issuer && base.issuer !== result.issuer,
    });
  }

  let status = 'ok';
  if (daysLeft < 0) {
    status = 'expired';
    if (now - lastExpiredAlert >= EXPIRED_REMINDER_MS) {
      events.push({ type: 'expired' });
      lastExpiredAlert = now;
    }
  } else {
    const crossed = warnDays.filter(t => daysLeft <= t);
    if (crossed.length) status = 'expiring';
    if (crossed.some(t => !alerted[t])) {
      events.push({ type: 'expiring' });
      crossed.forEach(t => { alerted[t] = true; });
    }
  }

  const state = {
    ts: now, ok: true, error: null, errorStreak: 0, status,
    validFrom:    Date.parse(result.validFrom) || null,
    validTo, daysLeft,
    fingerprint:  result.fingerprint  || '',
    subject:      result.subject      || '',
    commonName:   result.commonName   || '',
    issuer:       result.issuer       || '',
    issuerOrg:    result.issuerOrg    || '',
    sans:         (result.sans || []).slice(0, 25),
    serialNumber: result.serialNumber || '',
    protocol:     result.protocol     || '',
    authorized:   !!result.authorized,
    authError:    result.authError    || null,
    alerted, lastExpiredAlert,
  };
  return { state, events };
}

/**
 * One-line, human-readable description of an event, for the change history.
 *
 * @param {Object} event - One of the events from evaluateCert()
 * @param {Object} state - The state returned alongside it
 * @returns {string}
 */
function describeEvent(event, state) {
  switch (event.type) {
    case 'expiring': return `Expires in ${state.daysLeft} day${state.daysLeft === 1 ? '' : 's'} (${dateOnly(state.validTo)})`;
    case 'expired':  return `Expired ${Math.abs(state.daysLeft)} day${Math.abs(state.daysLeft) === 1 ? '' : 's'} ago (${dateOnly(state.validTo)})`;
    case 'renewed':  return `Renewed: now valid until ${dateOnly(state.validTo)}` +
                            (event.previousValidTo ? ` (was ${dateOnly(event.previousValidTo)})` : '');
    case 'changed':  return `Replaced by a different certificate, valid until ${dateOnly(state.validTo)}`;
    case 'error':    return `Could not check the certificate: ${event.message}`;
    case 'recovered': return 'Certificate checks are working again';
    default:         return event.type;
  }
}

module.exports = {
  DEFAULT_WARN_DAYS, ERROR_THRESHOLD, EXPIRED_REMINDER_MS, CHECK_MIN_INTERVAL_MS, DAY_MS,
  normalizeWarnDays, normalizePort, evaluateCert, describeEvent,
};
