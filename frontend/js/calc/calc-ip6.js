// NetRecon - IPv6 calculator math
// Pure functions: parsing, formatting and subnet maths for IPv6. No DOM access,
// so they can be unit-tested (frontend/test/calc-ip6.test.js). Rendering is in calc-ip6-render.js.
//
// IPv6 addresses are 128 bits, which does not fit in a JavaScript number, so BigInt is used.
// BigInt() calls are used instead of 1n literals so that a browser without BigInt can
// still load this file. The IPv6 path then shows a short message instead of failing.
'use strict';

var IP6_OK = typeof BigInt === 'function';
var IP6_B  = IP6_OK ? BigInt : Number;                 // short alias for constructing values
var IP6_ALL = IP6_OK ? (BigInt(1) << BigInt(128)) - BigInt(1) : 0;   // 128 one-bits
var IP6_MAX_INPUT = 100;

// ── Detecting IPv6 input ─────────────────────────────────────
// IPv6 when the text has a colon, or is only a prefix longer than /32 (which cannot be IPv4).
function isIp6Input(raw) {
  var s = String(raw || '').trim();
  if (s.indexOf(':') !== -1) return true;
  var m = s.match(/^\/(\d{2,3})$/);
  return !!m && parseInt(m[1], 10) > 32;
}

// ── Parsing ──────────────────────────────────────────────────
function ip6Octets(s) {
  var p = s.split('.');
  if (p.length !== 4) return null;
  var out = [];
  for (var i = 0; i < 4; i++) {
    if (!/^\d{1,3}$/.test(p[i]) || parseInt(p[i], 10) > 255) return null;
    out.push(parseInt(p[i], 10));
  }
  return out;
}

// Text -> BigInt, or null when it is not an IPv6 address.
// Accepts "::" shortening, upper or lower case, [brackets], a %zone suffix (ignored)
// and an IPv4 tail such as ::ffff:192.0.2.1.
function ip6Parse(text) {
  if (!IP6_OK) return null;
  var s = String(text).trim();
  if (s.charAt(0) === '[' && s.charAt(s.length - 1) === ']') s = s.slice(1, -1);
  s = s.replace(/%[0-9A-Za-z._~-]+$/, '');
  if (!s || !/^[0-9A-Fa-f:.]+$/.test(s)) return null;
  var tail = s.match(/^(.*:)(\d[\d.]*)$/);
  if (tail && tail[2].indexOf('.') !== -1) {
    var o = ip6Octets(tail[2]);
    if (!o) return null;
    s = tail[1] + ((o[0] << 8) | o[1]).toString(16) + ':' + ((o[2] << 8) | o[3]).toString(16);
  } else if (s.indexOf('.') !== -1) {
    return null;
  }
  var dbl = s.indexOf('::');
  var groups;
  if (dbl !== -1) {
    if (dbl !== s.lastIndexOf('::')) return null;       // only one "::" is allowed. ":::" also lands here
    var left  = s.slice(0, dbl),  right = s.slice(dbl + 2);
    var lg = left  ? left.split(':')  : [];
    var rg = right ? right.split(':') : [];
    if (lg.length + rg.length > 7) return null;         // "::" must stand for at least one group
    var zeros = [];
    for (var z = 0; z < 8 - lg.length - rg.length; z++) zeros.push('0');
    groups = lg.concat(zeros, rg);
  } else {
    groups = s.split(':');
    if (groups.length !== 8) return null;
  }
  var n = IP6_B(0);
  for (var i = 0; i < 8; i++) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(groups[i])) return null;
    n = (n << IP6_B(16)) | IP6_B(parseInt(groups[i], 16));
  }
  return n;
}

