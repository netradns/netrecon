// NetRecon — IP Calculator
// Input parsing and subnet math for the calculator. Rendering is in calc-render.js.

'use strict';

// Shorthand shared by all calculator files
function calcEl(id) { return document.getElementById(id); }

// ── Entry point ──────────────────────────────────────────────
// cidrOverride: use this text instead of the input box.
// silent: live-typing mode. Skips error messages and usage tracking.
function runCalc(cidrOverride, silent) {
  var input = document.getElementById('cidrInput');
  var raw = cidrOverride || (input ? input.value.trim() : '');
  if (!raw) return;

  var out = document.getElementById('calc-results');
  if (!out) return;

  // Just a prefix ("/27") or just a mask ("255.255.255.224"): show what it means, no IP needed
  var only = parsePrefixOnly(raw);
  if (only !== null) {
    if (!silent) trackUsage('calc', raw);
    renderPrefixInfo(only, out);
    return;
  }

  // Parse input — accepts 10.0.0.0/24, 10.0.0.0/255.255.255.0,
  // 10.0.0.0 255.255.255.0, 10.0.0.0 0.0.0.255 (wildcard), or a bare IP (/32)
  var parsed = parseCalcInput(raw);
  if (parsed.error) {
    if (silent) return;
    // The error can echo user input (e.g. from a shared #calc/ link), so it must be escaped
    out.innerHTML = '<div class="calc-error">✕ ' + h(parsed.error) + '</div>';
    return;
  }
  var ip = parsed.ip, prefix = parsed.prefix;

  if (!silent) trackUsage('calc', raw);

  var r = buildCalcResult(ip, prefix, raw);
  window._calcLast = { prefix: prefix, networkLong: r.networkLong, network: r.network, raw: raw };
  renderCalcResults(r, out);
}

// ── Core calculations: everything the UI needs for one subnet ─
function buildCalcResult(ip, prefix, raw) {
  var mask      = prefixToMaskLong(prefix);
  var wildcard  = (~mask) >>> 0;
  var network   = (ip2long(ip) & mask) >>> 0;
  var broadcast = (network | wildcard) >>> 0;
  var networkIP = long2ip(network);

  return {
    input:        raw || ip + '/' + prefix,
    ip:           ip,
    prefix:       prefix,
    network:      networkIP,
    networkLong:  network,
    broadcast:    long2ip(broadcast),
    mask:         long2ip(mask),
    maskLong:     mask,
    wildcard:     long2ip(wildcard),
    wildcardLong: wildcard,
    firstHost:    prefix === 31 ? networkIP : long2ip(network + 1),
    lastHost:     prefix === 31 ? long2ip(broadcast) : long2ip(broadcast - 1),
    totalHosts:   Math.pow(2, 32 - prefix),
    usableHosts:  getUsable(prefix),
    ipClass:      cidrClass(prefix),
    rfc:          rfcClass(networkIP)
  };
}
// ── Prefix length -> 32-bit mask (e.g. 27 -> 0xFFFFFFE0) ─────
function prefixToMaskLong(prefix) {
  return prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;
}

// ── Input parsing ────────────────────────────────────────────
function isDottedQuad(s) {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(s) && s.split('.').every(function(o) { return parseInt(o, 10) <= 255; });
}

// Returns prefix length for a contiguous mask (e.g. 255.255.255.224 -> 27), else -1
function maskToPrefix(maskStr) {
  var m = ip2long(maskStr) >>> 0;
  var bin = m.toString(2).padStart(32, '0');
  if (!/^1*0*$/.test(bin)) return -1;
  return bin.indexOf('0') === -1 ? 32 : bin.indexOf('0');
}

// Detects input that is only a prefix length ("/27", "27") or only a subnet mask ("255.255.255.224").
// Returns the prefix length (0-32), or null when the input is something else (e.g. a full IP).
function parsePrefixOnly(raw) {
  var s = raw.trim();
  var m = s.match(/^\/?(\d{1,2})$/);
  if (m) return parseInt(m[1], 10) <= 32 ? parseInt(m[1], 10) : null;
  if (isDottedQuad(s)) {
    var p = maskToPrefix(s);
    if (p > 0) return p;
  }
  return null;
}

