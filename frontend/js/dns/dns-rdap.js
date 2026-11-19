// NetRecon - Domain Registration card for public DNS lookups
// Shows who the registrar is and when the domain registration expires.
//
// The server (dns-proxy/lib/rdap.js) answers with one of these statuses:
//   ok           found. May have no expiry date (some registries do not publish one)
//   notfound     the registry has no such domain
//   unsupported  the TLD has no RDAP service (for example .io, .de, .us)
//   error        the registry could not be reached in time
//   invalid      not a domain name (an IP address, for example). No card is shown.
//
// This file only renders. dns.js starts the request.
'use strict';

// How long the lookup page waits for a registry before giving up on this card.
// The other cards are never held back by it.
var RDAP_WAIT_MS = 7000;

/**
 * Fetches registration details for a domain.
 * @param {string} domain
 * @returns {Promise<Object|null>} Result object, or null when the request failed
 */
async function fetchRdap(domain) {
  var ctl = new AbortController();
  var timer = setTimeout(function() { ctl.abort(); }, RDAP_WAIT_MS);
  try {
    var r = await fetch('/api/rdap?domain=' + encodeURIComponent(domain), { cache: 'no-store', signal: ctl.signal });
    if (!r.ok) { console.warn('[rdap] HTTP ' + r.status); return null; }
    return await r.json();
  } catch (e) {
    console.warn('[rdap] ' + (e.name === 'AbortError' ? 'timed out' : e.message));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function rdapCell(label, valueHtml) {
  return '<div class="ip-cell"><div class="ip-lbl">' + label + '</div><div class="ip-val">' + valueHtml + '</div></div>';
}

function rdapDate(ms) {
  return h(new Date(ms).toLocaleDateString());
}

// Registry status codes that mean the domain is not working or is about to be lost
var RDAP_BAD_STATUS = ['client hold', 'server hold', 'redemption period', 'pending delete'];

/**
 * Renders the Domain Registration card.
 * @param {Object|null} data   - Response from /api/rdap
 * @param {string}      domain - The name that was looked up
 * @param {number}      delay  - Animation delay in ms
 * @returns {string} HTML for the card, or '' when there is nothing useful to show
 */
function renderRdapCard(data, domain, delay) {
  var sub = 'Registrar and expiry';
  var ico = 'var(--ico-blue)';
  var glyph = '\u2616';
  function note(text) {
    return '<div class="empty-s">' + text + '</div>';
  }
  if (!data) {
    return card('sec-rdap', ico, glyph, 'Domain Registration', sub, undefined, note('Registration details are unavailable right now.'), delay);
  }
  if (data.status === 'invalid') return '';
  if (data.status === 'unsupported') {
    return card('sec-rdap', ico, glyph, 'Domain Registration', sub, undefined,
      note('The registry for .' + h(data.tld || '') + ' does not publish registration data over RDAP, so the expiry date cannot be shown.'), delay);
  }
  if (data.status === 'notfound') {
    return card('sec-rdap', ico, glyph, 'Domain Registration', sub, undefined,
      note('The registry has no registration for ' + h(data.domain || domain) + '. It may be unregistered, or the name may be mistyped.'), delay);
  }
  if (data.status !== 'ok') {
    return card('sec-rdap', ico, glyph, 'Domain Registration', sub, undefined,
      note(h(data.message || 'Registration details are unavailable right now.')), delay);
  }

  var cells = '';
  // Expiry first, since it is what people come here for
  if (data.expires) {
    var days = data.daysLeft;
    var cls  = days < 0 ? 'p-red' : days <= 30 ? 'p-red' : days <= 60 ? 'p-yellow' : 'p-green';
    var text = days < 0 ? 'expired ' + Math.abs(days) + ' day' + (days === -1 ? '' : 's') + ' ago'
                        : days + ' day' + (days === 1 ? '' : 's') + ' left';
    cells += rdapCell('Expires', rdapDate(data.expires) + ' ' + pill(text, cls));
  } else {
    cells += rdapCell('Expires', '<span style="color:var(--text-3)">Not published by this registry</span>');
  }
  if (data.registered) cells += rdapCell('Registered', rdapDate(data.registered));
  if (data.registrar)  cells += rdapCell('Registrar', h(data.registrar));
  if (data.updated)    cells += rdapCell('Last changed', rdapDate(data.updated));
  if (data.registeredDomain && data.registeredDomain !== String(domain).toLowerCase()) {
    cells += rdapCell('Registered as', h(data.registeredDomain));
  }
  if (data.server) cells += rdapCell('Registry server', h(data.server));

  var body = '<div class="ip-grid">' + cells + '</div>';
  if (data.statuses && data.statuses.length) {
    var pills = data.statuses.map(function(s) {
      return pill(s, RDAP_BAD_STATUS.indexOf(s) >= 0 ? 'p-red' : 'p-gray');
    }).join(' ');
    body += '<div style="padding:12px 18px"><div class="ip-lbl" style="margin-bottom:6px">Registry status</div>' + pills + '</div>';
  }
  return card('sec-rdap', ico, glyph, 'Domain Registration', sub, undefined, body, delay);
}