// Calculator input. Accepted: 2001:db8::/32   2001:db8:: /32   2001:db8::   (a bare address is /128)
// Returns { ip, prefix, explicit } or { error }.
function ip6ParseInput(raw) {
  if (!IP6_OK) return { error: 'This browser does not support the large numbers IPv6 needs. Please update it.' };
  raw = String(raw || '');
  if (raw.length > IP6_MAX_INPUT) return { error: 'Input is too long' };
  var s = raw.trim().replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ');
  var m = s.match(/^(\S+?)(?:[\/ ](\S+))?$/);
  if (!m) return { error: 'Invalid input. Try 2001:db8::/32' };
  var ip = ip6Parse(m[1]);
  if (ip === null) return { error: 'Invalid IPv6 address' };
  if (m[2] === undefined) return { ip: ip, prefix: 128, explicit: false };
  var p = m[2].replace(/^\//, '');
  if (!/^\d{1,3}$/.test(p)) return { error: 'Invalid prefix ' + m[2] + ' (must be 0\u2013128)' };
  var prefix = parseInt(p, 10);
  if (prefix > 128) return { error: 'Invalid prefix /' + prefix + ' (must be 0\u2013128)' };
  return { ip: ip, prefix: prefix, explicit: true };
}

// True when live typing should calculate: a valid address with a prefix, or a bare "/64".
// False once this exact text is already on screen, so it is not redrawn.
function ip6Ready(raw) {
  var s = String(raw || '').trim();
  if (!IP6_OK || !isIp6Input(s) || ip6SameAsShown(s)) return false;
  if (/^\/\d{2,3}$/.test(s)) return parseInt(s.slice(1), 10) <= 128;
  var p = ip6ParseInput(s);
  return !p.error && p.explicit;
}
function ip6SameAsShown(s) {
  return typeof window !== 'undefined' && window._calc6Last === s;
}

// ── Formatting ───────────────────────────────────────────────
function ip6Groups(n) {
  var g = [];
  for (var i = 7; i >= 0; i--) g.push(Number((n >> IP6_B(i * 16)) & IP6_B(0xFFFF)));
  return g;
}
function ip6Hex(g) { return g.toString(16); }

// All 8 groups, 4 digits each: 2001:0db8:0000:0000:0000:0000:0000:0001
function ip6Expand(n) {
  return ip6Groups(n).map(function(g) { return ('000' + g.toString(16)).slice(-4); }).join(':');
}

// Shortest standard form (RFC 5952): lower case, no leading zeros, and the longest run of
// two or more zero groups becomes "::" (the first run when two are equally long).
function ip6Compress(n) {
  var g = ip6Groups(n);
  var bestStart = -1, bestLen = 0, i = 0;
  while (i < 8) {
    if (g[i] !== 0) { i++; continue; }
    var j = i;
    while (j < 8 && g[j] === 0) j++;
    if (j - i > bestLen) { bestStart = i; bestLen = j - i; }
    i = j;
  }
  if (bestLen < 2) return g.map(ip6Hex).join(':');
  return g.slice(0, bestStart).map(ip6Hex).join(':') + '::' + g.slice(bestStart + bestLen).map(ip6Hex).join(':');
}

// 1234567 -> "1,234,567" (works on BigInt)
function ip6Group(big) {
  return String(big).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Size of a block with `bits` host bits: "256" for small ones, "2^64 (18,446,744,073,709,551,616)" for large ones
function ip6Size(bits) {
  var n = IP6_B(1) << IP6_B(bits);
  return bits <= 16 ? ip6Group(n) : '2^' + bits + ' (' + ip6Group(n) + ')';
}

// ── Address types ────────────────────────────────────────────
// Most specific first. A range only counts when the whole block fits inside it.
var IP6_TYPES = [
  ['::',            128, 'Unspecified',          'p-gray'  ],
  ['::1',           128, 'Loopback',             'p-purple'],
  ['::ffff:0:0',     96, 'IPv4-mapped',          'p-gray'  ],
  ['64:ff9b::',      96, 'NAT64',                'p-blue'  ],
  ['2001:db8::',     32, 'Documentation',        'p-gray'  ],
  ['3fff::',         20, 'Documentation',        'p-gray'  ],
  ['2002::',         16, '6to4',                 'p-blue'  ],
  ['2001::',         32, 'Teredo',               'p-blue'  ],
  ['fc00::',          7, 'Unique Local (ULA)',   'p-yellow'],
  ['fe80::',         10, 'Link-Local',           'p-orange'],
  ['ff00::',          8, 'Multicast',            'p-pink'  ],
  ['2000::',          3, 'Global Unicast',       'p-green' ]
];
var _ip6TypeCache = null;

// Type of the block `network`/`prefix`
function ip6Classify(network, prefix) {
  if (!_ip6TypeCache) {
    _ip6TypeCache = IP6_TYPES.map(function(t) {
      var base = ip6Parse(t[0]);
      var host = 128 - t[1];
      return { mask: IP6_ALL ^ ((IP6_B(1) << IP6_B(host)) - IP6_B(1)), base: base, len: t[1], label: t[2], cls: t[3] };
    });
  }
  for (var i = 0; i < _ip6TypeCache.length; i++) {
    var t = _ip6TypeCache[i];
    if (t.len <= prefix && (network & t.mask) === t.base) return { label: t.label, cls: t.cls };
  }
  return { label: 'Other / reserved', cls: 'p-red' };
}

// What a prefix length is usually used for (or '')
var IP6_USES = {
  32: 'Typical allocation to an ISP',
  48: 'Typical site or customer assignment',
  56: 'Small site or home assignment',
  64: 'One network (LAN). SLAAC needs a /64',
  127: 'Point-to-point link (RFC 6164)',
  128: 'A single address'
};
function ip6Use(prefix) { return IP6_USES[prefix] || ''; }

// ── The full result for one block ────────────────────────────
function ip6Build(ip, prefix, raw) {
  var hostBits = 128 - prefix;
  var hostMask = (IP6_B(1) << IP6_B(hostBits)) - IP6_B(1);
  var network  = ip & (IP6_ALL ^ hostMask);
  var last     = network | hostMask;
  return {
    input:     raw || ip6Compress(ip) + '/' + prefix,
    prefix:    prefix,
    hostBits:  hostBits,
    network:   network,
    last:      last,
    netStr:    ip6Compress(network),
    expanded:  ip6Expand(network),
    firstStr:  ip6Compress(network),
    lastStr:   ip6Compress(last),
    size:      ip6Size(hostBits),
    type:      ip6Classify(network, prefix),
    use:       ip6Use(prefix),
    reverse:   ip6Reverse(network, prefix),
    hostSet:   (ip & hostMask) !== IP6_B(0)       // the typed address had host bits set
  };
}

// Reverse DNS zone, e.g. 2001:db8::/32 -> 8.b.d.0.1.0.0.2.ip6.arpa. Only exact on a nibble
// (4-bit) boundary. Other prefixes cover several zones, so they have none.
function ip6Reverse(network, prefix) {
  if (prefix % 4 !== 0) return null;
  var hex = ip6Expand(network).replace(/:/g, '').slice(0, prefix / 4);
  return (hex ? hex.split('').reverse().join('.') + '.' : '') + 'ip6.arpa';
}

// ── Splits and supernets (always on a nibble boundary, as is usual for IPv6) ───
// The block cut into smaller blocks of prefix `newPrefix`: { count, first: [up to `max` CIDR strings] }
function ip6Split(r, newPrefix, max) {
  var bits  = newPrefix - r.prefix;
  var step  = IP6_B(1) << IP6_B(128 - newPrefix);
  var total = IP6_B(1) << IP6_B(bits);
  var shown = Number(total < IP6_B(max) ? total : IP6_B(max));
  var rows = [];
  for (var i = 0; i < shown; i++) {
    var net = r.network + step * IP6_B(i);
    rows.push({ cidr: ip6Compress(net) + '/' + newPrefix, first: ip6Compress(net), last: ip6Compress(net + step - IP6_B(1)) });
  }
  return { count: total, rows: rows };
}

// Parent blocks 4, 8, 12 and 16 bits up, not shorter than /8
function ip6Supernets(r) {
  var out = [];
  for (var i = 1; i <= 4; i++) {
    var p = r.prefix - 4 * i;
    if (p < 8) break;
    var mask = IP6_ALL ^ ((IP6_B(1) << IP6_B(128 - p)) - IP6_B(1));
    var net  = r.network & mask;
    out.push({
      prefix:  p,
      network: ip6Compress(net),
      cidr:    ip6Compress(net) + '/' + p,
      holds:   IP6_B(1) << IP6_B(r.prefix - p),
      slot:    ((r.network - net) >> IP6_B(128 - r.prefix)) + IP6_B(1)
    });
  }
  return out;
}

// Split prefixes offered for a block: +4, +8, +12 and +16 bits, up to /128
function ip6SplitPrefixes(prefix) {
  var out = [];
  for (var k = 1; k <= 4; k++) if (prefix + 4 * k <= 128) out.push(prefix + 4 * k);
  return out;
}
