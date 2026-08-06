// NetRecon Stats — Error Tracking

'use strict';

function renderErrors() {
  const qs      = _serverStats.queryStats || {};
  const errs    = qs.errorCounts || {};
  const entries = Object.entries(errs).sort((a, b) => b[1] - a[1]);
  const total   = entries.reduce((a, e) => a + e[1], 0);

  el('err-total').textContent = fmtNum(total) + ' total';

  if (!entries.length) {
    el('error-list').innerHTML = '<div class="empty-state" style="color:var(--green)">No errors recorded. All clear.</div>';
    return;
  }

  const maxCount = entries[0][1];
  el('error-list').innerHTML = entries.map(([code, count]) => {
    const pct = Math.round((count / maxCount) * 100);
    return `<div class="usage-row">
      <span class="usage-name" style="width:140px;font-family:'DM Mono',monospace;font-size:12px;color:var(--red)">${code}</span>
      <div class="usage-bar-wrap"><div class="usage-bar" style="width:${pct}%;background:var(--red)"></div></div>
      <span class="usage-count">${fmtNum(count)}</span>
    </div>`;
  }).join('');
}
