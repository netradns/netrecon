'use strict';

// Builds a self-signed X.509 certificate with any validity window and serves it
// from a local TLS server. Needs no openssl and no checked-in key files, and the
// dates are relative to "now", so the tests never go stale.

const crypto = require('crypto');
const tls    = require('tls');

// ── Minimal DER encoding ──────────────────────────────────────────
const lenBytes = n => n < 128 ? Buffer.from([n]) :
  n < 256 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 0xff]);
const tlv  = (tag, ...parts) => { const body = Buffer.concat(parts); return Buffer.concat([Buffer.from([tag]), lenBytes(body.length), body]); };
const seq  = (...p) => tlv(0x30, ...p);
const set  = (...p) => tlv(0x31, ...p);
const oid  = bytes => tlv(0x06, Buffer.from(bytes));
const utf8 = s => tlv(0x0c, Buffer.from(s, 'utf8'));
const utc  = d => tlv(0x17, Buffer.from(d.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z'));

const OID_CN        = [0x55, 0x04, 0x03];                                   // 2.5.4.3
const OID_ECDSA_SHA = [0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02];     // 1.2.840.10045.4.3.2

const name = cn => seq(set(seq(oid(OID_CN), utf8(cn))));

/**
 * @param {Object} o
 * @param {number} o.notBeforeDays - start of validity, in days from now (negative = in the past)
 * @param {number} o.notAfterDays  - end of validity, in days from now (negative = already expired)
 * @param {string} [o.cn]
 * @param {string} [o.issuer]
 * @returns {{ cert: string, key: string }} PEM strings
 */
function makeCert({ notBeforeDays, notAfterDays, cn = 'test.local', issuer = cn }) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const day = 86400000, now = Date.now();

  const serial = crypto.randomBytes(8); serial[0] = (serial[0] & 0x7f) | 0x01;   // positive, so no padding byte is needed
  const sigAlg = seq(oid(OID_ECDSA_SHA));
  const tbs = seq(
    tlv(0xa0, tlv(0x02, Buffer.from([2]))),                                  // version v3
    tlv(0x02, serial),
    sigAlg,
    name(issuer),
    seq(utc(new Date(now + notBeforeDays * day)), utc(new Date(now + notAfterDays * day))),
    name(cn),
    publicKey.export({ type: 'spki', format: 'der' })
  );
  const signature = crypto.sign('sha256', tbs, privateKey);                  // DER-encoded ECDSA
  const der = seq(tbs, sigAlg, tlv(0x03, Buffer.from([0]), signature));

  const pem = der.toString('base64').match(/.{1,64}/g).join('\n');
  return {
    cert: `-----BEGIN CERTIFICATE-----\n${pem}\n-----END CERTIFICATE-----\n`,
    key:  privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}

/**
 * Start a TLS server on 127.0.0.1 that presents the given certificate.
 * @returns {Promise<{ port: number, setCert: Function, close: Function }>}
 */
function serveCert(opts) {
  let current = makeCert(opts);
  const server = tls.createServer({ cert: current.cert, key: current.key }, sock => sock.end());
  server.on('tlsClientError', () => { /* clients that hang up early are fine */ });

  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve({
      port: server.address().port,
      // Swap in a different certificate (e.g. to simulate renewal)
      setCert(o) { current = makeCert(o); server.setSecureContext({ cert: current.cert, key: current.key }); },
      close: () => new Promise(r => server.close(r)),
    }));
  });
}

module.exports = { makeCert, serveCert };
