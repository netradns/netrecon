'use strict';

// Response shapes follow real RDAP answers from Verisign (.com) and Nominet (.uk).
// No network is used: the HTTP function is replaced with a fake.

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const rdap = require('../lib/rdap');

const BOOT = { services: [
  [['com', 'net'], ['https://rdap.verisign.com/com/v1/']],
  [['uk'],         ['http://insecure.example/', 'https://rdap.nominet.uk/uk/']],
  [['nl'],         ['https://rdap.sidn.nl/']],
  [['bad'],        ['http://only-http.example/']],
] };

const D = (iso, days) => new Date(Date.parse(iso) + (days || 0) * 86400000).toISOString();

/** A domain object like a registry returns. Leave a field out to leave it out of the answer. */
function domainJson(o) {
  const events = [];
  if (o.registration) events.push({ eventAction: 'registration', eventDate: o.registration });
  if (o.expiration)   events.push({ eventAction: 'expiration',   eventDate: o.expiration });
  events.push({ eventAction: 'last changed', eventDate: o.changed || '2026-08-14T00:00:00Z' });
  events.push({ eventAction: 'last update of RDAP database', eventDate: '2026-11-19T00:00:00Z' });
  return {
    ldhName: o.ldhName,
    events,
    status: o.status || ['client transfer prohibited'],
    nameservers: (o.ns || ['A.IANA-SERVERS.NET']).map(ldhName => ({ ldhName })),
    entities: o.registrar === null ? [] : [{ roles: ['registrar'], vcardArray: ['vcard', [['version', {}, 'text', '4.0'], o.org ? ['org', {}, 'text', [o.org]] : ['fn', {}, 'text', o.registrar || 'Example Registrar, Inc.']]] }],
  };
}

let calls;
/** Install a fake network. `answers` maps a URL (or URL prefix) to { status, json } or an Error. */
function fakeNetwork(answers) {
  calls = [];
  rdap.setFetcher(async url => {
    calls.push(url);
    if (url === 'https://data.iana.org/rdap/dns.json') return { status: 200, json: BOOT };
    const key = Object.keys(answers).find(k => url === k);
    if (!key) return { status: 404, json: null };
    if (answers[key] instanceof Error) throw answers[key];
    return answers[key];
  });
}

beforeEach(() => { rdap.clearCache(); rdap.setFetcher(null); calls = []; });

test('normalizeDomain accepts real names and rejects everything else', () => {
  assert.equal(rdap.normalizeDomain('Example.COM.'), 'example.com');
  assert.equal(rdap.normalizeDomain(' xn--bcher-kva.example '), 'xn--bcher-kva.example');
  for (const bad of ['', 'localhost', 'a b.com', 'a_b.com', '-a.com', 'a-.com', 'a..com', '10.0.0.5', '1.2.3.4', 'x'.repeat(64) + '.com', 'http://example.com', 'example.com/x', null, undefined]) {
    assert.equal(rdap.normalizeDomain(bad), null, String(bad));
  }
});

test('parseBootstrap keeps https servers only, lowercased, with a trailing slash', () => {
  const m = rdap.parseBootstrap({ services: [[['COM'], ['https://rdap.verisign.com/com/v1']], [['x'], ['http://plain.example/']], [[], ['https://a/']]] });
  assert.equal(m.get('com'), 'https://rdap.verisign.com/com/v1/');
  assert.equal(m.has('x'), false);
  assert.equal(m.size, 1);
  assert.equal(rdap.parseBootstrap(null).size, 0);
});

test('a registered domain: registrar, dates, status, nameservers', async () => {
  fakeNetwork({ 'https://rdap.verisign.com/com/v1/domain/example.com': { status: 200, json: domainJson({
    ldhName: 'EXAMPLE.COM', registration: '1995-08-14T04:00:00Z', expiration: '2027-08-13T04:00:00Z', registrar: 'RESERVED-Internet Assigned Numbers Authority',
    status: ['Client Delete Prohibited', 'client transfer prohibited'], ns: ['A.IANA-SERVERS.NET', 'B.IANA-SERVERS.NET'] }) } });

  const r = await rdap.lookupDomain('example.com');
  assert.equal(r.status, 'ok');
  assert.equal(r.registeredDomain, 'example.com');
  assert.equal(r.server, 'rdap.verisign.com');
  assert.equal(r.registrar, 'RESERVED-Internet Assigned Numbers Authority');
  assert.equal(r.registered, Date.parse('1995-08-14T04:00:00Z'));
  assert.equal(r.expires, Date.parse('2027-08-13T04:00:00Z'));
  assert.deepEqual(r.statuses, ['client delete prohibited', 'client transfer prohibited']);
  assert.deepEqual(r.nameservers, ['a.iana-servers.net', 'b.iana-servers.net']);
  assert.deepEqual(r.flags, { onHold: false, redemption: false, pendingDelete: false });
  assert.equal(r.tld, 'com');
});

