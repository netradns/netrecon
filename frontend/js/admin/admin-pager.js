// ── NetRecon Admin — Pager ───────────────────────────────────────
// The "Showing 1-25 of 134 · Per page 10 25 50 100 · Newer / Older" bar under a long
// table. Shared by the Activity page and the notification delivery log so both
// page the same way. It only builds HTML: the caller owns the page number and size.
'use strict';

const PAGER_SIZES = [10, 25, 50, 100];

/**
 * @param {Object} o
 * @param {number} o.total   - Rows in the whole list
 * @param {number} o.page    - Current page, counting from 0
 * @param {number} o.size    - Rows per page
 * @param {number} o.shown   - Rows on this page
 * @param {string} o.onPage  - Name of a global function called with -1 (newer) or 1 (older)
 * @param {string} o.onSize  - Name of a global function called with a new page size
 * @returns {string} HTML, or '' when everything fits on one smallest page
 */
function renderPager(o) {
  if (o.total <= PAGER_SIZES[0]) return '';
  const pages = Math.ceil(o.total / o.size);
  const from  = o.page * o.size;
  const sizes = PAGER_SIZES.map(n =>
    `<button class="btn btn-sm ${n === o.size ? 'btn-primary' : 'btn-ghost'}" onclick="${o.onSize}(${n})">${n}</button>`).join('');
  return `<div class="pager" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:12px;padding:0 4px;font-size:12px;color:var(--text-3)">
    <div>Showing ${from + 1}\u2013${from + o.shown} of ${o.total}</div>
    <div style="display:flex;align-items:center;gap:6px">Per page ${sizes}</div>
    <div style="display:flex;align-items:center;gap:8px">
      <button class="btn btn-ghost btn-sm" onclick="${o.onPage}(-1)" ${o.page === 0 ? 'disabled' : ''}>\u2039 Newer</button>
      <span>Page ${o.page + 1} of ${pages}</span>
      <button class="btn btn-ghost btn-sm" onclick="${o.onPage}(1)" ${o.page >= pages - 1 ? 'disabled' : ''}>Older \u203A</button>
    </div></div>`;
}
