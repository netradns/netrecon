// ── NetRecon — Blacklist Check Card ──────────────────────────────
// Renders the DNSBL blacklist check results as a card in DNS results.
// Called by dns.js after the main lookup completes for domains with A records.
//
// This file only handles rendering — the API call is made by dns.js.

'use strict';

/**
 * Fetches blacklist results for an IP address.
 * @param {string} ip - IPv4 address
 * @returns {Promise<Object|null>} { ip, results, listed, total } or null on error
 */
async function fetchBlacklist(ip) {
  try {
    var r = await fetch('/api/blacklist?ip=' + encodeURIComponent(ip), { cache: 'no-store' });
    if (!r.ok) { console.warn('[blacklist] HTTP ' + r.status); return null; }
    return await r.json();
  } catch (e) { console.error('[blacklist] fetch error:', e.message); return null; }
}

/**
 * Renders the blacklist check card HTML.
 * @param {Object} data - Response from /api/blacklist
 * @param {number} delay - Animation delay in ms
 * @returns {string} HTML string for the card
 */
function renderBlacklistCard(data, delay) {
  if (!data || !data.results) {
    return card('sec-bl', 'var(--ico-yellow)', '🛡', 'Blacklist Check', 'DNSBL Reputation', 0,
      '<div class="empty-s">Blacklist check unavailable</div>', delay);
  }

  var listed = data.results.filter(function(r) { return r.listed; });
  var clean  = data.results.filter(function(r) { return !r.listed; });

  var body = '<table class="dt"><thead><tr><th>Blocklist</th><th>Status</th><th></th></tr></thead><tbody>';
  data.results.forEach(function(r) {
    var statusPill = r.listed
      ? pill('Listed', 'p-red')
      : r.result === 'timeout'
        ? pill('Timeout', 'p-yellow')
        : pill('Clean', 'p-green');
    var link = r.infoUrl
      ? '<a href="' + h(r.infoUrl) + '" target="_blank" rel="noopener" style="font-size:11px;color:var(--blue);text-decoration:none">Check ↗</a>'
      : '';
    body += '<tr><td class="cm">' + h(r.name) + '</td><td>' + statusPill + '</td><td>' + link + '</td></tr>';
  });
  body += '</tbody></table>';

  var subtitle = listed.length > 0
    ? listed.length + ' of ' + data.total + ' blocklists'
    : 'Clean on all ' + data.total + ' blocklists';

  return card('sec-bl', listed.length > 0 ? 'var(--red-light)' : 'var(--ico-green)', '🛡',
    'Blacklist Check', subtitle, undefined, body, delay);
}
