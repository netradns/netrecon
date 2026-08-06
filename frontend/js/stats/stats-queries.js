// NetRecon Stats — Top Queries & Recent Lookups

'use strict';

const TYPE_COLOR = { dns: '#7c3aed', idns: '#d97706', ip: '#059669', calc: '#2563eb', cloud: '#0891b2' };
const TYPE_CLS   = { dns: 'lt-dns', ip: 'lt-ip', idns: 'lt-idns', calc: 'lt-calc', cloud: 'lt-cloud' };
const TYPE_LABEL = { dns: 'DNS', ip: 'IP', idns: 'INT', calc: 'CALC', cloud: 'CLOUD' };

// ── Top Queries ───────────────────────────────────────────────
function renderTopQueries() {
  const history = getHistory();
  if (!history.length) {
    el('top-queries').innerHTML = '<div class="empty-state">No lookups yet.</div>';
    return;
  }

  // Count frequency per type:target pair
  const counts = {};
  history.forEach(item => {
    const key = item.type + ':' + item.target;
    counts[key] = counts[key] || { type: item.type, target: item.target, count: 0 };
    counts[key].count++;
  });

  const sorted   = Object.values(counts).sort((a, b) => b.count - a.count).slice(0, 8);
  const maxCount = sorted[0]?.count || 1;

  el('top-queries').innerHTML = sorted.map((item, i) => {
    const pct   = Math.round((item.count / maxCount) * 100);
    const color = TYPE_COLOR[item.type] || '#888';
    return `<div class="tq-row">
      <span class="tq-rank">${i + 1}</span>
      <span class="tq-target" title="${item.target}">${item.target}</span>
      <div class="tq-bar-wrap"><div class="tq-bar" style="width:${pct}%;background:${color}"></div></div>
      <span class="tq-count">${item.count}×</span>
    </div>`;
  }).join('');
}

// ── Recent Lookups ────────────────────────────────────────────
function hashFor(item) {
  const enc = encodeURIComponent(item.target);
  if (item.type === 'calc')  return `/#calc/${enc}`;
  if (item.type === 'cloud') return `/#cloud/${enc}`;
  if (item.type === 'idns')  return `/#idns/${enc}`;
  if (item.type === 'ip')    return `/#ip/${enc}`;
  return `/#dns/${enc}`;
}

function renderRecent() {
  const history = getHistory();
  if (!history.length) {
    el('recent-list').innerHTML = '<div class="empty-state">No lookups recorded yet. Use the tools in the main app.</div>';
    return;
  }

  el('recent-list').innerHTML = [...history].reverse().slice(0, 15).map(item => {
    const msLabel  = item.responseMs ? `<span style="font-size:10px;color:var(--text-3);font-family:'DM Mono',monospace;margin-left:6px">${item.responseMs}ms</span>` : '';
    const failIcon = item.success === false ? '<span style="color:var(--red);margin-left:4px" title="Failed">✕</span>' : '';
    return `<div class="lookup-row">
      <span class="lookup-type ${TYPE_CLS[item.type] || 'lt-dns'}">${TYPE_LABEL[item.type] || item.type.toUpperCase()}</span>
      <span class="lookup-target" title="${item.target}">${item.target}</span>${failIcon}${msLabel}
      <a class="lookup-link" href="${hashFor(item)}" title="Open in tool">↗</a>
      <span class="lookup-time">${ago(item.ts)}</span>
    </div>`;
  }).join('');
}

// ── Clear history ─────────────────────────────────────────────
async function clearHistory() {
  try { await fetch('/api/internal-dns/stats/clear', { method: 'POST' }); } catch {}
  _serverStats = { counters: {}, history: [] };
  renderUsage();
  renderTopQueries();
  renderRecent();
}
