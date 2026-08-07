// ── NetRecon DNS Proxy — DNS Resolution ──────────────────────────
// Two resolution paths, strictly separated:
//
//   PUBLIC  → Cloudflare DoH (https://1.1.1.1/dns-query)
//             Used for all public DNS lookups.
//             HTTPS, no UDP truncation, handles large TXT records.
//             Never falls back to internal DNS — prevents split-brain
//             domains from leaking private records into public results.
//
//   INTERNAL → Node.js dns.Resolver (UDP) against your DNS_SERVERS
//              Used for the Internal DNS tool only.
//              Uses a dedicated Resolver instance — does NOT touch
//              the global dns module to avoid affecting Node internals.
//
// To add a new record type:
//   1. Add it to TYPE_NUMS (public) and the switch in resolveInternal
//   2. Add a parseDohAnswer case if the data format needs special handling

'use strict';

const dns   = require('dns');
const https = require('https');
const { DNS_SERVERS, PUBLIC_DNS, PUBLIC_TIMEOUT, DNS_TIMEOUT } = require('./config');

// ── Internal DNS resolver ─────────────────────────────────────────
// IMPORTANT: Use a dedicated Resolver instance, not dns.setServers().
// Calling dns.setServers() on the global module would affect all DNS
// resolution in the process, including Node.js internals.
const internalResolver = new dns.Resolver();
if (DNS_SERVERS.length) {
  internalResolver.setServers(DNS_SERVERS);
}

// Public resolver — used only for the startup connectivity test.
// Actual public lookups go through Cloudflare DoH, not this resolver.
const publicResolver = new dns.Resolver();
publicResolver.setServers(PUBLIC_DNS);

// ── Cloudflare DoH ────────────────────────────────────────────────
// Uses 1.1.1.1/dns-query directly.
// cloudflare-dns.com redirects to this URL, so we skip the redirect.
const DOH_URL = 'https://1.1.1.1/dns-query';

/**
 * Fetch a DNS record via Cloudflare DoH (DNS over HTTPS).
 * Returns the parsed JSON response or rejects with an error.
 *
 * @param {string} name   - Domain name to query
 * @param {string} type   - Record type (A, AAAA, MX, TXT, etc.)
 * @param {number} timeout - Request timeout in ms
 */
function dohFetch(name, type, timeout) {
  const ms  = timeout || PUBLIC_TIMEOUT;
  const url = `${DOH_URL}?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`;

  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'Accept':     'application/dns-json',
        'User-Agent': 'NetRecon/1.0',
      },
      timeout: ms,
    }, (res) => {
      // Non-200 means something is wrong (redirect, auth error, etc.)
      // Drain the response body to free the socket before rejecting.
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`DoH HTTP ${res.statusCode}`));
        return;
      }

      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (!body) {
          reject(new Error('DoH empty response'));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch(e) {
          // Log the raw response to help diagnose unexpected formats
          console.error(`[ERROR] DoH bad JSON for ${type} ${name}: ${body.slice(0, 200)}`);
          reject(new Error('DoH parse error'));
        }
      });
    });

    req.on('error', reject);
    // Destroy the socket on timeout to prevent connection leaks
    req.on('timeout', () => { req.destroy(); reject(new Error('DoH timeout')); });
  });
}

// ── DoH answer type numbers ───────────────────────────────────────
// Used to filter DoH answers to only the requested type.
// DoH responses may include CNAME chain records alongside the target type.
const TYPE_NUMS = {
  A: 1, AAAA: 28, CNAME: 5, MX: 15, NS: 2,
  SOA: 6, TXT: 16, SRV: 33, PTR: 12, CAA: 257,
};

/**
 * Parse a single Cloudflare DoH answer record into our standard format:
 * { type, name, data, ttl, ...type-specific fields }
 *
 * Cloudflare returns data as a string in presentation format.
 * We normalize it to match what Node's dns module returns.
 *
 * @param {object} ans      - Raw DoH answer object
 * @param {string} typeName - Record type name (A, MX, TXT, etc.)
 * @param {string} queryName - Original query name (for fallback)
 */
