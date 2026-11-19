// ── NetRecon — Watcher Snapshot Store ────────────────────────────
// Reads and writes /data/watched.json — the persistent state for
// the domain monitoring feature.
//
// Data shape:
//   {
//     domains: [
//       {
//         id:          string,   // hex timestamp ID
//         domain:      string,   // e.g. "example.com"
//         source:      string,   // "public" | "internal"
//         recordTypes: string[], // ["A", "MX", "TXT"] or ["ALL"]. Empty = certificate-only watch.
//         cert:        object|null, // { enabled, port, warnDays[] } when the TLS certificate is watched
//         certStatus:  string,   // "ok" | "expiring" | "expired" | "error" | "pending"
//         expiry:      object|null, // { enabled, warnDays[] } when the domain registration is watched
//         expiryStatus: string,  // "ok" | "expiring" | "expired" | "notfound" | "unsupported" | "noexpiry" | "error" | "pending"
//         interval:    number,   // poll interval in minutes
//         addedAt:     number,   // unix ms timestamp
//         lastChecked: number|null,
//         lastChanged: number|null,
//         status:      string,   // "pending" | "stable" | "changed" | "error"
//       }
//     ],
//     snapshots: {
//       "<id>": {               // keyed by domain entry ID
//         ts:      number,      // when this snapshot was taken
//         records: Array,       // the full record set at that time
//       }
//     },
//     certs: {
//       "<id>": { ... }       // latest certificate state, see cert.js evaluateCert()
//     },
//     expiries: {
//       "<id>": { ... }       // latest domain registration state, see domain-expiry.js
//     },
//     changeLog: [
//       {
//         watchId:   string,    // domain entry ID
//         domain:    string,
//         ts:        number,
//         changes:   Array,     // output of diff.js (empty for certificate entries)
//         kind:      "cert" | "expiry",  // only on certificate / registration events
//         certEvents / expiryEvents: Array,  // [{ type, message }]
//       }
//     ]
//   }
//
// This file handles I/O only — no polling, no diffing, no alerting.

'use strict';

const fs   = require('fs');
const path = require('path');
const { WATCHED_FILE } = require('../config');

// ── In-memory cache ───────────────────────────────────────────────
let _cache = null;

// ── Default structure ─────────────────────────────────────────────
function defaultWatched() {
  return { domains: [], snapshots: {}, certs: {}, expiries: {}, changeLog: [] };
}

// ── Load ──────────────────────────────────────────────────────────
/**
 * Returns the current watched domains state.
 * Reads from disk on first call, returns the in-memory cache thereafter.
 *
 * @returns {{ domains: Array, snapshots: Object, certs: Object, expiries: Object, changeLog: Array }}
 */
function getWatched() {
  if (_cache) return _cache;

  try {
    const raw = fs.readFileSync(WATCHED_FILE, 'utf8');
    _cache = JSON.parse(raw);
    // Ensure all expected top-level keys exist (handles schema upgrades)
    if (!_cache.domains)   _cache.domains   = [];
    if (!_cache.snapshots) _cache.snapshots = {};
    if (!_cache.certs)     _cache.certs     = {};
    if (!_cache.expiries)  _cache.expiries  = {};
    if (!_cache.changeLog) _cache.changeLog = [];
  } catch {
    _cache = defaultWatched();
  }

  return _cache;
}

// ── Save ──────────────────────────────────────────────────────────
/**
 * Writes the watched state to disk atomically.
 * Callers pass the full state object (mutated in place by the watcher).
 *
 * @param {Object} state - The full watched state object from getWatched()
 */
function saveWatched(state) {
  _cache = state;

  try {
    const dir = path.dirname(WATCHED_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const tmp = WATCHED_FILE + '.tmp';
    // Compact JSON — this file is written on every poll, pretty-printing is wasteful
    fs.writeFileSync(tmp, JSON.stringify(state), 'utf8');
    fs.renameSync(tmp, WATCHED_FILE);
  } catch (err) {
    console.error(`[ERROR] Failed to save watched state: ${err.message}`);
  }
}

module.exports = { getWatched, saveWatched };
