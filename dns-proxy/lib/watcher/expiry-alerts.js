// ── NetRecon — Domain Registration Alerts ────────────────────────
// Turns a domain registration event (see domain-expiry.js) into a
// notification and sends it through the configured channels.

'use strict';

const { dispatch } = require('../notify/dispatcher');

const dateOnly = ms => new Date(ms).toISOString().slice(0, 10);

/** Title, level and icon for each event. */
function expiryAlertParts(event, state) {
  const days = state.daysLeft;
  switch (event.type) {
    case 'expiring':     return { icon: days <= 7 ? '🔴' : '⚠️', level: days <= 7 ? 'danger' : 'warning',
                                  title: `Domain Registration Expiring in ${days} day${days === 1 ? '' : 's'}` };
    case 'expired':      return { icon: '🔴', level: 'danger',  title: 'Domain Registration Expired' };
    case 'renewed':      return { icon: '✅', level: 'success', title: 'Domain Registration Renewed' };
    case 'reregistered': return { icon: '🔴', level: 'danger',  title: 'Domain Was Registered Again' };
    case 'lifecycle':    return { icon: '🔴', level: 'danger',  title: 'Domain Registration Problem' };
    case 'notfound':     return { icon: '🔴', level: 'danger',  title: 'Domain Is No Longer Registered' };
    case 'error':        return { icon: '🔴', level: 'danger',  title: 'Domain Registration Check Failing' };
    case 'recovered':    return { icon: '✅', level: 'success', title: 'Domain Registration Check Recovered' };
    default:             return { icon: 'ℹ️', level: 'info',    title: 'Domain Registration Update' };
  }
}

/**
 * Sends a notification for one registration event.
 *
 * @param {Object} entry - Watched entry (domain)
 * @param {Object} event - Event from domain-expiry.js evaluateExpiry()
 * @param {Object} state - Registration state after the check
 */
async function alertExpiry(entry, event, state) {
  const { icon, level, title } = expiryAlertParts(event, state);

  const fields = [{ label: 'Domain', value: state.registeredDomain && state.registeredDomain !== entry.domain
    ? `${entry.domain} (registered as ${state.registeredDomain})` : entry.domain }];

  if (event.type === 'error') {
    fields.push({ label: 'Error', value: event.message });
  } else {
    if (state.expires)   fields.push({ label: 'Expires', value: `${dateOnly(state.expires)} (${state.daysLeft} days)` });
    if (state.registrar) fields.push({ label: 'Registrar', value: state.registrar });
    if (event.type === 'lifecycle')    fields.push({ label: 'Registry status', value: event.problems.join(', ') });
    if (event.type === 'reregistered') {
      fields.push({ label: 'New registration date', value: state.registered ? dateOnly(state.registered) : 'unknown' });
      if (event.previousRegistrar && event.previousRegistrar !== event.registrar) {
        fields.push({ label: 'Registrar changed', value: `${event.previousRegistrar} to ${event.registrar}` });
      }
    }
  }
  fields.push({ label: 'Detected', value: new Date().toISOString() });

  await dispatch({ title: `${icon} ${title} — ${entry.domain}`, level, fields, _event: `expiry_${event.type}` });
}

module.exports = { alertExpiry, expiryAlertParts };
