'use strict';

// Response shapes below follow real Cloudflare DoH answers (cloudflare.com, google.com, dnssec-failed.org).

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const dnssec   = require('../lib/dnssec');

const SIG = (signer, tag = 34505) =>
  ({ name: signer + '.', type: 46, TTL: 300, data: `A 13 2 300 1795198613 1795018613 ${tag} ${signer}. OnUwpaoDupHTwwlR+q3Rif75GuQqYIG9xNF9P/umEXUi7Rk4WyHnr2yhph7lALGR9+d58gYUecg0/t4QzLFow==` });
const A = name => ({ name, type: 1, TTL: 102, data: '104.16.132.229' });

// Fake resolver: answers come from a table keyed by "type name [cd]"
function fakeQuery(table, calls) {
  return async (name, type, flags) => {
    const key = `${type} ${name}${flags && flags.cd ? ' cd' : ''}`;
    if (calls) calls.push(key);
    const v = table[key];
    if (v instanceof Error) throw v;
    if (!v) throw new Error('unexpected query: ' + key);
    return v;
  };
}

const DS_RESPONSE = { Status: 0, AD: true, Answer: [
  { name: 'cloudflare.com', type: 43, TTL: 86400, data: '2371 13 2 32996839a6d808afe3eb4a795a0e6a7a39a76fc52ff228b22b76f6d63826f2b9' },
  { name: 'cloudflare.com', type: 46, TTL: 86400, data: 'DS 13 2 86400 1795568538 1794959538 65344 com. ZyH+Qdr' + 'nj'.repeat(4) + ' extra' } ] };
const KEY_RESPONSE = { Status: 0, AD: true, Answer: [
  { name: 'cloudflare.com', type: 48, TTL: 300, data: '257 3 13 mdsswUyr3DPW132mOi8V9xESWE8jTo0dxCjjnopKl+GqJxpVXckHAeF+KkxLbxILfDLUT0rAK9iUzy1L53eKGQ==' },
  { name: 'cloudflare.com', type: 48, TTL: 300, data: '256 3 13 oJMRESz5E4gYzS/q6XDrvU1qMPYIjCWzJaOau8XNEZeqCYKD5ar0IRd8KqXXFJkqmVfRvMGPmM1x8fGAa2XhSA==' } ] };

test('secure: validated answer, with signer, algorithm, DS and keys', async () => {
  const calls = [];
  const r = await dnssec.checkDnssec('cloudflare.com', fakeQuery({
    'A cloudflare.com':      { Status: 0, AD: true, Answer: [A('cloudflare.com'), SIG('cloudflare.com')] },
    'DS cloudflare.com':     DS_RESPONSE,
    'DNSKEY cloudflare.com': KEY_RESPONSE,
  }, calls));

  assert.equal(r.status, 'secure');
  assert.equal(r.validated, true);
  assert.equal(r.signer, 'cloudflare.com');
  assert.deepEqual(r.algorithm, { number: 13, name: 'ECDSAP256SHA256', weak: false });
  assert.equal(r.signatureExpires, 1795198613 * 1000);
  assert.equal(r.ds.length, 1);                                  // the RRSIG on the DS answer is not a DS
  assert.equal(r.ds[0].keyTag, 2371);
  assert.equal(r.ds[0].digestType.name, 'SHA-256');
  assert.equal(r.ds[0].digest.length, 64);
  assert.deepEqual(r.keys.map(k => k.role), ['KSK', 'ZSK']);
  assert.ok(!calls.some(c => c.endsWith(' cd')), 'no unchecked query for a healthy domain');
});

test('insecure: an unsigned domain is a normal result, with no extra lookups', async () => {
  const calls = [];
  const r = await dnssec.checkDnssec('google.com', fakeQuery({
    'A google.com': { Status: 0, AD: false, Answer: [{ name: 'google.com', type: 1, TTL: 60, data: '142.250.1.1' }] },
  }, calls));
  assert.equal(r.status, 'insecure');
  assert.equal(r.validated, false);
  assert.equal(r.signer, null);
  assert.deepEqual(calls, ['A google.com']);
});

test('partial: signatures exist but the resolver could not validate them (no DS at the parent)', async () => {
  const r = await dnssec.checkDnssec('island.example', fakeQuery({
    'A island.example':      { Status: 0, AD: false, Answer: [A('island.example'), SIG('island.example', 111)] },
    'DS island.example':     { Status: 0, AD: false },
    'DNSKEY island.example': KEY_RESPONSE,
  }));
  assert.equal(r.status, 'partial');
  assert.equal(r.validated, false);
  assert.equal(r.signer, 'island.example');
  assert.equal(r.ds.length, 0);
  assert.equal(r.keys.length, 2);
});

