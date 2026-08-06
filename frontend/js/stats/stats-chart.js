// NetRecon Stats — Hourly Volume Chart
// Renders an SVG bar chart of query volume for the last 24 hours

'use strict';

function renderHourlyVolume() {
  const qs = _serverStats.queryStats || {};
  const hv = qs.hourlyVolume || {};

  // Build array of last 24 hour keys (ISO format: "2026-04-22T14")
  const now   = new Date();
  const hours = [];
  for (let i = 23; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 3600000);
    hours.push(d.toISOString().slice(0, 13));
  }

  const values  = hours.map(h => hv[h] || 0);
  const maxVal  = Math.max(...values, 1);
  const total24 = values.reduce((a, v) => a + v, 0);

  el('vol-total').textContent = fmtNum(total24) + ' queries';

  if (total24 === 0) {
    el('hourly-chart').innerHTML = '<div class="empty-state">No query volume data yet.</div>';
    return;
  }

  const barWidth   = 18;
  const gap        = 3;
  const chartH     = 80;
  const svgWidth   = hours.length * (barWidth + gap);

  let svg = `<svg width="${svgWidth}" height="${chartH + 24}" style="display:block;min-width:${svgWidth}px;">`;

  values.forEach((v, i) => {
    const h       = Math.max((v / maxVal) * chartH, v > 0 ? 3 : 0);
    const x       = i * (barWidth + gap);
    const y       = chartH - h;
    const opacity = v > 0 ? 0.7 + (v / maxVal) * 0.3 : 0.15;

    svg += `<rect x="${x}" y="${y}" width="${barWidth}" height="${h}" rx="2" fill="var(--blue)" opacity="${opacity}"/>`;

    // Hour label every 3 hours
    if (i % 3 === 0) {
      const label = hours[i].slice(11, 13) + ':00';
      svg += `<text x="${x + barWidth / 2}" y="${chartH + 14}" text-anchor="middle" fill="var(--text-3)" font-size="9" font-family="'DM Mono',monospace">${label}</text>`;
    }

    // Value on top of bar if > 0
    if (v > 0) {
      svg += `<text x="${x + barWidth / 2}" y="${y - 3}" text-anchor="middle" fill="var(--text-3)" font-size="9" font-family="'DM Mono',monospace">${v}</text>`;
    }
  });

  svg += '</svg>';
  el('hourly-chart').innerHTML = svg;
}
