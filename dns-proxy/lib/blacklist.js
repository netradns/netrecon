// ── NetRecon — DNSBL Blacklist Checker ────────────────────────────
// Checks an IP address against common DNS-based blocklists (DNSBLs).
//
// How it works:
//   For each blocklist, we reverse the IP octets and query:
//     <reversed-ip>.<blocklist-zone>
//   If the query returns an A record (typically 127.0.0.x), the IP
//   is listed. If it returns NXDOMAIN or times out, it's clean.
//
// Uses Cloudflare DoH (same as public DNS lookups) instead of raw UDP
// because Docker's internal DNS resolver may not forward DNSBL queries
// correctly. DoH is already proven to work in this container.

'use strict';

const https = require('https');

// ── Blocklist zones ───────────────────────────────────────────────
const DNSBL_ZONES = [
  { zone: 'zen.spamhaus.org',         name: 'Spamhaus ZEN',     infoUrl: 'https://check.spamhaus.org/' },
  { zone: 'bl.spamcop.net',           name: 'SpamCop',          infoUrl: 'https://www.spamcop.net/bl.shtml' },
  { zone: 'b.barracudacentral.org',   name: 'Barracuda',        infoUrl: 'https://www.barracudacentral.org/lookups' },
  { zone: 'dnsbl.sorbs.net',          name: 'SORBS',            infoUrl: 'http://www.sorbs.net/lookup.shtml' },
  { zone: 'dnsbl-1.uceprotect.net',   name: 'UCEPROTECT L1',   infoUrl: 'https://www.uceprotect.net/en/' },
  { zone: 'spam.dnsbl.sorbs.net',     name: 'SORBS Spam',       infoUrl: 'http://www.sorbs.net/lookup.shtml' },
  { zone: 'cbl.abuseat.org',          name: 'CBL',              infoUrl: 'https://www.abuseat.org/lookup.cgi' },
  { zone: 'dnsbl.dronebl.org',        name: 'DroneBL',          infoUrl: 'https://dronebl.org/lookup' },
  { zone: 'psbl.surriel.com',         name: 'PSBL',             infoUrl: 'https://psbl.org/' },
  { zone: 'bl.mailspike.net',         name: 'Mailspike',        infoUrl: 'https://mailspike.org/' },
];

/**
 * Reverse an IPv4 address for DNSBL queries.
 * @param {string} ip
 * @returns {string|null}
 */
function reverseIp(ip) {
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) return null;
  return ip.split('.').reverse().join('.');
}

/**
 * Query a single DNSBL zone via Cloudflare DoH.
 * Returns { zone, name, listed, result, infoUrl }
 */
function checkOne(reversedIp, bl, timeoutMs) {
  const query = `${reversedIp}.${bl.zone}`;
  const url   = `https://1.1.1.1/dns-query?name=${encodeURIComponent(query)}&type=A`;

  return new Promise(resolve => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) { done = true; resolve({ zone: bl.zone, name: bl.name, listed: false, result: 'timeout', infoUrl: bl.infoUrl }); }
    }, timeoutMs);

    const req = https.get(url, {
      headers: { 'Accept': 'application/dns-json', 'User-Agent': 'NetRecon/1.0' },
      timeout: timeoutMs,
    }, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => {
        if (done) return;
        done = true;
        clearTimeout(timer);

        try {
          const d = JSON.parse(body);
          // Status 0 = NOERROR with answers = listed
          // Status 3 = NXDOMAIN = not listed
          // No Answer array = not listed
          if (d.Status === 0 && d.Answer && d.Answer.length > 0) {
            const addr = d.Answer[0].data || 'listed';
            resolve({ zone: bl.zone, name: bl.name, listed: true, result: addr, infoUrl: bl.infoUrl });
          } else {
            resolve({ zone: bl.zone, name: bl.name, listed: false, result: 'clean', infoUrl: bl.infoUrl });
          }
        } catch {
          resolve({ zone: bl.zone, name: bl.name, listed: false, result: 'error', infoUrl: bl.infoUrl });
        }
      });
    });

    req.on('error', () => {
      if (!done) { done = true; clearTimeout(timer); resolve({ zone: bl.zone, name: bl.name, listed: false, result: 'error', infoUrl: bl.infoUrl }); }
    });
    req.on('timeout', () => { req.destroy(); });
  });
}

/**
 * Check an IPv4 address against all configured DNSBLs in parallel.
 * @param {string} ip        - IPv4 address to check
 * @param {number} timeoutMs - Per-query timeout (default 4000ms)
 * @returns {Promise<Array>}
 */
async function checkBlacklists(ip, timeoutMs) {
  const reversed = reverseIp(ip);
  if (!reversed) return [];

  const ms = timeoutMs || 4000;
  return Promise.all(DNSBL_ZONES.map(bl => checkOne(reversed, bl, ms)));
}

module.exports = { checkBlacklists, DNSBL_ZONES };
