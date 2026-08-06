// ── NetRecon Admin — Watched Domains Table ────────────────────────
// Renders the table of watched domains and handles remove actions.
//
// Design note on row clicks:
//   We use data-index attributes + a delegated click listener instead of
//   embedding JSON in onclick attributes. Embedding JSON in onclick is
//   fragile — JSON.stringify output can contain characters that break
//   HTML attribute parsing. The index approach is safe and clean.

'use strict';

// Cached watched state — set by renderWatchedTable, read by row click handler
let _watchedState = null;

/**
 * Renders the watched domains table into #watchedTableContainer.
 * @param {Object} watched - Full watched state from GET /api/admin/watched
 */
function renderWatchedTable(watched) {
  _watchedState = watched;
  const container = document.getElementById('watchedTableContainer');
  if (!container) return;

  const domains = watched.domains || [];

  if (!domains.length) {
    container.innerHTML = `
      <div class="empty-state" style="padding:40px 0">
        <div style="font-size:32px;margin-bottom:12px">🔍</div>
        <div style="font-size:14px;font-weight:600;margin-bottom:6px">No domains being watched</div>
        <div style="font-size:12px;color:var(--text-3)">Add a domain above to start monitoring for DNS changes.</div>
      </div>`;
    return;
  }

  const _esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const _ago = ts => {
    if (!ts) return '—';
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60)    return s + 's ago';
    if (s < 3600)  return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  };

  const intervalLabel = i => i >= 1440 ? '24h' : i >= 60 ? (i / 60) + 'h' : i + 'm';
  const statusCls     = { stable: 'p-green', changed: 'p-yellow', error: 'p-red', pending: 'p-gray' };

  let html = `<div class="table-wrap"><table class="data-table" id="watchedDomainsTable">
    <thead><tr>
      <th>Domain</th><th>Source</th><th>Types</th><th>Interval</th>
      <th>Last Checked</th><th>Last Changed</th><th>Status</th><th></th>
    </tr></thead>
    <tbody>`;

  domains.forEach((entry, idx) => {
    const types = (entry.recordTypes || []).join(', ');
    // Use data-index to reference the entry — avoids embedding JSON in HTML
    html += `<tr class="watched-row" data-index="${idx}" style="cursor:pointer">
      <td style="font-weight:600">${_esc(entry.domain)}</td>
      <td><span class="pill ${entry.source === 'internal' ? 'p-yellow' : 'p-blue'}" style="font-size:10px">${_esc(entry.source)}</span></td>
      <td class="mono" style="font-size:11px;color:var(--text-3)">${_esc(types)}</td>
      <td style="font-size:12px;color:var(--text-3)">${intervalLabel(entry.interval)}</td>
      <td style="font-size:11px;color:var(--text-3)">${_ago(entry.lastChecked)}</td>
      <td style="font-size:11px;color:var(--text-3)">${_ago(entry.lastChanged)}</td>
      <td><span class="pill ${statusCls[entry.status] || 'p-gray'}" style="font-size:10px">${_esc(entry.status || 'pending')}</span></td>
      <td>
        <button class="btn btn-ghost btn-sm watched-remove-btn" data-index="${idx}" style="color:var(--red)">Remove</button>
      </td>
    </tr>`;
  });

  html += '</tbody></table></div>';
  container.innerHTML = html;

  // ── Delegated event listeners ─────────────────────────────────
  // One listener on the table handles all row clicks and remove buttons.
  // This is more efficient than attaching a listener to every row/button.
  const table = document.getElementById('watchedDomainsTable');
  if (!table) return;

  table.addEventListener('click', e => {
    // Remove button — stop propagation so the row click doesn't also fire
    const removeBtn = e.target.closest('.watched-remove-btn');
    if (removeBtn) {
      e.stopPropagation();
      const idx   = parseInt(removeBtn.getAttribute('data-index'), 10);
      const entry = _watchedState?.domains?.[idx];
      if (entry) removeWatchedDomain(entry.id, entry.domain);
      return;
    }

    // Row click — open detail panel
    const row = e.target.closest('.watched-row');
    if (row) {
      const idx   = parseInt(row.getAttribute('data-index'), 10);
      const entry = _watchedState?.domains?.[idx];
      if (entry) openWatchedDetail(entry, _watchedState);
    }
  });
}

// ── Remove domain ─────────────────────────────────────────────────
/**
 * Removes a watched domain after confirmation.
 * @param {string} id     - Domain entry ID (hex timestamp)
 * @param {string} domain - Domain name shown in the confirmation dialog
 */
async function removeWatchedDomain(id, domain) {
  if (!confirm(`Stop watching ${domain}?\nThis will also remove its snapshot and change history.`)) return;

  try {
    const r = await adminFetch(`/api/admin/watched/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const d = await r.json();
    if (r.ok) {
      adminToast(`Removed ${domain}`);
      loadWatchedPage();
    } else {
      adminToast(d.error || 'Remove failed', true);
    }
  } catch (e) {
    adminToast('Error: ' + e.message, true);
  }
}
