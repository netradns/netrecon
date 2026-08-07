// ── NetRecon DNS Proxy — HTTP Route Handlers ─────────────────────
// Each exported function handles one HTTP route.
// Routes are registered in server.js.
//
// All handlers follow the same pattern:
//   1. Validate input (return 400 on bad input)
//   2. Perform the operation
//   3. Track stats
//   4. Return JSON response
//
// Error handling: handlers catch their own errors and return appropriate
// HTTP status codes. The top-level try/catch in server.js is a last resort.
//
// Adding a new endpoint:
//   1. Add a handler function here
//   2. Export it at the bottom
//   3. Register it in server.js

'use strict';

const https = require('https');
const http  = require('http');
const { resolveAll, ipToArpa } = require('./resolver');
const stats = require('./stats');
const {
  DNS_SERVERS, PUBLIC_TIMEOUT, DNS_TIMEOUT, ALLOWED_DOMAINS,
} = require('./config');
const { getActiveHash } = require('./admin/password');
const { getConfig }     = require('./admin/config-store');
const { checkBlacklists } = require('./blacklist');
const { checkCert }       = require('./tls-check');

// ── Shared helpers ────────────────────────────────────────────────

/**
 * Send a JSON response safely.
 * Guards against writing to an already-finished response (can happen
 * if a timeout fires after the response was already sent).
 */
function jsonSafe(res, status, data) {
  if (res.writableEnded || res.headersSent) return;
  try {
    const body = JSON.stringify(data);
    res.writeHead(status, {
      'Content-Type':  'application/json',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch (err) {
    console.error(`[ERROR] Failed to send response: ${err.message}`);
    try { res.end(); } catch {}
  }
}

/**
 * Check if a domain is in the ALLOWED_DOMAINS list.
 * If ALLOWED_DOMAINS is empty, all domains are allowed.
 * Used to restrict the Internal DNS tool to specific domains.
 */
function isAllowed(name) {
  if (!ALLOWED_DOMAINS.length) return true;
  const lower = name.toLowerCase();
  return ALLOWED_DOMAINS.some(d => lower === d || lower.endsWith('.' + d));
}

/**
 * Read the request body as a string.
 * Enforces an 8k size limit and 10s timeout.
 * nginx already blocks requests >4k, so this is a safety net.
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error('Body read timeout'));
    }, 10000);

    req.on('data', chunk => {
      body += chunk;
      if (body.length > 8192) {
        clearTimeout(timer);
        req.destroy();
        reject(new Error('Body too large'));
      }
    });
    req.on('end',   () => { clearTimeout(timer); resolve(body); });
    req.on('error', err => { clearTimeout(timer); reject(err); });
  });
}

// ── DoH type number maps ──────────────────────────────────────────
// Used to format responses in DoH-compatible JSON format
// and to look up type names from numeric type codes.
const TYPE_MAP  = { A:1, AAAA:28, CNAME:5, MX:15, NS:2, SOA:6, TXT:16, SRV:33, PTR:12, CAA:257 };
const TYPE_RMAP = {};
Object.entries(TYPE_MAP).forEach(([k, v]) => { TYPE_RMAP[v] = k; TYPE_RMAP[k] = k; });

// ── Reusable HTTP/HTTPS JSON fetcher ─────────────────────────────
/**
 * Fetch JSON from an HTTP or HTTPS URL.
 * Defined at module scope to avoid function recreation on every request.
 *
 * @param {object} mod       - Node's http or https module
 * @param {string} url       - Full URL to fetch
 * @param {object} headers   - Request headers
 * @param {number} timeoutMs - Request timeout in ms
 */
function fetchJson(mod, url, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req2 = mod.get(url, { headers, timeout: timeoutMs || 4000 }, res2 => {
      // Drain and reject on non-200 to free the socket
      if (res2.statusCode !== 200) {
        res2.resume();
        reject(new Error(`HTTP ${res2.statusCode}`));
        return;
      }
      let body = '';
      res2.on('data', c => { body += c; });
      res2.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(e); }
      });
    });
    req2.on('error', reject);
    req2.on('timeout', () => { req2.destroy(); reject(new Error('timeout')); });
  });
}

// ── Route handlers ────────────────────────────────────────────────

/**
 * GET /health
 * Returns 200 OK with the configured internal DNS servers.
 * Used by Docker healthcheck and the admin dashboard proxy health panel.
 */
