// ── NetRecon — Certificate Check Runner ──────────────────────────
// Runs one certificate check for a watched entry and records the outcome.
//
// This file connects the pieces and holds no rules of its own:
//   tls-check.js  does the TLS handshake and reads the certificate
//   cert.js       decides what the result means (state + events)
//   alerts.js     turns each event into a notification
//
// Internal watches resolve names with your internal DNS servers and may
// reach private addresses, because that is the point of watching an internal
// server. Public watches keep the private-address guard in tls-check.js.

'use strict';

const { evaluateCert, describeEvent, CHECK_MIN_INTERVAL_MS } = require('./cert');
const { MAX_CHANGE_HISTORY } = require('../config');

/**
 * Check the certificate of a watched entry, update its state in `watched`,
 * log any events and send alerts. The caller saves the watched state.
 *
 * @param {Object}  entry              - Watched entry with entry.cert = { port, warnDays }
 * @param {Object}  watched            - Full watched state (mutated in place)
 * @param {Object}  [deps]             - Overrides for tests
 * @param {Function}[deps.checkCert]   - Replaces tls-check's checkCert
 * @param {Function}[deps.alert]       - Replaces alerts.alertCert
 * @param {number}  [deps.now]         - Current time in ms
 * @param {boolean} [deps.force]       - Check even if one ran in the last hour
 * @returns {Promise<{ state: Object, events: Object[] }|null>} null when the check was not due
 */
async function checkCertificate(entry, watched, deps) {
  const d     = deps || {};
  const now   = d.now !== undefined ? d.now : Date.now();
  const check = d.checkCert || require('../tls-check').checkCert;
  const alert = d.alert     || require('./alerts').alertCert;

  watched.certs = watched.certs || {};
  const prev = watched.certs[entry.id] || null;

  // Certificates change slowly, so skip if one was checked recently
  if (!d.force && prev && now - prev.ts < CHECK_MIN_INTERVAL_MS) return null;

  const internal = entry.source === 'internal';
  let result;
  try {
    result = await check(entry.domain, { port: entry.cert.port, internal, allowPrivate: internal });
  } catch (err) {
    result = { error: err.message };
  }

  const { state, events } = evaluateCert(prev, result, entry.cert.warnDays, now);
  watched.certs[entry.id] = state;
  entry.certStatus = state.status;

  if (events.length) {
    // History shown in the detail panel. Same list as DNS changes, marked kind: 'cert'.
    watched.changeLog = watched.changeLog || [];
    watched.changeLog.push({
      watchId: entry.id, domain: entry.domain, ts: now, kind: 'cert', changes: [],
      certEvents: events.map(e => ({ type: e.type, message: describeEvent(e, state) })),
    });
    if (watched.changeLog.length > MAX_CHANGE_HISTORY) {
      watched.changeLog = watched.changeLog.slice(-MAX_CHANGE_HISTORY);
    }

    for (const event of events) {
      Promise.resolve(alert(entry, event, state)).catch(err =>
        console.error(`[watcher] Certificate alert failed for ${entry.domain}: ${err.message}`)
      );
    }
    console.log(`[watcher] ${entry.domain}:${entry.cert.port} certificate: ${events.map(e => e.type).join(', ')}`);
  }

  return { state, events };
}

module.exports = { checkCertificate };
