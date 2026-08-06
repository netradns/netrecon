// ── NetRecon Admin — Notification Channels ───────────────────────
// Manages the webhook channel list in Settings → Notifications.
// Adapted from netra's notify-channels.js with NetRecon-specific changes.
//
// Responsibilities:
//   - Render the list of configured channels
//   - Handle add / remove / test actions
//   - Auto-save on every change via PUT /api/admin/config

'use strict';

// ── Module state ──────────────────────────────────────────────────
let _notifyChannels    = [];
let _selectedNotifySvc = 'slack';

// Service display metadata
const _svcNames = {
  slack: 'Slack', teams: 'Teams', discord: 'Discord', webhook: 'Webhook', email: 'Email',
};

const _svcPlaceholders = {
  slack:   'https://hooks.slack.com/services/…',
  teams:   'https://outlook.office.com/webhook/…',
  discord: 'https://discord.com/api/webhooks/…',
  webhook: 'https://your-endpoint.com/alerts',
  email:   'alerts@your-domain.com',
};

const _svcColors = {
  slack: '#4A154B', teams: '#6264A7', discord: '#5865F2',
  webhook: 'var(--teal)', email: 'var(--blue)',
};

// ── URL / email validation ────────────────────────────────────────
/**
 * Validates a webhook URL or email address for the given service.
 * Returns an error string if invalid, null if valid.
 *
 * @param {string} value - URL or email address
 * @param {string} svc   - slack | teams | discord | webhook | email
 * @returns {string|null}
 */
function validateChannelValue(value, svc) {
  if (!value) return 'Enter a value';

  if (svc === 'email') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Enter a valid email address';
    return null;
  }

  // Webhook URL validation
  let parsed;
  try { parsed = new URL(value); } catch { return 'Enter a valid URL (must start with https://)'; }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return 'URL must use http:// or https://';
  }

  // Service-specific prefix checks to catch obvious paste errors
  if (svc === 'slack'   && !value.includes('hooks.slack.com') && !value.includes('slack.com')) {
    return "Doesn't look like a Slack webhook URL. Expected: hooks.slack.com/services/…";
  }
  if (svc === 'discord' && !value.includes('discord.com/api/webhooks') && !value.includes('discordapp.com')) {
    return "Doesn't look like a Discord webhook URL. Expected: discord.com/api/webhooks/…";
  }
  if (svc === 'teams'   && !value.includes('office.com') && !value.includes('webhook.office.com') && !value.includes('logic.azure.com')) {
    return "Doesn't look like a Teams webhook URL. Expected: outlook.office.com/webhook/…";
  }

  return null;
}

// ── Service selector ──────────────────────────────────────────────
/**
 * Updates the UI when the user picks a different notification service.
 * @param {string} svc - slack | teams | discord | webhook | email
 */
function selectNotifyService(svc) {
  _selectedNotifySvc = svc;

  const input = document.getElementById('notifyChannelUrl');
  const label = document.getElementById('notifySvcLabel');
  if (input) input.placeholder = _svcPlaceholders[svc] || '';
  if (label) label.textContent = _svcNames[svc] || svc;

  // Highlight the active service button
  document.querySelectorAll('.notify-svc-btn').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-svc') === svc);
  });

  // Show the matching setup guide
  if (typeof showNotifyGuideFor === 'function') showNotifyGuideFor(svc);
}

// ── Render channel list ───────────────────────────────────────────
/**
 * Re-renders the list of configured webhook channels (excludes email).
 * Email recipients are managed separately in the Email Notifications panel.
 */
function renderNotifyChannels() {
  const el = document.getElementById('notifyChannelList');
  if (!el) return;

  // Only show non-email channels here
  const webhookChannels = _notifyChannels.filter(ch => ch.service !== 'email');

  if (!webhookChannels.length) {
    el.innerHTML = '<div style="font-size:12px;color:var(--text-3);padding:8px 0">No webhook channels configured. Add one below.</div>';
    return;
  }

  el.innerHTML = webhookChannels.map((ch) => {
    const idx     = _notifyChannels.indexOf(ch);
    const display = ch.url.length > 48 ? ch.url.slice(0, 48) + '…' : ch.url;
    const color   = _svcColors[ch.service] || 'var(--blue)';
    const badge   = `<span style="display:inline-flex;align-items:center;padding:2px 8px;border-radius:12px;font-size:10px;font-weight:700;color:#fff;background:${color};margin-right:8px">${_notifyEsc(_svcNames[ch.service] || ch.service)}</span>`;
    const name    = ch.name ? `<span style="font-weight:600;margin-right:6px">${_notifyEsc(ch.name)}</span>` : '';

    return `<div class="notify-channel-row" data-index="${idx}" style="display:flex;align-items:center;gap:8px;padding:10px 12px;border:1px solid var(--border);border-radius:6px;margin-bottom:6px;background:var(--surface)">
      ${badge}${name}
      <span class="mono" style="font-size:11px;color:var(--text-3);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_notifyEsc(display)}</span>
      <button class="btn btn-ghost btn-sm notify-test-btn" data-index="${idx}">Test</button>
      <button class="btn btn-ghost btn-sm notify-remove-btn" data-index="${idx}" style="color:var(--red)">Remove</button>
    </div>`;
  }).join('');

  el.onclick = (e) => {
    const testBtn   = e.target.closest('.notify-test-btn');
    const removeBtn = e.target.closest('.notify-remove-btn');
    if (testBtn)   testNotifyChannel(parseInt(testBtn.getAttribute('data-index'), 10));
    if (removeBtn) removeNotifyChannel(parseInt(removeBtn.getAttribute('data-index'), 10));
  };
}

