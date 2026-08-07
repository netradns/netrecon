// ── NetRecon Admin — Settings Page Orchestrator ───────────────────
// Renders the Settings page and coordinates the settings sub-modules.
//
// The Settings page has three tabs:
//   General      — Internal DNS toggle
//   Notifications — Webhook channels + SMTP config
//   Security     — Change admin password
//
// Each tab's logic lives in its own file (general.js, notify.js,
// smtp.js, password.js). This file just renders the shell and
// loads the data.

'use strict';

// Track the active settings tab
let _activeSettingsTab = 'general';

// ── Render the settings page shell ───────────────────────────────
/**
 * Renders the full Settings page HTML into #settingsContent.
 * Called once by loadSettingsPage() on first visit.
 */
function renderSettingsShell() {
  const el = document.getElementById('settingsContent');
  if (!el || el.dataset.rendered) return;
  el.dataset.rendered = '1';

  el.innerHTML = `
    <div style="font-size:18px;font-weight:700;margin-bottom:20px">Settings</div>

    <!-- Tab bar -->
    <div class="settings-tabs" id="adminSettingsTabs">
      <button class="settings-tab active" data-tab="general" onclick="showSettingsTab('general')">
        <svg width="13" height="13" viewBox="0 0 15 15" fill="none"><line x1="2" y1="4" x2="13" y2="4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="2" y1="7.5" x2="13" y2="7.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="2" y1="11" x2="13" y2="11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="5" cy="4" r="1.5" fill="var(--bg)" stroke="currentColor" stroke-width="1.2"/><circle cx="9" cy="7.5" r="1.5" fill="var(--bg)" stroke="currentColor" stroke-width="1.2"/><circle cx="5" cy="11" r="1.5" fill="var(--bg)" stroke="currentColor" stroke-width="1.2"/></svg>
        General
      </button>
      <button class="settings-tab" data-tab="server" onclick="showSettingsTab('server')">
        <svg width="13" height="13" viewBox="0 0 15 15" fill="none"><rect x="2" y="2" width="11" height="4" rx="1.5" stroke="currentColor" stroke-width="1.3"/><rect x="2" y="9" width="11" height="4" rx="1.5" stroke="currentColor" stroke-width="1.3"/><circle cx="5" cy="4" r=".8" fill="currentColor"/><circle cx="5" cy="11" r=".8" fill="currentColor"/></svg>
        Server
      </button>
      <button class="settings-tab" data-tab="notifications" onclick="showSettingsTab('notifications')">
        <svg width="13" height="13" viewBox="0 0 15 15" fill="none"><path d="M7.5 1.5a5 5 0 015 5v2.5l1 2H1.5l1-2V6.5a5 5 0 015-5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M6 12.5a1.5 1.5 0 003 0" stroke="currentColor" stroke-width="1.3"/></svg>
        Notifications
      </button>
      <button class="settings-tab" data-tab="security" onclick="showSettingsTab('security')">
        <svg width="13" height="13" viewBox="0 0 15 15" fill="none"><rect x="3.5" y="6" width="8" height="7" rx="1.2" stroke="currentColor" stroke-width="1.3"/><path d="M5 6V4.5a2.5 2.5 0 015 0V6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="7.5" cy="9.5" r="1" fill="currentColor"/></svg>
        Security
      </button>
    </div>

    <!-- ── Tab: General ── -->
    <div class="settings-tab-panel active" id="stab-general">
      <div class="panel" style="margin-bottom:16px">
        <div style="font-size:14px;font-weight:600;margin-bottom:4px">Internal DNS</div>
        <div style="font-size:12px;color:var(--text-3);margin-bottom:14px">
          Toggle the Internal DNS tool on or off. When disabled, the tool is hidden from all users
          and internal DNS queries are not processed. Useful for deployments without an internal DNS server.
        </div>
        <label class="toggle-wrap">
          <span class="toggle-input">
            <input type="checkbox" id="internalDnsToggle" onchange="onInternalDnsToggle()">
            <span class="toggle-slider"></span>
          </span>
          <span class="toggle-label-text" id="internalDnsLabel">Loading…</span>
        </label>
        <div style="font-size:11px;color:var(--text-3);margin-top:8px;margin-left:44px">
          Takes effect immediately — no container restart required.
          The main tool page reads this setting on every load.
        </div>
      </div>

      <!-- DNS Quick Links -->
      <div class="panel" style="margin-bottom:16px">
        <div style="font-size:14px;font-weight:600;margin-bottom:4px">DNS / IP Lookup — Quick Links</div>
        <div style="font-size:12px;color:var(--text-3);margin-bottom:12px">
          Chips shown below the DNS lookup input. Label is the display text; value is what gets looked up.
        </div>
        <div id="dnsQuickLinksList" style="margin-bottom:12px"></div>
        <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
          <div class="field-group" style="margin:0;min-width:120px">
            <label class="field-label">Label</label>
            <input class="f-input" id="dnsQlLabel" placeholder="e.g. github.com" style="height:30px">
          </div>
          <div class="field-group" style="margin:0;flex:1;min-width:160px">
            <label class="field-label">Value (domain or IP)</label>
            <input class="f-input mono" id="dnsQlValue" placeholder="github.com" style="height:30px">
          </div>
          <button class="btn btn-primary btn-sm" onclick="addQuickLink('dnsQuickLinks')">Add</button>
        </div>
      </div>

      <!-- Internal DNS Quick Links -->
      <div class="panel">
        <div style="font-size:14px;font-weight:600;margin-bottom:4px">Internal DNS — Quick Links</div>
        <div style="font-size:12px;color:var(--text-3);margin-bottom:12px">
          Chips shown below the Internal DNS lookup input. Typically internal hostnames.
        </div>
        <div id="idnsQuickLinksList" style="margin-bottom:12px"></div>
        <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
          <div class="field-group" style="margin:0;min-width:120px">
            <label class="field-label">Label</label>
            <input class="f-input" id="idnsQlLabel" placeholder="e.g. dc01" style="height:30px">
          </div>
          <div class="field-group" style="margin:0;flex:1;min-width:160px">
            <label class="field-label">Value (hostname or IP)</label>
            <input class="f-input mono" id="idnsQlValue" placeholder="dc01.corp.local" style="height:30px">
          </div>
          <button class="btn btn-primary btn-sm" onclick="addQuickLink('idnsQuickLinks')">Add</button>
        </div>
      </div>
    </div>

    <!-- ── Tab: Server ── -->
    <div class="settings-tab-panel" id="stab-server">
      <div class="panel" style="margin-bottom:16px">
        <div style="font-size:14px;font-weight:600;margin-bottom:4px">DNS Configuration</div>
        <div style="font-size:12px;color:var(--text-3);margin-bottom:16px">
          Configure DNS servers and behavior. Changes take effect immediately — no container restart required.
          The DNS resolver is hot-reloaded when you save.
        </div>

        <div class="field-group" style="margin-bottom:14px">
          <label class="field-label">Internal DNS Servers</label>
          <input class="f-input mono" id="serverDnsServers" placeholder="e.g., 192.168.1.10, 192.168.1.11 (comma-separated)">
          <div style="font-size:11px;color:var(--text-3);margin-top:4px">Your private DNS servers for internal hostname resolution. Leave blank to disable Internal DNS.</div>
        </div>

        <div class="field-group" style="margin-bottom:14px">
          <label class="field-label">Public DNS Servers</label>
          <input class="f-input mono" id="serverPublicDns" placeholder="1.1.1.1, 8.8.8.8 (comma-separated)">
          <div style="font-size:11px;color:var(--text-3);margin-top:4px">Used for the startup connectivity test only. Public lookups always use Cloudflare DoH regardless of this value.</div>
        </div>

        <div class="field-group" style="margin-bottom:14px">
          <label class="field-label">Allowed Domains <span style="font-weight:400;color:var(--text-3)">(optional)</span></label>
          <input class="f-input mono" id="serverAllowedDomains" placeholder="e.g., corp.local, internal.example.com (comma-separated)">
          <div style="font-size:11px;color:var(--text-3);margin-top:4px">Restrict internal DNS lookups to these domains only. Leave blank to allow all.</div>
        </div>

        <div class="field-group" style="margin-bottom:16px;max-width:200px">
          <label class="field-label">DNS Timeout (ms)</label>
          <input class="f-input mono" id="serverDnsTimeout" type="number" value="5000" min="1000" max="30000" step="500">
          <div style="font-size:11px;color:var(--text-3);margin-top:4px">How long to wait for internal DNS responses.</div>
        </div>

        <button class="btn btn-primary btn-sm" id="serverSettingsSaveBtn" onclick="saveServerSettings()">Save Server Settings</button>
      </div>
    </div>

    <!-- ── Tab: Notifications ── -->
    <div class="settings-tab-panel" id="stab-notifications">

      <!-- Webhook channels — Slack, Teams, Discord, custom webhook only -->
      <div class="panel" style="margin-bottom:16px">
        <div style="font-size:14px;font-weight:600;margin-bottom:4px">Webhook Channels</div>
        <div style="font-size:12px;color:var(--text-3);margin-bottom:14px">
          Push DNS change alerts to Slack, Teams, Discord, or a custom webhook.
          Changes save automatically.
        </div>
        <div id="notifyChannelList" style="margin-bottom:14px"></div>

        <!-- Add channel form -->
        <div style="border:1px solid var(--border);border-radius:6px;padding:14px;background:var(--bg)">
          <div style="font-size:12px;font-weight:600;color:var(--text-3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Add Channel</div>

          <!-- Service selector buttons — no email here, email is below -->
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
            <button class="btn btn-ghost btn-sm notify-svc-btn active" data-svc="slack"   onclick="selectNotifyService('slack')">Slack</button>
            <button class="btn btn-ghost btn-sm notify-svc-btn"        data-svc="teams"   onclick="selectNotifyService('teams')">Teams</button>
            <button class="btn btn-ghost btn-sm notify-svc-btn"        data-svc="discord" onclick="selectNotifyService('discord')">Discord</button>
            <button class="btn btn-ghost btn-sm notify-svc-btn"        data-svc="webhook" onclick="selectNotifyService('webhook')">Webhook</button>
          </div>

          <!-- Setup guide (rendered by guides.js) -->
          <div id="notifyGuideContent" style="margin-bottom:12px;display:none"></div>

          <!-- URL input -->
          <div class="field-row">
            <div class="field-group">
              <label class="field-label"><span id="notifySvcLabel">Slack</span> Webhook URL</label>
              <input class="f-input mono" id="notifyChannelUrl" placeholder="https://hooks.slack.com/services/…">
            </div>
            <div class="field-group">
              <label class="field-label">Label (optional)</label>
              <input class="f-input" id="notifyChannelName" placeholder="e.g. #dns-alerts">
            </div>
          </div>
          <button class="btn btn-primary btn-sm" style="margin-top:8px" onclick="addNotifyChannel()">Add Channel</button>
        </div>
      </div>

      <!-- Email Notifications — separate panel like netra -->
      <div class="panel" style="margin-bottom:16px">
        <div style="font-size:14px;font-weight:600;margin-bottom:4px">Email Notifications</div>
        <div style="font-size:12px;color:var(--text-3);margin-bottom:14px">
          Configure your SMTP server once, then add recipient addresses below.
          NetRecon will email those addresses for every DNS change alert.
        </div>

        <!-- SMTP config -->
        <div style="font-size:12px;font-weight:600;color:var(--text-3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">SMTP Server</div>
        <div style="font-size:11px;color:var(--text-3);margin-bottom:12px">Port 465 = implicit TLS · 25 = plain relay · 587 = plain relay (STARTTLS not yet supported). Leave username/password blank for unauthenticated relay.</div>
        <div class="field-row">
          <div class="field-group">
            <label class="field-label">SMTP Host</label>
            <input class="f-input mono" id="smtpHost" placeholder="smtp.corp.local">
          </div>
          <div class="field-group">
            <label class="field-label">Port</label>
            <input class="f-input mono" id="smtpPort" type="number" value="587" min="1" max="65535" style="max-width:100px">
          </div>
        </div>
        <div class="field-row">
          <div class="field-group">
            <label class="field-label">Username <span style="font-weight:400;color:var(--text-3)">(blank for relay)</span></label>
            <input class="f-input" id="smtpUser" placeholder="optional" autocomplete="off">
          </div>
          <div class="field-group">
            <label class="field-label">Password</label>
            <input class="f-input" id="smtpPass" type="password" placeholder="leave blank to keep current" autocomplete="new-password">
          </div>
        </div>
        <div class="field-row">
          <div class="field-group">
            <label class="field-label">From Address</label>
            <input class="f-input" id="smtpFrom" placeholder="NetRecon &lt;netrecon@corp.local&gt;">
          </div>
          <div class="field-group" style="justify-content:flex-end;padding-top:20px">
            <label class="toggle-wrap">
              <span class="toggle-input"><input type="checkbox" id="smtpSecure"><span class="toggle-slider"></span></span>
              <span class="toggle-label-text">Implicit TLS (port 465)</span>
            </label>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:20px">
          <button class="btn btn-primary btn-sm" onclick="saveSmtpSettings()">Save SMTP Settings</button>
          <button class="btn btn-ghost btn-sm" onclick="sendTestEmail()">Send Test Email</button>
          <input class="f-input" id="smtpTestTo" placeholder="test@corp.local" type="email" style="width:200px;height:30px">
        </div>

        <!-- Email recipients — separate from webhook channels -->
        <div style="border-top:1px solid var(--border);padding-top:16px">
          <div style="font-size:12px;font-weight:600;color:var(--text-3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Notification Recipients</div>
          <div style="font-size:11px;color:var(--text-3);margin-bottom:12px">These addresses receive all NetRecon alerts — DNS change notifications, watch errors, and recovery events.</div>
          <div id="emailRecipientList" style="margin-bottom:10px"></div>
          <div style="display:flex;gap:8px;align-items:flex-end">
            <div class="field-group" style="flex:1;margin:0">
              <label class="field-label">Add Recipient</label>
              <input class="f-input" id="emailRecipientAddr" placeholder="ops@corp.local" type="email">
            </div>
            <div class="field-group" style="margin:0">
              <label class="field-label">Label (optional)</label>
              <input class="f-input" id="emailRecipientLabel" placeholder="Ops Team">
            </div>
            <button class="btn btn-primary btn-sm" style="margin-bottom:1px" onclick="addEmailRecipient()">Add</button>
          </div>
        </div>
      </div>

      <!-- Delivery log -->
      <div class="panel">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
          <div style="font-size:14px;font-weight:600">Delivery Log</div>
          <button class="btn btn-ghost btn-sm" onclick="loadNotifyLog()">Refresh</button>
        </div>
        <div style="font-size:12px;color:var(--text-3);margin-bottom:12px">Last 200 webhook and email delivery attempts. Shows success, failure, and duration per channel.</div>
        <div id="notifyDeliveryLog"><div class="empty-state"><div class="spin"></div></div></div>
      </div>
    </div>

    <!-- ── Tab: Security ── -->
    <div class="settings-tab-panel" id="stab-security">
      <div class="panel" style="margin-bottom:16px">
        <div style="font-size:14px;font-weight:600;margin-bottom:4px">Webhook Secret</div>
        <div style="font-size:12px;color:var(--text-3);margin-bottom:14px">
          When set, this secret is included as the <code style="font-family:'DM Mono',monospace;background:var(--bg);padding:1px 5px;border-radius:3px;border:1px solid var(--border)">X-Webhook-Secret</code>
          header in all outgoing webhook notifications. Use it to verify that incoming requests to your webhook endpoint actually came from NetRecon.
        </div>
        <div class="field-row">
          <div class="field-group" style="flex:1">
            <label class="field-label">Secret</label>
            <input class="f-input mono" id="webhookSecret" placeholder="Leave blank to disable" autocomplete="off">
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="btn btn-primary btn-sm" onclick="saveWebhookSecret()">Save Secret</button>
          <button class="btn btn-ghost btn-sm" onclick="generateWebhookSecret()">Generate Random</button>
        </div>
      </div>

      <div class="panel">
        <div style="font-size:14px;font-weight:600;margin-bottom:4px">Change Admin Password</div>
        <div style="font-size:12px;color:var(--text-3);margin-bottom:16px">
          Takes effect immediately — no container restart required.
          The new password is stored as a SHA-256 hash in <code>/data/config.json</code>.
        </div>
        <form onsubmit="return changeAdminPassword(event)" style="max-width:360px">
          <div class="field-group" style="margin-bottom:10px">
            <label class="field-label">Current Password</label>
            <input class="f-input" id="pwCurrent" type="password" autocomplete="current-password">
          </div>
          <div class="field-group" style="margin-bottom:10px">
            <label class="field-label">New Password <span style="font-weight:400;color:var(--text-3)">(min 8 characters)</span></label>
            <input class="f-input" id="pwNew" type="password" autocomplete="new-password">
          </div>
          <div class="field-group" style="margin-bottom:14px">
            <label class="field-label">Confirm New Password</label>
            <input class="f-input" id="pwConfirm" type="password" autocomplete="new-password">
          </div>
          <div id="pwError"   style="display:none;color:var(--red);font-size:12px;margin-bottom:8px"></div>
          <div id="pwSuccess" style="display:none;color:var(--green);font-size:12px;margin-bottom:8px"></div>
          <button class="btn btn-primary btn-sm" type="submit">Change Password</button>
        </form>
      </div>
    </div>
  `;

  // Show the initial guide for the default service
  showNotifyGuideFor('slack');

  // Apply the app's custom select component to any <select class="f-select"> in settings
  if (typeof initAllCustomSelects === 'function') {
    setTimeout(() => initAllCustomSelects(el), 0);
  }
}

