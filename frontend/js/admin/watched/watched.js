// ── NetRecon Admin — Watched Domains Page Orchestrator ───────────
// Renders the Watched Domains page shell and coordinates sub-modules.
//
// Sub-modules:
//   watched-form.js   — Add domain form
//   watched-table.js  — Domain list table + remove
//   watched-detail.js — Domain detail slide-in panel

'use strict';

// ── Render the page shell ─────────────────────────────────────────
/**
 * Renders the Watched Domains page HTML into #watchedContent.
 * Called once on first visit — subsequent visits just reload data.
 */
function renderWatchedShell() {
  const el = document.getElementById('watchedContent');
  if (!el || el.dataset.rendered) return;
  el.dataset.rendered = '1';

  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:8px">      <div>
        <div style="font-size:18px;font-weight:700">Watched Domains</div>
        <div style="font-size:12px;color:var(--text-3);margin-top:2px">
          Monitor public and internal domains for DNS record changes. Get alerted the moment something changes.
        </div>
      </div>
      <button class="refresh-btn" onclick="loadWatchedPage()">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M21 2v6h-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 12a9 9 0 0 1 15.36-6.36L21 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 22v-6h6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 12a9 9 0 0 1-15.36 6.36L3 16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Refresh
      </button>
    </div>

    <!-- Add domain form (rendered by watched-form.js) -->
    ${renderWatchedForm()}

    <!-- Domain table -->
    <div class="section">
      <div class="section-hdr">
        <div class="section-ico" style="background:var(--blue-light)">◈</div>
        <span class="section-title">Monitored Domains</span>
        <span class="section-sub" id="watchedCount">—</span>
      </div>
      <div id="watchedTableContainer">
        <div class="empty-state"><div class="spin"></div></div>
      </div>
    </div>

    <!-- Detail panel (slide-in overlay) -->
    <div id="watchedDetailPanel" class="detail-panel">
      <div id="watchedDetailContent"></div>
    </div>
  `;
}

// ── Load page data ────────────────────────────────────────────────
/**
 * Called by admin-nav.js when the user navigates to Watched Domains.
 * Renders the shell (once) and loads the domain list from the server.
 */
async function loadWatchedPage() {
  renderWatchedShell();

  // Apply custom selects immediately after shell renders (first visit only —
  // initAllCustomSelects skips already-initialized selects on subsequent calls)
  if (typeof initAllCustomSelects === 'function') {
    initAllCustomSelects(document.getElementById('addWatchedPanel'));
  }

  try {
    const r = await adminFetch('/api/admin/watched');
    if (!r.ok) throw new Error('Failed to load watched domains');
    const watched = await r.json();

    const countEl = document.getElementById('watchedCount');
    if (countEl) countEl.textContent = `${watched.domains?.length || 0} domain${watched.domains?.length !== 1 ? 's' : ''}`;

    renderWatchedTable(watched);
  } catch (e) {
    const el = document.getElementById('watchedTableContainer');
    if (el) el.innerHTML = `<div class="empty-state">Failed to load: ${e.message}</div>`;
    adminToast('Failed to load watched domains: ' + e.message, true);
  }
}
