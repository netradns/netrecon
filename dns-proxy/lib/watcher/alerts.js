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

module.exports = { alertRecordChanged, alertRecovered, alertError };