function handleHealth(req, res) {
  return jsonSafe(res, 200, { ok: true, servers: DNS_SERVERS });
}

/**
 * GET /app-config
 * Returns non-sensitive runtime configuration for the frontend.
 * - statsPasswordHash: used by the login gate to validate the password
 *   client-side without the plaintext ever being transmitted.
 * - internalDnsEnabled: controls whether the Internal DNS tool is shown.
 *   Reads from config-store so UI changes take effect without restart.
 */
function handleAppConfig(req, res) {
  const cfg = getConfig();
  return jsonSafe(res, 200, {
    statsPasswordHash:  getActiveHash(),
    internalDnsEnabled: cfg.internalDnsEnabled === false ? false : true,
    dnsQuickLinks:      cfg.dnsQuickLinks  || [],
    idnsQuickLinks:     cfg.idnsQuickLinks || [],
  });
}

/**
 * GET /dns-query?name=example.com&type=TXT
 * Single-type DNS query via Cloudflare DoH.
 * Returns a DoH-compatible JSON response (same format as Cloudflare's API).
 * Used by the DKIM selector probing in the frontend.
 */
async function handleDnsQuery(req, res, query) {
  const name     = (query.name || '').trim();
  const rawType  = (query.type || 'A').toString();
  const typeName = TYPE_RMAP[rawType] || TYPE_RMAP[parseInt(rawType)] || rawType.toUpperCase();
  const typeNum  = TYPE_MAP[typeName] || parseInt(rawType) || 1;

  if (!name)             return jsonSafe(res, 400, { error: 'name parameter required' });
  if (name.length > 253) return jsonSafe(res, 400, { error: 'Domain name too long' });
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
    return jsonSafe(res, 400, { error: 'Invalid domain name characters' });
  }

  const t0 = Date.now();
  try {
    // Handle PTR lookups: convert IP to arpa notation
    let queryName = name;
    if (typeName === 'PTR' && /^(\d{1,3}\.){3}\d{1,3}$/.test(name)) {
      queryName = ipToArpa(name);
      if (!queryName) return jsonSafe(res, 400, { error: 'Invalid IP for PTR lookup' });
    }

    const records    = await resolveAll(queryName, typeName, true, PUBLIC_TIMEOUT);
    const responseMs = Date.now() - t0;

    const st = stats.load();
    stats.track(st, {
      type: 'dns', target: stats.historyTarget(name), source: 'public',
      recordType: typeName, recordCount: records.length,
      responseMs, success: true, skipHistory: !stats.shouldLog(name),
    });
    stats.save(st);

    // Return DoH-compatible response format
    return jsonSafe(res, 200, {
      Status: 0, TC: false, RD: true, RA: true, AD: false, CD: false,
      Question: [{ name: name + (name.endsWith('.') ? '' : '.'), type: typeNum }],
      Answer: records.map(r => ({
        name: (r.name || name) + (name.endsWith('.') ? '' : '.'),
        type: TYPE_MAP[r.type] || typeNum,
        TTL:  r.ttl || 300,
        data: r.data || '',
      })),
    });

  } catch (err) {
    const responseMs = Date.now() - t0;
    console.error(`[ERROR] dns-query ${name} ${typeName}: ${err.message}`);
    const st = stats.load();
    stats.track(st, {
      type: 'dns', target: stats.historyTarget(name), source: 'public',
      recordType: typeName, recordCount: 0, responseMs,
      success: false, errorCode: err.code || err.message,
      skipHistory: !stats.shouldLog(name),
    });
    stats.save(st);
    return jsonSafe(res, 200, {
      Status: 2, TC: false, RD: true, RA: true, AD: false, CD: false,
      Question: [{ name: name + '.', type: typeNum }],
      Comment: `Resolution failed: ${err.message}`,
    });
  }
}

/**
 * POST /dns-query-multi
 * Body: { name: string, types: string[], emailSecurity: boolean }
 *
 * Resolves multiple record types in parallel in a single request.
 * This is the primary endpoint used by the public DNS lookup tool.
 * Cuts perceived latency from ~6s (sequential) to ~300ms (parallel).
 *
 * emailSecurity: true also queries _dmarc, default._domainkey,
 * _mta-sts, and _smtp._tls sub-domains.
 */
