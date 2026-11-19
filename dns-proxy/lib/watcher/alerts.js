// ── NetRecon — Watcher Alert Formatter ───────────────────────────
// Formats DNS change events and dispatches them via the notify system.
// This file has one job: given a domain entry and a list of changes,
// build a human-readable notification and send it.
//
// Keeping formatting separate from the scheduler (index.js) means:
//   - The notification format can be changed without touching poll logic
//   - A contributor can easily find and improve alert messages

'use strict';

const { dispatch } = require('../notify/dispatcher');

/**
 * Sends a notification for detected DNS record changes.
 *
 * @param {Object} entry   - Watched domain entry from snapshot.js
 * @param {Array}  changes - Array of change objects from diff.js
 *                           [{ type: 'added'|'removed', recordType, data }]
 */
async function alertRecordChanged(entry, changes) {
  if (!changes.length) return;

  const { domain, source } = entry;
  const sourceLabel = source === 'internal' ? 'Internal DNS' : 'Public DNS';

  // Summarise the changes into human-readable field values
  const added   = changes.filter(c => c.type === 'added');
  const removed = changes.filter(c => c.type === 'removed');

  const fields = [
    { label: 'Domain', value: domain },
    { label: 'Source', value: sourceLabel },
  ];

  // List added records
  if (added.length) {
    fields.push({
      label: `Added (${added.length})`,
      value: added.map(c => `${c.recordType}: ${c.data}`).join('\n'),
    });
  }

  // List removed records
  if (removed.length) {
    fields.push({
      label: `Removed (${removed.length})`,
      value: removed.map(c => `${c.recordType}: ${c.data}`).join('\n'),
    });
  }

  fields.push({ label: 'Detected', value: new Date().toISOString() });

  await dispatch({
    title:  `🔍 DNS Record Changed — ${domain}`,
    level:  'warning',
    fields,
    _event: 'record_changed',
  });
}

/**
 * Sends a notification when a watched domain first becomes reachable
 * after being in an error state (e.g. DNS server was down).
 *
 * @param {Object} entry - Watched domain entry
 */
async function alertRecovered(entry) {
  await dispatch({
    title:  `✅ DNS Watch Recovered — ${entry.domain}`,
    level:  'success',
    fields: [
      { label: 'Domain',    value: entry.domain },
      { label: 'Source',    value: entry.source === 'internal' ? 'Internal DNS' : 'Public DNS' },
      { label: 'Recovered', value: new Date().toISOString() },
    ],
    _event: 'watch_recovered',
  });
}

/**
 * Sends a notification when a watched domain becomes unreachable
 * (resolution fails consistently across multiple poll attempts).
 *
 * @param {Object} entry - Watched domain entry
 * @param {string} error - Error message from the poller
 */
async function alertError(entry, error) {
  await dispatch({
    title:  `🔴 DNS Watch Error — ${entry.domain}`,
    level:  'danger',
    fields: [
      { label: 'Domain', value: entry.domain },
      { label: 'Source', value: entry.source === 'internal' ? 'Internal DNS' : 'Public DNS' },
      { label: 'Error',  value: error },
      { label: 'Time',   value: new Date().toISOString() },
    ],
    _event: 'watch_error',
  });
}

// ── Certificate alerts ───────────────────────────────────────────

// Title, level and wording for each certificate event
function certAlertParts(event, state) {
  const days = state.daysLeft;
  switch (event.type) {
    case 'expiring': return { icon: days <= 7 ? '🔴' : '⚠️', level: days <= 7 ? 'danger' : 'warning',
                              title: `Certificate Expiring in ${days} day${days === 1 ? '' : 's'}` };
    case 'expired':  return { icon: '🔴', level: 'danger',  title: 'Certificate Expired' };
    case 'renewed':  return { icon: '✅', level: 'success', title: 'Certificate Renewed' };
    case 'changed':  return { icon: '⚠️', level: 'warning', title: 'Certificate Replaced' };
    case 'error':    return { icon: '🔴', level: 'danger',  title: 'Certificate Check Failing' };
    case 'recovered': return { icon: '✅', level: 'success', title: 'Certificate Check Recovered' };
    default:         return { icon: 'ℹ️', level: 'info',    title: 'Certificate Update' };
  }
}

/**
 * Sends a notification for one certificate event.
 *
 * @param {Object} entry - Watched entry (domain, source, cert.port)
 * @param {Object} event - Event from cert.js evaluateCert()
 * @param {Object} state - Certificate state after the check
 */
async function alertCert(entry, event, state) {
  const { icon, level, title } = certAlertParts(event, state);
  const host = `${entry.domain}:${entry.cert.port}`;

  const fields = [
    { label: 'Host',   value: host },
    { label: 'Source', value: entry.source === 'internal' ? 'Internal DNS' : 'Public DNS' },
  ];

  if (event.type === 'error') {
    fields.push({ label: 'Error', value: event.message });
  } else if (event.type !== 'recovered' || state.validTo) {
    if (state.validTo)    fields.push({ label: 'Expires', value: `${new Date(state.validTo).toISOString().slice(0, 10)} (${state.daysLeft} days)` });
    if (state.commonName) fields.push({ label: 'Name',    value: state.commonName });
    if (state.issuer)     fields.push({ label: 'Issuer',  value: state.issuer });
    if (event.type === 'changed' || event.type === 'renewed') {
      if (event.issuerChanged) fields.push({ label: 'Issuer changed', value: `from ${event.previousIssuer}` });
    }
  }

  fields.push({ label: 'Detected', value: new Date().toISOString() });

  await dispatch({ title: `${icon} ${title} — ${entry.domain}`, level, fields, _event: `cert_${event.type}` });
}
module.exports = { alertRecordChanged, alertRecovered, alertError, alertCert, certAlertParts };
