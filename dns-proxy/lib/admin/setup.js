// ── NetRecon — First-Run Setup Handler ───────────────────────────
// Handles the one-time setup wizard that runs on first launch.
//
// On first run (no /data/config.json or setupComplete !== true),
// the frontend shows a setup wizard. This handler accepts the
// setup form submission and writes the initial config.
//
// After setup, the app behaves normally — all settings are editable
// in the admin Settings page.
//
// Endpoints:
//   GET  /setup/status  — returns { setupComplete: bool }
//   POST /setup         — accepts initial config, marks setup complete
//
// Security:
//   - /setup endpoints are ONLY available when setup is not complete.
//   - Once setupComplete is true, both endpoints return 403.
//   - No auth required (there's no password yet during first run).

'use strict';

const { hashPassword, validateNewPassword } = require('./password');
const { getConfig, saveConfig } = require('./config-store');

/**
 * GET /setup/status
 * Returns whether first-run setup has been completed.
 * Used by the frontend to decide whether to show the setup wizard.
 */
function handleSetupStatus(req, res, jsonSafe) {
  const cfg = getConfig();
  return jsonSafe(res, 200, { setupComplete: cfg.setupComplete === true });
}

/**
 * POST /setup
 * Accepts the initial configuration from the setup wizard.
 *
 * Body: {
 *   password:    string,   // plaintext admin password, 8+ characters (stored as a salted hash)
 *   dnsServers:  string,   // comma-separated internal DNS server IPs (optional)
 *   publicDns:   string,   // comma-separated public DNS IPs (optional)
 *   allowedDomains: string // comma-separated allowed domains (optional)
 *   dnsTimeout:  number    // timeout in ms (optional)
 * }
 *
 * On success: saves config, marks setup complete, returns { ok: true }.
 * On failure: returns 400 with error message.
 */
function handleSetup(req, res, jsonSafe, readBody) {
  const cfg = getConfig();

  // Block if setup is already complete — no re-running the wizard
  if (cfg.setupComplete === true) {
    return jsonSafe(res, 403, { error: 'Setup already completed. Use Settings to make changes.' });
  }

  // Read and parse the request body
  readBody(req).then(async raw => {
    let body;
    try { body = JSON.parse(raw); }
    catch { return jsonSafe(res, 400, { error: 'Invalid JSON body' }); }

    // ── Validate password (required) ──────────────────────────
    const password = String(body.password || '');
    const problem  = validateNewPassword(password);
    if (problem) {
      return jsonSafe(res, 400, { error: problem });
    }

    // ── Parse DNS servers (optional) ──────────────────────────
    const dnsServers = String(body.dnsServers || '')
      .split(',').map(s => s.trim()).filter(Boolean);

    // Validate each IP format (IPv4 only for internal DNS)
    const ipRe = /^(\d{1,3}\.){3}\d{1,3}$/;
    for (const ip of dnsServers) {
      if (!ipRe.test(ip)) {
        return jsonSafe(res, 400, { error: `Invalid DNS server IP: ${ip}` });
      }
    }

    // ── Parse public DNS (optional, defaults to Cloudflare + Google) ─
    const publicDns = String(body.publicDns || '')
      .split(',').map(s => s.trim()).filter(Boolean);

    // ── Parse allowed domains (optional) ──────────────────────
    const allowedDomains = String(body.allowedDomains || '')
      .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

    // ── Parse timeout (optional) ──────────────────────────────
    const dnsTimeout = parseInt(body.dnsTimeout, 10) || 5000;

    // ── Hash the password ─────────────────────────────────────
    const adminPassword = await hashPassword(password);   // salted scrypt, see password.js

    // ── Save everything to config-store ───────────────────────
    saveConfig({
      setupComplete:      true,
      adminPassword:      adminPassword,
      statsPasswordHash:  null,
      dnsServers:         dnsServers,
      publicDns:          publicDns.length ? publicDns : ['1.1.1.1', '8.8.8.8'],
      allowedDomains:     allowedDomains,
      dnsTimeout:         dnsTimeout,
      internalDnsEnabled: dnsServers.length > 0,
    });

    console.log('[INFO] First-run setup completed');
    if (dnsServers.length) {
      console.log(`[INFO] Internal DNS servers configured: ${dnsServers.join(', ')}`);
    } else {
      console.log('[INFO] No internal DNS servers configured — Internal DNS tool disabled');
    }

    return jsonSafe(res, 200, { ok: true });

  }).catch(err => {
    return jsonSafe(res, 400, { error: err.message });
  });
}

module.exports = { handleSetupStatus, handleSetup };
