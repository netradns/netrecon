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
const { runConnectivityTests, reconfigure } = require('./lib/resolver');
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
  readBody,
} = require('./lib/handlers');

// Admin route handlers — settings, password, notify, watched domains
const {
  handleLogin,
  handleLogout,
  handleSession,
  handleGetConfig,
  handlePutConfig,
  handleChangePassword,
  handleGetNotifyLog,
  handleTestNotify,
  handleGetWatched,
  handleAddWatched,
  handleCheckWatched,
  handleRemoveWatched,
} = require('./lib/admin/handlers');

// Session guard for routes outside /admin that must not be public (stats)
const { requireAuth, clientIp } = require('./lib/admin/session');

// Audit trail: who signed in and what was changed
const audit = require('./lib/admin/audit');
const { handleGetAudit } = require('./lib/admin/audit-handlers');

// Domain registration lookup (RDAP)
const { handleRdap } = require('./lib/rdap-handler');

// Setup wizard handlers (first-run only)
const { handleSetupStatus, handleSetup } = require('./lib/admin/setup');

// Server settings handlers (DNS servers, timeout, etc.)
const { handleGetServerSettings, handlePutServerSettings } = require('./lib/admin/server-settings');

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
  audit.flush();      // Write any pending audit events to disk
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
    if (pathname === '/setup/status'     && method === 'GET') return handleSetupStatus(req, res, jsonSafe);
    if (pathname === '/setup'            && method === 'POST') return handleSetup(req, res, jsonSafe, readBody);
    if (pathname === '/dns-query'        && method === 'GET') return handleDnsQuery(req, res, query);
    if (pathname === '/dns-query-multi'  && method === 'POST') return handleDnsQueryMulti(req, res);
    if (pathname === '/geo'              && method === 'GET') return handleGeo(req, res, query);
    if (pathname === '/resolve'          && method === 'GET') return handleResolve(req, res, query);
    if (pathname === '/resolve-all'      && method === 'GET') return handleResolveAll(req, res, query);
    // Stats hold recent lookups (internal hostnames, calculator input), so reading or clearing them needs a login
    if (pathname === '/stats'            && method === 'GET') { if (!requireAuth(req, res)) return; return handleStatsGet(req, res); }
    if (pathname === '/stats/log'        && method === 'POST') return handleStatsLog(req, res);
    if (pathname === '/stats/clear'      && method === 'POST') { if (!requireAuth(req, res)) return; audit.record('stats_cleared', { ip: clientIp(req) }); return handleStatsClear(req, res); }
    if (pathname === '/blacklist'        && method === 'GET')  return handleBlacklist(req, res, query);
    if (pathname === '/tls-check'        && method === 'GET')  return handleTlsCheck(req, res, query);
    if (pathname === '/rdap'             && method === 'GET')  return handleRdap(req, res, query);

    // ── Admin routes ─────────────────────────────────────────────
    // All /admin/* routes except login require a session token (checked inside each handler).
    if (pathname === '/admin/login'        && method === 'POST')   return handleLogin(req, res);
    if (pathname === '/admin/logout'       && method === 'POST')   return handleLogout(req, res);
    if (pathname === '/admin/session'      && method === 'GET')    return handleSession(req, res);
    if (pathname === '/admin/config'       && method === 'GET')    return handleGetConfig(req, res);
    if (pathname === '/admin/config'       && method === 'PUT')    return handlePutConfig(req, res);
    if (pathname === '/admin/password'     && method === 'POST')   return handleChangePassword(req, res);
    if (pathname === '/admin/notify-log'   && method === 'GET')    return handleGetNotifyLog(req, res);
    if (pathname === '/admin/audit'        && method === 'GET')    return handleGetAudit(req, res);
    if (pathname === '/admin/notify/test'  && method === 'POST')   return handleTestNotify(req, res);
    if (pathname === '/admin/watched'      && method === 'GET')    return handleGetWatched(req, res);
    if (pathname === '/admin/watched'      && method === 'POST')   return handleAddWatched(req, res);
    if (pathname === '/admin/server-settings' && method === 'GET') return handleGetServerSettings(req, res);
    if (pathname === '/admin/server-settings' && method === 'PUT') return handlePutServerSettings(req, res, readBody, reconfigure);

    // POST /admin/watched/:id/check — run one entry's checks now
    const checkMatch = /^\/admin\/watched\/([A-Za-z0-9]+)\/check$/.exec(pathname);
    if (checkMatch && method === 'POST') return handleCheckWatched(req, res, checkMatch[1]);

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
  if (require('./lib/admin/password').isUsingDefaultPassword()) {
    console.warn('[WARN] Using the default admin password "admin" — set a new one in the setup wizard or Settings → Security');
  }
});

// Run connectivity tests 2 seconds after startup
// (gives the network stack time to initialize)
runConnectivityTests();

// ── Apply stored configuration ────────────────────────────────────
// On startup, check if config.json has DNS servers stored from the UI.
// If so, reconfigure the resolver to use them instead of env vars.
// This ensures the setup wizard / admin settings take precedence.
const { getConfig: getStoredConfig } = require('./lib/admin/config-store');
(function applyStoredConfig() {
  const cfg = getStoredConfig();
  if (cfg.dnsServers && cfg.dnsServers.length) {
    reconfigure({ dnsServers: cfg.dnsServers, publicDns: cfg.publicDns || [] });
    console.log(`[INFO] Applied stored DNS config: ${cfg.dnsServers.join(', ')}`);
  }
})();

// Start the domain watcher scheduler
// (delayed 30s inside watcher/index.js to let the server fully initialise)
watcher.start();
