'use strict';
// GET /admin/audit through the real server: paging, groups, the 24 hour summary,
// and the events the server records about itself.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server');

let srv, token;
before(async () => {
  srv = await startServer({ env: { STATS_PASSWORD: 'integration-pass' }, config: { setupComplete: true } });
  token = (await srv.request('POST', '/admin/login', { body: { username: 'admin', password: 'integration-pass' } })).body.token;
  // a few admin events so there is something to page through
  for (let i = 0; i < 4; i++) await srv.request('POST', '/admin/login', { body: { username: 'user' + i, password: 'wrong' } });
});
after(async () => { await srv.stop(); });

const feed = q => srv.request('GET', '/admin/audit' + (q || ''), { token });

test('the feed needs a login', async () => {
  assert.equal((await srv.request('GET', '/admin/audit')).status, 401);
});

test('the server records that it started', async () => {
  const r = await feed('?category=system');
  assert.equal(r.status, 200);
  assert.equal(r.body.events.length, 1);
  assert.equal(r.body.events[0].type, 'server_started');
  assert.equal(r.body.events[0].actor, 'system');
  assert.match(r.body.events[0].detail, /port \d+/);
});

test('paging returns slices of one list and the total', async () => {
  const all = (await feed()).body;
  assert.ok(all.total >= 6, 'start, sign-in and four failed sign-ins');
  const first  = (await feed('?limit=2&offset=0')).body;
  const second = (await feed('?limit=2&offset=2')).body;
  assert.equal(first.events.length, 2);
  assert.equal(first.total, all.total);
  assert.equal(second.total, all.total);
  assert.deepEqual(first.events.concat(second.events).map(e => e.ts + e.type), all.events.slice(0, 4).map(e => e.ts + e.type));
  assert.equal((await feed('?limit=2&offset=9999')).body.events.length, 0);
});

test('bad paging values and groups do not break the request', async () => {
  for (const q of ['?limit=abc', '?limit=-1&offset=-1', '?limit=100000', '?offset=x', '?category=nonsense', '?category=delivery', '?category=alerts']) {
    const r = await feed(q);
    assert.equal(r.status, 200, q);
    assert.ok(Array.isArray(r.body.events), q);
  }
  assert.ok((await feed('?limit=100000')).body.events.length <= 500);
});

test('the summary covers the audit log whatever the filter or page', async () => {
  const unfiltered = (await feed()).body.summary;
  const filtered   = (await feed('?category=system&limit=1')).body.summary;
  assert.deepEqual(filtered, unfiltered);
  assert.equal(unfiltered.signIns, 1);
  assert.equal(unfiltered.failed, 4);
});
