// ── NetRecon Admin — Page Navigation ─────────────────────────────
// Handles tab switching between Dashboard, Watched Domains, Activity, and Settings.
//
// Each "page" is a div with class .admin-page inside #adminPageContainer.
// Switching pages shows/hides the relevant div and updates the sidebar
// nav item active state and the topbar breadcrumb.
//
// Adding a new admin page:
//   1. Add a .admin-page div with id="page-<id>" in admin.html
//   2. Add a sidebar nav item with id="nav-<id>" in admin.html
//   3. Add the page title to _pageTitles below
//   4. Add a data loader call in showAdminPage() below

'use strict';

// Page titles shown in the topbar breadcrumb
const _adminPageTitles = {
  dashboard: '<b>Dashboard</b> &mdash; System &amp; Usage',
  watched:   '<b>Watched Domains</b> &mdash; DNS Change Monitoring',
  audit:     '<b>Activity</b> &mdash; Sign-ins &amp; Changes',
  settings:  '<b>Settings</b> &mdash; Configuration',
};

// Track the currently active page
let _currentAdminPage = 'dashboard';

/**
 * Switches to the specified admin page.
 * Updates the active nav item, page visibility, and topbar title.
 * Calls the page's data loader if one is registered.
 *
 * @param {string} pageId - 'dashboard' | 'watched' | 'audit' | 'settings'
 */
function showAdminPage(pageId) {
  if (!_adminPageTitles[pageId]) return;
  _currentAdminPage = pageId;

  // Hide all pages, show the target
  document.querySelectorAll('.admin-page').forEach(p => p.classList.remove('active'));
  const pageEl = document.getElementById('page-' + pageId);
  if (pageEl) pageEl.classList.add('active');

  // Update sidebar active state
  document.querySelectorAll('.sb-item').forEach(b => b.classList.remove('active'));
  const navEl = document.getElementById('nav-' + pageId);
  if (navEl) navEl.classList.add('active');

  // Update topbar breadcrumb
  const titleEl = document.getElementById('adminTopbarTitle');
  if (titleEl) titleEl.innerHTML = _adminPageTitles[pageId] || '';

  // Call the page's data loader
  if (pageId === 'dashboard') refreshAll();
  if (pageId === 'watched')   loadWatchedPage();
  if (pageId === 'audit')     loadAuditPage();
  if (pageId === 'settings')  loadSettingsPage();
}

/**
 * Returns the currently active page ID.
 * @returns {string}
 */
function getCurrentAdminPage() {
  return _currentAdminPage;
}