test('a hostname steps up to its registered domain', async () => {
  fakeNetwork({ 'https://rdap.verisign.com/com/v1/domain/example.com': { status: 200, json: domainJson({ ldhName: 'example.com', registration: '1995-08-14T00:00:00Z', expiration: '2027-08-13T00:00:00Z' }) } });
  const r = await rdap.lookupDomain('www.mail.example.com');
  assert.equal(r.status, 'ok');
  assert.equal(r.domain, 'www.mail.example.com');
  assert.equal(r.registeredDomain, 'example.com');
  assert.deepEqual(calls.slice(1), [
    'https://rdap.verisign.com/com/v1/domain/www.mail.example.com',
    'https://rdap.verisign.com/com/v1/domain/mail.example.com',
    'https://rdap.verisign.com/com/v1/domain/example.com',
  ]);
});

test('a name that is not registered is reported as not found (empty 404 bodies included)', async () => {
  fakeNetwork({});
  const r = await rdap.lookupDomain('this-should-not-exist-zzqq.com');
  assert.equal(r.status, 'notfound');
  assert.equal(r.tld, 'com');
});

test('a registry suffix such as co.uk is never mistaken for the domain', async () => {
  fakeNetwork({
    'https://rdap.nominet.uk/uk/domain/co.uk': { status: 200, json: { ldhName: 'co.uk', events: [{ eventAction: 'last changed', eventDate: '2025-01-01T00:00:00Z' }] } },
  });
  assert.equal((await rdap.lookupDomain('www.nonexistent-zzqq.co.uk')).status, 'notfound');

  // while a real second-level registration steps up correctly
  rdap.clearCache();
  fakeNetwork({
    'https://rdap.nominet.uk/uk/domain/bbc.co.uk': { status: 200, json: domainJson({ ldhName: 'bbc.co.uk', registration: '1994-12-13T00:00:00Z', expiration: '2034-12-13T00:00:00Z' }) },
  });
  const ok = await rdap.lookupDomain('www.bbc.co.uk');
  assert.equal(ok.status, 'ok');
  assert.equal(ok.registeredDomain, 'bbc.co.uk');
});

test('only https servers are used: a TLD that lists plain http only has no usable server', async () => {
  fakeNetwork({});
  assert.equal((await rdap.lookupDomain('example.bad')).status, 'unsupported');
});

test('a TLD without RDAP is unsupported and costs no registry request', async () => {
  fakeNetwork({});
  const r = await rdap.lookupDomain('example.io');
  assert.equal(r.status, 'unsupported');
  assert.equal(r.tld, 'io');
  assert.deepEqual(calls, ['https://data.iana.org/rdap/dns.json']);
});

test('a registry that publishes no expiry date still answers, with expires null', async () => {
  fakeNetwork({ 'https://rdap.sidn.nl/domain/sidn.nl': { status: 200, json: domainJson({ ldhName: 'sidn.nl', registration: '1999-11-18T00:00:00Z', status: ['locked'], org: 'Stichting Internet Domeinregistratie Nederland' }) } });
  const r = await rdap.lookupDomain('sidn.nl');
  assert.equal(r.status, 'ok');
  assert.equal(r.expires, null);
  assert.equal(r.registrar, 'Stichting Internet Domeinregistratie Nederland');   // falls back to the organization name
});

test('hold, redemption and pending-delete statuses are flagged', async () => {
  fakeNetwork({ 'https://rdap.verisign.com/com/v1/domain/late.com': { status: 200, json: domainJson({
    ldhName: 'late.com', registration: '2010-01-01T00:00:00Z', expiration: '2026-10-01T00:00:00Z', status: ['redemption period', 'client hold', 'pending delete'] }) } });
  const r = await rdap.lookupDomain('late.com');
  assert.deepEqual(r.flags, { onHold: true, redemption: true, pendingDelete: true });
});

