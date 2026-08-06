// NetRecon Stats — Nginx Status
// Fetches /nginx_status and parses the stub_status response

'use strict';

async function fetchNginx() {
  try {
    const r = await fetch('/nginx_status', { cache: 'no-store' });
    if (!r.ok) throw new Error();
    const t = await r.text();

    const active   = (t.match(/Active connections:\s*(\d+)/) || [])[1];
    const nums     = t.match(/\n\s*(\d+)\s+(\d+)\s+(\d+)/) || [];
    const accepts  = nums[1], handled = nums[2], requests = nums[3];
    const reading  = (t.match(/Reading:\s*(\d+)/) || [])[1];
    const writing  = (t.match(/Writing:\s*(\d+)/) || [])[1];
    const waiting  = (t.match(/Waiting:\s*(\d+)/) || [])[1];
    const dropped  = (accepts && handled) ? parseInt(accepts) - parseInt(handled) : 0;

    el('ng-active').textContent   = fmtNum(active);
    el('ng-waiting').textContent  = waiting;
    el('ng-reading').textContent  = reading;
    el('ng-writing').textContent  = writing;
    el('ng-requests').textContent = fmtNum(requests);
    el('ng-dropped').textContent  = fmtNum(dropped);
    el('ng-active').className     = 'nginx-val' + (parseInt(active) > 0 ? ' up' : '');
    el('sc-nginx').textContent    = fmtNum(active);
    el('sc-reqs').textContent     = fmtNum(requests);
    el('nginx-updated').textContent     = new Date().toLocaleTimeString();
    el('nginx-error').style.display     = 'none';

  } catch {
    el('nginx-error').style.display = 'block';
    el('sc-nginx').textContent = 'N/A';
    el('sc-reqs').textContent  = 'N/A';
  }
}