// ── Tab switching ─────────────────────────────────────────────────
/**
 * Shows the specified settings tab panel.
 * @param {string} tab - 'general' | 'notifications' | 'security'
 */
function showSettingsTab(tab) {
  _activeSettingsTab = tab;

  document.querySelectorAll('#adminSettingsTabs .settings-tab').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-tab') === tab);
  });
  document.querySelectorAll('.settings-tab-panel').forEach(p => {
    p.classList.toggle('active', p.id === 'stab-' + tab);
  });

  // Load tab-specific data
  if (tab === 'notifications') loadNotifyLog();
  if (tab === 'server') loadServerSettings();
}

// ── Load settings page ────────────────────────────────────────────
/**
 * Called by admin-nav.js when the user navigates to Settings.
 * Renders the shell (once) and loads config from the server.
 */
async function loadSettingsPage() {
  renderSettingsShell();

  try {
    const r = await adminFetch('/api/admin/config');
    if (!r.ok) throw new Error('Failed to load config');
    const config = await r.json();

    loadGeneralSettings(config);
    loadNotifyChannels(config);
    loadSmtpSettings(config);
    loadWebhookSecret(config);
  } catch (e) {
    adminToast('Failed to load settings: ' + e.message, true);
  }
}

// ── Delivery log ──────────────────────────────────────────────────
/**
 * Loads and renders the notification delivery log.
 */
