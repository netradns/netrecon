// NetRecon Stats — Tool Usage
// Renders the tool usage bar chart and top-level stat cards

'use strict';

const TOOLS = [
  { key: 'dns',   label: 'DNS / IP Lookup', color: '#7c3aed' },
  { key: 'idns',  label: 'Internal DNS',    color: '#d97706' },
  { key: 'ip',    label: 'IP Geolocation',  color: '#059669' },
  { key: 'calc',  label: 'IP Calculator',   color: '#2563eb' },
  { key: 'cloud', label: 'Cloud CIDR',      color: '#0891b2' },
];

function renderUsage() {
  const stats = getStats();
  const qs    = _serverStats.queryStats || {};
  const total = TOOLS.reduce((a, t) => a + (stats[t.key] || 0), 0);

  // Top stat cards
  el('total-label').textContent = fmtNum(total) + ' total';
  el('sc-total').textContent    = fmtNum(total);
  el('sc-dns').textContent      = fmtNum(stats.dns  || 0);
  el('sc-idns').textContent     = fmtNum(stats.idns || 0);
  el('sc-ip').textContent       = fmtNum(stats.ip   || 0);

  // Enhanced stats from server
  el('sc-avgms').textContent = qs.avgResponseMs ? qs.avgResponseMs + 'ms' : '—';
  if (qs.totalQueries > 0) {
    const rate = Math.round((qs.successCount / qs.totalQueries) * 100);
    el('sc-success').textContent     = rate + '%';
    el('sc-success-sub').textContent = qs.failCount + ' failed of ' + fmtNum(qs.totalQueries);
  } else {
    el('sc-success').textContent = '—';
  }

  // Usage bars
  const max = Math.max(...TOOLS.map(t => stats[t.key] || 0), 1);
  el('usage-list').innerHTML = TOOLS.map(t => {
    const count = stats[t.key] || 0;
    const pct   = Math.round((count / max) * 100);
    const pctOf = total > 0 ? Math.round((count / total) * 100) : 0;
    return `<div class="usage-row">
      <span class="usage-name">${t.label}</span>
      <div class="usage-bar-wrap"><div class="usage-bar" style="width:${pct}%;background:${t.color}"></div></div>
      <span class="usage-count">${fmtNum(count)}</span>
      <span class="usage-pct">${pctOf}%</span>
    </div>`;
  }).join('');
}