async function handleDnsQueryMulti(req, res) {
  let body;
  try { body = JSON.parse(await readBody(req)); }
  catch { return jsonSafe(res, 400, { error: 'Invalid JSON body' }); }

  const name = (body.name || '').trim();
  if (!name) return jsonSafe(res, 400, { error: 'name required' });
  if (name.length > 253 || !/^[a-zA-Z0-9._-]+$/.test(name)) {
    return jsonSafe(res, 400, { error: 'Invalid domain name' });
  }

  // Whitelist valid record types and cap at 12 to prevent abuse
  const VALID = new Set(['A','AAAA','CNAME','MX','NS','TXT','SOA','CAA','SRV','PTR']);
  const types = (Array.isArray(body.types)
    ? body.types
    : ['A','AAAA','CNAME','MX','NS','TXT','SOA','CAA'])
    .filter(t => VALID.has(String(t).toUpperCase()))
    .slice(0, 12);

  // Email security sub-queries (only when emailSecurity: true)
  const emailQueries = body.emailSecurity ? [
    { name: `_dmarc.${name}`,             type: 'TXT', label: 'DMARC'           },
    { name: `default._domainkey.${name}`, type: 'TXT', label: 'DKIM (default)'  },
    { name: `_mta-sts.${name}`,           type: 'TXT', label: 'MTA-STS'         },
    { name: `_smtp._tls.${name}`,         type: 'TXT', label: 'SMTP TLS'        },
  ] : [];

  const t0 = Date.now();

  // Fire all queries in parallel — this is the key performance win
  const [stdResults, emailResults] = await Promise.all([
    Promise.all(types.map(t =>
      resolveAll(name, t, true, PUBLIC_TIMEOUT).then(recs => ({ type: t, records: recs }))
    )),
    Promise.all(emailQueries.map(q =>
      resolveAll(q.name, q.type, true, PUBLIC_TIMEOUT).then(recs => ({
        label: q.label, name: q.name, records: recs,
      }))
    )),
  ]);

  const responseMs = Date.now() - t0;

  // Build results map: { A: [...], MX: [...], ... }
  const results = {};
  stdResults.forEach(r => { if (r.records.length) results[r.type] = r.records; });

  // Build email security map: { 'DMARC': { name, records }, ... }
  const emailSecurity = {};
  emailResults.forEach(r => {
    if (r.records.length) emailSecurity[r.label] = { name: r.name, records: r.records };
  });

  const st = stats.load();
  stats.track(st, {
    type: 'dns', target: stats.historyTarget(name), source: 'public',
    recordType: 'MULTI',
    recordCount: Object.values(results).flat().length,
    responseMs, success: true, skipHistory: !stats.shouldLog(name),
  });
  stats.save(st);

  return jsonSafe(res, 200, { name, results, emailSecurity, responseMs });
}

/**
 * GET /geo?ip=1.2.3.4
 * IP geolocation lookup.
 * Tries ipinfo.io first (supports IPv4 + IPv6), falls back to
 * ip-api.com (IPv4 only) if ipinfo.io fails.
 *
 * Server-side to avoid CORS issues and keep API keys server-side
 * if you add an ipinfo.io token in the future.
 */
async function handleGeo(req, res, query) {
  const ip     = (query.ip || '').trim();
  const isIPv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(ip);
  const isIPv6 = ip.includes(':');

  if (!ip || (!isIPv4 && !isIPv6)) {
    return jsonSafe(res, 400, { error: 'Valid IP address required' });
  }

  // Try ipinfo.io — supports both IPv4 and IPv6
  try {
    const d = await fetchJson(
      https,
      `https://ipinfo.io/${encodeURIComponent(ip)}/json`,
      { 'Accept': 'application/json', 'User-Agent': 'NetRecon/1.0' }
    );
    if (d && !d.error && d.ip) return jsonSafe(res, 200, d);
  } catch (e) {
    console.warn(`[WARN] ipinfo.io ${ip}: ${e.message}`);
  }

  // Fallback: ip-api.com (IPv4 only, free tier)
  if (isIPv4) {
    try {
      const d = await fetchJson(
        http,
        `http://ip-api.com/json/${ip}?fields=status,city,regionName,countryCode,zip,lat,lon,as,org,timezone,query,reverse`,
        { 'Accept': 'application/json', 'User-Agent': 'NetRecon/1.0' }
      );
      if (d && d.status === 'success') {
        return jsonSafe(res, 200, {
          ip:       d.query,
          city:     d.city,
          region:   d.regionName,
          country:  d.countryCode,
          postal:   d.zip,
          loc:      `${d.lat},${d.lon}`,
          org:      `${d.as} ${d.org}`.trim(),
          timezone: d.timezone,
          hostname: d.reverse || '',
        });
      }
    } catch (e) {
      console.warn(`[WARN] ip-api.com ${ip}: ${e.message}`);
    }
  }

  // Both providers failed — return a structured error (not HTTP 500)
  // The frontend handles this gracefully with an informational message
  return jsonSafe(res, 200, { error: 'Geolocation unavailable', ip });
}

