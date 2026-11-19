// ── NetRecon — Domain Registration Lookup (RDAP) ─────────────────
// Finds out when a domain registration expires, who the registrar is, and
// whether the domain is on hold, using RDAP (the JSON successor to WHOIS).
//
// How it works:
//   1. IANA publishes which RDAP server handles each TLD (data.iana.org/rdap/dns.json).
//      That list is fetched once a day and kept in memory.
//   2. The registry's RDAP server is asked about the domain.
//   3. If the name is not a registered domain itself (www.example.com), parent
//      names are tried until one is found, so any hostname can be entered.
//
// Honest limits:
//   - Not every TLD has RDAP. At the time of writing .io, .de, .us and .co
//     have no RDAP server, and some registries (for example .nl and .au) answer
//     but do not publish an expiry date. The result says which case applies.
//   - Only the facts needed to watch a registration are kept. Registrant and
//     contact details are never read.
//
// Safety:
//   - Requests go only to https servers named in the IANA list, never to IP
//     addresses, and any address that is private or reserved is refused, so a
//     bad list entry or DNS answer cannot aim this at your network.
//   - Answers are limited in size and time, and results are cached so the same
//     domain does not hit the registry again for hours.

'use strict';

const https = require('https');
const dns   = require('dns');
const net   = require('net');
const { isPrivateAddress } = require('./net-guard');

const BOOTSTRAP_URL   = 'https://data.iana.org/rdap/dns.json';
const BOOTSTRAP_TTL   = 24 * 60 * 60 * 1000;
const RESULT_TTL      = 6 * 60 * 60 * 1000;     // a successful answer
const FAILURE_TTL     = 5 * 60 * 1000;          // an error, so a struggling registry is not hammered
const CACHE_MAX       = 500;
const REQUEST_TIMEOUT = 6000;
const MAX_BYTES       = 1024 * 1024;
const MAX_REDIRECTS   = 3;
const MAX_ATTEMPTS    = 5;                      // names tried when stepping up from a hostname
const TOTAL_BUDGET_MS  = 10000;                  // one lookup never takes longer than this in total

// ── HTTP ──────────────────────────────────────────────────────────

/**
 * DNS lookup that refuses private and reserved addresses.
 * Handles both the single-address and the "all addresses" call styles of Node.
 */
function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, options, (err, address, family) => {
    if (err) return callback(err);
    if (Array.isArray(address)) {
      const allowed = address.filter(a => !isPrivateAddress(a.address));
      return allowed.length ? callback(null, allowed) : callback(new Error('Refusing to connect to a private address'));
    }
    return isPrivateAddress(address)
      ? callback(new Error('Refusing to connect to a private address'))
      : callback(null, address, family);
  });
}

/** Only https URLs to named hosts are allowed. */
function checkUrl(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:')           throw new Error('Only https is allowed');
  if (net.isIP(u.hostname.replace(/^\[|\]$/g, '')) || u.hostname === 'localhost') throw new Error('Hosts must be names, not addresses');
  return u;
}

/**
 * GET a URL and parse the answer as JSON.
 * @returns {Promise<{ status: number, json: Object|null }>}
 */
function httpGetJson(url, redirectsLeft) {
  const left = redirectsLeft === undefined ? MAX_REDIRECTS : redirectsLeft;

  return new Promise((resolve, reject) => {
    let u;
    try { u = checkUrl(url); } catch (err) { return reject(err); }

    const req = https.get(u, {
      headers: { 'Accept': 'application/rdap+json, application/json', 'User-Agent': 'NetRecon/1.0' },
      timeout: REQUEST_TIMEOUT,
      lookup:  safeLookup,
    }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (left <= 0) return reject(new Error('Too many redirects'));
        let next;
        try { next = new URL(res.headers.location, u).toString(); } catch (e) { return reject(e); }
        return httpGetJson(next, left - 1).then(resolve, reject);
      }

      let size = 0;
      const chunks = [];
      res.on('data', c => {
        size += c.length;
        if (size > MAX_BYTES) { req.destroy(new Error('The answer was too large')); return; }
        chunks.push(c);
      });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* empty or not JSON */ }
        resolve({ status: res.statusCode, json });
      });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('The registry did not answer in time')));
    req.on('error', reject);
  });
}

// The function used for requests. Tests replace it with a fake.
let _fetch = httpGetJson;
function setFetcher(fn) { _fetch = fn || httpGetJson; }

// ── IANA bootstrap list ───────────────────────────────────────────
let _bootstrap = null;     // { ts, map: Map(tld -> base url) }
let _bootstrapLoading = null;

/** Turn IANA's list into a Map of TLD to the first https RDAP address. */
function parseBootstrap(json) {
  const map = new Map();
  for (const svc of (json && json.services) || []) {
    const base = (svc[1] || []).find(u => typeof u === 'string' && u.startsWith('https://'));
    if (!base) continue;
    for (const tld of svc[0] || []) map.set(String(tld).toLowerCase(), base.replace(/\/?$/, '/'));
  }
  return map;
}

async function getBootstrap() {
  if (_bootstrap && Date.now() - _bootstrap.ts < BOOTSTRAP_TTL) return _bootstrap.map;
  if (!_bootstrapLoading) {
    _bootstrapLoading = _fetch(BOOTSTRAP_URL)
      .then(r => {
        if (r.status !== 200 || !r.json) throw new Error(`IANA answered HTTP ${r.status}`);
        const map = parseBootstrap(r.json);
        if (!map.size) throw new Error('The IANA list was empty');
        _bootstrap = { ts: Date.now(), map };
        return map;
      })
      .finally(() => { _bootstrapLoading = null; });
  }
  try {
    return await _bootstrapLoading;
  } catch (err) {
    if (_bootstrap) return _bootstrap.map;          // an old list is better than none
    throw err;
  }
}

