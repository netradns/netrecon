'use strict';

// Adding and removing registration watches through the real admin API, and the public
// /rdap endpoint's handling of bad input. Nothing here depends on what a live registry
// answers: the first background check records a state (a result or an error) either way.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server');

let srv, token;

before(async () => {
  srv = await startServer({ env: { STATS_PASSWORD: 'integration-pass' }, config: { setupComplete: true } });
  token = (await srv.request('POST', '/admin/login', { body: { username: 'admin', password: 'integration-pass' } })).body.token;
});
after(async () => { await srv.stop(); });

const add = body => srv.request('POST', '/admin/watched', { token, body });
const watched = () => srv.request('GET', '/admin/watched', { token }).then(r => r.body);

test('the public /rdap endpoint rejects bad input without contacting any registry', async () => {
  assert.equal((await srv.request('GET', '/rdap')).status, 400);
  for (const bad of ['localhost', '10.0.0.5', 'not a domain', 'http://example.com', '-bad-.com']) {
    const r = await srv.request('GET', '/rdap?domain=' + encodeURIComponent(bad));
    assert.equal(r.status, 200, bad);
    assert.equal(r.body.status, 'invalid', bad);
  }
});

test('registration watches need a login', async () => {
  const r = await srv.request('POST', '/admin/watched', { body: { domain: 'example.com', source: 'public', expiry: { enabled: true } } });
  assert.equal(r.status, 401);
});

test('registration watching is for public registered domains only', async () => {
  const on = { enabled: true };
  const internal = await add({ domain: 'corp.example.com', source: 'internal', expiry: on });
  assert.equal(internal.status, 400);
  assert.match(internal.body.error, /public domains/);

  const ip = await add({ domain: '203.0.113.9', source: 'public', cert: { enabled: true, port: 443 }, expiry: on });
  assert.equal(ip.status, 400);

  const single = await add({ domain: 'localhost', source: 'public', expiry: on });
  assert.equal(single.status, 400);
  assert.match(single.body.error, /registered domain/);

  const none = await add({ domain: 'example.com', source: 'public', recordTypes: [] });
  assert.equal(none.status, 400);
  assert.match(none.body.error, /registration monitoring/);
});

test('a registration-only watch: defaults, state, duplicates, removal', async () => {
  const r = await add({ domain: 'example.com', source: 'public', expiry: { enabled: true } });
  assert.equal(r.status, 201);
  const entry = r.body.entry;
  assert.deepEqual(entry.expiry, { enabled: true, warnDays: [60, 30, 14, 7] });
  assert.deepEqual(entry.recordTypes, []);
  assert.equal(entry.cert, null);
  assert.equal(entry.expiryStatus, 'pending');

  // The first check runs in the background and always stores a state
  const end = Date.now() + 20000;
  let state;
  while (!state && Date.now() < end) {
    state = (await watched()).expiries[entry.id];
    if (!state) await new Promise(res => setTimeout(res, 200));
  }
  assert.ok(state, 'a registration state was recorded');
  assert.ok(['ok', 'expiring', 'error', 'pending', 'noexpiry'].includes(state.status), state.status);

  // The same domain cannot be watched for registration twice
  assert.equal((await add({ domain: 'example.com', source: 'public', expiry: { enabled: true } })).status, 409);

  // Removing the entry removes its state
  assert.equal((await srv.request('DELETE', `/admin/watched/${entry.id}`, { token })).status, 200);
  const after = await watched();
  assert.equal(after.expiries[entry.id], undefined);
  assert.ok(!after.domains.some(d => d.id === entry.id));
});

test('warning thresholds are cleaned up', async () => {
  const r = await add({ domain: 'example.org', source: 'public', expiry: { enabled: true, warnDays: [7, 7, '30', 999, -1, 'x'] } });
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.entry.expiry.warnDays, [30, 7]);
});

test('registration can sit alongside DNS records and a certificate on the same domain', async () => {
  const both = await add({ domain: 'example.net', source: 'public', recordTypes: ['A', 'MX'], expiry: { enabled: true, warnDays: [30, 7] } });
  assert.equal(both.status, 201);
  assert.deepEqual(both.body.entry.recordTypes, ['A', 'MX']);
  assert.equal(both.body.entry.expiry.warnDays.length, 2);

  // a second DNS watch of the same domain is still refused, as before
  assert.equal((await add({ domain: 'example.net', source: 'public', recordTypes: ['TXT'] })).status, 409);
  // and so is a second registration watch
  assert.equal((await add({ domain: 'example.net', source: 'public', recordTypes: [], expiry: { enabled: true } })).status, 409);
});

test('the audit trail describes what was added', async () => {
  const { events } = (await srv.request('GET', '/admin/audit', { token })).body;
  assert.ok(events.some(e => e.type === 'watched_added' && /example\.com \(public\): domain registration/.test(e.detail)));
  assert.ok(events.some(e => e.type === 'watched_added' && /example\.net \(public\): DNS records \+ domain registration/.test(e.detail)));
});

test('DNS-only and certificate watches still work exactly as before', async () => {
  const dnsOnly = await add({ domain: 'corp.test', source: 'internal', recordTypes: ['A'] });
  assert.equal(dnsOnly.status, 201);
  assert.equal(dnsOnly.body.entry.expiry, null);
  assert.equal(dnsOnly.body.entry.expiryStatus, null);

  const certOnly = await add({ domain: '127.0.0.1', source: 'internal', recordTypes: [], cert: { enabled: true, port: 9 } });
  assert.equal(certOnly.status, 201);
  assert.equal(certOnly.body.entry.expiry, null);
});