/**
 * GET /resolve?name=server.corp.local&type=A
 * Single-type internal DNS lookup against your DNS_SERVERS.
 * Used by the Internal DNS tool for specific record type queries.
 */
async function handleResolve(req, res, query) {
  const name = (query.name || '').trim();
  const type = (query.type || 'A').toUpperCase();

  if (!name) return jsonSafe(res, 400, { error: 'name parameter required' });
  if (name.length > 253 || !/^[a-zA-Z0-9._-]+$/.test(name)) {
    return jsonSafe(res, 400, { error: 'Invalid domain name' });
  }
  if (!DNS_SERVERS.length) return jsonSafe(res, 503, { error: 'Internal DNS not configured — set DNS_SERVERS in docker-compose.yml' });
  if (!isAllowed(name)) return jsonSafe(res, 403, { error: 'Domain not permitted' });

  const ALLOWED_TYPES = new Set(['A','AAAA','CNAME','MX','SRV','TXT','NS','PTR','SOA','CAA']);
  if (!ALLOWED_TYPES.has(type)) return jsonSafe(res, 400, { error: 'Unsupported type' });

  // Convert IP to arpa notation for PTR lookups
  let queryName = name;
  if (type === 'PTR' && /^(\d{1,3}\.){3}\d{1,3}$/.test(name)) {
    queryName = ipToArpa(name);
    if (!queryName) return jsonSafe(res, 400, { error: 'Invalid IP for PTR' });
  }

  const t0 = Date.now();
  try {
    const records    = await resolveAll(queryName, type, false, DNS_TIMEOUT);
    const responseMs = Date.now() - t0;
    const st = stats.load();
    stats.track(st, {
      type: 'idns', target: name, source: 'internal',
      recordType: type, recordCount: records.length, responseMs, success: true,
    });
    stats.save(st);
    return jsonSafe(res, 200, {
      name, type, server: DNS_SERVERS[0], records, count: records.length, responseMs,
    });
  } catch (err) {
    const responseMs = Date.now() - t0;
    const st = stats.load();
    stats.track(st, {
      type: 'idns', target: name, source: 'internal',
      recordType: type, recordCount: 0, responseMs,
      success: false, errorCode: err.code || err.message,
    });
    stats.save(st);
    return jsonSafe(res, 500, { error: err.message });
  }
}

/**
 * GET /resolve-all?name=server.corp.local
 * Resolves all common record types in parallel against your DNS_SERVERS.
 * This is the primary endpoint used by the Internal DNS tool.
 * For IP addresses, only PTR is queried.
 */
async function handleResolveAll(req, res, query) {
  const name = (query.name || '').trim();

  if (!name) return jsonSafe(res, 400, { error: 'name required' });
  if (name.length > 253 || !/^[a-zA-Z0-9._-]+$/.test(name)) {
    return jsonSafe(res, 400, { error: 'Invalid domain name' });
  }
  if (!DNS_SERVERS.length) return jsonSafe(res, 503, { error: 'Internal DNS not configured — set DNS_SERVERS in docker-compose.yml' });
  if (!isAllowed(name)) return jsonSafe(res, 403, { error: 'Domain not permitted' });

  const isIP  = /^(\d{1,3}\.){3}\d{1,3}$/.test(name);
  const types = isIP ? ['PTR'] : ['A','AAAA','CNAME','MX','SRV','TXT','NS'];

  const t0 = Date.now();
  try {
    const results = await Promise.all(types.map(t => {
      const qname = (t === 'PTR' && isIP) ? ipToArpa(name) : name;
      return resolveAll(qname, t, false, DNS_TIMEOUT);
    }));
    const all        = results.flat();
    const responseMs = Date.now() - t0;
    const st = stats.load();
    stats.track(st, {
      type: 'idns', target: name, source: 'internal',
      recordType: 'ALL', recordCount: all.length, responseMs, success: true,
    });
    stats.save(st);
    return jsonSafe(res, 200, {
      name, server: DNS_SERVERS[0], records: all, count: all.length, responseMs,
    });
  } catch (err) {
    const responseMs = Date.now() - t0;
    const st = stats.load();
    stats.track(st, {
      type: 'idns', target: name, source: 'internal',
      recordType: 'ALL', recordCount: 0, responseMs,
      success: false, errorCode: err.code || err.message,
    });
    stats.save(st);
    return jsonSafe(res, 500, { error: err.message });
  }
}

