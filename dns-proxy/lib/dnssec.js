// ── NetRecon — DNSSEC Status ─────────────────────────────────────
// Reports whether a public domain's DNS answers are protected by DNSSEC.
//
// How it is decided (using Cloudflare's validating resolver over DoH):
//   1. Ask for the domain's A record with the DNSSEC-OK flag.
//        AD flag set                         -> secure    (answer was cryptographically validated)
//        no AD flag, but signatures present  -> partial   (zone is signed, but the parent has no DS
//                                                          record, so nobody can validate it)
//        no AD flag, no signatures           -> insecure  (the domain is simply not signed)
//   2. If the resolver answers SERVFAIL, ask again with checking disabled.
//        data comes back                     -> bogus     (signed, but validation FAILS: resolvers
//                                                          that validate will refuse to resolve it)
//        still failing                       -> unknown   (an outage, not a DNSSEC verdict)
//   3. When the zone is signed, also read its DS and DNSKEY records so the
//      page can show algorithms and key roles.
//
// "Insecure" is a normal state, not an error: most domains are unsigned.
// Internal DNS is not covered, because plain UDP lookups to your own servers
// do not report validation.

'use strict';

// DNSSEC algorithm numbers (RFC 8624). `weak` marks algorithms that are deprecated or discouraged.
const ALGORITHMS = {
  1:  { name: 'RSAMD5',             weak: true  },
  3:  { name: 'DSA',                weak: true  },
  5:  { name: 'RSASHA1',            weak: true  },
  6:  { name: 'DSA-NSEC3-SHA1',     weak: true  },
  7:  { name: 'RSASHA1-NSEC3-SHA1', weak: true  },
  8:  { name: 'RSASHA256',          weak: false },
  10: { name: 'RSASHA512',          weak: false },
  12: { name: 'ECC-GOST',           weak: true  },
  13: { name: 'ECDSAP256SHA256',    weak: false },
  14: { name: 'ECDSAP384SHA384',    weak: false },
  15: { name: 'ED25519',            weak: false },
  16: { name: 'ED448',              weak: false },
};

const DIGEST_TYPES = {
  1: { name: 'SHA-1',   weak: true  },
  2: { name: 'SHA-256', weak: false },
  3: { name: 'GOST',    weak: true  },
  4: { name: 'SHA-384', weak: false },
};

const TYPE = { RRSIG: 46, DS: 43, DNSKEY: 48 };

const algorithm  = n => Object.assign({ number: n, weak: false, name: `Algorithm ${n}` }, ALGORITHMS[n]);
const digestType = n => Object.assign({ number: n, weak: false, name: `Digest ${n}` },    DIGEST_TYPES[n]);

// ── Record parsing ────────────────────────────────────────────────

/**
 * Convert an RRSIG time field to milliseconds. Resolvers print either Unix
 * seconds (Cloudflare) or YYYYMMDDHHMMSS.
 */
function parseSigTime(s) {
  if (/^\d{14}$/.test(s)) {
    return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14));
  }
  return /^\d+$/.test(s) ? Number(s) * 1000 : null;
}

/**
 * Parse an RRSIG record in presentation format:
 *   "A 13 2 300 1795198613 1795018613 34505 cloudflare.com. <signature>"
 * @returns {Object|null}
 */
function parseRrsig(data) {
  const f = String(data || '').trim().split(/\s+/);
  if (f.length < 9) return null;
  const alg = parseInt(f[1], 10);
  const exp = parseSigTime(f[4]);
  if (!Number.isInteger(alg) || exp === null) return null;
  return {
    covered:    f[0].toUpperCase(),
    algorithm:  alg,
    expiration: exp,
    inception:  parseSigTime(f[5]),
    keyTag:     parseInt(f[6], 10),
    signer:     f[7].replace(/\.$/, '').toLowerCase(),
  };
}

/** Parse a DS record: "2371 13 2 <hex digest>". */
function parseDs(data) {
  const f = String(data || '').trim().split(/\s+/);
  if (f.length < 4) return null;
  const [keyTag, alg, digest] = [parseInt(f[0], 10), parseInt(f[1], 10), parseInt(f[2], 10)];
  if (![keyTag, alg, digest].every(Number.isInteger)) return null;
  return { keyTag, algorithm: algorithm(alg), digestType: digestType(digest), digest: f.slice(3).join('').toLowerCase() };
}

