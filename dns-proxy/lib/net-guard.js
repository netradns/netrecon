// ── NetRecon — Network Address Guard ─────────────────────────────
// Helpers that decide whether an IP address is safe to connect to on
// behalf of a public visitor.
//
// Why this exists:
//   The TLS check connects to whatever IP a domain resolves to. Without a
//   guard, someone could point their own domain at 127.0.0.1 or 10.x.x.x
//   and use this server to probe the network it runs on (SSRF).
//
// Rules:
//   - Only canonical dotted-quad IPv4 literals are accepted. "0177.0.0.1"
//     is rejected because the operating system reads it as octal (127.0.0.1)
//     while a naive parser reads it as 177.0.0.1.
//   - IPv6 loopback, link-local, unique-local and multicast are private.
//     IPv4-mapped IPv6 (::ffff:10.0.0.1) is checked as the IPv4 it wraps.
//
// Internal watches (admin-configured, resolved by your own DNS) skip the
// guard on purpose. The guard protects the public, unauthenticated tools.

'use strict';

const net = require('net');

/**
 * Parse a canonical dotted-quad IPv4 address.
 * Rejects leading zeros, values over 255 and anything that is not four octets.
 *
 * @param {string} str
 * @returns {number[]|null} Four octets, or null if the string is not canonical
 */
function parseIPv4(str) {
  if (typeof str !== 'string') return null;
  const parts = str.split('.');
  if (parts.length !== 4) return null;
  const octets = [];
  for (const p of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(p)) return null;
    const n = parseInt(p, 10);
    if (n > 255) return null;
    octets.push(n);
  }
  return octets;
}

/**
 * True when an IPv4 address is private, loopback, link-local, multicast,
 * reserved, or otherwise not a normal public unicast address.
 *
 * @param {number[]} o - Four octets
 */
function isPrivateIPv4(o) {
  const [a, b, c] = o;
  if (a === 0)                          return true;  // "this" network
  if (a === 10)                         return true;  // RFC 1918
  if (a === 100 && b >= 64 && b <= 127) return true;  // CGNAT 100.64.0.0/10
  if (a === 127)                        return true;  // loopback
  if (a === 169 && b === 254)           return true;  // link-local (cloud metadata lives here)
  if (a === 172 && b >= 16 && b <= 31)  return true;  // RFC 1918
  if (a === 192 && b === 0 && c === 0)  return true;  // IETF protocol assignments
  if (a === 192 && b === 168)           return true;  // RFC 1918
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224)                         return true;  // multicast, reserved, broadcast
  return false;
}

/**
 * Expand an IPv6 address into eight 16-bit groups.
 * Handles "::" compression and an embedded IPv4 tail (::ffff:1.2.3.4).
 *
 * @param {string} str
 * @returns {number[]|null} Eight groups, or null if invalid
 */
function parseIPv6(str) {
  if (net.isIPv6(str) === false) return null;
  let s = str.toLowerCase();

  // Convert an embedded IPv4 tail into two hex groups
  const tail = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const o = parseIPv4(tail[1]);
    if (!o) return null;
    s = s.slice(0, -tail[1].length) +
      ((o[0] << 8) | o[1]).toString(16) + ':' + ((o[2] << 8) | o[3]).toString(16);
  }

  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;

  const groups = head.concat(new Array(halves.length === 2 ? missing : 0).fill('0'), rest)
    .map(g => parseInt(g, 16));
  return groups.length === 8 && groups.every(g => g >= 0 && g <= 0xffff) ? groups : null;
}

/** True when an IPv6 address is not a normal public unicast address. */
function isPrivateIPv6(g) {
  const allZeroUntil = n => g.slice(0, n).every(x => x === 0);

  if (allZeroUntil(7) && (g[7] === 0 || g[7] === 1)) return true;   // :: and ::1
  if ((g[0] & 0xffc0) === 0xfe80) return true;                      // fe80::/10 link-local
  if ((g[0] & 0xfe00) === 0xfc00) return true;                      // fc00::/7 unique local
  if ((g[0] & 0xff00) === 0xff00) return true;                      // ff00::/8 multicast

  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d): judge the IPv4 inside
  if (allZeroUntil(5) && (g[5] === 0xffff || g[5] === 0)) {
    return isPrivateIPv4([g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff]);
  }
  // NAT64 64:ff9b::/96 wraps an IPv4 address in the last 32 bits
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every(x => x === 0)) {
    return isPrivateIPv4([g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff]);
  }
  return false;
}

/**
 * True when the string is an IP address that must not be contacted on behalf
 * of a public visitor. Anything that does not parse as a canonical IP is
 * treated as unsafe, so odd encodings cannot slip through.
 *
 * @param {string} ip
 * @returns {boolean}
 */
function isPrivateAddress(ip) {
  const v4 = parseIPv4(ip);
  if (v4) return isPrivateIPv4(v4);
  const v6 = parseIPv6(ip);
  if (v6) return isPrivateIPv6(v6);
  return true;
}

module.exports = { parseIPv4, parseIPv6, isPrivateAddress };
