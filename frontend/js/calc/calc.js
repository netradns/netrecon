// NetRecon — IP Calculator
// CIDR and subnet calculation logic — matches netrecon-old exactly

'use strict';

// ── Entry point ──────────────────────────────────────────────
function runCalc(cidrOverride) {
  var input = document.getElementById('cidrInput');
  var raw = cidrOverride || (input ? input.value.trim() : '');
  if (!raw) return;

  var out = document.getElementById('calc-results');
  if (!out) return;

  // Parse CIDR — default to /32 if no prefix given
  var ip, prefix;
  if (raw.includes('/')) {
    var parts = raw.split('/');
    ip     = parts[0].trim();
    prefix = parseInt(parts[1].trim(), 10);
  } else {
    ip     = raw;
    prefix = 32;
  }

  // Validate IP
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip) || ip.split('.').some(function(o) { return parseInt(o) > 255; })) {
    out.innerHTML = '<div class="calc-error">✕ Invalid IP address</div>';
    return;
  }
  if (prefix < 0 || prefix > 32) {
    out.innerHTML = '<div class="calc-error">✕ Invalid prefix /' + prefix + ' — must be 0–32</div>';
    return;
  }

  trackUsage('calc', raw);

  // ── Core calculations ────────────────────────────────────
  var mask      = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;
  var wildcard  = (~mask) >>> 0;
  var network   = (ip2long(ip) & mask) >>> 0;
  var broadcast = (network | wildcard) >>> 0;
  var totalIPs  = Math.pow(2, 32 - prefix);
  var usable    = getUsable(prefix);
  var firstHost = prefix === 31 ? long2ip(network)     : long2ip(network + 1);
  var lastHost  = prefix === 31 ? long2ip(broadcast)   : long2ip(broadcast - 1);
  var networkIP = long2ip(network);
  var rfc       = rfcClass(networkIP);

  renderCalcResults({
    input:       raw,
    ip:          ip,
    prefix:      prefix,
    network:     networkIP,
    networkLong: network,
    broadcast:   long2ip(broadcast),
    mask:        long2ip(mask),
    maskLong:    mask,
    wildcard:    long2ip(wildcard),
    wildcardLong:wildcard,
    firstHost:   firstHost,
    lastHost:    lastHost,
    totalHosts:  totalIPs,
    usableHosts: usable,
    ipClass:     cidrClass(prefix),
    rfc:         rfc
  }, out);
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
  if (o[0] < 128)                               return { label: 'Public Routable',     cls: 'p-green'  };
  if (o[0] < 192)                               return { label: 'Public Routable',     cls: 'p-green'  };
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