/** Parse a DNSKEY record: "257 3 13 <base64 key>". The key material itself is not kept. */
function parseDnskey(data) {
  const f = String(data || '').trim().split(/\s+/);
  if (f.length < 4) return null;
  const flags = parseInt(f[0], 10), alg = parseInt(f[2], 10);
  if (!Number.isInteger(flags) || !Number.isInteger(alg)) return null;
  // Bit 15 of the flags marks a secure entry point (key-signing key)
  return { flags, role: (flags & 1) ? 'KSK' : 'ZSK', algorithm: algorithm(alg) };
}

/** All records of one numeric type from a DoH JSON response (Answer section, then Authority). */
function recordsOfType(json, type) {
  const all = [].concat((json && json.Answer) || [], (json && json.Authority) || []);
  return all.filter(r => Number(r.type) === type);
}

const firstRrsig = json => recordsOfType(json, TYPE.RRSIG).map(r => parseRrsig(r.data)).find(Boolean) || null;

/** The human-readable reason a resolver gives for a failure ("EDE(9): DNSKEY Missing ..."). */
const failureReason = json => (json && Array.isArray(json.Comment) ? json.Comment.join(' ') : (json && json.Comment) || '');

// ── The check ─────────────────────────────────────────────────────

/**
 * Work out the DNSSEC status of a domain.
 *
 * @param {string}   name    - Domain name
 * @param {Function} query   - async (name, type, flags) => DoH JSON. Injected so tests need no network.
 * @returns {Promise<Object>} { status, validated, signer, algorithm, signatureExpires, ds, keys, reason }
 *   status: 'secure' | 'partial' | 'insecure' | 'bogus' | 'unknown'
 */
async function checkDnssec(name, query) {
  const out = {
    status: 'unknown', validated: false, signer: null, algorithm: null,
    signatureExpires: null, ds: [], keys: [], reason: '',
  };

  let first;
  try {
    first = await query(name, 'A', { do: 1 });
  } catch (err) {
    out.reason = 'The DNSSEC check could not be completed';
    return out;
  }

  let sigSource = first;

  if (first.Status === 2) {
    // SERVFAIL. A validation failure and an outage look the same until validation is switched off.
    let unchecked = null;
    try { unchecked = await query(name, 'A', { do: 1, cd: 1 }); } catch { /* treated as unknown below */ }

    if (!unchecked || unchecked.Status !== 0) {
      out.reason = failureReason(first) || 'The resolver could not answer';
      return out;
    }
    out.status    = 'bogus';
    out.reason    = failureReason(first);
    sigSource     = unchecked;
  } else if (first.Status === 0 || first.Status === 3) {
    if (first.AD)                          { out.status = 'secure'; out.validated = true; }
    else if (firstRrsig(first))            out.status = 'partial';
    else                                   out.status = 'insecure';
  } else {
    out.reason = failureReason(first) || 'The resolver could not answer';
    return out;
  }

  // Details only make sense when the zone is signed
  if (out.status === 'insecure') return out;

  const sig = firstRrsig(sigSource);
  if (sig) {
    out.signer           = sig.signer;
    out.algorithm        = algorithm(sig.algorithm);
    out.signatureExpires = sig.expiration;
  }

  if (out.signer) {
    const [dsJson, keyJson] = await Promise.all([
      query(out.signer, 'DS',     { do: 1 }).catch(() => null),
      query(out.signer, 'DNSKEY', { do: 1 }).catch(() => null),
    ]);
    out.ds   = recordsOfType(dsJson,  TYPE.DS).map(r => parseDs(r.data)).filter(Boolean);
    out.keys = recordsOfType(keyJson, TYPE.DNSKEY).map(r => parseDnskey(r.data)).filter(Boolean);
  }
  return out;
}

module.exports = {
  checkDnssec, parseRrsig, parseDs, parseDnskey, parseSigTime, algorithm, digestType,
};