/**
 * POST /stats/log
 * Body: { type: string, target: string }
 * Called by the frontend to log non-DNS tool usage (calc, cloud, ip).
 * DNS lookups are tracked server-side automatically — this handles the rest.
 */
async function handleStatsLog(req, res) {
  try {
    const body   = JSON.parse(await readBody(req));
    const VALID  = new Set(['dns','ip','idns','calc','cloud']);
    const type   = String(body.type   || '');
    const target = String(body.target || '').slice(0, 100);

    if (!VALID.has(type) || !target) {
      return jsonSafe(res, 400, { error: 'Invalid type or missing target' });
    }

    // For DNS/IP types, skip if already tracked server-side to avoid duplicates
    const isDns = type === 'dns' || type === 'ip';
    const skip  = isDns && !stats.shouldLog(target);

    const st = stats.load();
    stats.track(st, {
      type,
      target:      isDns ? stats.historyTarget(target) : target,
      source:      'client',
      recordType:  null,
      recordCount: 0,
      responseMs:  0,
      success:     true,
      skipHistory: skip,
    });
    stats.save(st);
    return jsonSafe(res, 200, { ok: true });

  } catch {
    return jsonSafe(res, 400, { error: 'Invalid JSON body' });
  }
}

/**
 * GET /stats
 * Returns the full stats object for the admin dashboard.
 */
function handleStatsGet(req, res) {
  return jsonSafe(res, 200, stats.load());
}

/**
 * POST /stats/clear
 * Resets all stats to zero. Used by the "Clear all" button on the dashboard.
 */
function handleStatsClear(req, res) {
  stats.clear();
  return jsonSafe(res, 200, { ok: true });
}

/**
 * GET /blacklist?ip=1.2.3.4
 * Checks an IPv4 address against common DNS-based blocklists.
 * Returns an array of results, one per blocklist.
 */
async function handleBlacklist(req, res, query) {
  const ip = (query.ip || '').trim();
  if (!ip || !/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
    return jsonSafe(res, 400, { error: 'Valid IPv4 address required' });
  }

  try {
    console.log(`[INFO] Blacklist check for ${ip}`);
    const results = await checkBlacklists(ip);
    const listed  = results.filter(r => r.listed).length;
    console.log(`[INFO] Blacklist check complete: ${listed}/${results.length} listed`);
    return jsonSafe(res, 200, { ip, results, listed, total: results.length });
  } catch (err) {
    console.error(`[ERROR] blacklist ${ip}: ${err.message}`);
    return jsonSafe(res, 500, { error: err.message });
  }
}

/**
 * GET /tls-check?domain=example.com
 * Connects to a domain on port 443 and returns TLS certificate details.
 */
async function handleTlsCheck(req, res, query) {
  const domain = (query.domain || '').trim().toLowerCase();
  if (!domain || domain.length > 253 || !/^[a-z0-9._-]+$/.test(domain)) {
    return jsonSafe(res, 400, { error: 'Valid domain name required' });
  }

  try {
    console.log(`[INFO] TLS check for ${domain}`);
    const result = await checkCert(domain);
    console.log(`[INFO] TLS check complete: ${result.error ? 'error: ' + result.error : result.commonName || 'ok'}`);
    return jsonSafe(res, 200, { domain, ...result });
  } catch (err) {
    console.error(`[ERROR] tls-check ${domain}: ${err.message}`);
    return jsonSafe(res, 500, { error: err.message });
  }
}

module.exports = {
  handleHealth,
  handleAppConfig,
  handleDnsQuery,
  handleDnsQueryMulti,
  handleGeo,
  handleResolve,
  handleResolveAll,
  handleStatsLog,
  handleStatsGet,
  handleStatsClear,
  handleBlacklist,
  handleTlsCheck,
  jsonSafe,
};
