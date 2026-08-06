// ── NetRecon Admin — SMTP Configuration ──────────────────────────
// Manages the SMTP settings form in Settings → Notifications.
// SMTP is used to send email alerts for DNS change events.

'use strict';

// ── Populate form from config ─────────────────────────────────────
/**
 * Populates the SMTP form fields from the loaded config.
 * Called by settings.js after the config API response arrives.
 *
 * @param {Object} config - Full config object from GET /api/admin/config
 */
function loadSmtpSettings(config) {
  const smtp = config.smtpConfig || {};
  _setVal('smtpHost',   smtp.host   || '');
  _setVal('smtpPort',   smtp.port   || 587);
  _setVal('smtpUser',   smtp.user   || '');
  _setVal('smtpFrom',   smtp.from   || '');
  // Password is never returned from the server — leave blank
  _setVal('smtpPass',   '');
  const secureEl = document.getElementById('smtpSecure');
  if (secureEl) secureEl.checked = !!smtp.secure;
}

// ── Save SMTP settings ────────────────────────────────────────────
/**
 * Reads the SMTP form and saves to the server.
 * Only sends the password if the user has typed a new one.
 */
async function saveSmtpSettings() {
  const host   = _getVal('smtpHost').trim();
  const port   = parseInt(_getVal('smtpPort'), 10) || 587;
  const user   = _getVal('smtpUser').trim();
  const pass   = _getVal('smtpPass'); // may be empty (don't overwrite stored pass)
  const from   = _getVal('smtpFrom').trim();
  const secure = !!(document.getElementById('smtpSecure') || {}).checked;

  if (!host) { adminToast('SMTP host is required', true); return; }

  const smtpConfig = { host, port, user, from, secure };
  // Only include password if the user typed something new
  if (pass) smtpConfig.pass = pass;

  try {
    const r = await adminFetch('/api/admin/config', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ smtpConfig }),
    });
    const d = await r.json();
    if (r.ok) adminToast('SMTP settings saved');
    else      adminToast(d.error || 'Save failed', true);
  } catch (e) {
    adminToast('Error: ' + e.message, true);
  }
}

// ── Test email ────────────────────────────────────────────────────
/**
 * Sends a test notification to the email address in #smtpTestTo.
 * Requires SMTP to be saved first.
 */
async function sendTestEmail() {
  const to = (_getVal('smtpTestTo') || '').trim();
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    adminToast('Enter a valid test email address', true);
    return;
  }

  try {
    const r = await adminFetch('/api/admin/notify/test', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ channel: { service: 'email', url: to, name: 'Test' } }),
    });
    const d = await r.json();
    if (r.ok) adminToast(`Test email sent to ${to}`);
    else      adminToast(d.error || 'Test failed', true);
  } catch (e) {
    adminToast('Error: ' + e.message, true);
  }
}

// ── Helpers ───────────────────────────────────────────────────────
function _getVal(id) { return (document.getElementById(id) || {}).value || ''; }
function _setVal(id, val) { const el = document.getElementById(id); if (el) el.value = val; }