test('control characters in registry text are removed', async () => {
  fakeNetwork({ 'https://rdap.verisign.com/com/v1/domain/odd.com': { status: 200, json: domainJson({ ldhName: 'odd.com', registrar: 'Evil\u0000\n<b>Registrar</b>' }) } });
  const r = await rdap.lookupDomain('odd.com');
  assert.ok(!/[\u0000-\u001f]/.test(r.registrar));
});

test('failures are reported, never thrown: network error, rate limit, server error, no registry list', async () => {
  fakeNetwork({ 'https://rdap.verisign.com/com/v1/domain/a.com': new Error('The registry did not answer in time') });
  const t = await rdap.lookupDomain('a.com');
  assert.equal(t.status, 'error');
  assert.match(t.message, /did not answer/);

  rdap.clearCache();
  fakeNetwork({ 'https://rdap.verisign.com/com/v1/domain/b.com': { status: 429, json: null } });
  assert.match((await rdap.lookupDomain('b.com')).message, /limiting requests/);

  rdap.clearCache();
  fakeNetwork({ 'https://rdap.verisign.com/com/v1/domain/c.com': { status: 503, json: null } });
  assert.match((await rdap.lookupDomain('c.com')).message, /HTTP 503/);

  rdap.clearCache();
  rdap.setFetcher(async () => { throw new Error('offline'); });
  const boot = await rdap.lookupDomain('d.com');
  assert.equal(boot.status, 'error');
  assert.match(boot.message, /list of registries/);
});

test('invalid input is rejected before any request', async () => {
  fakeNetwork({});
  assert.equal((await rdap.lookupDomain('10.0.0.5')).status, 'invalid');
  assert.equal((await rdap.lookupDomain('localhost')).status, 'invalid');
  assert.equal((await rdap.lookupDomain('')).status, 'invalid');
  assert.deepEqual(calls, []);
});

test('answers are cached, and simultaneous lookups share one request', async () => {
  fakeNetwork({ 'https://rdap.verisign.com/com/v1/domain/cached.com': { status: 200, json: domainJson({ ldhName: 'cached.com', registration: '2000-01-01T00:00:00Z', expiration: '2030-01-01T00:00:00Z' }) } });
  const [a, b, c] = await Promise.all([rdap.lookupDomain('cached.com'), rdap.lookupDomain('CACHED.com'), rdap.lookupDomain('cached.com.')]);
  assert.equal(a, b); assert.equal(b, c);
  await rdap.lookupDomain('cached.com');
  assert.equal(calls.filter(u => u.includes('cached.com')).length, 1);
  assert.equal(calls.filter(u => u.includes('data.iana.org')).length, 1);
});

test('errors are cached briefly so a struggling registry is not hammered', async () => {
  fakeNetwork({ 'https://rdap.verisign.com/com/v1/domain/flaky.com': { status: 503, json: null } });
  await rdap.lookupDomain('flaky.com');
  await rdap.lookupDomain('flaky.com');
  assert.equal(calls.filter(u => u.includes('flaky.com')).length, 1);
});

test('requests are limited to https servers named by host', () => {
  assert.doesNotThrow(() => rdap.checkUrl('https://rdap.verisign.com/com/v1/domain/example.com'));
  for (const bad of ['http://rdap.verisign.com/', 'https://127.0.0.1/x', 'https://10.0.0.5/x', 'https://[::1]/x', 'https://localhost/x', 'ftp://x.example/']) {
    assert.throws(() => rdap.checkUrl(bad), undefined, bad);
  }
});

test('the DNS lookup refuses private addresses in both call styles', async () => {
  const single = await new Promise(r => rdap.safeLookup('localhost', { family: 4 }, (err, a) => r({ err, a })));
  assert.ok(single.err, 'localhost resolves to a private address and must be refused');
  const all = await new Promise(r => rdap.safeLookup('localhost', { all: true }, (err, a) => r({ err, a })));
  assert.ok(all.err);
});

test('a slow registry cannot make one lookup run past its time budget', async (t) => {
  let fakeNow = Date.now();
  t.mock.method(Date, 'now', () => fakeNow);
  const asked = [];
  rdap.setFetcher(async url => {
    if (url === 'https://data.iana.org/rdap/dns.json') return { status: 200, json: BOOT };
    asked.push(url);
    fakeNow += 6000;                              // every registry request takes six seconds and finds nothing
    return { status: 404, json: null };
  });
  const r = await rdap.lookupDomain('a.b.c.d.example.com');
  assert.equal(r.status, 'error');
  assert.match(r.message, /too long/);
  assert.equal(asked.length, 2, 'it gave up after the budget instead of trying all five names');
});