// ── NetRecon Admin — Server Settings ─────────────────────────────
// Manages the Server tab in the Settings page.
// Handles:
//   - Internal DNS server IPs (add/remove)
//   - Public DNS servers
//   - Allowed domains for internal DNS
//   - DNS timeout
//
// All changes are saved to /data/config.json via the backend and
// hot-reload the DNS resolver without a container restart.
//
// This file is intentionally self-contained — one developer can
// work on server settings without touching notification, password,
// or quick link code.

'use strict';

// ── Load server settings ──────────────────────────────────────────
/**
 * Fetches current server settings from the backend and populates
 * the form fields. Called when the Server tab is shown.
 */
async function loadServerSettings() {
  try {
    var r = await adminFetch('/api/admin/server-settings', { method: 'GET' });
    if (!r.ok) return;
    var d = await r.json();

    var dnsEl      = document.getElementById('serverDnsServers');
    var publicEl   = document.getElementById('serverPublicDns');
    var domainsEl  = document.getElementById('serverAllowedDomains');
    var timeoutEl  = document.getElementById('serverDnsTimeout');

    if (dnsEl)     dnsEl.value     = (d.dnsServers || []).join(', ');
    if (publicEl)  publicEl.value  = (d.publicDns || []).join(', ');
    if (domainsEl) domainsEl.value = (d.allowedDomains || []).join(', ');
    if (timeoutEl) timeoutEl.value = d.dnsTimeout || 5000;
  } catch (e) {
    console.error('[server-settings] Load failed:', e.message);
  }
}

// ── Save server settings ──────────────────────────────────────────
/**
 * Reads the form fields and saves to the backend.
 * The backend hot-reloads the DNS resolver automatically.
 */
async function saveServerSettings() {
  var dnsEl      = document.getElementById('serverDnsServers');
  var publicEl   = document.getElementById('serverPublicDns');
  var domainsEl  = document.getElementById('serverAllowedDomains');
  var timeoutEl  = document.getElementById('serverDnsTimeout');

  var dnsServers = (dnsEl ? dnsEl.value : '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
  var publicDns  = (publicEl ? publicEl.value : '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
  var allowedDomains = (domainsEl ? domainsEl.value : '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
  var dnsTimeout = parseInt(timeoutEl ? timeoutEl.value : '5000', 10) || 5000;

  var btn = document.getElementById('serverSettingsSaveBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  try {
    var r = await adminFetch('/api/admin/server-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dnsServers: dnsServers, publicDns: publicDns, allowedDomains: allowedDomains, dnsTimeout: dnsTimeout }),
    });
    var d = await r.json();
    if (r.ok) {
      adminToast('Server settings saved. DNS resolver updated.');
    } else {
      adminToast(d.error || 'Save failed', true);
    }
  } catch (e) {
    adminToast('Error: ' + e.message, true);
  }

  if (btn) { btn.disabled = false; btn.textContent = 'Save Server Settings'; }
}
