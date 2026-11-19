// ── NetRecon Admin — Activity page ───────────────────────────────
// One place for what happened: who signed in and what was changed, which watched
// entries raised alerts, which notifications were delivered or failed, and what the
// server itself did. Data comes from GET /api/admin/audit, which merges the logs
// (see dns-proxy/lib/admin/activity.js). Passwords, setting values and web addresses
// are never recorded, so there is nothing sensitive to show here.
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
  watched_edited:          { label: 'Watch edited',               cls: 'p-blue'   },
  stats_cleared:           { label: 'Stats cleared',              cls: 'p-yellow' },
  server_started:          { label: 'Server started',             cls: 'p-gray'   },
  watch_failing:           { label: 'Watch failing',              cls: 'p-red'    },
  alert_dns:               { label: 'DNS change',                 cls: 'p-yellow' },
  alert_cert:              { label: 'Certificate alert',          cls: 'p-yellow' },
  alert_expiry:            { label: 'Registration alert',         cls: 'p-yellow' },
  notify_ok:               { label: 'Notification sent',          cls: 'p-green'  },
  notify_failed:           { label: 'Notification failed',        cls: 'p-red'    },
};

// Filter chips: [category sent to the server, label]
const AUDIT_FILTERS = [
  ['',         'All'],
  ['signin',   'Sign-ins'],
  ['security', 'Security'],
  ['config',   'Settings'],
  ['watch',    'Watched domains'],
  ['alerts',   'Watch alerts'],
  ['delivery', 'Notifications'],
  ['system',   'System'],
  ['data',     'Data'],
];

let _auditFilter = '';
let _auditPage   = 0;      // counting from 0
let _auditSize   = 25;
let _auditTotal  = 0;

const _auditEsc = s => String(s === undefined || s === null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function _auditAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)    return 'just now';
  if (s < 3600)  return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

