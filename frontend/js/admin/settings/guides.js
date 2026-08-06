// ── NetRecon Admin — Notification Setup Guides ───────────────────
// Collapsible setup guides for each notification service.
// Kept in a separate file so the notify.js logic stays readable.
//
// Each guide is a self-contained HTML string rendered into the
// Settings → Notifications panel by notify.js.
//
// To add a guide for a new service:
//   1. Add an entry to NOTIFY_GUIDES below
//   2. notify.js will automatically render it when that service is selected

'use strict';

// ── Guide content ─────────────────────────────────────────────────
// Each entry is an HTML string rendered inside a collapsible panel.
const NOTIFY_GUIDES = {

  slack: `
    <strong>Create a Slack Incoming Webhook</strong>
    <ol style="margin:8px 0 0 16px;line-height:2.2">
      <li>Go to <a href="https://api.slack.com/apps" target="_blank" rel="noopener" style="color:var(--blue)">api.slack.com/apps</a> → <strong>Create New App</strong> → <strong>From scratch</strong></li>
      <li>Name it (e.g. <code>NetRecon</code>) and pick your workspace</li>
      <li>In the left sidebar → <strong>Incoming Webhooks</strong> → toggle <strong>Activate Incoming Webhooks</strong> on</li>
      <li>Click <strong>Add New Webhook to Workspace</strong> → pick a channel (e.g. <code>#dns-alerts</code>) → Allow</li>
      <li>Copy the webhook URL — it starts with <code>https://hooks.slack.com/services/…</code></li>
      <li>Paste it into the URL field below and click <strong>Add Channel</strong></li>
    </ol>
    <div style="margin-top:8px;color:var(--text-3)">
      NetRecon sends Block Kit messages with a link to the admin panel when a DNS change is detected.
    </div>`,

  teams: `
    <strong>Create a Teams Incoming Webhook (Workflows)</strong>
    <div style="margin:6px 0;color:var(--text-3)">Microsoft retired the old Office 365 Connector. Use the Workflows app instead:</div>
    <ol style="margin:8px 0 0 16px;line-height:2.2">
      <li>Open the Teams channel you want alerts in</li>
      <li>Click the <strong>+</strong> icon → search for <strong>Workflows</strong></li>
      <li>Alternatively: go to <a href="https://make.powerautomate.com" target="_blank" rel="noopener" style="color:var(--blue)">make.powerautomate.com</a> → <strong>Create</strong> → search <em>Post to a channel when a webhook request is received</em></li>
      <li>Follow the wizard — select your team and channel</li>
      <li>Copy the generated webhook URL</li>
      <li>Paste it into the URL field below and click <strong>Add Channel</strong></li>
    </ol>`,

  discord: `
    <strong>Create a Discord Webhook</strong>
    <ol style="margin:8px 0 0 16px;line-height:2.2">
      <li>Open your Discord server → right-click the channel → <strong>Edit Channel</strong></li>
      <li>Go to <strong>Integrations</strong> → <strong>Webhooks</strong> → <strong>New Webhook</strong></li>
      <li>Give it a name (e.g. <code>NetRecon</code>) and optionally set an avatar</li>
      <li>Click <strong>Copy Webhook URL</strong> — it starts with <code>https://discord.com/api/webhooks/…</code></li>
      <li>Paste it into the URL field below and click <strong>Add Channel</strong></li>
    </ol>
    <div style="margin-top:8px;color:var(--text-3)">
      Discord webhooks don't support interactive buttons. Action links are included as plain text in the message.
    </div>`,

  webhook: `
    <strong>Custom Webhook — JSON payload format</strong>
    <div style="margin:6px 0;color:var(--text-2)">NetRecon sends a <code>POST</code> request with <code>Content-Type: application/json</code>. Your endpoint must return any 2xx status.</div>
    <pre style="background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:10px;margin:6px 0;font-size:11px;overflow-x:auto;line-height:1.6">{
  "source":    "netrecon",
  "title":     "🔍 DNS Record Changed — example.com",
  "level":     "warning",
  "fields":    [
    { "label": "Domain",   "value": "example.com" },
    { "label": "Added",    "value": "MX: 10 mail.new.com" },
    { "label": "Removed",  "value": "MX: 10 mail.old.com" },
    { "label": "Detected", "value": "2026-04-23T12:00:00.000Z" }
  ],
  "actions":   null,
  "timestamp": "2026-04-23T12:00:00.000Z"
}</pre>
    <div style="color:var(--text-3)">
      <strong>level</strong> values: <code>info</code> · <code>warning</code> · <code>success</code> · <code>danger</code>
    </div>`,
};

/**
 * Returns the guide HTML for a given service, or an empty string.
 * @param {string} service - slack | teams | discord | webhook
 * @returns {string} HTML string
 */
function getNotifyGuide(service) {
  return NOTIFY_GUIDES[service] || '';
}

/**
 * Renders the setup guide for the currently selected service into
 * the #notifyGuideContent element.
 * Called by notify.js when the user switches service tabs.
 *
 * @param {string} service
 */
function showNotifyGuideFor(service) {
  const el = document.getElementById('notifyGuideContent');
  if (!el) return;

  const guide = getNotifyGuide(service);
  if (!guide) {
    el.style.display = 'none';
    return;
  }

  el.innerHTML = `<div class="info-box" style="font-size:12px"><div style="width:100%">${guide}</div></div>`;
  el.style.display = 'block';
}
