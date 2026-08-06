// NetRecon — Internal DNS Lookup — matches netrecon-old exactly

'use strict';

var IDNS_QUICK_LINKS = [
  { label: 'server.corp.local',   value: 'server.corp.local'   },
  { label: 'dc01.corp.local',     value: 'dc01.corp.local'     }
];

var _idnsType = 'ALL';

// ── Bind Enter key ───────────────────────────────────────────
(function() {
  var inp = document.getElementById('idnsInput');
  if (inp) inp.addEventListener('keydown', function(e) { if (e.key === 'Enter') runIdnsLookup(); });
})();

// ── Init ─────────────────────────────────────────────────────
function initInternalDns() {
  // Use config-provided quick links if available (set by applyAppConfig in index.html),
  // otherwise fall back to the hardcoded defaults above.
  var links = window._configIdnsQuickLinks || IDNS_QUICK_LINKS;
  renderIdnsQuickLinks(links);
  checkIdnsProxy();
}

/**
 * Renders the internal DNS quick link chips.
 * Called on init and again if the config loads after init.
 * @param {Array} links - [{ label, value }]
 */
function renderIdnsQuickLinks(links) {
  var qw = document.getElementById('idns-quick-wrap');
  var qc = document.getElementById('idns-quick-chips');
  if (!qw || !qc) return;
  if (links && links.length) {
    qw.style.display = 'flex';
    qc.innerHTML = links.map(function(l) {
      return '<span class="ql-chip" onclick="idnsQuickLookup(\'' + h(l.value) + '\')">' + h(l.label) + '</span>';
    }).join('');
  } else {
    qw.style.display = 'none';
  }
}

function idnsQuickLookup(val) {
  document.getElementById('idnsInput').value = val;
  runIdnsLookup();
}

// ── Proxy health check ───────────────────────────────────────
// Only runs if internal DNS is enabled (set by applyAppConfig in index.html).
// If disabled, the sidebar dot stays hidden — no health check needed.
async function checkIdnsProxy() {
  // Skip if internal DNS is disabled — the UI elements are hidden
  if (window._idnsEnabled === false) return;

  var dot  = document.getElementById('idns-dot');
  var lbl  = document.getElementById('idns-server-lbl');
  try {
    var r = await fetch('/api/internal-dns/health', { cache: 'no-store' });
    if (!r.ok) throw new Error('non-200');
    if (dot) { dot.style.background = 'var(--green)'; dot.style.boxShadow = '0 0 6px var(--green)'; }
    if (lbl) lbl.textContent = 'Connected';
  } catch(e) {
    if (dot) { dot.style.background = 'var(--red)'; dot.style.boxShadow = '0 0 6px var(--red)'; }
    if (lbl) lbl.textContent = 'Unreachable';
  }
}

// ── Progress ─────────────────────────────────────────────────
function idnsProg(pct) {
  var pb = document.getElementById('idns-pb');
  if (pb) pb.style.width = pct + '%';
}

// ── Run lookup ───────────────────────────────────────────────
async function runIdnsLookup() {
  var raw = (document.getElementById('idnsInput') || {}).value;
  if (!raw) return;
  raw = raw.trim();
  if (!raw) return;

  var btn = document.getElementById('idnsBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<div class="spin" style="border-top-color:#fff;border-color:rgba(255,255,255,.25)"></div>&nbsp;Resolving\u2026';
  }

  var out = document.getElementById('idns-results');
  out.innerHTML = '<div class="load-s"><div class="spin"></div>Resolving ' + h(raw) + ' via internal DNS\u2026</div>';

  var pw = document.getElementById('idns-pw');
  if (pw) pw.classList.add('on');
  idnsProg(15);

  try {
    var r = await fetch('/api/internal-dns/resolve-all?name=' + encodeURIComponent(raw), { cache: 'no-store' });
    idnsProg(70);

    if (!r.ok) {
      var errData = await r.json().catch(function() { return { error: 'HTTP ' + r.status }; });
      throw new Error(errData.error || 'HTTP ' + r.status);
    }

    var d = await r.json();
    idnsProg(90);
    renderIdnsResults(raw, d.records || [], d.server || '');
    if (typeof trackUsage === 'function') trackUsage('idns', raw);

  } catch(err) {
    out.innerHTML = '<div class="results"><div class="card" style="animation:fu .2s ease both">' +
      '<div class="card-hdr" style="cursor:default">' +
      '<div class="ch-ico" style="background:var(--red-light)">&#10005;</div>' +
      '<span class="ch-t">Lookup Failed</span></div>' +
      '<div class="card-body"><div class="error-s">' + h(err.message) +
      '<br><small style="color:var(--text-3);font-size:11px;margin-top:4px;display:block">' +
      'Check that the dns-proxy container is running and DNS_SERVERS is set correctly in docker-compose.yml' +
      '</small></div></div></div></div>';
  }

  idnsProg(100);
  setTimeout(function() {
    if (pw) pw.classList.remove('on');
    idnsProg(0);
  }, 400);

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 15 15" fill="none">' +
      '<circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" stroke-width="1.6"/>' +
      '<line x1="9.8" y1="9.8" x2="13" y2="13" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>' +
      '</svg> Resolve';
  }
}

document.addEventListener('DOMContentLoaded', initInternalDns);
