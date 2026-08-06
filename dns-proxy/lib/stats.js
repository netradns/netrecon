// ── NetRecon DNS Proxy — Stats Persistence & Tracking ────────────
// Tracks usage metrics and persists them to /data/stats.json.
//
// Design decisions:
//   - In-memory cache: stats are read/written in memory, flushed to
//     disk every 5 seconds. This avoids I/O on every DNS query.
//   - Atomic writes: write to .tmp then rename to prevent corruption
//     if the container is killed mid-write.
//   - Bounded memory: all collections have hard caps to prevent
//     unbounded growth over time.
//   - Deduplication: a single domain lookup fires many sub-queries
//     (A, AAAA, MX, _dmarc, selectors...). We deduplicate so only
//     the base domain appears once in Recent Lookups.
//
// Stats structure:
//   counters:    { dns: N, ip: N, idns: N, calc: N, cloud: N }
//   history:     [ { type, target, ts, responseMs, ... }, ... ]  (max 500)
//   queryStats:  { totalQueries, successCount, recordTypeCounts,
//                  topDomains, hourlyVolume, errorCounts, ... }

'use strict';

const fs   = require('fs');
const path = require('path');
const {
  STATS_FILE, MAX_HISTORY, MAX_TOP_DOMAINS, DEDUP_WINDOW,
} = require('./config');

// ── In-memory cache ───────────────────────────────────────────────
let _cache   = null;   // The stats object (loaded once, mutated in place)
let _dirty   = false;  // True when cache has unsaved changes
let _writing = false;  // True while a disk write is in progress

/** Returns a fresh queryStats object with all fields initialized to zero. */
function defaultQueryStats() {
  return {
    totalQueries:    0,
    successCount:    0,
    failCount:       0,
    totalResponseMs: 0,
    avgResponseMs:   0,
    recordTypeCounts: {},  // { A: N, MX: N, ... }
    topDomains:       {},  // { 'example.com': N, ... }
    hourlyVolume:     {},  // { '2026-04-22T14': N, ... }
    errorCounts:      {},  // { 'NXDOMAIN': N, ... }
  };
}

/**
 * Load stats from disk (or return cached version).
 * Called on every request — returns the in-memory cache after first load.
 */
function load() {
  if (_cache) return _cache;

  try {
    const raw = fs.readFileSync(STATS_FILE, 'utf8');
    _cache = JSON.parse(raw);
    // Ensure all expected fields exist (handles old stats files from upgrades)
    if (!_cache.counters)   _cache.counters   = {};
    if (!_cache.history)    _cache.history    = [];
    if (!_cache.queryStats) _cache.queryStats = defaultQueryStats();
  } catch {
    // File doesn't exist yet or is corrupt — start fresh
    _cache = { counters: {}, history: [], queryStats: defaultQueryStats() };
  }

  return _cache;
}

/** Mark the cache as dirty (will be flushed on next interval). */
function save(data) {
  _cache = data;
  _dirty = true;
}

/**
 * Flush the in-memory cache to disk.
 * Uses atomic write (tmp → rename) to prevent corruption.
 * Called every 5 seconds by setInterval, and on graceful shutdown.
 */
function flush() {
  if (!_dirty || _writing || !_cache) return;

  _writing = true;
  _dirty   = false;

  try {
    const dir = path.dirname(STATS_FILE);
    // Create the data directory if it doesn't exist
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // Atomic write: write to temp file, then rename
    // If the process is killed mid-write, the original file is intact
    const tmp = STATS_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(_cache), 'utf8');
    fs.renameSync(tmp, STATS_FILE);
  } catch(err) {
    console.error(`[ERROR] Failed to save stats: ${err.message}`);
    // Reset dirty flag so we retry on next interval
    _dirty = true;
  } finally {
    _writing = false;
  }
}

// Flush every 5 seconds — avoids disk I/O on every DNS query
// .unref() prevents this timer from keeping the process alive during shutdown
setInterval(flush, 5000).unref();

// ── Recent lookup deduplication ───────────────────────────────────
// When a user looks up "google.com", the frontend fires ~20 sub-queries:
// A, AAAA, MX, TXT, NS, SOA, CAA, _dmarc.google.com, selector1._domainkey...
// We only want "google.com" to appear once in Recent Lookups.
const _recentDomains = new Map(); // domain → timestamp of last log

/**
 * Strip common sub-query prefixes to get the base domain.
 * Example: "_dmarc.google.com" → "google.com"
 *          "selector1._domainkey.google.com" → "google.com"
 */
function getBaseDomain(name) {
  return (name || '').toLowerCase().replace(/\.$/, '')
    .replace(/^_dmarc\./, '')
    .replace(/^[^.]+\._domainkey\./, '')
    .replace(/^_mta-sts\./, '')
    .replace(/^_smtp\._tls\./, '')
    .replace(/^_[a-z]+\._[a-z]+\./, '');
}

