// ── NetRecon Admin — Watched Domain Detail Panel ─────────────────
// Shows the record snapshot, certificate details and change history for a single
// watched entry. Rendered as a slide-in panel over the table.

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

  panel.innerHTML = renderDetailContent(entry, snapshot, changes, watched.certs?.[entry.id], watched.expiries?.[entry.id]);
  panel.classList.add('open');
  if (typeof initWatchEditor === 'function') initWatchEditor();   // watched-edit.js
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
function renderDetailContent(entry, snapshot, changes, certState, expiryState) {
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
        if (c.kind === 'cert') return renderCertEventCard(c, _esc, _ts);
        if (c.kind === 'expiry') return renderExpiryEventCard(c, _esc, _ts);
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
          ${_esc((entry.recordTypes || []).join(', ') || (entry.cert && entry.expiry ? 'Certificate + registration' : entry.expiry ? 'Registration only' : 'Certificate only'))} ·
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

    ${typeof renderWatchEditor === 'function' ? renderWatchEditor(entry) : ''}
    ${entry.cert ? renderCertSection(entry, certState, _esc, _ts) : ''}
    ${entry.expiry ? renderExpirySection(entry, expiryState, _esc, _ts) : ''}

    <!-- Current snapshot -->
    ${(entry.recordTypes || []).length ? `<div class="section" style="margin-bottom:16px">
      <div class="section-hdr">
        <div class="section-ico" style="background:var(--blue-light)">◈</div>
        <span class="section-title">Current Snapshot</span>
        <span class="section-sub">${snapshot ? _esc(_ts(snapshot.ts)) : 'Pending'}</span>
      </div>
      <div style="padding:0 4px">${recordsHtml}</div>
    </div>` : ''}

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

// ── Certificate section ───────────────────────────────────────────
/**
 * Details of the watched TLS certificate: expiry, name, issuer and trust.
 * @param {Object} entry - Watched entry (entry.cert has the port and thresholds)
 * @param {Object} c     - Certificate state from the server, or undefined before the first check
 */
function renderCertSection(entry, c, _esc, _ts) {
  const color = { ok: 'var(--green)', expiring: 'var(--yellow)', expired: 'var(--red)', error: 'var(--red)' };
  const cell  = (label, value, mono) => `<div style="min-width:0">
      <div style="font-size:11px;color:var(--text-3);margin-bottom:2px">${label}</div>
      <div ${mono ? 'class="mono"' : ''} style="font-size:12px;word-break:break-all">${value}</div></div>`;

  let body;
  if (!c) {
    body = '<div class="empty-state" style="padding:12px 0">The first certificate check is pending.</div>';
  } else {
    const days = c.validTo
      ? (c.daysLeft < 0 ? `expired ${Math.abs(c.daysLeft)} day${Math.abs(c.daysLeft) === 1 ? '' : 's'} ago` : `${c.daysLeft} day${c.daysLeft === 1 ? '' : 's'} left`)
      : '—';
    const trust = c.authorized
      ? 'Trusted'
      : 'Not publicly trusted. This is normal for self-signed and internal CA certificates.';
    body = `
      ${c.ok ? '' : `<div style="font-size:12px;color:var(--red);margin-bottom:10px">Last check failed: ${_esc(c.error)}</div>`}
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:14px">
        ${cell('Status', `<span style="color:${color[c.status] || 'var(--text-3)'};font-weight:600">${_esc(c.status)}</span> · ${_esc(days)}`)}
        ${cell('Expires', c.validTo ? _esc(new Date(c.validTo).toLocaleDateString()) : '—')}
        ${cell('Valid from', c.validFrom ? _esc(new Date(c.validFrom).toLocaleDateString()) : '—')}
        ${cell('Name (CN)', _esc(c.commonName || '—'), true)}
        ${cell('Issuer', _esc(c.issuer || '—'))}
        ${cell('Trust', _esc(trust))}
        ${cell('Protocol', _esc(c.protocol || '—'))}
        ${cell('Names covered', _esc((c.sans || []).slice(0, 8).join(', ') || '—') + ((c.sans || []).length > 8 ? ` +${c.sans.length - 8} more` : ''), true)}
        ${cell('Fingerprint (SHA-256)', _esc((c.fingerprint || '—')), true)}
        ${cell('Last checked', _esc(_ts(c.ts)))}
      </div>`;
  }

  return `
    <div class="section" style="margin-bottom:16px">
      <div class="section-hdr">
        <div class="section-ico" style="background:var(--green-light)">🔒</div>
        <span class="section-title">TLS Certificate</span>
        <span class="section-sub">${_esc(entry.domain)}:${_esc(entry.cert.port)} · warns at ${_esc((entry.cert.warnDays || []).join(', '))} days</span>
      </div>
      <div style="padding:12px 4px">${body}</div>
    </div>`;
}

/**
 * One certificate event in the change history (expiring, renewed, ...).
 */
function renderCertEventCard(c, _esc, _ts) {
  const color = { expiring: 'var(--yellow)', expired: 'var(--red)', error: 'var(--red)',
                  renewed: 'var(--green)', recovered: 'var(--green)', changed: 'var(--yellow)' };
  const label = { expiring: 'Expiring', expired: 'Expired', error: 'Check failing',
                  renewed: 'Renewed', recovered: 'Recovered', changed: 'Replaced' };
  return `<div style="border:1px solid var(--border);border-radius:6px;padding:12px;margin-bottom:8px;background:var(--surface)">
    <div style="font-size:11px;color:var(--text-3);margin-bottom:8px">${_esc(_ts(c.ts))} · certificate</div>
    ${(c.certEvents || []).map(ev => `<div style="font-size:12px;color:${color[ev.type] || 'var(--text)'};margin-bottom:3px">
      <span style="font-weight:600">${_esc(label[ev.type] || ev.type)}</span> ${_esc(ev.message)}
    </div>`).join('')}
  </div>`;
}