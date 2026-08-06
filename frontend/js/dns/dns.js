// NetRecon — DNS / IP Lookup — matches netrecon-old exactly

'use strict';

var DNS_QUICK_LINKS = ['example.com','github.com','google.com','microsoft.com','cloudflare.com'];

// ── Leaflet map instance ─────────────────────────────────────
var _mapInstance = null;
function destroyMap() {
  if (_mapInstance) { _mapInstance.remove(); _mapInstance = null; }
}

// ── Progress bar ─────────────────────────────────────────────
function prog(pct) {
  var pb = document.getElementById('pb');
  if (pb) pb.style.width = pct + '%';
}

// ── Reset run button ─────────────────────────────────────────
function resetBtn() {
  var btn = document.getElementById('dnsBtn');
  if (!btn) return;
  btn.disabled = false;
  btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 15 15" fill="none">' +
    '<circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" stroke-width="1.6"/>' +
    '<line x1="9.8" y1="9.8" x2="13" y2="13" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>' +
    '</svg> Run Lookup';
}

// ── DNS query — uses local nginx proxy (server-side resolution) ──
// All DNS queries go through the dns-proxy container which uses
// configurable public resolvers (default: 1.1.1.1, 8.8.8.8).
// This is the correct enterprise pattern — no direct browser→DNS calls.
async function dnsQ(name, type) {
  try {
    var r = await fetch('/api/dns-query?name=' + encodeURIComponent(name) + '&type=' + type, {
      cache: 'no-store'
    });
    if (!r.ok) return [];
    var d = await r.json();
    return d.Answer || [];
  } catch(e) { return null; }
}

// ── Multi-type DNS query — resolves all types in one request ─────
// Uses /api/dns-query-multi which fires all queries in parallel
// server-side, cutting lookup time from ~6s to ~300ms.
async function dnsQMulti(name) {
  try {
    var r = await fetch('/api/dns-query-multi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name,
        types: ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SOA', 'CAA'],
        emailSecurity: true
      }),
      cache: 'no-store'
    });
    if (!r.ok) return null;
    return await r.json();
  } catch(e) { return null; }
}

// ── IP geolocation — server-side via dns-proxy (avoids CORS) ────
// Cache capped at 100 entries to prevent unbounded memory growth
var _ic = {};
var _icCount = 0;
async function ipI(ip) {
  if (_ic[ip]) return _ic[ip];
  try {
    var r = await fetch('/api/geo?ip=' + encodeURIComponent(ip), { cache: 'no-store' });
    if (!r.ok) return null;
    var d = await r.json();
    if (d && !d.error && d.ip) {
      if (_icCount >= 100) { _ic = {}; _icCount = 0; } // evict all when full
      _ic[ip] = d;
      _icCount++;
      return d;
    }
  } catch(e) {}
  return null;
}

// ── Country flag emoji — correct regional indicator formula ──────
function flag(cc) {
  if (!cc || cc.length !== 2) return '';
  // Regional indicator symbols start at U+1F1E6 (for 'A')
  return String.fromCodePoint(
    0x1F1E6 + cc.toUpperCase().charCodeAt(0) - 65,
    0x1F1E6 + cc.toUpperCase().charCodeAt(1) - 65
  );
}

// ── TXT record classifier — matches old version exactly ──────────
function classifyTxt(txt) {
  if (txt.startsWith('v=spf1'))   return 'SPF';
  if (txt.startsWith('v=DMARC1')) return 'DMARC';
  if (txt.startsWith('v=DKIM1') || (txt.includes('p=') && txt.includes('k='))) return 'DKIM';
  if (txt.includes('google-site-verification') || txt.toLowerCase().includes('google')) return 'Google';
  if (txt.includes('MS=') || txt.toLowerCase().includes('microsoft')) return 'MS';
  if (txt.includes('apple-domain')) return 'Apple';
  return null;
}

function txtPill(label) {
  var cls = { SPF: 'p-green', DKIM: 'p-blue', DMARC: 'p-purple', MS: 'p-blue', Google: 'p-green', Apple: 'p-gray' };
  return pill(label, cls[label] || 'p-gray');
}