/**
 * Returns true if this domain should be logged to history.
 * Returns false if the same base domain was logged within DEDUP_WINDOW ms.
 */
function shouldLog(name) {
  const base = getBaseDomain(name);
  const now  = Date.now();
  const last = _recentDomains.get(base);

  if (last && (now - last) < DEDUP_WINDOW) return false;

  _recentDomains.set(base, now);

  // Periodically clean up expired entries to prevent memory growth
  if (_recentDomains.size > 200) {
    for (const [k, v] of _recentDomains) {
      if (now - v > DEDUP_WINDOW * 2) _recentDomains.delete(k);
    }
  }

  return true;
}

/** Returns the base domain to use as the history target. */
function historyTarget(name) {
  return getBaseDomain(name);
}

// ── Query tracking ────────────────────────────────────────────────
/**
 * Record a query in the stats object.
 * This mutates the stats object in place — call save() after.
 *
 * @param {object} stats - The stats object from load()
 * @param {object} opts
 * @param {string}  opts.type        - Tool type: dns|ip|idns|calc|cloud
 * @param {string}  opts.target      - Domain/IP/CIDR that was queried
 * @param {string}  opts.source      - 'public'|'internal'|'client'
 * @param {string}  opts.recordType  - DNS record type (A, MX, MULTI, etc.)
 * @param {number}  opts.recordCount - Number of records returned
 * @param {number}  opts.responseMs  - Query duration in ms
 * @param {boolean} opts.success     - Whether the query succeeded
 * @param {string}  opts.errorCode   - Error code if failed
 * @param {boolean} opts.skipHistory - Don't add to recent lookups list
 */
function track(stats, {
  type, target, source, recordType, recordCount,
  responseMs, success, errorCode, skipHistory,
}) {
  try {
    // ── Basic counters (per tool type) ────────────────────────
    stats.counters[type] = (stats.counters[type] || 0) + 1;

    // ── Recent lookups history ────────────────────────────────
    if (!skipHistory) {
      const entry = {
        type, target, ts: Date.now(),
        source:      source      || 'unknown',
        responseMs:  responseMs  || 0,
        recordCount: recordCount || 0,
        success:     success !== false,
      };
      if (recordType) entry.recordType = recordType;
      if (errorCode)  entry.errorCode  = errorCode;

      stats.history.push(entry);

      // Keep only the most recent MAX_HISTORY entries
      if (stats.history.length > MAX_HISTORY) {
        stats.history = stats.history.slice(-MAX_HISTORY);
      }
    }

    // ── Enhanced query stats ──────────────────────────────────
    if (!stats.queryStats) stats.queryStats = defaultQueryStats();
    const qs = stats.queryStats;

    qs.totalQueries++;
    if (success !== false) qs.successCount++; else qs.failCount++;

    if (responseMs) {
      qs.totalResponseMs += responseMs;
      qs.avgResponseMs = Math.round(qs.totalResponseMs / qs.totalQueries);
    }

    // Record type distribution (A, MX, TXT, MULTI, etc.)
    if (recordType) {
      qs.recordTypeCounts[recordType] = (qs.recordTypeCounts[recordType] || 0) + 1;
    }

    // Top queried domains — evict only when significantly over limit
    // to avoid O(n log n) sort on every single query
    if (target) {
      qs.topDomains[target] = (qs.topDomains[target] || 0) + 1;
      const keys = Object.keys(qs.topDomains);
      if (keys.length > MAX_TOP_DOMAINS + 50) {
        keys.sort((a, b) => qs.topDomains[a] - qs.topDomains[b])
            .slice(0, keys.length - MAX_TOP_DOMAINS)
            .forEach(k => delete qs.topDomains[k]);
      }
    }

    // Hourly volume — key format: "2026-04-22T14" (ISO hour)
    const hourKey = new Date().toISOString().slice(0, 13);
    qs.hourlyVolume[hourKey] = (qs.hourlyVolume[hourKey] || 0) + 1;

    // Keep only the last 168 hours (7 days)
    const hourKeys = Object.keys(qs.hourlyVolume).sort();
    if (hourKeys.length > 168) {
      hourKeys.slice(0, hourKeys.length - 168).forEach(k => delete qs.hourlyVolume[k]);
    }

    // Error code tracking
    if (errorCode) {
      qs.errorCounts[errorCode] = (qs.errorCounts[errorCode] || 0) + 1;
    }

  } catch(err) {
    // Stats tracking must never crash a DNS query
    console.error(`[ERROR] Stats tracking failed: ${err.message}`);
  }
}

/** Reset all stats to zero and flush immediately. */
function clear() {
  _cache = { counters: {}, history: [], queryStats: defaultQueryStats() };
  _dirty = true;
  flush();
}

module.exports = { load, save, flush, track, shouldLog, historyTarget, clear };
