// ── NetRecon Admin — Activity (audit trail) page ─────────────────
// Shows who signed in and what was changed in the admin panel.
// Data comes from GET /api/admin/audit (see dns-proxy/lib/admin/audit.js).
// Passwords and setting values are never recorded, so there is nothing
// sensitive to show here.

'use strict';

// How each event type is shown: label and pill color
const AUDIT_EVENTS = {
  login_ok:                { label: 'Signed in',                  cls: 'p-green'  },
  login_failed:            { label: 'Failed sign-in',             cls: 'p-red'    },
  login_locked:            { label: 'Locked out',                 cls: 'p-red'    },
  login_blocked:           { label: 'Blocked while locked out',   cls: 'p-yellow' },
  logout:                  { label: 'Signed out',                 cls: 'p-gray'   },
  password_changed:        { label: 'Password changed',           cls: 'p-blue'   },
  password_change_failed:  { label: 'Wrong current password',     cls: 'p-yellow' },
  password_reset_cli:      { label: 'Password reset (command line)', cls: 'p-blue' },
  setup_completed:         { label: 'Setup completed',            cls: 'p-blue'   },
  settings_changed:        { label: 'Settings changed',           cls: 'p-purple' },
  server_settings_changed: { label: 'Server settings changed',    cls: 'p-purple' },
  notify_test:             { label: 'Test notification',          cls: 'p-gray'   },
  watched_added:           { label: 'Watch added',                cls: 'p-green'  },
  watched_removed:         { label: 'Watch removed',              cls: 'p-yellow' },
  stats_cleared:           { label: 'Stats cleared',              cls: 'p-yellow' },
};

// Filter chips: [category sent to the server, label]
const AUDIT_FILTERS = [
  ['',         'All'],
  ['signin',   'Sign-ins'],
  ['security', 'Security'],
  ['config',   'Settings'],
  ['watch',    'Watched domains'],
  ['data',     'Data'],
];

let _auditFilter = '';

const _auditEsc = s => String(s === undefined || s === null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function _auditAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)    return 'just now';
  if (s < 3600)  return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

// ── Page shell ────────────────────────────────────────────────────

/** Builds the page once. Later visits only reload the data. */
function renderAuditShell() {
  const el = document.getElementById('auditContent');
  if (!el || el.dataset.rendered) return;
  el.dataset.rendered = '1';

  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:8px">
      <div>
        <div style="font-size:18px;font-weight:700">Activity</div>
        <div style="font-size:12px;color:var(--text-3);margin-top:2px">
          Who signed in and what was changed. Passwords and setting values are never recorded.
        </div>
      </div>
      <button class="refresh-btn" onclick="loadAuditPage()">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M21 2v6h-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 12a9 9 0 0 1 15.36-6.36L21 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 22v-6h6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 12a9 9 0 0 1-15.36 6.36L3 16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Refresh
      </button>
    </div>

    <div id="auditSummary" class="audit-summary"></div>

    <div class="audit-chips" id="auditChips">
      ${AUDIT_FILTERS.map(f => `<button class="audit-chip${f[0] === _auditFilter ? ' active' : ''}" data-cat="${f[0]}">${f[1]}</button>`).join('')}
    </div>

    <div class="section">
      <div class="section-hdr">
        <div class="section-ico" style="background:var(--blue-light)">≡</div>
        <span class="section-title">Events</span>
        <span class="section-sub" id="auditCount">—</span>
      </div>
      <div id="auditTable"><div class="empty-state"><div class="spin"></div></div></div>
    </div>`;

  document.getElementById('auditChips').addEventListener('click', e => {
    const chip = e.target.closest('.audit-chip');
    if (!chip) return;
    _auditFilter = chip.getAttribute('data-cat');
    document.querySelectorAll('.audit-chip').forEach(c => c.classList.toggle('active', c === chip));
    loadAuditPage();
  });
}

// ── Load and render ───────────────────────────────────────────────

/** Called by admin-nav.js when the page is opened, and by the Refresh button. */
async function loadAuditPage() {
  renderAuditShell();
  const table = document.getElementById('auditTable');
  if (!table) return;

  try {
    const url = '/api/admin/audit' + (_auditFilter ? '?category=' + encodeURIComponent(_auditFilter) : '');
    const r = await adminFetch(url);
    if (!r.ok) throw new Error(r.status === 401 ? 'Please sign in again' : 'The server returned ' + r.status);
    const d = await r.json();
    renderAuditTable(d.events || [], d.kept);
    if (!_auditFilter) renderAuditSummary(d.events || []);
  } catch (e) {
    table.innerHTML = `<div class="empty-state">Could not load the activity log: ${_auditEsc(e.message)}</div>`;
  }
}

/** One line above the table: the last 24 hours at a glance. */
function renderAuditSummary(events) {
  const el = document.getElementById('auditSummary');
  if (!el) return;
  const since = Date.now() - 86400000;
  let ok = 0, failed = 0, changes = 0;
  events.forEach(e => {
    if (e.ts < since) return;
    if (e.type === 'login_ok')          ok += 1;
    else if (e.type === 'login_failed') failed += e.count || 1;
    else if (e.category === 'config' || e.category === 'watch' || e.category === 'security') changes += 1;
  });
  el.innerHTML = `Last 24 hours: <b>${ok}</b> sign-in${ok === 1 ? '' : 's'}, ` +
    `<b class="${failed ? 'audit-bad' : ''}">${failed}</b> failed attempt${failed === 1 ? '' : 's'}, ` +
    `<b>${changes}</b> change${changes === 1 ? '' : 's'}.`;
}

function renderAuditTable(events, kept) {
  const table = document.getElementById('auditTable');
  const count = document.getElementById('auditCount');
  if (count) count.textContent = events.length + ' event' + (events.length === 1 ? '' : 's') + (kept ? ` · keeps the last ${kept}` : '');
  if (!table) return;

  if (!events.length) {
    table.innerHTML = '<div class="empty-state" style="padding:32px 0">Nothing recorded yet.</div>';
    return;
  }

  const who = e => {
    if (e.actor === 'cli') return 'command line';
    return _auditEsc(e.ip || '—') + (e.actor === 'anonymous' ? ' <span style="color:var(--text-3)">(not signed in)</span>' : '');
  };

  let html = `<div class="table-wrap"><table class="data-table">
    <thead><tr><th>When</th><th>Event</th><th>From</th><th>Details</th></tr></thead><tbody>`;
  events.forEach(e => {
    const meta  = AUDIT_EVENTS[e.type] || { label: e.type, cls: 'p-gray' };
    const times = e.count > 1 ? ` <span class="mono" style="color:var(--text-3)">×${e.count}</span>` : '';
    html += `<tr>
      <td style="white-space:nowrap" title="${_auditEsc(new Date(e.ts).toLocaleString())}">
        <div style="font-size:12px">${_auditEsc(new Date(e.ts).toLocaleString())}</div>
        <div style="font-size:11px;color:var(--text-3)">${_auditAgo(e.ts)}</div>
      </td>
      <td style="white-space:nowrap"><span class="pill ${meta.cls}" style="font-size:10px">${_auditEsc(meta.label)}</span>${times}</td>
      <td class="mono" style="font-size:12px">${who(e)}</td>
      <td style="font-size:12px;color:var(--text-3);word-break:break-word">${_auditEsc(e.detail)}</td>
    </tr>`;
  });
  table.innerHTML = html + '</tbody></table></div>';
}
