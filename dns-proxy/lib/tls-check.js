// ── NetRecon — TLS Certificate Checker ───────────────────────────
// Connects to a domain on port 443 and inspects the SSL/TLS certificate.
// Returns issuer, validity dates, SANs, protocol version, and chain info.
//
// Uses Cloudflare DoH to resolve the domain first (avoids Docker DNS
// issues), then connects to the resolved IP with SNI.

'use strict';

const tls   = require('tls');
const https = require('https');

/**
 * Connects to a domain on port 443 and returns certificate details.
 * Resolves the domain via DoH first to bypass Docker's internal DNS.
 *
 * @param {string} domain    - Domain name to check
 * @param {number} timeoutMs - Connection timeout (default 5000ms)
 * @returns {Promise<Object>} Certificate details or { error: string }
 */
async function checkCert(domain, timeoutMs) {
  const ms = timeoutMs || 5000;

  // Step 1: Resolve domain to IP via Cloudflare DoH
  let ip;
  try {
    ip = await resolveViaDoH(domain, ms);
  } catch (err) {
    console.error(`[tls-check] DoH resolve failed for ${domain}: ${err.message}`);
    return { error: `DNS resolution failed: ${err.message}` };
  }

  if (!ip) {
    console.warn(`[tls-check] No A record for ${domain}`);
    return { error: `Could not resolve ${domain} — no A record found` };
  }

  // Step 2: TLS connect to the resolved IP with SNI
  return new Promise((resolve) => {
    let done = false;
    const finish = (result) => { if (!done) { done = true; resolve(result); } };

    try {
      const sock = tls.connect({
        host:               ip,
        port:               443,
        servername:         domain,
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

// ── DoH resolver ──────────────────────────────────────────────────
/**
 * Resolve a domain to an IPv4 address via Cloudflare DoH.
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
          if (d.Answer && d.Answer.length > 0) {
            const aRecord = d.Answer.find(a => a.type === 1);
            resolve(aRecord ? aRecord.data : null);
          } else {
            resolve(null);
          }
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('DoH timeout')); });
  });
}

module.exports = { checkCert };
