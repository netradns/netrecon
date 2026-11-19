// ── NetRecon Admin — Activity feed ───────────────────────────────
// One time-ordered list for the admin Activity page, built when it is asked for
// from three logs that each keep their own history:
//
//   audit log         who signed in and what was changed        (audit.js, up to 1000)
//   delivery log      each notification sent or failed          (notify/log.js, up to 200)
//   watch history     DNS changes and certificate or            (watcher change log, up to 100)
//                     registration events that raised an alert
//
// The logs are merged on read and never copied into each other, so a burst of
// notification deliveries cannot push sign-in history out of the audit log.
//
// Nothing secret is added here. Delivery errors can carry the address of a webhook,
// so web addresses are replaced before they are shown.
'use strict';
const audit = require('./audit');
const { getLog: getDeliveryLog } = require('../notify/log');
const { getWatched }             = require('../watcher/snapshot');

// Groups that come from the other logs (the audit log's own groups are in audit.CATEGORY)
const EXTRA_CATEGORIES = ['delivery', 'alerts'];

const MAX_PAGE = 500;
const ALL      = 100000;    // audit.getLog() clamps this to what the log holds
const DAY_MS   = 86400000;

/** Valid values for the `category` filter. */
function categories() {
  return new Set(Object.values(audit.CATEGORY).concat(EXTRA_CATEGORIES));
}

/** Web addresses can hold secrets (webhook tokens), so they are never shown. */
function hideUrls(text) {
  return String(text || '').replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[address hidden]');
}

// ── Source: notification deliveries ──────────────────────────────
function deliveryEvents() {
  return getDeliveryLog().map(row => {
    const ok = row.ok === 1;
    const ms = row.durationMs != null ? ` (${row.durationMs} ms)` : '';
    const detail = ok
      ? `${row.service}: ${row.event}${ms}`
      : `${row.service}: ${row.event} - ${hideUrls(row.errorMsg) || 'failed'}${ms}`;
    return {
      ts: row.ts, type: ok ? 'notify_ok' : 'notify_failed', category: 'delivery',
      actor: 'system', ip: '', detail: audit.clean(detail, 200), count: 1,
    };
  });
}

// ── Source: alerts raised by watched entries ─────────────────────
function alertDetail(c) {
  if (c.kind === 'cert' || c.kind === 'expiry') {
    const list = c.kind === 'cert' ? c.certEvents : c.expiryEvents;
    return `${c.domain}: ` + (list || []).map(e => e.message).join('; ');
  }
  const changes = c.changes || [];
  const shown = changes.slice(0, 3).map(x => `${x.type === 'added' ? '+' : '-'}${x.recordType} ${x.data}`).join(', ');
  const more  = changes.length > 3 ? ` and ${changes.length - 3} more` : '';
  return `${c.domain}: ${shown}${more}`;
}

function alertEvents() {
  const log = getWatched().changeLog || [];
  return log.map(c => ({
    ts: c.ts,
    type: c.kind === 'cert' ? 'alert_cert' : c.kind === 'expiry' ? 'alert_expiry' : 'alert_dns',
    category: 'alerts', actor: 'system', ip: '',
    detail: audit.clean(alertDetail(c), 200), count: 1,
  }));
}

// ── The merged feed ──────────────────────────────────────────────
/**
 * @param {Object} [opts]
 * @param {string} [opts.category] - One of categories(). Empty means everything.
 * @param {number} [opts.limit]    - Events per page (1 to 500, default 200)
 * @param {number} [opts.offset]   - Events to skip, for paging
 * @returns {{ events: Array, total: number }} `total` counts all matches, not just this page
 */
function getActivity(opts) {
  const o        = opts || {};
  const category = categories().has(o.category) ? o.category : '';
  const limit    = Math.min(Math.max(parseInt(o.limit, 10) || 200, 1), MAX_PAGE);
  const offset   = Math.max(parseInt(o.offset, 10) || 0, 0);

  let all = [];
  if (!category || !EXTRA_CATEGORIES.includes(category)) {
    all = all.concat(audit.getLog({ category: category || undefined, limit: ALL }));
  }
  if (!category || category === 'delivery') all = all.concat(deliveryEvents());
  if (!category || category === 'alerts') {
    // With no filter the audit log's own alert events (a watch that keeps failing) are already in the list
    all = all.concat(alertEvents());
    if (category === 'alerts') all = all.concat(audit.getLog({ category: 'alerts', limit: ALL }));
  }
  all.sort((a, b) => b.ts - a.ts);
  return { events: all.slice(offset, offset + limit), total: all.length };
}

/** Sign-ins, failed attempts and changes in the last 24 hours (audit log only). */
function summary24h(now) {
  const since = (now || Date.now()) - DAY_MS;
  let signIns = 0, failed = 0, changes = 0;
  for (const e of audit.getLog({ limit: ALL })) {
    if (e.ts < since) break;                       // newest first, so everything after is older
    if (e.type === 'login_ok')          signIns += 1;
    else if (e.type === 'login_failed') failed  += e.count || 1;
    else if (['config', 'watch', 'security'].includes(e.category)) changes += 1;
  }
  return { signIns, failed, changes };
}

module.exports = { getActivity, summary24h, categories, hideUrls, MAX_PAGE };