function parseDohAnswer(ans, typeName, queryName) {
  const ttl  = ans.TTL || 300;
  // Strip trailing dot from DNS names (presentation format artifact)
  const name = (ans.name || queryName || '').replace(/\.$/, '');
  const raw  = String(ans.data || '');

  switch (typeName) {
    case 'A':
    case 'AAAA':
      // IPv4/IPv6 address — data is the address string
      return { type: typeName, name, data: raw, ttl };

    case 'CNAME':
    case 'NS':
    case 'PTR':
      // These all return a single hostname — strip trailing dot
      return { type: typeName, name, data: raw.replace(/\.$/, ''), ttl };

    case 'MX': {
      // Format: "10 mail.example.com."
      const p    = raw.split(' ');
      const pri  = parseInt(p[0]) || 10;
      const exch = (p[1] || '').replace(/\.$/, '');
      return { type: 'MX', name, data: `${pri} ${exch}`, ttl, priority: pri, exchange: exch };
    }

    case 'TXT':
      // Cloudflare wraps TXT data in quotes and separates segments with " "
      // Strip outer quotes and join quoted segments with a space
      return {
        type: 'TXT', name, ttl,
        data: raw.replace(/^"|"$/g, '').replace(/"[ ]*"/g, ' '),
      };

    case 'SOA': {
      // Format: "ns1.example.com. admin.example.com. 2024010101 3600 900 604800 300"
      const p = raw.split(' ');
      return {
        type: 'SOA', name, data: raw, ttl,
        nsname: p[0], hostmaster: p[1],
        serial: +p[2], refresh: +p[3], retry: +p[4], expire: +p[5], minttl: +p[6],
      };
    }

    case 'CAA': {
      // Format: "0 issue \"letsencrypt.org\""
      const p = raw.split(' ');
      return {
        type: 'CAA', name, ttl,
        data: `${p[0]} ${p[1]} ${p.slice(2).join(' ').replace(/^"|"$/g, '')}`,
      };
    }

    case 'SRV': {
      // Format: "10 20 443 target.example.com."
      const p = raw.split(' ');
      return {
        type: 'SRV', name, data: raw, ttl,
        priority: +p[0], weight: +p[1], port: +p[2],
        target: (p[3] || '').replace(/\.$/, ''),
      };
    }

    default:
      return { type: typeName, name, data: raw, ttl };
  }
}

// ── Public DNS resolution (Cloudflare DoH) ────────────────────────
/**
 * Resolve a DNS record using Cloudflare DoH.
 * Returns an array of parsed records, or [] on NXDOMAIN/error.
 *
 * IMPORTANT: Does NOT fall back to internal DNS on failure.
 * Falling back would return private records for split-brain domains
 * (e.g. a domain that resolves differently internally vs publicly).
 *
 * @param {string} name    - Domain name
 * @param {string} type    - Record type
 * @param {number} timeout - Timeout in ms
 */
async function resolvePublic(name, type, timeout) {
  const typeName = type.toUpperCase();
  try {
    const d = await dohFetch(name, typeName, timeout);

    // Status 3 = NXDOMAIN (domain doesn't exist) — return empty, not an error
    if (!d || d.Status === 3) return [];

    return (d.Answer || [])
      .filter(a => {
        // Filter to only the requested type — DoH may include CNAME chain records
        const t = typeof a.type === 'number' ? a.type : parseInt(a.type);
        return t === (TYPE_NUMS[typeName] || t);
      })
      .map(a => parseDohAnswer(a, typeName, name));

  } catch(e) {
    // Log non-timeout errors for debugging
    if (e.message !== 'DoH timeout') {
      console.warn(`[WARN] DoH ${typeName} ${name}: ${e.message}`);
    }
    // Return empty — never leak internal DNS results to the public tool
    return [];
  }
}

// ── Internal DNS resolution (Node.js UDP) ─────────────────────────
/**
 * Timeout wrapper for Node.js callback-style DNS methods.
 * Prevents hung queries from blocking the event loop.
 */
function withTimeout(fn, ms) {
  return new Promise((resolve, reject) => {
    let done = false;
    const t = setTimeout(() => {
      if (!done) { done = true; reject(new Error('DNS timeout')); }
    }, ms);
    fn((err, result) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      if (err) reject(err); else resolve(result);
    });
  });
}

/**
 * Resolve a DNS record against your internal DNS servers (UDP).
 * Returns an array of parsed records, or [] on error/NXDOMAIN.
 *
 * @param {string} name    - Domain name or arpa address
 * @param {string} type    - Record type
 * @param {number} timeout - Timeout in ms
 */
