// NetRecon Stats — Server Info
// Fetches /server_info for nginx version, hostname, server time, and detects browser

'use strict';

async function fetchServerInfo() {
  try {
    const r = await fetch('/server_info', { cache: 'no-store' });
    if (!r.ok) throw new Error();
    const d = await r.json();

    el('si-nginx').textContent = d.nginx    || '—';
    el('si-host').textContent  = d.hostname || '—';
    el('si-time').textContent  = d.time ? new Date(d.time).toLocaleTimeString() : '—';

    // Detect browser from user agent
    const ua = navigator.userAgent;
    let browser = 'Unknown';
    if (ua.includes('Edg'))     browser = 'Edge';
    else if (ua.includes('Chrome'))  browser = 'Chrome';
    else if (ua.includes('Firefox')) browser = 'Firefox';
    else if (ua.includes('Safari'))  browser = 'Safari';
    el('si-browser').textContent = browser;

  } catch { /* server_info endpoint optional */ }
}