const _auditQuery = (extra) => {
  const q = [];
  if (_auditFilter) q.push('category=' + encodeURIComponent(_auditFilter));
  return '/api/admin/audit' + (q.concat(extra || []).length ? '?' + q.concat(extra || []).join('&') : '');
};

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
          Sign-ins, changes, watch alerts and notification deliveries in one place. Passwords and setting values are never recorded.
        </div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="refresh-btn" onclick="exportAuditCsv()" title="Download the events matching the filter as a CSV file (up to 500)">Export CSV</button>
        <button class="refresh-btn" onclick="loadAuditPage()">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M21 2v6h-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 12a9 9 0 0 1 15.36-6.36L21 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 22v-6h6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 12a9 9 0 0 1-15.36 6.36L3 16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Refresh
        </button>
      </div>
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
      <div id="auditPager"></div>
      <div style="font-size:11px;color:var(--text-3);padding:10px 4px 2px">
        Kept: the last 1000 admin events, 200 notification deliveries and 100 watch alerts.
      </div>
    </div>`;
  document.getElementById('auditChips').addEventListener('click', e => {
    const chip = e.target.closest('.audit-chip');
    if (!chip) return;
    _auditFilter = chip.getAttribute('data-cat');
    _auditPage = 0;
    loadAuditPage();
  });
}

/** Open the Activity page on one group, for example from a "see all" link. */
function openActivity(category) {
  _auditFilter = category || '';
  _auditPage = 0;
  showAdminPage('audit');
}

// ── Paging (called by the pager buttons) ──────────────────────────
function auditPage(delta) {
  const pages = Math.max(1, Math.ceil(_auditTotal / _auditSize));
  _auditPage = Math.min(pages - 1, Math.max(0, _auditPage + delta));
  loadAuditPage();
}
function auditSize(n) {
  _auditSize = n;
  _auditPage = 0;
  loadAuditPage();
}

// ── Load and render ───────────────────────────────────────────────
/** Called by admin-nav.js when the page is opened, and by the Refresh button. */
async function loadAuditPage() {
  renderAuditShell();
  document.querySelectorAll('.audit-chip').forEach(c => c.classList.toggle('active', c.getAttribute('data-cat') === _auditFilter));
  const table = document.getElementById('auditTable');
  if (!table) return;
  try {
    const r = await adminFetch(_auditQuery(['limit=' + _auditSize, 'offset=' + (_auditPage * _auditSize)]));
    if (!r.ok) throw new Error(r.status === 401 ? 'Please sign in again' : 'The server returned ' + r.status);
    const d = await r.json();
    _auditTotal = d.total || 0;
    // The list got shorter since the last visit (or a filter changed): go to the last page that exists
    if (!(d.events || []).length && _auditTotal > 0 && _auditPage > 0) {
      _auditPage = Math.ceil(_auditTotal / _auditSize) - 1;
      return loadAuditPage();
    }
    renderAuditTable(d.events || []);
    renderAuditSummary(d.summary);
  } catch (e) {
    table.innerHTML = `<div class="empty-state">Could not load the activity log: ${_auditEsc(e.message)}</div>`;
  }
}

/** One line above the table: the last 24 hours at a glance (computed by the server). */
function renderAuditSummary(s) {
  const el = document.getElementById('auditSummary');
  if (!el || !s) return;
  el.innerHTML = `Last 24 hours: <b>${s.signIns}</b> sign-in${s.signIns === 1 ? '' : 's'}, ` +
    `<b class="${s.failed ? 'audit-bad' : ''}">${s.failed}</b> failed attempt${s.failed === 1 ? '' : 's'}, ` +
    `<b>${s.changes}</b> change${s.changes === 1 ? '' : 's'}.`;
}

/** Who did it: an address, "system" for the server itself, or "command line". */
function _auditWho(e) {
  if (e.actor === 'cli')    return 'command line';
  if (e.actor === 'system') return 'system';
  return _auditEsc(e.ip || '—') + (e.actor === 'anonymous' ? ' <span style="color:var(--text-3)">(not signed in)</span>' : '');
}

function renderAuditTable(events) {
  const table = document.getElementById('auditTable');
  const count = document.getElementById('auditCount');
  const pager = document.getElementById('auditPager');
  if (count) count.textContent = _auditTotal + ' event' + (_auditTotal === 1 ? '' : 's');
  if (pager) pager.innerHTML = renderPager({ total: _auditTotal, page: _auditPage, size: _auditSize, shown: events.length, onPage: 'auditPage', onSize: 'auditSize' });
  if (!table) return;
  if (!events.length) {
    table.innerHTML = '<div class="empty-state" style="padding:32px 0">Nothing recorded yet.</div>';
    return;
  }
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
      <td class="mono" style="font-size:12px">${_auditWho(e)}</td>
      <td style="font-size:12px;color:var(--text-3);word-break:break-word">${_auditEsc(e.detail)}</td>
    </tr>`;
  });
  table.innerHTML = html + '</tbody></table></div>';
}

// ── Export ────────────────────────────────────────────────────────
/** One CSV field. A leading = + - or @ is defused so a spreadsheet never runs it as a formula. */
function _auditCsvField(v) {
  let s = String(v === undefined || v === null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

/** Download the events matching the current group (newest 500) as a CSV file. */
async function exportAuditCsv() {
  try {
    const r = await adminFetch(_auditQuery(['limit=500', 'offset=0']));
    if (!r.ok) throw new Error('The server returned ' + r.status);
    const d = await r.json();
    const rows = [['When', 'Event', 'Group', 'From', 'Count', 'Details']].concat((d.events || []).map(e => [
      new Date(e.ts).toISOString(), (AUDIT_EVENTS[e.type] || { label: e.type }).label, e.category,
      e.actor === 'cli' ? 'command line' : e.actor === 'system' ? 'system' : e.ip, e.count || 1, e.detail,
    ]));
    const csv = rows.map(row => row.map(_auditCsvField).join(',')).join('\r\n') + '\r\n';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'netrecon-activity' + (_auditFilter ? '-' + _auditFilter : '') + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    adminToast('Exported ' + (rows.length - 1) + ' events');
  } catch (e) {
    adminToast('Export failed: ' + e.message, true);
  }
}