// ── Email recipient list (separate from webhooks) ─────────────────
/**
 * Re-renders the email recipient list in the Email Notifications panel.
 */
function renderEmailRecipients() {
  const el = document.getElementById('emailRecipientList');
  if (!el) return;

  const emailChannels = _notifyChannels.filter(ch => ch.service === 'email');

  if (!emailChannels.length) {
    el.innerHTML = '<div style="font-size:12px;color:var(--text-3);padding:4px 0 8px">No recipients yet — add one below.</div>';
    return;
  }

  el.innerHTML = emailChannels.map(ch => {
    const idx = _notifyChannels.indexOf(ch);
    return `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border:1px solid var(--border);border-radius:6px;margin-bottom:6px;background:var(--surface)">
      <svg width="14" height="14" viewBox="0 0 15 15" fill="none" style="flex-shrink:0;color:var(--blue)"><rect x="1" y="3" width="13" height="9" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M1 5l6.5 4L14 5" stroke="currentColor" stroke-width="1.3"/></svg>
      <span class="mono" style="font-size:12px;flex:1">${_notifyEsc(ch.url)}</span>
      ${ch.name ? '<span style="font-size:11px;color:var(--text-3)">' + _notifyEsc(ch.name) + '</span>' : ''}
      <button class="btn btn-ghost btn-sm" onclick="testNotifyChannel(${idx})">Test</button>
      <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="removeNotifyChannel(${idx})">Remove</button>
    </div>`;
  }).join('');
}

/**
 * Adds a new email recipient from the Email Notifications panel.
 */
function addEmailRecipient() {
  const addr  = (document.getElementById('emailRecipientAddr')  || {}).value?.trim() || '';
  const label = (document.getElementById('emailRecipientLabel') || {}).value?.trim() || '';

  if (!addr || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) {
    adminToast('Enter a valid email address', true);
    return;
  }

  _notifyChannels.push({
    id:      Date.now().toString(16),
    service: 'email',
    url:     addr,
    name:    label || undefined,
  });

  const addrEl  = document.getElementById('emailRecipientAddr');
  const labelEl = document.getElementById('emailRecipientLabel');
  if (addrEl)  addrEl.value  = '';
  if (labelEl) labelEl.value = '';

  renderEmailRecipients();
  saveNotifyChannels();
}

// ── Add channel ───────────────────────────────────────────────────
/**
 * Validates and adds a new channel from the form inputs.
 */
function addNotifyChannel() {
  const url  = (document.getElementById('notifyChannelUrl')  || {}).value?.trim() || '';
  const name = (document.getElementById('notifyChannelName') || {}).value?.trim() || '';

  const err = validateChannelValue(url, _selectedNotifySvc);
  if (err) { adminToast(err, true); return; }

  _notifyChannels.push({
    id:      Date.now().toString(16),
    service: _selectedNotifySvc,
    url,
    name:    name || undefined,
  });

  // Clear inputs
  const urlEl  = document.getElementById('notifyChannelUrl');
  const nameEl = document.getElementById('notifyChannelName');
  if (urlEl)  urlEl.value  = '';
  if (nameEl) nameEl.value = '';

  renderNotifyChannels();
  saveNotifyChannels();
}

// ── Remove channel ────────────────────────────────────────────────
/**
 * Removes a channel by index and auto-saves.
 * @param {number} index
 */
function removeNotifyChannel(index) {
  _notifyChannels.splice(index, 1);
  renderNotifyChannels();
  renderEmailRecipients();
  saveNotifyChannels();
}

// ── Test channel ──────────────────────────────────────────────────
/**
 * Sends a test notification to a single channel via the admin API.
 * @param {number} index
 */
async function testNotifyChannel(index) {
  const ch = _notifyChannels[index];
  if (!ch) return;

  try {
    const r = await adminFetch('/api/admin/notify/test', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ channel: ch }),
    });
    const d = await r.json();
    if (r.ok) adminToast(`Test sent to ${ch.name || _svcNames[ch.service] || ch.service}`);
    else      adminToast(d.error || 'Test failed', true);
  } catch (e) {
    adminToast('Error: ' + e.message, true);
  }
}

// ── Save ──────────────────────────────────────────────────────────
/**
 * Persists the current channel list to the server.
 * Called automatically after every add/remove.
 */
async function saveNotifyChannels() {
  try {
    const r = await adminFetch('/api/admin/config', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ notifyChannels: _notifyChannels }),
    });
    const d = await r.json();
    if (r.ok) adminToast('Saved');
    else      adminToast(d.error || 'Save failed', true);
  } catch (e) {
    adminToast('Error: ' + e.message, true);
  }
}

// ── Load ──────────────────────────────────────────────────────────
/**
 * Initialises the channel list from the settings payload.
 * Called by settings.js after the config API response arrives.
 *
 * @param {Object} config - Full config object from GET /api/admin/config
 */
function loadNotifyChannels(config) {
  _notifyChannels = Array.isArray(config.notifyChannels) ? config.notifyChannels.slice() : [];
  renderNotifyChannels();
  renderEmailRecipients();
}

// ── Escape helper ─────────────────────────────────────────────────
function _notifyEsc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
