// ── NetRecon — TLS Certificate Checker ───────────────────────────
// Connects to a host and inspects its SSL/TLS certificate.
// Returns issuer, validity dates, SANs, protocol version, and chain info.
//
// Used in two ways:
//   1. The public TLS check tool (port 443, public addresses only).
//   2. The admin certificate watcher, which can also check internal hosts,
//      IP addresses and other ports (LDAPS 636, 8443, ...).
//
// Safety: a public visitor must not be able to aim this at the network the
// server runs on. Unless the caller sets allowPrivate (admin watches of
// internal hosts), any address that is private, loopback, link-local or
// otherwise reserved is refused, and the connection goes to the exact IP
// that was checked, so DNS cannot change the answer between check and use.

'use strict';

const tls   = require('tls');
const https = require('https');
const { parseIPv4, isPrivateAddress } = require('./net-guard');

/**
 * Connects to a host and returns certificate details.
 *
 * @param {string}   host                  - Domain name or IPv4 address
 * @param {Object}   [opts]
 * @param {number}   [opts.timeoutMs=5000]
 * @param {number}   [opts.port=443]
 * @param {boolean}  [opts.allowPrivate=false] - Permit private/reserved addresses
 * @param {boolean}  [opts.internal=false]     - Resolve names with the internal DNS servers instead of public DoH
 * @param {Function} [opts.resolve]            - Override name resolution (async (host, ms) => ip). Used by tests.
 * @returns {Promise<Object>} Certificate details or { error: string }
 */
async function checkCert(host, opts) {
  const o       = opts || {};
  const ms      = o.timeoutMs || 5000;
  const port    = o.port || 443;
  const literal = parseIPv4(host);

  // Step 1: work out which IP to connect to
  let ip;
  if (literal) {
    ip = host;                                   // already an IP, no DNS needed
  } else if (/^\d+(\.\d+){0,3}$/.test(host)) {
    return { error: 'Invalid IP address' };      // looks numeric but is not a canonical IPv4
  } else {
    try {
      ip = await (o.resolve || (o.internal ? resolveInternalA : resolveViaDoH))(host, ms);
    } catch (err) {
      console.error(`[tls-check] DNS resolve failed for ${host}: ${err.message}`);
      return { error: `DNS resolution failed: ${err.message}` };
    }
    if (!ip) {
      console.warn(`[tls-check] No A record for ${host}`);
      return { error: `Could not resolve ${host} — no A record found` };
    }
  }

  // Step 2: refuse private and reserved addresses unless the caller opted in
  if (!o.allowPrivate && isPrivateAddress(ip)) {
    return { error: 'This address is private or reserved, so it cannot be checked from the public tool' };
  }

  // Step 3: TLS connect to that exact IP (SNI only for names, never for IP literals)
  return new Promise((resolve) => {
    let done = false;
    const finish = (result) => { if (!done) { done = true; resolve(result); } };

    try {
      const sock = tls.connect({
        host:               ip,
        port,
        servername:         literal ? undefined : host,
        rejectUnauthorized: false,
        timeout:            ms,
      });

      sock.setTimeout(ms);
      sock.on('timeout', () => { sock.destroy(); finish({ error: 'Connection timed out' }); });
      sock.on('error',   err => { sock.destroy(); finish({ error: err.message }); });

      sock.on('secureConnect', () => {
        try {
          const cert = sock.getPeerCertificate(true);
          if (!cert || !cert.subject) {
            sock.destroy();
            return finish({ error: 'No certificate returned' });
          }

          const result = {
            subject:      formatDN(cert.subject),
            commonName:   cert.subject.CN || '',
            issuer:       formatDN(cert.issuer),
            issuerOrg:    cert.issuer.O || cert.issuer.CN || '',
            validFrom:    cert.valid_from,
            validTo:      cert.valid_to,
            daysLeft:     daysUntil(cert.valid_to),
            expired:      new Date(cert.valid_to) < new Date(),
            sans:         parseSans(cert.subjectaltname),
            serialNumber: cert.serialNumber || '',
            fingerprint:  cert.fingerprint256 || cert.fingerprint || '',
            protocol:     sock.getProtocol ? sock.getProtocol() : '',
            cipher:       sock.getCipher ? sock.getCipher().name : '',
            authorized:   sock.authorized,
            authError:    sock.authorizationError || null,
            chain:        buildChain(cert),
          };

          sock.destroy();
          finish(result);
        } catch (err) {
          sock.destroy();
          finish({ error: `Certificate parse error: ${err.message}` });
        }
      });
    } catch (err) {
      finish({ error: err.message });
    }
  });
}

// ── Helpers ───────────────────────────────────────────────────────

function formatDN(dn) {
  if (!dn) return '';
  const parts = [];
  if (dn.CN) parts.push(`CN=${dn.CN}`);
  if (dn.O)  parts.push(`O=${dn.O}`);
  if (dn.OU) parts.push(`OU=${dn.OU}`);
  if (dn.C)  parts.push(`C=${dn.C}`);
  if (dn.ST) parts.push(`ST=${dn.ST}`);
  if (dn.L)  parts.push(`L=${dn.L}`);
  return parts.join(', ');
}

function parseSans(raw) {
  if (!raw) return [];
  return raw.split(',')
    .map(s => s.trim().replace(/^DNS:/, '').replace(/^IP Address:/, 'IP:'))
    .filter(Boolean);
}

function daysUntil(dateStr) {
  const target = new Date(dateStr);
  const now    = new Date();
  return Math.floor((target - now) / (1000 * 60 * 60 * 24));
}

function buildChain(cert) {
  const chain = [];
  let current = cert;
  const seen  = new Set();

  for (let i = 0; i < 5 && current; i++) {
    const fp = current.fingerprint256 || current.fingerprint || '';
    if (seen.has(fp)) break;
    seen.add(fp);
    chain.push({ subject: formatDN(current.subject), issuer: formatDN(current.issuer) });
    current = current.issuerCertificate;
  }

  return chain;
}

// ── Name resolution ───────────────────────────────────────────────

/**
 * Resolve a domain to an IPv4 address via Cloudflare DoH.
 * Used for public checks so Docker's own DNS never decides the answer.
 *
 * @param {string} domain
 * @param {number} timeoutMs
 * @returns {Promise<string|null>} IPv4 address or null
 */
function resolveViaDoH(domain, timeoutMs) {
  const url = `https://1.1.1.1/dns-query?name=${encodeURIComponent(domain)}&type=A`;

  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'Accept': 'application/dns-json', 'User-Agent': 'NetRecon/1.0' },
      timeout: timeoutMs || 4000,
    }, res => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`DoH HTTP ${res.statusCode}`));
      }
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => {
        try {
          const d = JSON.parse(body);
          const aRecord = d.Answer && d.Answer.find(a => a.type === 1);
          resolve(aRecord ? aRecord.data : null);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('DoH timeout')); });
  });
}

/**
 * Resolve a host to an IPv4 address using the internal DNS servers.
 * The resolver is required lazily so this file loads without its setup.
 *
 * @returns {Promise<string|null>}
 */
async function resolveInternalA(host, timeoutMs) {
  const { resolveInternal } = require('./resolver');
  const records = await resolveInternal(host, 'A', timeoutMs);
  return records.length ? records[0].data : null;
}

module.exports = { checkCert };