// Parse calculator input. Accepted forms:
//   10.0.0.0/24   10.0.0.0/255.255.255.0   10.0.0.0 255.255.255.0
//   10.0.0.0 0.0.0.255 (wildcard mask)     10.0.0.0 /24      10.0.0.0 (= /32)
// Returns { ip, prefix, explicit } where `explicit` is false for a bare IP, or { error }.
var MAX_INPUT_LENGTH = 100;

function parseCalcInput(raw) {
  if (raw.length > MAX_INPUT_LENGTH) return { error: 'Input is too long' };
  var s = raw.trim().replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ');
  if (/^\/\d+$/.test(s)) return { error: 'Invalid prefix ' + s + ' (must be 0–32)' };
  var ip, rest = null;

  var m = s.match(/^(\S+?)(?:[\/ ](\S+))?$/);
  if (!m) return { error: 'Invalid input. Try 192.168.1.0/24 or 192.168.1.0 255.255.255.0' };
  ip = m[1];
  rest = m[2] || null;

  if (!isDottedQuad(ip)) return { error: 'Invalid IP address' };
  if (rest === null) return { ip: ip, prefix: 32, explicit: false };

  // Dotted form: subnet mask, or wildcard mask as a fallback
  if (rest.indexOf('.') !== -1) {
    if (!isDottedQuad(rest)) return { error: 'Invalid subnet mask ' + rest };
    var p = maskToPrefix(rest);
    if (p === -1) {
      var inv = long2ip((~ip2long(rest)) >>> 0);
      p = maskToPrefix(inv);
      if (p === -1) return { error: 'Invalid subnet mask ' + rest + ' (mask bits must be contiguous)' };
    }
    return { ip: ip, prefix: p, explicit: true };
  }

  // Prefix length (allow a leading slash, e.g. "10.0.0.0 /24")
  rest = rest.replace(/^\//, '');
  if (!/^\d{1,2}$/.test(rest)) return { error: 'Invalid prefix ' + rest + ' (must be 0–32)' };
  var prefix = parseInt(rest, 10);
  if (prefix > 32) return { error: 'Invalid prefix /' + prefix + ' (must be 0–32)' };
  return { ip: ip, prefix: prefix, explicit: true };
}

// ── RFC classification — exact from old version ──────────────
function rfcClass(ip) {
  var o = ip.split('.').map(Number);
  if (o[0] === 10)                              return { label: 'RFC 1918 Private',    cls: 'p-yellow' };
  if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return { label: 'RFC 1918 Private',    cls: 'p-yellow' };
  if (o[0] === 192 && o[1] === 168)             return { label: 'RFC 1918 Private',    cls: 'p-yellow' };
  if (o[0] === 127)                             return { label: 'Loopback',            cls: 'p-purple' };
  if (o[0] === 169 && o[1] === 254)             return { label: 'Link-Local',          cls: 'p-orange' };
  if (o[0] >= 224 && o[0] <= 239)              return { label: 'Multicast',           cls: 'p-pink'   };
  if (o[0] >= 240)                              return { label: 'Reserved',            cls: 'p-red'    };
  return                                               { label: 'Public Routable',     cls: 'p-green'  };
}

// ── CIDR class — exact from old version ─────────────────────
function cidrClass(prefix) {
  if (prefix <= 8)  return 'Class A';
  if (prefix <= 16) return 'Class B';
  if (prefix <= 24) return 'Class C';
  return 'Subnet';
}

// ── toBin helper used by renderBitRow ────────────────────────
function toBin(n) {
  return (n >>> 0).toString(2).padStart(32, '0');
}

// ── Quick example helper ─────────────────────────────────────
function calcQuick(cidr) {
  var input = document.getElementById('cidrInput');
  if (input) { input.value = cidr; runCalc(); }
}

// ── Keyboard: Enter triggers calculation ────────────────────
document.addEventListener('DOMContentLoaded', function() {
  var input = document.getElementById('cidrInput');
  if (input) input.addEventListener('keydown', function(e) { if (e.key === 'Enter') runCalc(); });
});
