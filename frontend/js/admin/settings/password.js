// ── NetRecon Admin — Change Password ─────────────────────────────
// Handles the Change Password form in Settings → Security.
//
// Flow:
//   1. User enters current password, new password, confirm
//   2. POST /api/admin/password with { currentPassword, newPassword }
//   3. The server checks the current password, stores the new one as a
//      salted hash, and ends every other session
//   4. This browser stays signed in (its session token is unchanged)

'use strict';

// Keep in sync with MIN_PASSWORD_LENGTH in dns-proxy/lib/admin/password.js
const MIN_ADMIN_PASSWORD = 8;

// ── Form handler ──────────────────────────────────────────────────
/**
 * Called when the Change Password form is submitted.
 * Validates the inputs, then calls the admin API.
 */
async function changeAdminPassword(e) {
  if (e) e.preventDefault();

  const current   = (document.getElementById('pwCurrent') || {}).value || '';
  const newPw     = (document.getElementById('pwNew')     || {}).value || '';
  const confirm   = (document.getElementById('pwConfirm') || {}).value || '';
  const errorEl   = document.getElementById('pwError');
  const successEl = document.getElementById('pwSuccess');

  // Clear previous messages
  if (errorEl)   { errorEl.style.display   = 'none'; errorEl.textContent   = ''; }
  if (successEl) { successEl.style.display = 'none'; successEl.textContent = ''; }

  // Client-side validation (the server checks again)
  if (!current) { showPwError('Enter your current password'); return; }
  if (!newPw)   { showPwError('Enter a new password'); return; }
  if (newPw.length < MIN_ADMIN_PASSWORD) { showPwError(`New password must be at least ${MIN_ADMIN_PASSWORD} characters`); return; }
  if (newPw !== confirm) { showPwError('New passwords do not match'); return; }
  if (current === newPw) { showPwError('New password must be different from the current password'); return; }

  try {
    const r = await adminFetch('/api/admin/password', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ currentPassword: current, newPassword: newPw }),
    });
    const d = await r.json();

    if (r.ok) {
      // Clear the form
      ['pwCurrent', 'pwNew', 'pwConfirm'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });

      // The default-password reminder no longer applies
      if (typeof showDefaultPasswordBanner === 'function') showDefaultPasswordBanner(false);

      if (successEl) { successEl.textContent = 'Password changed successfully.'; successEl.style.display = 'block'; }
      adminToast('Password changed');
    } else {
      showPwError(d.error || 'Password change failed');
    }
  } catch (e) {
    showPwError('Error: ' + e.message);
  }

  return false;
}

function showPwError(msg) {
  const el = document.getElementById('pwError');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
  adminToast(msg, true);
}
