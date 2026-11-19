// NetRecon Stats — Main Controller
// Orchestrates data fetching, rendering, and the auto-refresh loop

'use strict';

// ── Shared state ──────────────────────────────────────────────
let _serverStats = { counters: {}, history: [] };

// ── Helpers ───────────────────────────────────────────────────
const fmtNum = n => Number(n).toLocaleString();
const el     = id => document.getElementById(id);

function ago(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5)    return 'just now';
  if (s < 60)   return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  return Math.floor(s / 3600) + 'h ago';
}

// ── Server-side stats fetch ───────────────────────────────────
async function fetchServerStats() {
  try {
    const r = await adminFetch('/api/internal-dns/stats', { cache: 'no-store' });
    if (r.ok) _serverStats = await r.json();
  } catch {}
}

function getStats()   { return _serverStats.counters || {}; }
function getHistory() { return _serverStats.history  || []; }

// ── Refresh all sections ──────────────────────────────────────
async function refreshAll() {
  await Promise.all([
    checkProxy(),
    fetchNginx(),
    fetchServerInfo(),
    fetchServerStats()
  ]);
  renderUsage();
  renderTopQueries();
  renderRecent();
  renderRecordTypes();
  renderErrors();
  renderHourlyVolume();
}

// ── Init ──────────────────────────────────────────────────────
// On admin.html, initAdmin() calls showAdminPage('dashboard') which
// calls refreshAll() directly — so we skip the auto-init here to
// avoid a double fetch on page load. On the original stats.html
// (now removed), this was the only init path.
// We still set up the auto-refresh intervals below.
(function initStats() {
  // Only auto-init if we're NOT on admin.html (which has its own init flow).
  // admin.html has #adminPageContainer; stats-only pages don't.
  const isAdminPage = !!document.getElementById('adminPageContainer');
  if (!isAdminPage && isAdminLoggedIn()) {
    refreshAll();
  }
})();

// Auto-refresh every 15s; relative timestamps every 30s
setInterval(function () {
  if (isAdminLoggedIn()) refreshAll();
}, 15000);

setInterval(function () {
  if (isAdminLoggedIn()) renderRecent();
}, 30000);
