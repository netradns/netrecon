// ── NetRecon Admin — Watched entry rules ─────────────────────────
// The checks that decide whether a set of watch settings is allowed.
// Shared by "add a watch" (POST /admin/watched) and "edit a watch"
// (PATCH /admin/watched/:id) so the two can never disagree.
//
// Pure functions: no I/O, no request or response objects.
'use strict';
const { normalizeWarnDays, normalizePort } = require('../watcher/cert');
const { normalizeWarnDays: normalizeExpiryWarnDays } = require('../watcher/domain-expiry');
const { normalizeDomain } = require('../rdap');
const { parseIPv4, isPrivateAddress } = require('../net-guard');

const VALID_SOURCES   = new Set(['public', 'internal']);
const VALID_TYPES     = new Set(['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'SOA', 'CAA', 'SRV', 'ALL']);
const VALID_INTERVALS = new Set([5, 15, 60, 360, 1440]);

/**
 * Turns the settings an admin sent into the settings that are stored, or says why not.
 *
 * @param {string} domain - Already cleaned (lower case, no trailing dot)
 * @param {string} source - "public" | "internal"
 * @param {Object} input  - { recordTypes, cert, expiry, interval } as sent by the browser
 * @returns {{ ok: true, recordTypes: string[], cert: Object|null, expiry: Object|null, interval: number }
 *          | { ok: false, status: number, error: string }}
 */
function resolveSettings(domain, source, input) {
  const fail = (error) => ({ ok: false, status: 400, error });

  // Certificate watch (optional)
  let cert = null;
  if (input.cert && input.cert.enabled) {
    const port = normalizePort(input.cert.port);
    if (port === null) return fail('Invalid port. Use a number from 1 to 65535.');
    cert = { enabled: true, port, warnDays: normalizeWarnDays(input.cert.warnDays) };
  }

  // Domain registration watch (optional). Internal names and IP addresses are not registered anywhere.
  let expiry = null;
  if (input.expiry && input.expiry.enabled) {
    if (source === 'internal') {
      return fail('Registration expiry applies to public domains. Choose the Public source.');
    }
    if (!normalizeDomain(domain)) {
      return fail('Registration expiry needs a registered domain name, such as example.com.');
    }
    expiry = { enabled: true, warnDays: normalizeExpiryWarnDays(input.expiry.warnDays) };
  }

  let recordTypes = Array.isArray(input.recordTypes)
    ? input.recordTypes.filter(t => VALID_TYPES.has(String(t).toUpperCase())).map(t => String(t).toUpperCase())
    : (cert || expiry ? [] : ['A', 'MX', 'TXT', 'NS']);

  // An IP address is not a DNS name: watch its certificate only
  const isIp = !!parseIPv4(domain);
  if (!isIp && /^\d+(\.\d+){0,3}$/.test(domain)) {
    return fail('That looks like an IP address but is not valid. Use four numbers from 0 to 255, like 10.0.0.5.');
  }
  if (isIp) {
    if (!cert) return fail('An IP address has no DNS records to watch. Turn on certificate monitoring instead.');
    if (expiry) return fail('An IP address has no domain registration to watch.');
    recordTypes = [];
    if (source === 'public' && isPrivateAddress(domain)) {
      return fail('That is a private address. Choose the Internal source to watch it.');
    }
  }

  if (!recordTypes.length && !cert && !expiry) {
    return fail('Choose at least one record type, or turn on certificate or registration monitoring.');
  }

  const interval = VALID_INTERVALS.has(Number(input.interval)) ? Number(input.interval) : 60;
  return { ok: true, recordTypes, cert, expiry, interval };
}

/**
 * Finds an existing entry that the given settings would duplicate: the same host and source
 * may not watch DNS twice, the same certificate port twice, or the registration twice.
 *
 * @param {Array}  domains  - watched.domains
 * @param {string} domain
 * @param {string} source
 * @param {Object} settings - Result of resolveSettings()
 * @param {string} [ignoreId] - An entry to leave out (the one being edited)
 */
function findClash(domains, domain, source, settings, ignoreId) {
  return domains.find(d => d.id !== ignoreId && d.domain === domain && d.source === source && (
    ((d.recordTypes || []).length > 0 && settings.recordTypes.length > 0) ||
    (d.cert && settings.cert && d.cert.port === settings.cert.port) ||
    (d.expiry && settings.expiry)
  ));
}

module.exports = { resolveSettings, findClash, VALID_SOURCES, VALID_INTERVALS };
