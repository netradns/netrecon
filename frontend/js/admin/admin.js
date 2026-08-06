// ── NetRecon Admin — Main Orchestrator ───────────────────────────
// Entry point for the admin panel. Called after successful authentication.
//
// Responsibilities:
//   - Initialise the default page (Dashboard)
//   - Start the dashboard auto-refresh loop
//   - Wire up any global admin UI behaviours
//
// This file is intentionally thin. All page logic lives in the
// page-specific modules under js/admin/settings/ and js/admin/watched/.

'use strict';

/**
 * Called by admin-auth.js after a successful login or session restore.
 * Navigates to the Dashboard and starts the auto-refresh loop.
 */
function initAdmin() {
  // Show the dashboard by default
  showAdminPage('dashboard');

  // Dashboard auto-refreshes every 15s (handled by stats.js)
  // Settings and Watched pages refresh on demand when navigated to
}

// ── Auto-init if already authenticated ───────────────────────────
// If the session was restored (page reload while logged in),
// admin-auth.js has already hidden the overlay — init immediately.
(function autoInit() {
  if (sessionStorage.getItem('nr-admin-hash')) {
    // Small delay to ensure all script modules have loaded
    setTimeout(initAdmin, 50);
  }
})();
