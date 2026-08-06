// ── NetRecon — DNS Proxy Entry Point ─────────────────────────────
// This file is intentionally minimal — it only handles:
//   1. HTTP server creation and routing
//   2. Global error handlers (prevent process crash)
//   3. Graceful shutdown
//
// All business logic lives in lib/:
//   lib/config.js    — environment variable parsing
//   lib/resolver.js  — DNS resolution (DoH + UDP)
//   lib/handlers.js  — HTTP route handlers
//   lib/stats.js     — usage stats persistence
//
// To add a new endpoint:
//   1. Add a handler function in lib/handlers.js
//   2. Export it from lib/handlers.js
//   3. Import it here and add a route below

'use strict';

const http = require('http');
const { PORT, DNS_SERVERS, PUBLIC_DNS } = require('./lib/config');
const { runConnectivityTests } = require('./lib/resolver');
const { flush } = require('./lib/stats');
const { flush: flushNotifyLog } = require('./lib/notify/log');
const {
  handleHealth,
  handleAppConfig,
  handleDnsQuery,
  handleDnsQueryMulti,
  handleGeo,
  handleResolve,
  handleResolveAll,
  handleStatsLog,
  handleStatsGet,
  handleStatsClear,
  handleBlacklist,
  handleTlsCheck,
  jsonSafe,
} = require('./lib/handlers');

// Admin route handlers — settings, password, notify, watched domains
const {
  handleGetConfig,
  handlePutConfig,
  handleChangePassword,
  handleGetNotifyLog,
  handleTestNotify,
  handleGetWatched,
  handleAddWatched,
  handleRemoveWatched,
} = require('./lib/admin/handlers');

// Domain watcher — starts the polling scheduler
const watcher = require('./lib/watcher/index');

// ── Global error handlers ─────────────────────────────────────────
// Prevent the process from crashing on unhandled errors.
// The Docker healthcheck will restart the container if it becomes
// truly unresponsive, so we log and continue rather than exit.

process.on('uncaughtException', (err) => {
  console.error(`[FATAL] Uncaught exception: ${err.message}`);
  console.error(err.stack);
});

process.on('unhandledRejection', (reason) => {
  console.error(`[WARN] Unhandled promise rejection: ${reason}`);
});

// ── Graceful shutdown ─────────────────────────────────────────────
// On SIGTERM/SIGINT: flush stats to disk, close the HTTP server,
// then exit. The 5s force-exit ensures we don't hang indefinitely
// if a request is stuck.

function shutdown() {
  console.log('[INFO] Shutting down...');
  flush();            // Write any pending stats to disk before exit
  flushNotifyLog();   // Write any pending notify log entries to disk
  server.close(() => {
    console.log('[INFO] HTTP server closed');
    process.exit(0);
  });
  // Force exit after 5 seconds if graceful shutdown hangs
  setTimeout(() => {
    console.warn('[WARN] Forced exit after timeout');
    process.exit(1);
  }, 5000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);

// ── HTTP Server ───────────────────────────────────────────────────
// Simple request router — no framework needed for this few routes.
// All routes are exact matches or prefix matches for simplicity.

const server = http.createServer(async (req, res) => {
  try {
    // Parse the URL — use WHATWG URL API (url.parse is deprecated in Node 22)
    let parsed;
    try {
      parsed = new URL(req.url, 'http://localhost');
    } catch {
      return jsonSafe(res, 400, { error: 'Bad request URI' });
    }

    const { pathname } = parsed;
    const query  = Object.fromEntries(parsed.searchParams);
    const method = req.method;

    // ── Route table ─────────────────────────────────────────────
    if (pathname === '/health')                               return handleHealth(req, res);
    if (pathname === '/app-config'       && method === 'GET') return handleAppConfig(req, res);
    if (pathname === '/dns-query'        && method === 'GET') return handleDnsQuery(req, res, query);
    if (pathname === '/dns-query-multi'  && method === 'POST') return handleDnsQueryMulti(req, res);
    if (pathname === '/geo'              && method === 'GET') return handleGeo(req, res, query);
    if (pathname === '/resolve'          && method === 'GET') return handleResolve(req, res, query);
    if (pathname === '/resolve-all'      && method === 'GET') return handleResolveAll(req, res, query);
    if (pathname === '/stats'            && method === 'GET') return handleStatsGet(req, res);
    if (pathname === '/stats/log'        && method === 'POST') return handleStatsLog(req, res);
    if (pathname === '/stats/clear'      && method === 'POST') return handleStatsClear(req, res);
    if (pathname === '/blacklist'        && method === 'GET')  return handleBlacklist(req, res, query);
    if (pathname === '/tls-check'        && method === 'GET')  return handleTlsCheck(req, res, query);

    // ── Admin routes ─────────────────────────────────────────────
    // All /admin/* routes require X-Admin-Hash header (checked inside each handler).
    if (pathname === '/admin/config'       && method === 'GET')    return handleGetConfig(req, res);
    if (pathname === '/admin/config'       && method === 'PUT')    return handlePutConfig(req, res);
    if (pathname === '/admin/password'     && method === 'POST')   return handleChangePassword(req, res);
    if (pathname === '/admin/notify-log'   && method === 'GET')    return handleGetNotifyLog(req, res);
    if (pathname === '/admin/notify/test'  && method === 'POST')   return handleTestNotify(req, res);
    if (pathname === '/admin/watched'      && method === 'GET')    return handleGetWatched(req, res);
    if (pathname === '/admin/watched'      && method === 'POST')   return handleAddWatched(req, res);

    // DELETE /admin/watched/:id — extract the ID from the path
    if (pathname.startsWith('/admin/watched/') && method === 'DELETE') {
      const id = pathname.slice('/admin/watched/'.length);
      return handleRemoveWatched(req, res, id);
    }

    return jsonSafe(res, 404, { error: 'Not found' });

  } catch(err) {
    // Last-resort catch — should never reach here
    console.error(`[FATAL] Unhandled request error: ${err.message}`);
    console.error(err.stack);
    try { jsonSafe(res, 500, { error: 'Internal server error' }); } catch {}
  }
});

// ── Server timeouts ───────────────────────────────────────────────
// Prevent slow/hung connections from accumulating.
server.timeout          = 15000; // 15s max per request
server.keepAliveTimeout = 5000;  // Close idle keep-alive connections after 5s
server.headersTimeout   = 16000; // Must be > server.timeout

// ── Start ─────────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[INFO] NetRecon DNS proxy listening on :${PORT}`);
  console.log(`[INFO] Internal DNS servers: ${DNS_SERVERS.join(', ')}`);
  console.log(`[INFO] Public DNS: Cloudflare DoH (1.1.1.1) — configured servers: ${PUBLIC_DNS.join(', ')}`);

  // Warn if using the default password — easy to miss in production
  const { STATS_PASSWORD } = require('./lib/config');
  if (STATS_PASSWORD === 'admin') {
    console.warn('[WARN] Using default admin password "admin" — change STATS_PASSWORD in docker-compose.yml or via the admin UI');
  }
});

// Run connectivity tests 2 seconds after startup
// (gives the network stack time to initialize)
runConnectivityTests();

// Start the domain watcher scheduler
// (delayed 30s inside watcher/index.js to let the server fully initialise)
watcher.start();
