// ── NetRecon Admin — Authentication ──────────────────────────────
// Login gate for the admin panel.
//
// How it works:
//   1. The user submits the login form.
//   2. The password is sent to POST /api/admin/login. The SERVER checks it.
//   3. On success the server returns a random session token. It is kept in
//      sessionStorage (cleared when the tab closes) and sent as
//      "Authorization: Bearer <token>" on every admin request.
//   4. If the server later answers 401 (restart, 2 hours idle, password
//      changed elsewhere), the login screen comes back.
//
// Nothing about the password or its hash is ever sent to the browser.
// This works over plain HTTP too, so installs reached by IP address without
// a certificate can still sign in. The login screen shows a gentle notice
// in that case, but never blocks.

'use strict';

const ADMIN_TOKEN_KEY = 'nr-admin-token';

// ── Token helpers ─────────────────────────────────────────────────

/** The current session token, or null when signed out. */
function getAdminToken() {
  return sessionStorage.getItem(ADMIN_TOKEN_KEY);
}

/** True when this tab holds a session token (it may still have expired on the server). */
function isAdminLoggedIn() {
  return !!getAdminToken();
}

// ── Overlay and banners ───────────────────────────────────────────

function showLoginOverlay(message) {
  const overlay = document.getElementById('loginOverlay');
  if (overlay) overlay.classList.remove('hidden');

  const err = document.getElementById('loginError');
  if (err) {
    err.textContent   = message || '';
    err.style.display = message ? 'block' : 'none';
  }
  const pass = document.getElementById('loginPass');
  if (pass) { pass.value = ''; pass.focus(); }
}

function hideLoginOverlay() {
  const overlay = document.getElementById('loginOverlay');
  if (overlay) overlay.classList.add('hidden');
}

/**
 * Soft notice on the login screen when the page is not served over HTTPS.
 * Localhost is exempt. This is information only; signing in still works.
 */
function showInsecureConnectionNotice() {
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const note  = document.getElementById('loginNote');
  if (note && location.protocol === 'http:' && !local) note.style.display = 'block';
}

/**
 * Remembers what the server told us at sign-in and fills the Security tab's connection note.
 * Safe to call before that tab exists. It is called again when the tab is built.
 */
function setAdminSessionInfo(info) {
  if (info) window._adminSession = info;
  const el = document.getElementById('connIp');
  if (el) el.textContent = (window._adminSession && window._adminSession.clientIp) || 'unknown';
}

/**
 * Reminder bar shown after signing in while the built-in password is still
 * in use. Removed again once the password has been changed.
 */
function showDefaultPasswordBanner(show) {
  let bar = document.getElementById('defaultPwBanner');
  if (!show) { if (bar) bar.remove(); return; }
  if (bar) return;

  bar = document.createElement('div');
  bar.id        = 'defaultPwBanner';
  bar.className = 'admin-banner';
  bar.innerHTML = 'You are still using the default password. ' +
    '<a href="#" onclick="showAdminPage(\'settings\'); return false;">Change it in Settings &rarr; Security</a>.';

  const topbar = document.querySelector('.topbar');
  if (topbar && topbar.parentNode) topbar.parentNode.insertBefore(bar, topbar.nextSibling);
}

// ── Login ─────────────────────────────────────────────────────────

/**
 * Called by the login form's onsubmit. Sends the credentials to the server
 * and, on success, stores the session token and opens the admin app.
 */
async function handleAdminLogin(e) {
  e.preventDefault();

  const user = document.getElementById('loginUser').value.trim();
  const pass = document.getElementById('loginPass').value;
  const btn  = document.querySelector('#loginOverlay .login-btn');
  if (btn) btn.disabled = true;

  try {
    const r = await fetch('/api/admin/login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username: user, password: pass }),
    });
    const d = await r.json().catch(() => ({}));

    if (r.ok && d.token) {
      sessionStorage.setItem(ADMIN_TOKEN_KEY, d.token);
      document.getElementById('loginPass').value = '';
      document.getElementById('loginError').style.display = 'none';
      hideLoginOverlay();
      showDefaultPasswordBanner(!!d.usingDefault);
      setAdminSessionInfo(d);
      if (typeof initAdmin === 'function') initAdmin();
    } else {
      // 401 = wrong credentials, 429 = locked out; the server's message says which
      showLoginOverlay(d.error || 'Sign in failed. Please try again.');
    }
  } catch (err) {
    showLoginOverlay('Could not reach the server. Check your connection and try again.');
  } finally {
    if (btn) btn.disabled = false;
  }

  return false;
}

// ── Sign out ──────────────────────────────────────────────────────

/** Ends the session on the server, forgets the token and shows the login screen. */
async function adminLogout() {
  const token = getAdminToken();
  sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  if (token) {
    try { await fetch('/api/admin/logout', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } }); }
    catch { /* the token is gone locally either way */ }
  }
  showDefaultPasswordBanner(false);
  showLoginOverlay('');
}

// ── Session restore ───────────────────────────────────────────────
// On page load, a saved token is checked with the server before the admin
// app opens. After a restart or a long idle time it will no longer be valid.
(async function restoreAdminSession() {
  showInsecureConnectionNotice();

  const token = getAdminToken();
  if (!token) return;

  try {
    const r = await fetch('/api/admin/session', { headers: { 'Authorization': 'Bearer ' + token } });
    if (r.ok) {
      const d = await r.json();
      hideLoginOverlay();
      showDefaultPasswordBanner(!!d.usingDefault);
      setAdminSessionInfo(d);
      if (typeof initAdmin === 'function') initAdmin();
      return;
    }
  } catch { /* fall through to the login screen */ }

  sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  showLoginOverlay('');
})();

// ── Authenticated fetch helper ────────────────────────────────────
/**
 * Wrapper around fetch() that adds the session token. Use it for every
 * /api/admin/* call and for the admin-only stats calls.
 *
 * A 401 answer means the session is over, so the login screen is shown.
 * The response is still returned so callers can handle it normally.
 *
 * @param {string} url
 * @param {Object} [options] - Standard fetch options
 * @returns {Promise<Response>}
 */
async function adminFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      'Authorization': 'Bearer ' + (getAdminToken() || ''),
    },
  });

  if (res.status === 401 && getAdminToken()) {
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
    showLoginOverlay('Your session has ended. Please sign in again.');
  }
  return res;
}
