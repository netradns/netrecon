// ── NetRecon — DNS Record Differ ─────────────────────────────────
// Compares two record sets and returns a list of changes.
// This is a pure function — no I/O, no side effects.
// Easy to unit test in isolation.
//
// Change types:
//   added   — a record exists in `current` but not in `previous`
//   removed — a record exists in `previous` but not in `current`
//
// Records are compared by their canonical string representation
// (type + data) so TTL changes are intentionally ignored — TTL
// fluctuations are normal and not worth alerting on.
//
// Example output:
//   [
//     { type: 'added',   recordType: 'MX', data: '10 mail.new.com' },
//     { type: 'removed', recordType: 'MX', data: '10 mail.old.com' },
//   ]

'use strict';

/**
 * Returns a canonical string key for a DNS record.
 * Used to compare records across snapshots — TTL is excluded
 * because it changes frequently and isn't meaningful for change detection.
 *
 * @param {Object} record - { type, data, ... }
 * @returns {string}
 */
function recordKey(record) {
  // Normalise to lowercase and trim whitespace for stable comparison
  return `${String(record.type).toUpperCase()}:${String(record.data || '').trim().toLowerCase()}`;
}

/**
 * Compares two arrays of DNS records and returns the differences.
 * Returns an empty array if the record sets are identical.
 *
 * @param {Array} previous - Record set from the last snapshot
 * @param {Array} current  - Record set from the latest poll
 * @returns {Array} Array of change objects: { type, recordType, data }
 */
function diffRecords(previous, current) {
  const prevKeys = new Map();
  const currKeys = new Map();

  // Index previous records by their canonical key
  for (const r of (previous || [])) {
    prevKeys.set(recordKey(r), r);
  }

  // Index current records by their canonical key
  for (const r of (current || [])) {
    currKeys.set(recordKey(r), r);
  }

  const changes = [];

  // Find removed records — in previous but not in current
  for (const [key, record] of prevKeys) {
    if (!currKeys.has(key)) {
      changes.push({
        type:       'removed',
        recordType: record.type,
        data:       record.data,
      });
    }
  }

  // Find added records — in current but not in previous
  for (const [key, record] of currKeys) {
    if (!prevKeys.has(key)) {
      changes.push({
        type:       'added',
        recordType: record.type,
        data:       record.data,
      });
    }
  }

  return changes;
}

/**
 * Returns true if two record sets are identical (no changes).
 * Convenience wrapper around diffRecords for the common case.
 *
 * @param {Array} previous
 * @param {Array} current
 * @returns {boolean}
 */
function isUnchanged(previous, current) {
  return diffRecords(previous, current).length === 0;
}

module.exports = { diffRecords, isUnchanged, recordKey };