// ── SPF breakdown footer ──────────────────────────────────────
function spfBd(spf) {
  var mechs = spf.split(/\s+/).filter(Boolean);
  var html = '<div class="spf-bd"><div class="spf-ttl">SPF Mechanisms</div><div class="spf-mechs">';
  mechs.forEach(function(m) {
    var cls = 'p-gray';
    if (/^ip[46]:/.test(m))    cls = 'p-blue';
    else if (/^include:/.test(m)) cls = 'p-purple';
    else if (/^a[:$]/.test(m) || m === 'a') cls = 'p-green';
    else if (/^mx/.test(m))    cls = 'p-teal';
    else if (/^[~\-+?]?all$/.test(m)) cls = m.startsWith('-') ? 'p-red' : m.startsWith('~') ? 'p-yellow' : 'p-green';
    html += pill(m, cls);
  });
  return html + '</div></div>';
}

// ── DKIM probe — filters for records with p= key (matches old version) ──────
async function probeDkim(domain) {
  var selectors = ['default','google','selector1','selector2','mail','dkim','k1','s1','s2','smtp','zoho','mandrill'];
  var found = [];
  await Promise.all(selectors.map(async function(s) {
    var ans = await dnsQ(s + '._domainkey.' + domain, 'TXT');
    if (ans && ans.length) {
      var rec = ans.find(function(r) { return r.data && r.data.includes('p='); });
      if (rec) found.push({ selector: s, data: rec.data, ttl: rec.TTL });
    }
  }));
  return found;
}

// ── Empty / error state helpers ───────────────────────────────
function emptyS(msg) {
  return '<div class="empty-s">' + (msg ? h(msg) : 'No records found') + '</div>';
}
function errS(msg) {
  return '<div class="error-s">⚠ ' + h(msg) + '</div>';
}

// ── Main entry point ──────────────────────────────────────────
async function runLookup() {
  var input = document.getElementById('domainInput');
  var raw = input ? input.value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim() : '';
  if (!raw) return;

  var btn = document.getElementById('dnsBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<div class="spin" style="border-top-color:#fff;border-color:rgba(255,255,255,.25)"></div>&nbsp;Looking up\u2026';
  }

  destroyMap();
  document.getElementById('dns-results').innerHTML =
    '<div class="load-s"><div class="spin"></div>Resolving ' + h(raw) + '\u2026</div>';
  document.getElementById('pw').classList.add('on');
  prog(5);

  // IP lookup branch
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(raw)) {
    await ipLookup(raw);
    resetBtn();
    return;
  }

  // Domain lookup — use multi endpoint for one fast parallel request
  prog(20);
  var multi = await dnsQMulti(raw);
  prog(62);

  if (!multi) {
    document.getElementById('dns-results').innerHTML = '<div class="error-s">⚠ DNS lookup failed. Check that the dns-proxy container is running.</div>';
    prog(100);
    setTimeout(function() { document.getElementById('pw').classList.remove('on'); prog(0); }, 400);
    resetBtn();
    return;
  }

  var results = multi.results || {};
  var emailSec = multi.emailSecurity || {};

  // Map multi results to the format renderDnsResults expects
  var aRecs     = results.A     || [];
  var aaaaRecs  = results.AAAA  || [];
  var cnameRecs = results.CNAME || [];
  var mxRecs    = results.MX    || [];
  var txtRecs   = results.TXT   || [];
  var nsRecs    = results.NS    || [];
  var soaRecs   = results.SOA   || [];
  var caaRecs   = results.CAA   || [];

  // DMARC from emailSecurity
  var dmarcRecs = (emailSec['DMARC'] && emailSec['DMARC'].records) || [];

  // DKIM — use results from emailSecurity (multi endpoint already probed default selector)
  // Only probe additional selectors if the multi endpoint found nothing
  var dkimFromMulti = (emailSec['DKIM (default)'] && emailSec['DKIM (default)'].records) || [];
  prog(75);
  var dkimRecs = dkimFromMulti.length ? dkimFromMulti.map(function(r) { return { selector: 'default', data: r.data, ttl: r.ttl || r.TTL }; }) : await probeDkim(raw);

  // Geo-enrich A records
  var geoData = (aRecs && aRecs.length) ? await Promise.all(aRecs.map(function(r) { return ipI(r.data); })) : [];
  prog(85);

  renderDnsResults(raw, { aRecs, aaaaRecs, cnameRecs, mxRecs, txtRecs, nsRecs, soaRecs, caaRecs, dmarcRecs, dkimRecs, geoData });

  // Fire blacklist + TLS checks in parallel (non-blocking — append cards when ready)
  var firstIp = (aRecs && aRecs.length) ? aRecs[0].data : null;
  Promise.all([
    firstIp ? fetchBlacklist(firstIp) : Promise.resolve(null),
    fetchTlsCheck(raw),
  ]).then(function(results) {
    var container = document.getElementById('dns-results');
    if (!container) return;
    var resultsDiv = container.querySelector('.results');
    if (!resultsDiv) return;

    // Append blacklist card
    var blHtml = renderBlacklistCard(results[0], 200);
    if (blHtml) {
      var blDiv = document.createElement('div');
      blDiv.innerHTML = blHtml;
      while (blDiv.firstChild) resultsDiv.appendChild(blDiv.firstChild);
    }

    // Append TLS card
    var tlsHtml = renderTlsCard(results[1], raw, 240);
    if (tlsHtml) {
      var tlsDiv = document.createElement('div');
      tlsDiv.innerHTML = tlsHtml;
      while (tlsDiv.firstChild) resultsDiv.appendChild(tlsDiv.firstChild);
    }

    // Inject copy buttons for the new cards
    if (typeof injectCopyButtons === 'function') injectCopyButtons(container);
  });

  prog(100);
  setTimeout(function() {
    document.getElementById('pw').classList.remove('on');
    prog(0);
  }, 400);
  resetBtn();
}