async function resolveInternal(name, type, timeout) {
  const r  = internalResolver;
  const ms = timeout || DNS_TIMEOUT;
  const T  = type.toUpperCase();

  try {
    switch (T) {
      case 'A': {
        const a = await withTimeout(cb => r.resolve4(name, { ttl: true }, cb), ms);
        return a.map(x => typeof x === 'object'
          ? { type: 'A', name, data: x.address, ttl: x.ttl || 300 }
          : { type: 'A', name, data: x, ttl: 300 });
      }
      case 'AAAA': {
        const a = await withTimeout(cb => r.resolve6(name, { ttl: true }, cb), ms);
        return a.map(x => typeof x === 'object'
          ? { type: 'AAAA', name, data: x.address, ttl: x.ttl || 300 }
          : { type: 'AAAA', name, data: x, ttl: 300 });
      }
      case 'CNAME': {
        const a = await withTimeout(cb => r.resolveCname(name, cb), ms);
        return a.map(c => ({ type: 'CNAME', name, data: c, ttl: 300 }));
      }
      case 'MX': {
        const a = await withTimeout(cb => r.resolveMx(name, cb), ms);
        return a.map(m => ({
          type: 'MX', name,
          data: `${m.priority} ${m.exchange}`,
          ttl: 300, priority: m.priority, exchange: m.exchange,
        }));
      }
      case 'SRV': {
        const a = await withTimeout(cb => r.resolveSrv(name, cb), ms);
        return a.map(s => ({
          type: 'SRV', name,
          data: `${s.priority} ${s.weight} ${s.port} ${s.name}`,
          ttl: 300, priority: s.priority, weight: s.weight, port: s.port, target: s.name,
        }));
      }
      case 'TXT': {
        const a = await withTimeout(cb => r.resolveTxt(name, cb), ms);
        // resolveTxt returns string[][] — join each record's chunks
        return a.map(t => ({ type: 'TXT', name, data: t.join(''), ttl: 300 }));
      }
      case 'NS': {
        const a = await withTimeout(cb => r.resolveNs(name, cb), ms);
        return a.map(n => ({ type: 'NS', name, data: n, ttl: 300 }));
      }
      case 'SOA': {
        const a = await withTimeout(cb => r.resolveSoa(name, cb), ms);
        return [{
          type: 'SOA', name, ttl: 300,
          data: `${a.nsname} ${a.hostmaster} ${a.serial} ${a.refresh} ${a.retry} ${a.expire} ${a.minttl}`,
          ...a,
        }];
      }
      case 'CAA': {
        const a = await withTimeout(cb => r.resolveCaa(name, cb), ms);
        return a.map(c => ({
          type: 'CAA', name, ttl: 300,
          data: `${c.critical} ${c.issue || c.issuewild || c.iodef || ''}`,
        }));
      }
      case 'PTR': {
        const a = await withTimeout(cb => r.resolvePtr(name, cb), ms);
        return a.map(p => ({ type: 'PTR', name, data: p, ttl: 300 }));
      }
      default:
        return [];
    }
  } catch {
    // NXDOMAIN, ENOTFOUND, timeout — all expected for missing records
    return [];
  }
}

// ── Unified resolver entry point ──────────────────────────────────
/**
 * Resolve a DNS record using the appropriate resolver.
 *
 * @param {string}  name     - Domain name
 * @param {string}  type     - Record type (A, AAAA, MX, TXT, etc.)
 * @param {boolean} isPublic - true = Cloudflare DoH, false = internal UDP
 * @param {number}  timeout  - Timeout in ms (optional)
 */
function resolveAll(name, type, isPublic, timeout) {
  return isPublic
    ? resolvePublic(name, type, timeout)
    : resolveInternal(name, type, timeout);
}

// ── Utility: IPv4 to arpa notation ───────────────────────────────
/**
 * Convert an IPv4 address to its .in-addr.arpa PTR query name.
 * Example: 1.2.3.4 → 4.3.2.1.in-addr.arpa
 */
function ipToArpa(ip) {
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
    return ip.split('.').reverse().join('.') + '.in-addr.arpa';
  }
  return null;
}

// ── Startup connectivity tests ────────────────────────────────────
/**
 * Run basic connectivity tests 2 seconds after startup.
 * Results are logged but do not affect startup — the proxy
 * will still start even if DNS is temporarily unreachable.
 */
function runConnectivityTests() {
  setTimeout(() => {
    // Test internal DNS (only if configured)
    if (DNS_SERVERS.length) {
      internalResolver.resolve4('localhost', (err) => {
        if (err && err.code !== 'ENOTFOUND' && err.code !== 'ENODATA') {
          console.warn(`[WARN] Internal DNS test failed (${err.code}) — check DNS_SERVERS`);
        } else {
          console.log('[INFO] Internal DNS connectivity OK');
        }
      });
    }

    // Test public DNS (UDP, not DoH — just checks network reachability)
    publicResolver.resolve4('cloudflare.com', (err) => {
      if (err) console.warn(`[WARN] Public DNS test failed (${err.code})`);
      else     console.log('[INFO] Public DNS connectivity OK');
    });
  }, 2000);
}

module.exports = {
  resolveAll,
  resolvePublic,
  resolveInternal,
  ipToArpa,
  runConnectivityTests,
};