// ── Parsing an RDAP answer ────────────────────────────────────────

const eventDate = (json, action) => {
  const e = (json.events || []).find(x => x.eventAction === action && x.eventDate);
  const t = e ? Date.parse(e.eventDate) : NaN;
  return Number.isFinite(t) ? t : null;
};

const cleanText = (s, max) => String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

function registrarName(json) {
  for (const ent of json.entities || []) {
    if (!(ent.roles || []).includes('registrar')) continue;
    const fields = (ent.vcardArray && ent.vcardArray[1]) || [];
    const pick = key => (fields.find(f => f[0] === key) || [])[3];
    const name = pick('fn') || pick('org');
    if (name) return cleanText(Array.isArray(name) ? name[0] : name, 120);
  }
  return '';
}

/** Reduce an RDAP domain object to what NetRecon needs. */
function parseDomain(json, asked, found, base) {
  const statuses = (json.status || []).map(s => String(s).toLowerCase()).slice(0, 20);
  return {
    status:           'ok',
    domain:           asked,
    registeredDomain: cleanText(json.ldhName || found, 253).toLowerCase(),
    server:           new URL(base).hostname,
    registrar:        registrarName(json),
    registered:       eventDate(json, 'registration'),
    expires:          eventDate(json, 'expiration'),
    updated:          eventDate(json, 'last changed'),
    statuses,
    nameservers:      (json.nameservers || []).map(n => cleanText(n.ldhName, 253).toLowerCase()).filter(Boolean).slice(0, 13),
    flags: {
      onHold:        statuses.some(s => s === 'client hold' || s === 'server hold'),
      redemption:    statuses.includes('redemption period'),
      pendingDelete: statuses.includes('pending delete'),
    },
  };
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Check a domain name before it is used in a request.
 * @returns {string|null} the cleaned name, or null if it is not acceptable
 */
function normalizeDomain(input) {
  const name = String(input || '').trim().toLowerCase().replace(/\.$/, '');
  if (name.length > 253 || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(name)) return null;
  if (name.split('.').some(l => l.length > 63 || l.startsWith('-') || l.endsWith('-'))) return null;
  if (/^\d+$/.test(name.split('.').pop())) return null;                 // looks like an IP address
  return name;
}

const _cache = new Map();         // name -> { until, result }
const _inFlight = new Map();      // name -> Promise

function remember(name, result) {
  const ttl = result.status === 'error' ? FAILURE_TTL : RESULT_TTL;
  if (_cache.size >= CACHE_MAX) _cache.delete(_cache.keys().next().value);
  _cache.set(name, { until: Date.now() + ttl, result });
}

async function lookupUncached(name) {
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  const labels = name.split('.');
  const tld    = labels[labels.length - 1];

  let base;
  try {
    base = (await getBootstrap()).get(tld);
  } catch (err) {
    return { status: 'error', domain: name, message: `Could not get the list of registries (${err.message})` };
  }
  if (!base) return { status: 'unsupported', domain: name, tld };

  // The name itself first, then its parents: www.example.com -> example.com
  const candidates = [];
  for (let i = 0; i <= labels.length - 2 && candidates.length < MAX_ATTEMPTS; i++) candidates.push(labels.slice(i).join('.'));

  for (const candidate of candidates) {
    if (Date.now() > deadline) return { status: 'error', domain: name, message: 'The registry took too long to answer.' };
    let r;
    try {
      r = await _fetch(`${base}domain/${encodeURIComponent(candidate)}`);
    } catch (err) {
      return { status: 'error', domain: name, message: err.message };
    }

    if (r.status === 200 && r.json) {
      // A registry's own suffix (co.uk) answers too. It has no registration date, so a
      // typo such as www.nonexistent.co.uk must not be reported as co.uk.
      const isParent = candidate !== name;
      if (isParent && candidate.split('.').length === 2 && eventDate(r.json, 'registration') === null) break;
      return Object.assign(parseDomain(r.json, name, candidate, base), { tld });
    }
    if (r.status === 404) continue;
    if (r.status === 429) return { status: 'error', domain: name, message: 'The registry is limiting requests right now. Try again later.' };
    return { status: 'error', domain: name, message: `The registry answered HTTP ${r.status}` };
  }
  return { status: 'notfound', domain: name, tld };
}

/**
 * Look up a domain's registration.
 *
 * @param {string} input
 * @param {Object} [opts]
 * @param {boolean} [opts.fresh] - Skip the cache and ask the registry again
 * @returns {Promise<Object>} always resolves. result.status is one of:
 *   ok           found. Has registrar, registered, expires (may be null), statuses, flags
 *   notfound     no such registered domain
 *   unsupported  the TLD has no RDAP server
 *   invalid      not a usable domain name
 *   error        the registry or the network failed (message says how)
 */
async function lookupDomain(input, opts) {
  const name = normalizeDomain(input);
  if (!name) return { status: 'invalid', domain: String(input || '').slice(0, 100) };

  const hit = _cache.get(name);
  if (hit && hit.until > Date.now() && !(opts && opts.fresh)) return hit.result;

  if (!_inFlight.has(name)) {
    _inFlight.set(name, lookupUncached(name).then(result => { remember(name, result); return result; })
      .finally(() => _inFlight.delete(name)));
  }
  return _inFlight.get(name);
}

/** Forget cached results (tests, or after a manual refresh). */
function clearCache() { _cache.clear(); _bootstrap = null; }

module.exports = { lookupDomain, normalizeDomain, parseBootstrap, parseDomain, setFetcher, clearCache, safeLookup, checkUrl };
