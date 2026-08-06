// ── NetRecon — Admin Config Store ────────────────────────────────
// Reads and writes /data/config.json — the runtime configuration
// that can be changed via the admin UI without restarting the container.
//
// Separation of concerns:
//   - This file handles I/O only. No business logic lives here.
//   - Callers (handlers.js, watcher, notify dispatcher) read config
//     via getConfig() and write via saveConfig().
//
// Config schema:
//   {
//     internalDnsEnabled: boolean,   // show/hide Internal DNS tool
//     notifyChannels:     Array,     // [{ id, service, url, name }]
//     smtpConfig:         Object,    // { host, port, secure, user, pass, from }
//     statsPasswordHash:  string,    // SHA-256 of the current admin password
//                                    // null = fall back to env var hash
//   }
//
// The env var STATS_PASSWORD is the initial/fallback password.
// Once changed via the UI, the new hash is stored here and takes
// precedence over the env var hash on every subsequent login check.

'use strict';

const fs   = require('fs');
const path = require('path');
const { CONFIG_FILE } = require('../config');

// ── In-memory cache ───────────────────────────────────────────────
// Loaded once on first access, mutated in place, flushed on save.
let _cache = null;

// ── Default config ────────────────────────────────────────────────
// Returned when no config file exists yet (first run).
// All fields should have safe, sensible defaults.
function defaultConfig() {
  return {
    internalDnsEnabled: true,   // Internal DNS enabled by default
    notifyChannels:     [],     // No notification channels configured
    smtpConfig:         null,   // No SMTP configured
    statsPasswordHash:  null,   // null = use env var hash (see password.js)
    // Webhook secret — included as X-Webhook-Secret header in outgoing
    // webhook notifications. Allows receivers to verify the request
    // came from NetRecon. Empty = no secret header sent.
    webhookSecret:      '',
    // Quick links shown on the DNS/IP Lookup and Internal DNS tool pages.
    // Each entry: { label: string, value: string }
    // Empty array = hide the quick links row entirely.
    dnsQuickLinks:  [
      { label: 'example.com',   value: 'example.com'   },
      { label: 'github.com',    value: 'github.com'    },
      { label: 'google.com',    value: 'google.com'    },
      { label: 'microsoft.com', value: 'microsoft.com' },
      { label: 'cloudflare.com',value: 'cloudflare.com'},
    ],
    idnsQuickLinks: [
      { label: 'server.corp.local', value: 'server.corp.local' },
      { label: 'dc01.corp.local',   value: 'dc01.corp.local'   },
    ],
  };
}

// ── Load ──────────────────────────────────────────────────────────
/**
 * Returns the current runtime config.
 * Reads from disk on first call, returns the in-memory cache thereafter.
 * Merges with defaults so new fields added in future versions are
 * always present even if the on-disk file predates them.
 *
 * @returns {Object} The current config object.
 */
function getConfig() {
  if (_cache) return _cache;

  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    // Merge with defaults so any new fields added in future versions
    // are always present, even if the stored file is from an older release.
    _cache = Object.assign(defaultConfig(), JSON.parse(raw));
  } catch {
    // File doesn't exist yet (first run) or is corrupt — start with defaults.
    _cache = defaultConfig();
  }

  return _cache;
}

// ── Save ──────────────────────────────────────────────────────────
/**
 * Merges the provided partial config into the current config and
 * writes it to disk atomically (tmp → rename).
 *
 * Atomic write prevents corruption if the container is killed mid-write.
 *
 * @param {Object} partial - Fields to update. Merged with current config.
 * @returns {Object} The updated config object.
 */
function saveConfig(partial) {
  // Ensure cache is loaded before merging
  const current = getConfig();
  _cache = Object.assign(current, partial);

  try {
    const dir = path.dirname(CONFIG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // Atomic write: write to .tmp then rename so readers never see a partial file
    const tmp = CONFIG_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(_cache, null, 2), 'utf8');
    fs.renameSync(tmp, CONFIG_FILE);
  } catch (err) {
    console.error(`[ERROR] Failed to save config: ${err.message}`);
  }

  return _cache;
}

// ── Invalidate cache ──────────────────────────────────────────────
/**
 * Forces the next getConfig() call to re-read from disk.
 * Useful in tests or if the file is modified externally.
 */
function invalidateCache() {
  _cache = null;
}

module.exports = { getConfig, saveConfig, invalidateCache };