async function loadNotifyLog() {
  const el = document.getElementById('notifyDeliveryLog');
  if (!el) return;
  el.innerHTML = '<div class="empty-state"><div class="spin"></div></div>';

  try {
    const r = await adminFetch('/api/admin/notify-log');
    if (!r.ok) throw new Error();
    const log = await r.json();
    renderNotifyLog(log, el);
  } catch {
    el.innerHTML = '<div class="empty-state">Failed to load delivery log.</div>';
  }
}

function renderNotifyLog(log, el) {
  if (!log.length) {
    el.innerHTML = '<div class="empty-state" style="padding:12px 0">No deliveries recorded yet.</div>';
    return;
  }

  const _esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const _ts  = ts => new Date(ts).toLocaleString();

  let html = '<div class="table-wrap"><table class="data-table"><thead><tr><th>Time</th><th>Channel</th><th>Event</th><th>Status</th><th>Duration</th><th>Error</th></tr></thead><tbody>';
  log.slice().reverse().forEach(row => {
    const ok = row.ok === 1;
    html += `<tr>
      <td style="color:var(--text-3);font-size:11px;white-space:nowrap">${_esc(_ts(row.ts))}</td>
      <td><span class="pill p-gray" style="font-size:10px">${_esc(row.service)}</span></td>
      <td style="font-size:11px;color:var(--text-2)">${_esc(row.event)}</td>
      <td>${ok ? '<span class="pill p-green">ok</span>' : '<span class="pill p-red">failed</span>'}</td>
      <td class="mono" style="color:var(--text-3);font-size:11px">${row.durationMs != null ? row.durationMs + 'ms' : '—'}</td>
      <td style="color:var(--red);font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${_esc(row.errorMsg||'')}">${_esc(row.errorMsg||'')}</td>
    </tr>`;
  });
  html += '</tbody></table></div>';
  el.innerHTML = html;
}

