// ── NetRecon Admin — Watched Domain Detail Panel ─────────────────
// Shows the full record snapshot and change history for a single
// watched domain. Rendered as a slide-in panel over the table.

'use strict';

// Currently open domain entry
let _detailEntry = null;

/**
 * Opens the detail panel for a watched domain.
 * @param {Object} entry     - Domain entry from the watched state
 * @param {Object} watched   - Full watched state (for snapshots + changeLog)
 */
function openWatchedDetail(entry, watched) {
  _detailEntry = entry;

  const panel = document.getElementById('watchedDetailPanel');
  if (!panel) return;

  const snapshot  = watched.snapshots?.[entry.id];
  const changes   = (watched.changeLog || []).filter(c => c.watchId === entry.id).slice().reverse();

  panel.innerHTML = renderDetailContent(entry, snapshot, changes);
  panel.classList.add('open');
}

/**
 * Closes the detail panel.
 */
function closeWatchedDetail() {
  const panel = document.getElementById('watchedDetailPanel');
  if (panel) panel.classList.remove('open');
  _detailEntry = null;
}

// ── Render detail content ─────────────────────────────────────────
function renderDetailContent(entry, snapshot, changes) {
  const _esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const _ts  = ts => ts ? new Date(ts).toLocaleString() : '—';

  const statusColor = { stable: 'var(--green)', changed: 'var(--yellow)', error: 'var(--red)', pending: 'var(--text-3)' };
  // entry.status comes from the server (pending|stable|changed|error) but escape defensively
  const safeStatus  = _esc(entry.status || 'unknown');
  const statusBadge = `<span style="color:${statusColor[entry.status] || 'var(--text-3)'};font-weight:600">${safeStatus}</span>`;

  // Current snapshot records table
  const records = snapshot?.records || [];
  const recordsHtml = records.length
    ? `<div class="table-wrap"><table class="data-table">
        <thead><tr><th>Type</th><th>Data</th><th>TTL</th></tr></thead>
        <tbody>${records.map(r => `<tr>
          <td class="mono" style="font-size:11px;color:var(--blue)">${_esc(r.type)}</td>
          <td class="mono" style="font-size:11px">${_esc(r.data)}</td>
          <td class="mono" style="font-size:11px;color:var(--text-3)">${r.ttl||'—'}</td>
        </tr>`).join('')}</tbody>
      </table></div>`
    : '<div class="empty-state" style="padding:12px 0">No snapshot yet — first poll pending.</div>';

  // Change history
  const changesHtml = changes.length
    ? changes.slice(0, 20).map(c => {
        const added   = c.changes.filter(x => x.type === 'added');
        const removed = c.changes.filter(x => x.type === 'removed');
        return `<div style="border:1px solid var(--border);border-radius:6px;padding:12px;margin-bottom:8px;background:var(--surface)">
          <div style="font-size:11px;color:var(--text-3);margin-bottom:8px">${_esc(_ts(c.ts))}</div>
          ${added.map(x => `<div style="font-size:12px;color:var(--green);margin-bottom:3px">
            <span style="font-weight:600">+ Added</span> <span class="mono">${_esc(x.recordType)}: ${_esc(x.data)}</span>
          </div>`).join('')}
          ${removed.map(x => `<div style="font-size:12px;color:var(--red);margin-bottom:3px">
            <span style="font-weight:600">− Removed</span> <span class="mono">${_esc(x.recordType)}: ${_esc(x.data)}</span>
          </div>`).join('')}
        </div>`;
      }).join('')
    : '<div class="empty-state" style="padding:12px 0">No changes detected yet.</div>';

  return `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <div>
        <div style="font-size:16px;font-weight:700">${_esc(entry.domain)}</div>
        <div style="font-size:12px;color:var(--text-3);margin-top:2px">
          ${_esc(entry.source === 'internal' ? 'Internal DNS' : 'Public DNS')} ·
          ${_esc((entry.recordTypes || []).join(', '))} ·
          Every ${entry.interval >= 1440 ? '24h' : entry.interval >= 60 ? Math.floor(entry.interval / 60) + 'h' : entry.interval + 'm'}
        </div>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="closeWatchedDetail()">✕ Close</button>
    </div>

    <!-- Status row -->
    <div style="display:flex;gap:24px;margin-bottom:20px;font-size:12px">
      <div><span style="color:var(--text-3)">Status</span> &nbsp;${statusBadge}</div>
      <div><span style="color:var(--text-3)">Last checked</span> &nbsp;${_esc(_ts(entry.lastChecked))}</div>
      <div><span style="color:var(--text-3)">Last changed</span> &nbsp;${_esc(_ts(entry.lastChanged))}</div>
    </div>

    <!-- Current snapshot -->
    <div class="section" style="margin-bottom:16px">
      <div class="section-hdr">
        <div class="section-ico" style="background:var(--blue-light)">◈</div>
        <span class="section-title">Current Snapshot</span>
        <span class="section-sub">${snapshot ? _esc(_ts(snapshot.ts)) : 'Pending'}</span>
      </div>
      <div style="padding:0 4px">${recordsHtml}</div>
    </div>

    <!-- Change history -->
    <div class="section">
      <div class="section-hdr">
        <div class="section-ico" style="background:var(--yellow-light)">⇢</div>
        <span class="section-title">Change History</span>
        <span class="section-sub">${changes.length} event${changes.length !== 1 ? 's' : ''}</span>
      </div>
      <div style="padding:12px 4px">${changesHtml}</div>
    </div>`;
}
