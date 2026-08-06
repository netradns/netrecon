// NetRecon — Theme Management
// Handles light/dark/system theme switching with persistence

'use strict';

// Stats page uses 'system' as default — respects OS dark/light preference
(function() {
  var saved = localStorage.getItem('nr-theme') || 'system';
  applyTheme(saved);
})();

// ── Set theme ────────────────────────────────────────────────────
function setTheme(theme) {
  localStorage.setItem('nr-theme', theme);
  applyTheme(theme);
}

// ── Apply theme to document ──────────────────────────────────────
function applyTheme(theme) {
  var html = document.documentElement;
  
  // Update button states
  ['light', 'dark', 'system'].forEach(function(t) {
    var btn = document.getElementById('tt-' + t);
    if (btn) {
      if (t === theme) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    }
  });

  // Apply theme
  if (theme === 'system') {
    // Use system preference
    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    html.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    html.setAttribute('data-theme', theme);
  }
}

// ── Listen for system theme changes ──────────────────────────────
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function() {
    var saved = localStorage.getItem('nr-theme') || 'system';
    if (saved === 'system') {
      applyTheme('system');
    }
  });
}