// ── Webhook secret ─────────────────────────────────────────────────

function loadWebhookSecret(config) {
  var el = document.getElementById('webhookSecret');
  if (el) el.value = config.webhookSecret || '';
}

async function saveWebhookSecret() {
  var secret = (document.getElementById('webhookSecret') || {}).value || '';
  try {
    var r = await adminFetch('/api/admin/config', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhookSecret: secret }),
    });
    var d = await r.json();
    if (r.ok) adminToast(secret ? 'Webhook secret saved' : 'Webhook secret cleared');
    else      adminToast(d.error || 'Save failed', true);
  } catch (e) { adminToast('Error: ' + e.message, true); }
}

function generateWebhookSecret() {
  // Generate a 32-byte random hex string using Web Crypto
  var arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  var hex = Array.from(arr).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
  var el = document.getElementById('webhookSecret');
  if (el) el.value = hex;
}

// ── Toast helper ──────────────────────────────────────────────────
/**
 * Shows a brief toast notification.
 * Falls back gracefully if a toast system isn't available.
 *
 * @param {string}  msg   - Message to display
 * @param {boolean} error - If true, shows as an error toast
 */
function adminToast(msg, error) {
  // Use the existing toast() function if available (from core/utils.js)
  if (typeof toast === 'function') { toast(msg, error); return; }
  // Fallback: console only
  if (error) console.error('[admin]', msg);
  else       console.log('[admin]', msg);
}
