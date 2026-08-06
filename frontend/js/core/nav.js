// NetRecon — Navigation & Routing
// Handles page switching and sidebar navigation

'use strict';

// ── Page titles for topbar ───────────────────────────────────────
var PAGE_TITLES = {
  dns: '<b>DNS / IP Lookup</b> &mdash; Domain &amp; IP Intelligence',
  idns: '<b>Internal DNS</b> &mdash; Internal Network Lookup',
  calc: '<b>IP Calculator</b> &mdash; CIDR &amp; Subnet Planning',
  cloud: '<b>Cloud CIDR</b> &mdash; VPC Network Planning'
};

// ── Show page ────────────────────────────────────────────────────
function showPage(pageId) {
  // Hide all pages
  document.querySelectorAll('.page').forEach(function(page) {
    page.classList.remove('active');
  });

  // Show selected page
  var page = document.getElementById('page-' + pageId);
  if (page) page.classList.add('active');

  // Update sidebar active state
  document.querySelectorAll('.sb-item').forEach(function(item) {
    item.classList.remove('active');
  });
  var navItem = document.getElementById('nav-' + pageId);
  if (navItem) navItem.classList.add('active');

  // Update topbar title
  var titleEl = document.getElementById('topbar-title');
  if (titleEl && PAGE_TITLES[pageId]) {
    titleEl.innerHTML = PAGE_TITLES[pageId];
  }

  // Close mobile sidebar
  closeSidebar();

  // Update URL hash
  try {
    history.replaceState(null, '', '#' + pageId);
  } catch(e) {
    window.location.hash = pageId;
  }
}

// ── Mobile sidebar toggle ────────────────────────────────────────
function openSidebar() {
  var sidebar = document.getElementById('sidebar');
  var overlay = document.getElementById('sbOverlay');
  if (sidebar) sidebar.classList.add('open');
  if (overlay) overlay.classList.add('open');
}

function closeSidebar() {
  var sidebar = document.getElementById('sidebar');
  var overlay = document.getElementById('sbOverlay');
  if (sidebar) sidebar.classList.remove('open');
  if (overlay) overlay.classList.remove('open');
}

// ── Hash-based routing on load ───────────────────────────────────
window.addEventListener('DOMContentLoaded', function() {
  var hash = window.location.hash.replace('#', '').split('/')[0];
  var validPages = ['dns', 'idns', 'calc', 'cloud'];
  if (validPages.indexOf(hash) !== -1) {
    showPage(hash);
  }
});
