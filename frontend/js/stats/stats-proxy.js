// NetRecon Stats — DNS Proxy Health
// Checks /api/internal-dns/health and updates the proxy section

'use strict';

async function checkProxy() {
  // First check if internal DNS is enabled via app config
  try {
    const cfgR = await fetch('/api/app-config', { cache: 'no-store' });
    if (cfgR.ok) {
      const cfg = await cfgR.json();
      const proxySection = document.getElementById('proxy-section');
      if (cfg.internalDnsEnabled === false) {
        if (proxySection) proxySection.style.display = 'none';
        return;
      } else {
        if (proxySection) proxySection.style.display = '';
      }
    }
  } catch {}

  const t0 = performance.now();
  try {
    const r = await fetch('/api/internal-dns/health', { cache: 'no-store' });
    const ping = Math.round(performance.now() - t0);
    if (!r.ok) throw new Error('non-200');
    const d = await r.json();

    // If no DNS servers configured, show as "Not Configured" rather than online
    if (!d.servers || d.servers.length === 0) {
      el('proxy-status').textContent = 'Not Configured';
      el('proxy-status').className   = 'proxy-val';
      el('proxy-servers').textContent = 'None — set DNS_SERVERS in docker-compose.yml';
      el('proxy-ping').textContent   = '—';
      el('proxy-ping-bar').style.width = '0%';
      el('proxy-checked').textContent  = new Date().toLocaleTimeString();
      el('proxy-updated').textContent  = 'Checked ' + new Date().toLocaleTimeString();
      el('proxy-error').style.display  = 'none';

      const dot = el('sb-idns-dot');
      const lbl = el('sb-idns-lbl');
      if (dot) { dot.style.background = 'var(--sb-label)'; dot.style.boxShadow = 'none'; }
      if (lbl) lbl.textContent = 'Not configured';
      return;
    }

    el('proxy-status').textContent = 'Reachable';
    el('proxy-status').className   = 'proxy-val up';
    el('proxy-servers').textContent = (d.servers || []).join(', ') || '—';
    if (el('proxy-public')) el('proxy-public').textContent = (d.publicDns || []).join(', ') || '—';
    el('proxy-ping').textContent   = ping + 'ms';
    el('proxy-ping').className     = 'proxy-val' + (ping < 100 ? ' up' : ping < 500 ? '' : ' down');
    el('proxy-ping-bar').style.width      = Math.min(ping / 5, 100) + '%';
    el('proxy-ping-bar').style.background = ping < 100 ? 'var(--green)' : ping < 500 ? 'var(--yellow)' : 'var(--red)';
    el('proxy-checked').textContent  = new Date().toLocaleTimeString();
    el('proxy-updated').textContent  = 'Updated ' + new Date().toLocaleTimeString();
    el('proxy-error').style.display  = 'none';

    // Sidebar status dot
    const dot = el('sb-idns-dot');
    const lbl = el('sb-idns-lbl');
    if (dot) { dot.style.background = '#10b981'; dot.style.boxShadow = '0 0 6px #10b981'; }
    if (lbl) lbl.textContent = 'Connected';

  } catch {
    el('proxy-status').textContent  = 'Unreachable';
    el('proxy-status').className    = 'proxy-val down';
    el('proxy-ping').textContent    = '—';
    el('proxy-checked').textContent = new Date().toLocaleTimeString();
    el('proxy-updated').textContent = 'Failed ' + new Date().toLocaleTimeString();
    el('proxy-error').style.display = 'block';

    const dot = el('sb-idns-dot');
    const lbl = el('sb-idns-lbl');
    if (dot) { dot.style.background = 'var(--red)'; dot.style.boxShadow = '0 0 6px var(--red)'; }
    if (lbl) lbl.textContent = 'Unreachable';
  }
}
