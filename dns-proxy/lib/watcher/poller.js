// ── NetRecon — Domain Poller ──────────────────────────────────────
// Resolves a single watched domain and returns its current record set.
// This file has one job: given a domain entry, return DNS records.
// No diffing, no alerting, no persistence — just resolution.
//
// Separating this from the scheduler (index.js) makes it easy to:
//   - Test resolution in isolation
//   - Swap out the resolution strategy without touching the scheduler
//   - Add per-domain resolution options in the future

'use strict';

const { resolveAll } = require('../resolver');
const { DNS_TIMEOUT, PUBLIC_TIMEOUT } = require('../config');

// Record types to query when "ALL" is selected
const ALL_TYPES = ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'SOA', 'CAA'];

/**
 * Resolves all configured record types for a watched domain entry.
 * Returns a flat array of record objects from the resolver.
 *
 * @param {Object} entry - Watched domain entry from snapshot.js
 * @param {string} entry.domain      - Domain name to resolve
 * @param {string} entry.source      - "public" | "internal"
 * @param {Array}  entry.recordTypes - ["A", "MX", ...] or ["ALL"]
 * @returns {Promise<Array>} Flat array of DNS record objects
 */
async function pollDomain(entry) {
  const { domain, source, recordTypes } = entry;
  const isPublic = source !== 'internal';
  const timeout  = isPublic ? PUBLIC_TIMEOUT : DNS_TIMEOUT;

  // Expand "ALL" to the full set of common record types
  const types = (recordTypes || []).includes('ALL') ? ALL_TYPES : (recordTypes || ['A']);

  // Resolve all types in parallel — same pattern as handleDnsQueryMulti
  const results = await Promise.allSettled(
    types.map(type => resolveAll(domain, type, isPublic, timeout))
  );

  // Flatten results, ignoring any individual type failures
  // A failure on one type (e.g. no MX records) shouldn't fail the whole poll
  const records = [];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled' && Array.isArray(result.value)) {
      records.push(...result.value);
    } else if (result.status === 'rejected') {
      console.warn(`[watcher] ${domain} ${types[i]} resolution failed: ${result.reason?.message}`);
    }
  });

  return records;
}

module.exports = { pollDomain };
