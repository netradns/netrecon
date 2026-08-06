// ── NetRecon Admin — Change Password ─────────────────────────────
// Handles the Change Password form in Settings → Security.
//
// Flow:
//   1. User enters current password, new password, confirm
//   2. All three are hashed client-side (SHA-256)
//   3. POST /api/admin/password with { currentHash, newHash }
//   4. Server validates current hash, stores new hash in config.json
//   5. Session hash is updated so the user stays logged in
//
// The plaintext password never leaves the browser.

'use strict';

// ── SHA-256 helper ────────────────────────────────────────────────
async function _sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Form handler ──────────────────────────────────────────────────
/**
 * Called when the Change Password form is submitted.
 * Validates inputs, hashes passwords, and calls the admin API.
 */
async function changeAdminPassword(e) {
  if (e) e.preventDefault();

  const current  = (document.getElementById('pwCurrent')  || {}).value || '';
  const newPw    = (document.getElementById('pwNew')       || {}).value || '';
  const confirm  = (document.getElementById('pwConfirm')   || {}).value || '';
  const errorEl  = document.getElementById('pwError');
  const successEl = document.getElementById('pwSuccess');

  // Clear previous messages
  if (errorEl)   { errorEl.style.display   = 'none'; errorEl.textContent   = ''; }
  if (successEl) { successEl.style.display = 'none'; successEl.textContent = ''; }

  // Client-side validation
  if (!current) { showPwError('Enter your current password'); return; }
  if (!newPw)   { showPwError('Enter a new password'); return; }
  if (newPw.length < 8) { showPwError('New password must be at least 8 characters'); return; }
  if (newPw !== confirm) { showPwError('New passwords do not match'); return; }
  if (current === newPw) { showPwError('New password must be different from the current password'); return; }

  // Hash all three values — plaintext never leaves the browser
  const [currentHash, newHash] = await Promise.all([_sha256(current), _sha256(newPw)]);

  try {
    const r = await adminFetch('/api/admin/password', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ currentHash, newHash }),
    });
    const d = await r.json();

    if (r.ok) {
      // Update the session hash so the user stays logged in with the new password.
      // sessionStorage is the source of truth — admin-auth.js reads from it
      // via getAdminHash() on every adminFetch() call.
      sessionStorage.setItem('nr-admin-hash', newHash);

      // Clear the form
      ['pwCurrent', 'pwNew', 'pwConfirm'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });

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