test('bogus: SERVFAIL that goes away with checking disabled is a validation failure', async () => {
  const reason = 'EDE(9): DNSKEY Missing no SEP matching the DS found for dnssec-failed.org.';
  const r = await dnssec.checkDnssec('dnssec-failed.org', fakeQuery({
    'A dnssec-failed.org':    { Status: 2, AD: false, Comment: [reason] },
    'A dnssec-failed.org cd': { Status: 0, AD: false, Answer: [A('dnssec-failed.org'), SIG('dnssec-failed.org', 32784)], Comment: [reason] },
    'DS dnssec-failed.org':     { Status: 0 },
    'DNSKEY dnssec-failed.org': { Status: 0 },
  }));
  assert.equal(r.status, 'bogus');
  assert.equal(r.validated, false);
  assert.equal(r.reason, reason);
  assert.equal(r.signer, 'dnssec-failed.org');
});

test('unknown: SERVFAIL that persists with checking disabled is an outage, not a DNSSEC verdict', async () => {
  const r = await dnssec.checkDnssec('down.example', fakeQuery({
    'A down.example':    { Status: 2, Comment: ['EDE(23): Network Error'] },
    'A down.example cd': { Status: 2 },
  }));
  assert.equal(r.status, 'unknown');
  assert.match(r.reason, /Network Error/);
});

test('unknown: a failed lookup never throws', async () => {
  const a = await dnssec.checkDnssec('x.example', fakeQuery({ 'A x.example': new Error('DoH timeout') }));
  assert.equal(a.status, 'unknown');
  assert.match(a.reason, /could not be completed/);

  const b = await dnssec.checkDnssec('x.example', fakeQuery({ 'A x.example': { Status: 5 } }));   // REFUSED
  assert.equal(b.status, 'unknown');
});

test('a signed name that does not exist (NXDOMAIN) still counts as secure', async () => {
  const r = await dnssec.checkDnssec('nope.cloudflare.com', fakeQuery({
    'A nope.cloudflare.com': { Status: 3, AD: true, Authority: [SIG('cloudflare.com')] },
    'DS cloudflare.com':     DS_RESPONSE,
    'DNSKEY cloudflare.com': KEY_RESPONSE,
  }));
  assert.equal(r.status, 'secure');
  assert.equal(r.signer, 'cloudflare.com');                       // signer found in the Authority section
});

test('failing DS or DNSKEY lookups do not hide the main result', async () => {
  const r = await dnssec.checkDnssec('cloudflare.com', fakeQuery({
    'A cloudflare.com':      { Status: 0, AD: true, Answer: [A('cloudflare.com'), SIG('cloudflare.com')] },
    'DS cloudflare.com':     new Error('boom'),
    'DNSKEY cloudflare.com': new Error('boom'),
  }));
  assert.equal(r.status, 'secure');
  assert.deepEqual(r.ds, []);
  assert.deepEqual(r.keys, []);
});

test('weak algorithms and digests are flagged', () => {
  const ds = dnssec.parseDs('12345 5 1 ' + 'ab'.repeat(20));
  assert.equal(ds.algorithm.weak, true);
  assert.equal(ds.digestType.weak, true);
  assert.equal(dnssec.parseDs('1 8 2 ' + 'cd'.repeat(32)).algorithm.weak, false);
  assert.equal(dnssec.algorithm(99).name, 'Algorithm 99');       // unknown numbers still render
});

test('record parsers reject malformed data instead of throwing', () => {
  assert.equal(dnssec.parseRrsig('garbage'), null);
  assert.equal(dnssec.parseRrsig(''), null);
  assert.equal(dnssec.parseRrsig(undefined), null);
  assert.equal(dnssec.parseDs('1 2'), null);
  assert.equal(dnssec.parseDnskey('257 3'), null);
  assert.equal(dnssec.parseDnskey('x 3 13 key'), null);
});

test('RRSIG times are read in both Unix-seconds and YYYYMMDDHHMMSS form', () => {
  assert.equal(dnssec.parseSigTime('1795198613'), 1795198613000);
  assert.equal(dnssec.parseSigTime('20260115083000'), Date.UTC(2026, 0, 15, 8, 30, 0));
  assert.equal(dnssec.parseSigTime('abc'), null);
  const sig = dnssec.parseRrsig('A 8 2 300 20260115083000 20251215083000 12345 Example.COM. c2ln');
  assert.equal(sig.signer, 'example.com');
  assert.equal(sig.expiration, Date.UTC(2026, 0, 15, 8, 30, 0));
});

test('DNSKEY flags: 257 is a key-signing key, 256 a zone-signing key', () => {
  assert.equal(dnssec.parseDnskey('257 3 13 abc').role, 'KSK');
  assert.equal(dnssec.parseDnskey('256 3 13 abc').role, 'ZSK');
});
