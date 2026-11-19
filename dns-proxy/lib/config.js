// ── NetRecon DNS Proxy — Configuration ───────────────────────────
// All settings come from environment variables set in docker-compose.yml.
// No code changes are needed to configure the proxy.
//
// To add a new config value:
//   1. Add it here with a sensible default
//   2. Export it
//   3. Document it in docker-compose.example.yml and README.md

'use strict';

const path = require('path');

// ── Network ───────────────────────────────────────────────────────
// Port the HTTP server listens on (internal Docker network only)
const PORT = parseInt(process.env.PORT || '3053', 10);

// ── DNS Servers ───────────────────────────────────────────────────
// DNS_SERVERS: your internal/private DNS servers (required)
//   Used by the Internal DNS tool. Never used for public lookups.
//   Example: DNS_SERVERS=192.168.1.10,192.168.1.11
//
//   Priority: config.json (set via UI) > environment variable > empty
const DNS_SERVERS = (process.env.DNS_SERVERS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

// PUBLIC_DNS: public DNS servers (used for startup connectivity test only)
//   Public lookups always use Cloudflare DoH (1.1.1.1) regardless of this value.
const PUBLIC_DNS = (process.env.PUBLIC_DNS || '1.1.1.1,8.8.8.8')
  .split(',').map(s => s.trim()).filter(Boolean);

// ALLOWED_DOMAINS: restrict internal DNS to these domains (optional)
//   Leave empty to allow all domains.
//   Example: ALLOWED_DOMAINS=corp.local,internal.example.com
const ALLOWED_DOMAINS = (process.env.ALLOWED_DOMAINS || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

// ── Timeouts ──────────────────────────────────────────────────────
// DNS_TIMEOUT: internal DNS query timeout in milliseconds
const DNS_TIMEOUT = parseInt(process.env.DNS_TIMEOUT || '5000', 10);

// Public DNS timeout — tighter than internal since Cloudflare DoH is fast.
// Keeps the UI responsive when a record type doesn't exist.
const PUBLIC_TIMEOUT = Math.min(DNS_TIMEOUT, 4000);

// ── Stats ─────────────────────────────────────────────────────────
// STATS_DIR: directory for stats.json persistence
//   Should be a Docker volume mount so data survives container restarts.
const STATS_FILE = path.join(process.env.STATS_DIR || '/data', 'stats.json');

// Maximum entries kept in the recent lookups history
const MAX_HISTORY = 500;

// Maximum unique domains tracked in the top-domains leaderboard
const MAX_TOP_DOMAINS = 500;

// Deduplication window: sub-queries for the same domain within this
// window (ms) are collapsed into a single history entry.
// Example: looking up google.com fires A, AAAA, MX, TXT, _dmarc, etc.
// — we only want "google.com" to appear once in Recent Lookups.
const DEDUP_WINDOW = 15000; // 15 seconds

// ── Admin / Stats password ────────────────────────────────────────
// STATS_PASSWORD: password for the /admin page.
//   Set via STATS_PASSWORD env var in docker-compose.yml.
//   Default: 'admin' — change before deploying to production!
//   The plaintext is hashed server-side; it never reaches the browser.
const STATS_PASSWORD = process.env.STATS_PASSWORD || 'admin';

// ── Runtime config file ───────────────────────────────────────────
// CONFIG_FILE: path to the runtime config JSON file.
//   Stores settings that can be changed via the admin UI without
//   restarting the container (password hash, notify channels, etc.).
//   Lives in the same Docker volume as stats.json so it persists
//   across container restarts and rebuilds.
const CONFIG_FILE = path.join(process.env.STATS_DIR || '/data', 'config.json');

// ── Watched domains file ──────────────────────────────────────────
// WATCHED_FILE: path to the watched domains JSON file.
//   Stores the list of domains being monitored for DNS changes,
//   their last-known record snapshots, and change history.
const WATCHED_FILE = path.join(process.env.STATS_DIR || '/data', 'watched.json');

// ── Notify delivery log file ──────────────────────────────────────
// NOTIFY_LOG_FILE: path to the notification delivery log.
//   Rolling log of the last N delivery attempts (success/failure).
//   Shown in the admin Settings → Notifications panel.
const NOTIFY_LOG_FILE = path.join(process.env.STATS_DIR || '/data', 'notify-log.json');

// Maximum entries kept in the notification delivery log
const MAX_NOTIFY_LOG = 200;

// Maximum change history entries kept per watched domain
const MAX_CHANGE_HISTORY = 100;

// ── Admin audit trail ─────────────────────────────────────────────
// AUDIT_FILE: who signed in and what was changed in the admin panel.
// PENDING_AUDIT_FILE: events written by command-line tools (such as
//   reset-password.js) while the server is not running. The server reads
//   and removes this file when it starts.
const AUDIT_FILE         = path.join(process.env.STATS_DIR || '/data', 'audit.json');
const PENDING_AUDIT_FILE = path.join(process.env.STATS_DIR || '/data', 'audit-pending.ndjson');
// Maximum audit events kept (oldest are dropped first)
const MAX_AUDIT_LOG = 1000;

// ── Validation ────────────────────────────────────────────────────
if (!DNS_SERVERS.length) {
  console.warn('[WARN] DNS_SERVERS is empty — Internal DNS tool will be unavailable.');
  console.warn('[WARN] Public DNS, IP Calculator, and Cloud CIDR tools work without it.');
  console.warn('[WARN] To enable Internal DNS, set DNS_SERVERS=192.168.1.10,192.168.1.11');
}

module.exports = {
  PORT,
  DNS_TIMEOUT,
  DNS_SERVERS,
  PUBLIC_DNS,
  ALLOWED_DOMAINS,
  STATS_FILE,
  CONFIG_FILE,
  WATCHED_FILE,
  NOTIFY_LOG_FILE,
  PUBLIC_TIMEOUT,
  MAX_HISTORY,
  MAX_TOP_DOMAINS,
  MAX_NOTIFY_LOG,
  MAX_CHANGE_HISTORY,
  AUDIT_FILE,
  PENDING_AUDIT_FILE,
  MAX_AUDIT_LOG,
  DEDUP_WINDOW,
  STATS_PASSWORD,
};
