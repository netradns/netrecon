// ── NetRecon — Server Settings Handlers ──────────────────────────
// HTTP route handlers for server-level settings that were previously
// environment variables only. Now configurable via the admin UI.
//
// These settings are stored in /data/config.json alongside all other
// runtime config. Environment variables are used as initial defaults
// only — once values are saved to config.json, they take precedence.
//
// Endpoints:
//   GET  /admin/server-settings  — returns current server config
//   PUT  /admin/server-settings  — updates server config + hot-reloads
//
// Hot-reload:
//   When DNS servers or timeout change, this module calls the resolver's
//   reconfigure() function to apply changes without a container restart.

'use strict';

const { getConfig, saveConfig } = require('./config-store');
const { jsonSafe }              = require('../handlers');
const audit                    = require('./audit');
const session                  = require('./session');

/**
 * GET /admin/server-settings
 * Returns the current server-level configuration.
 * Used by the Settings → Server tab in the admin panel.
 */
function handleGetServerSettings(req, res) {
  // Auth check — reuse the same pattern as other admin handlers
  const { requireAuth } = require('./handlers');
  if (!requireAuth(req, res)) return;

  const cfg = getConfig();

  return jsonSafe(res, 200, {
    dnsServers:     cfg.dnsServers     || [],
    publicDns:      cfg.publicDns      || ['1.1.1.1', '8.8.8.8'],
    allowedDomains: cfg.allowedDomains || [],
    dnsTimeout:     cfg.dnsTimeout     || 5000,
  });
}

/**
 * PUT /admin/server-settings
 * Updates server-level configuration and hot-reloads the resolver.
 *
 * Body: {
 *   dnsServers:     string[],  // internal DNS server IPs
 *   publicDns:      string[],  // public DNS server IPs
 *   allowedDomains: string[],  // restrict internal DNS to these domains
 *   dnsTimeout:     number     // timeout in ms
 * }
 */
async function handlePutServerSettings(req, res, readBody, reconfigure) {
  // Auth check
  const { requireAuth } = require('./handlers');
  if (!requireAuth(req, res)) return;

  let body;
  try { body = JSON.parse(await readBody(req)); }
  catch { return jsonSafe(res, 400, { error: 'Invalid JSON body' }); }

  const update = {};
  const ipRe = /^(\d{1,3}\.){3}\d{1,3}$/;

  // ── DNS Servers ─────────────────────────────────────────────
  if (Array.isArray(body.dnsServers)) {
    const servers = body.dnsServers
      .map(s => String(s).trim())
      .filter(Boolean);

    // Validate each IP
    for (const ip of servers) {
      if (!ipRe.test(ip)) {
        return jsonSafe(res, 400, { error: `Invalid DNS server IP: ${ip}` });
      }
    }
    update.dnsServers = servers;
  }

  // ── Public DNS ──────────────────────────────────────────────
  if (Array.isArray(body.publicDns)) {
    const pubDns = body.publicDns
      .map(s => String(s).trim())
      .filter(Boolean);

    for (const ip of pubDns) {
      if (!ipRe.test(ip)) {
        return jsonSafe(res, 400, { error: `Invalid public DNS IP: ${ip}` });
      }
    }
    update.publicDns = pubDns.length ? pubDns : ['1.1.1.1', '8.8.8.8'];
  }

  // ── Allowed Domains ─────────────────────────────────────────
  if (Array.isArray(body.allowedDomains)) {
    update.allowedDomains = body.allowedDomains
      .map(s => String(s).trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 50); // Cap at 50 domains
  }

  // ── DNS Timeout ─────────────────────────────────────────────
  if (body.dnsTimeout !== undefined) {
    const timeout = parseInt(body.dnsTimeout, 10);
    if (isNaN(timeout) || timeout < 1000 || timeout > 30000) {
      return jsonSafe(res, 400, { error: 'DNS timeout must be between 1000 and 30000 ms' });
    }
    update.dnsTimeout = timeout;
  }

  if (!Object.keys(update).length) {
    return jsonSafe(res, 400, { error: 'No valid fields to update' });
  }

  // Auto-enable/disable Internal DNS based on whether servers are configured
  if ('dnsServers' in update) {
    update.internalDnsEnabled = update.dnsServers.length > 0;
  }

  // Save to config store
  saveConfig(update);
  audit.record('server_settings_changed', { ip: session.clientIp(req), detail: Object.keys(update).join(', ') });

  // Hot-reload the resolver with new settings
  try {
    const cfg = getConfig();
    reconfigure({
      dnsServers:     cfg.dnsServers     || [],
      publicDns:      cfg.publicDns      || ['1.1.1.1', '8.8.8.8'],
      allowedDomains: cfg.allowedDomains || [],
      dnsTimeout:     cfg.dnsTimeout     || 5000,
    });
    console.log('[INFO] Server settings updated and resolver reconfigured');
  } catch (err) {
    console.error(`[ERROR] Resolver reconfigure failed: ${err.message}`);
  }

  return jsonSafe(res, 200, { ok: true });
}

module.exports = { handleGetServerSettings, handlePutServerSettings };
