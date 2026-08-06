// ── NetRecon Admin — Authentication ──────────────────────────────
// Login gate for the admin panel.
//
// Replaces the stats-auth.js pattern with a cleaner implementation
// that also stores the hash for use in authenticated API requests.
//
// How it works:
//   1. On page load, fetch the password hash from /api/app-config
//   2. User submits the login form
//   3. Hash their input client-side with Web Crypto (SHA-256)
//   4. Compare against the server-provided hash
//   5. On match: store hash in sessionStorage, hide overlay, init app
//
// The stored hash is sent as X-Admin-Hash on every admin API request.
// This is the same hash the server uses to verify admin actions.

'use strict';

// The valid password hash fetched from /api/app-config
let _adminValidHash = null;

// The hash of the currently authenticated session
// Exported so admin API helpers can attach it to requests
let _adminSessionHash = null;

/**
 * Returns the current session hash, or null if not authenticated.
 * Used by admin API helpers to set the X-Admin-Hash header.
 * @returns {string|null}
 */
function getAdminHash() {
  return _adminSessionHash || sessionStorage.getItem('nr-admin-hash');
}

// ── Load config on page load ──────────────────────────────────────
// Fetches the password hash from /api/app-config asynchronously.
// On session restore (page reload), the overlay is already hidden before
// this resolves — that's fine because the hash is only needed for the
// login form, not for authenticated API calls (which use the stored hash).
(async function loadAdminConfig() {
  try {
    const r = await fetch('/api/app-config', { cache: 'no-store' });
    if (r.ok) {
      const d = await r.json();
      _adminValidHash = d.statsPasswordHash || null;

      // Expose internalDnsEnabled to the rest of the admin UI
      window._adminAppConfig = d;
    }
  } catch (e) {
    console.warn('[admin-auth] Could not load app config:', e.message);
  }
})();

// ── SHA-256 helper ────────────────────────────────────────────────
async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Login form handler ────────────────────────────────────────────
/**
 * Called by the login form's onsubmit.
 * Hashes the password and compares against the server-provided hash.
 */
function handleAdminLogin(e) {
  e.preventDefault();
  const user = document.getElementById('loginUser').value.trim();
  const pass = document.getElementById('loginPass').value;

  sha256(pass).then(hash => {
    if (user === 'admin' && _adminValidHash && hash === _adminValidHash) {
      // Store hash for this session — used in API request headers
      _adminSessionHash = hash;
      sessionStorage.setItem('nr-admin-hash', hash);
      sessionStorage.setItem('nr-stats-auth', '1'); // keep stats modules happy

      document.getElementById('loginOverlay').classList.add('hidden');

      // Initialise the admin app now that we're authenticated
      if (typeof initAdmin === 'function') initAdmin();

    } else {
      document.getElementById('loginError').style.display = 'block';
      document.getElementById('loginPass').value = '';
      document.getElementById('loginPass').focus();
    }
  });

  return false;
}

// ── Session restore ───────────────────────────────────────────────
// If the user already authenticated this session, skip the login overlay.
(function restoreAdminSession() {
  const stored = sessionStorage.getItem('nr-admin-hash');
  if (stored) {
    _adminSessionHash = stored;
    document.getElementById('loginOverlay').classList.add('hidden');
  }
})();

// ── Authenticated fetch helper ────────────────────────────────────
/**
 * Wrapper around fetch() that automatically attaches the X-Admin-Hash
 * header to every request. Use this for all /api/admin/* calls.
 *
 * @param {string} url
 * @param {Object} [options] - Standard fetch options
 * @returns {Promise<Response>}
 */
function adminFetch(url, options = {}) {
  const hash = getAdminHash();
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      'X-Admin-Hash': hash || '',
    },
  });
}
