// ── NetRecon — TLS Certificate Card ──────────────────────────────
// Renders the SSL/TLS certificate inspection results as a card.
// Called by dns.js after the main lookup completes for domain lookups.
//
// This file only handles rendering — the API call is made by dns.js.

'use strict';

/**
 * Fetches TLS certificate details for a domain.
 * @param {string} domain
 * @returns {Promise<Object|null>} Certificate details or null on error
 */
async function fetchTlsCheck(domain) {
  try {
    var r = await fetch('/api/tls-check?domain=' + encodeURIComponent(domain), { cache: 'no-store' });
    if (!r.ok) { console.warn('[tls-check] HTTP ' + r.status); return null; }
    return await r.json();
  } catch (e) { console.error('[tls-check] fetch error:', e.message); return null; }
}

/**
 * Renders the TLS certificate card HTML.
 * Uses the same padding/border patterns as other DNS result cards
 * (ip-grid for the main fields, spf-bd style for sub-sections).
 *
 * @param {Object} data   - Response from /api/tls-check
 * @param {string} domain - The domain that was checked
 * @param {number} delay  - Animation delay in ms
 * @returns {string} HTML string for the card
 */
function renderTlsCard(data, domain, delay) {
  if (!data || data.error) {
    var errMsg = data && data.error ? h(data.error) : 'Could not connect to ' + h(domain) + ' on port 443';
    return card('sec-tls', 'var(--ico-yellow)', '🔒', 'TLS Certificate', 'SSL/TLS', 0,
      '<div class="empty-s">' + errMsg + '</div>', delay);
  }

  var statusWarn = !data.expired && data.daysLeft <= 30 && data.daysLeft > 7;
  var bgColor    = data.expired ? 'var(--red-light)' : statusWarn ? 'var(--yellow-light)' : 'var(--ico-green)';

  // ── Main info grid (same structure as IP info card) ─────────
  var body = '<div class="ip-grid">';

  var statusLabel = data.expired ? 'Expired' : data.daysLeft <= 30 ? 'Expiring Soon' : 'Valid';
  var statusCls   = data.expired ? 'p-red' : statusWarn ? 'p-yellow' : 'p-green';
  body += '<div class="ip-cell"><div class="ip-lbl">Status</div><div class="ip-val">' + pill(statusLabel, statusCls) + '</div></div>';

  if (data.commonName) body += '<div class="ip-cell"><div class="ip-lbl">Common Name</div><div class="ip-val">' + h(data.commonName) + '</div></div>';
  if (data.issuerOrg)  body += '<div class="ip-cell"><div class="ip-lbl">Issuer</div><div class="ip-val">' + h(data.issuerOrg) + '</div></div>';
  if (data.validFrom)  body += '<div class="ip-cell"><div class="ip-lbl">Valid From</div><div class="ip-val">' + h(data.validFrom) + '</div></div>';
  if (data.validTo)    body += '<div class="ip-cell"><div class="ip-lbl">Valid To</div><div class="ip-val">' + h(data.validTo) + ' <span style="font-size:11px;color:var(--text-3)">(' + data.daysLeft + ' days)</span></div></div>';
  if (data.protocol)   body += '<div class="ip-cell"><div class="ip-lbl">Protocol</div><div class="ip-val">' + h(data.protocol) + '</div></div>';
  if (data.cipher)     body += '<div class="ip-cell"><div class="ip-lbl">Cipher</div><div class="ip-val" style="font-size:11px">' + h(data.cipher) + '</div></div>';
  if (data.fingerprint) body += '<div class="ip-cell" style="grid-column:1/-1"><div class="ip-lbl">SHA-256 Fingerprint</div><div class="ip-val" style="font-size:10px;font-family:\'DM Mono\',monospace;word-break:break-all">' + h(data.fingerprint) + '</div></div>';

  body += '</div>';

  // ── SANs (same padding as spf-bd) ──────────────────────────
  if (data.sans && data.sans.length) {
    body += '<div style="padding:12px 18px;border-top:1px solid var(--border);background:var(--bg)">';
    body += '<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--text-3);margin-bottom:7px">Subject Alternative Names (' + data.sans.length + ')</div>';
    body += '<div style="display:flex;flex-wrap:wrap;gap:5px">';
    data.sans.forEach(function(san) {
      body += pill(san, san.startsWith('*.') ? 'p-purple' : 'p-blue');
    });
    body += '</div></div>';
  }

  // ── Certificate chain (same padding as spf-bd) ─────────────
  if (data.chain && data.chain.length > 1) {
    body += '<div style="padding:12px 18px;border-top:1px solid var(--border);background:var(--bg)">';
    body += '<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--text-3);margin-bottom:7px">Certificate Chain</div>';
    data.chain.forEach(function(c, i) {
      body += '<div style="margin-left:' + (i * 16) + 'px;font-size:12px;padding:3px 0;color:var(--text-2)">';
      body += (i === 0 ? '🔒 ' : '↳ ') + h(c.subject);
      body += '</div>';
    });
    body += '</div>';
  }

  // ── Auth error ─────────────────────────────────────────────
  if (data.authError) {
    body += '<div style="padding:8px 18px;font-size:11px;color:var(--red)">⚠ ' + h(data.authError) + '</div>';
  }

  var subtitle = data.expired ? 'Expired' : data.daysLeft + ' days remaining';
  return card('sec-tls', bgColor, '🔒', 'TLS Certificate', subtitle, undefined, body, delay);
}
