// NetRecon Stats — Record Type Distribution

'use strict';

const RECORD_COLORS = {
  A: '#2563eb', AAAA: '#7c3aed', MX: '#d97706', TXT: '#059669',
  NS: '#0891b2', CNAME: '#ea580c', SOA: '#db2777', CAA: '#dc2626',
  PTR: '#6366f1', SRV: '#0d9488', ALL: '#64748b'
};

function renderRecordTypes() {
  const qs      = _serverStats.queryStats || {};
  const rtc     = qs.recordTypeCounts || {};
  const entries = Object.entries(rtc).sort((a, b) => b[1] - a[1]);
  const total   = entries.reduce((a, e) => a + e[1], 0);

  el('rt-total').textContent = fmtNum(total) + ' total';

  if (!entries.length) {
    el('record-type-list').innerHTML = '<div class="empty-state">No DNS queries recorded yet.</div>';
    return;
  }

  const maxCount = entries[0][1];
  el('record-type-list').innerHTML = entries.map(([type, count]) => {
    const pct   = Math.round((count / maxCount) * 100);
    const pctOf = total > 0 ? Math.round((count / total) * 100) : 0;
    const color = RECORD_COLORS[type] || '#888';
    return `<div class="usage-row">
      <span class="usage-name" style="width:80px;font-family:'DM Mono',monospace;font-size:12px">${type}</span>
      <div class="usage-bar-wrap"><div class="usage-bar" style="width:${pct}%;background:${color}"></div></div>
      <span class="usage-count">${fmtNum(count)}</span>
      <span class="usage-pct">${pctOf}%</span>
    </div>`;
  }).join('');
}
