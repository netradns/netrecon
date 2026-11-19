// ── NetRecon Admin — Domain Registration Display ─────────────────
// How a watched domain registration is shown: the badge in the table, the
// section in the detail panel, and the events in the change history.
// The data comes from dns-proxy (see lib/watcher/domain-expiry.js).
//
// Kept in its own file so the table and detail files only gain a call each.

'use strict';

// Pill color for each registration state
const EXPIRY_PILL = {
  ok: 'p-green', expiring: 'p-yellow', expired: 'p-red', notfound: 'p-red', error: 'p-red',
  unsupported: 'p-gray', noexpiry: 'p-gray', pending: 'p-gray',
};

/** "266d" for ordinary values, "2.6y" once it is more than about three years away. */
function expiryDaysLabel(days) {
  if (days < 0) return 'expired';
  return days > 1000 ? (days / 365).toFixed(1) + 'y' : days + 'd';
}

/**
 * The small badge shown in the Expiry column of the watched table.
 * @param {Object} entry - Watched entry
 * @param {Object} s     - Registration state from the server (undefined before the first check)
 */
function expiryBadge(entry, s) {
  if (!entry.expiry) return '';
  const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  let label = 'checking…';
  if (s) {
    if (s.status === 'unsupported')   label = 'no RDAP';
    else if (s.status === 'noexpiry') label = 'no date';
    else if (s.status === 'notfound') label = 'not registered';
    else if (s.status === 'error')    label = 'error';
    else if (!s.ok)                   label = 'unreachable';
    else if (s.expires)               label = expiryDaysLabel(s.daysLeft);
  }
  const cls = (s && EXPIRY_PILL[s.status]) || 'p-gray';
  return `<span class="pill ${cls}" style="font-size:10px" title="Domain registration">Domain ${esc(label)}</span>`;
}

/** One sentence that explains states which are not a problem with the domain itself. */
function expiryStateNote(s) {
  const tld = s.tld ? '.' + s.tld : 'this extension';
  if (s.status === 'unsupported') return `The registry for ${tld} does not offer RDAP, so the registration cannot be watched. DNS and certificate watching still work.`;
  if (s.status === 'noexpiry')    return 'The registry answers but does not publish an expiry date for this domain, so only changes such as a hold or re-registration can be detected.';
  if (s.status === 'notfound')    return 'No registration was found for this name. It may have expired and been deleted, or it was never registered.';
  return '';
}

/**
 * The Domain Registration section of the detail panel.
 * @param {Object} entry - Watched entry (entry.expiry has the thresholds)
 * @param {Object} s     - Registration state, or undefined before the first check
 */
function renderExpirySection(entry, s, esc, ts) {
  const color = { ok: 'var(--green)', expiring: 'var(--yellow)', expired: 'var(--red)', notfound: 'var(--red)', error: 'var(--red)' };
  const cell  = (label, value, mono) => `<div style="min-width:0">
      <div style="font-size:11px;color:var(--text-3);margin-bottom:2px">${label}</div>
      <div ${mono ? 'class="mono"' : ''} style="font-size:12px;word-break:break-all">${value}</div></div>`;
  const date = ms => ms ? esc(new Date(ms).toLocaleDateString()) : '—';

  let body;
  if (!s) {
    body = '<div class="empty-state" style="padding:12px 0">The first registration check is pending.</div>';
  } else {
    const note = expiryStateNote(s);
    const left = s.expires
      ? (s.daysLeft < 0 ? `expired ${Math.abs(s.daysLeft)} day${Math.abs(s.daysLeft) === 1 ? '' : 's'} ago` : `${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'} left`)
      : '—';
    const flagged = new Set(['client hold', 'server hold', 'redemption period', 'pending delete']);
    const pills = (s.statuses || []).map(t =>
      `<span class="pill ${flagged.has(t) ? 'p-red' : 'p-gray'}" style="font-size:10px;margin:0 4px 4px 0">${esc(t)}</span>`).join('');

    body = `
      ${s.ok ? '' : `<div style="font-size:12px;color:var(--red);margin-bottom:10px">Last check failed: ${esc(s.error)}</div>`}
      ${note ? `<div style="font-size:12px;color:var(--text-3);margin-bottom:10px">${esc(note)}</div>` : ''}
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:14px">
        ${cell('Status', `<span style="color:${color[s.status] || 'var(--text-3)'};font-weight:600">${esc(s.status)}</span>${s.expires ? ' · ' + esc(left) : ''}`)}
        ${s.registeredDomain ? cell('Registered as', esc(s.registeredDomain), true) : ''}
        ${s.expires || s.registrar ? cell('Expires', date(s.expires)) : ''}
        ${s.registrar ? cell('Registrar', esc(s.registrar)) : ''}
        ${s.registered ? cell('Registered', date(s.registered)) : ''}
        ${s.updated ? cell('Last changed', date(s.updated)) : ''}
        ${s.server ? cell('Registry server', esc(s.server), true) : ''}
        ${cell('Last checked', esc(ts(s.ts)))}
      </div>
      ${pills ? `<div style="margin-top:12px"><div style="font-size:11px;color:var(--text-3);margin-bottom:4px">Registry status</div>${pills}</div>` : ''}`;
  }

  return `
    <div class="section" style="margin-bottom:16px">
      <div class="section-hdr">
        <div class="section-ico" style="background:var(--blue-light)">🌐</div>
        <span class="section-title">Domain Registration</span>
        <span class="section-sub">warns at ${esc((entry.expiry.warnDays || []).join(', '))} days</span>
      </div>
      <div style="padding:12px 4px">${body}</div>
    </div>`;
}

/** One registration event in the change history. */
function renderExpiryEventCard(c, esc, ts) {
  const color = { expiring: 'var(--yellow)', expired: 'var(--red)', error: 'var(--red)', notfound: 'var(--red)', lifecycle: 'var(--red)',
                  reregistered: 'var(--red)', renewed: 'var(--green)', recovered: 'var(--green)' };
  const label = { expiring: 'Expiring', expired: 'Expired', error: 'Check failing', notfound: 'Not registered', lifecycle: 'Registry status',
                  reregistered: 'Registered again', renewed: 'Renewed', recovered: 'Recovered' };
  return `<div style="border:1px solid var(--border);border-radius:6px;padding:12px;margin-bottom:8px;background:var(--surface)">
    <div style="font-size:11px;color:var(--text-3);margin-bottom:8px">${esc(ts(c.ts))} · domain registration</div>
    ${(c.expiryEvents || []).map(ev => `<div style="font-size:12px;color:${color[ev.type] || 'var(--text)'};margin-bottom:3px">
      <span style="font-weight:600">${esc(label[ev.type] || ev.type)}</span> ${esc(ev.message)}
    </div>`).join('')}
  </div>`;
}