// ── IP lookup ─────────────────────────────────────────────────
async function ipLookup(ip) {
  prog(40);
  var isIPv6 = ip.includes(':');
  var arpa;
  if (isIPv6) {
    // IPv6 PTR: fully expand address, reverse nibbles, append .ip6.arpa
    try {
      // Expand :: shorthand
      var addr = ip;
      if (addr.includes('::')) {
        var sides = addr.split('::');
        var left  = sides[0] ? sides[0].split(':') : [];
        var right = sides[1] ? sides[1].split(':') : [];
        var missing = 8 - left.length - right.length;
        var middle = Array(missing).fill('0000');
        addr = left.concat(middle, right).join(':');
      }
      // Pad each group to 4 hex digits
      var expanded = addr.split(':').map(function(g) { return g.padStart(4, '0'); }).join('');
      arpa = expanded.split('').reverse().join('.') + '.ip6.arpa';
    } catch(e) { arpa = null; }
  } else {
    arpa = ip.split('.').reverse().join('.') + '.in-addr.arpa';
  }
  var [geo, ptrRecs] = await Promise.all([
    ipI(ip),
    arpa ? dnsQ(arpa, 'PTR') : Promise.resolve([])
  ]);
  prog(90);
  renderIpResults(ip, geo, ptrRecs);
  prog(100);
  setTimeout(function() {
    document.getElementById('pw').classList.remove('on');
    prog(0);
  }, 400);
}

// ── Quick link ────────────────────────────────────────────────
function dnsQuick(domain) {
  var input = document.getElementById('domainInput');
  if (input) { input.value = domain; runLookup(); }
}

// ── Direct IP lookup — bypasses domain validation (for IPv6 clicks) ──
function ipLookupDirect(ip) {
  var input = document.getElementById('domainInput');
  if (input) input.value = ip;
  destroyMap();
  document.getElementById('dns-results').innerHTML =
    '<div class="load-s"><div class="spin"></div>Looking up ' + h(ip) + '\u2026</div>';
  document.getElementById('pw').classList.add('on');
  prog(5);
  var btn = document.getElementById('dnsBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<div class="spin" style="border-top-color:#fff;border-color:rgba(255,255,255,.25)"></div>&nbsp;Looking up\u2026';
  }
  ipLookup(ip).then(function() { resetBtn(); });
}

// ── Enter key ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  var input = document.getElementById('domainInput');
  if (input) input.addEventListener('keydown', function(e) { if (e.key === 'Enter') runLookup(); });
});
