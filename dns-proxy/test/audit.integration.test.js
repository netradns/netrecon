'use strict';

// The audit trail end to end: real server, real requests.

const fs   = require('fs');
const http = require('http');
const path = require('path');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server');

let srv, hook, token;
const SECRET   = 'webhook-secret-that-must-never-be-logged';
const NEW_PASS = 'a-brand-new-passphrase-123';
const asIp = ip => ({ 'X-Real-IP': ip });

before(async () => {
  hook = http.createServer((req, res) => { req.resume(); req.on('end', () => res.end('ok')); });
  await new Promise(r => hook.listen(0, '127.0.0.1', r));
  srv = await startServer({ config: { setupComplete: true } });
});
after(async () => { await srv.stop(); await new Promise(r => hook.close(r)); });

const login = (password, ip = '203.0.113.20', username = 'admin') =>
  srv.request('POST', '/admin/login', { headers: asIp(ip), body: { username, password } });
const audit = (query = '') => srv.request('GET', '/admin/audit' + query, { token }).then(r => r.body);
const types = events => events.map(e => e.type);

test('the audit endpoint needs a login', async () => {
  assert.equal((await srv.request('GET', '/admin/audit')).status, 401);
  assert.equal((await srv.request('GET', '/admin/audit', { token: 'not-a-real-token-at-all-1234567' })).status, 401);
});

test('failed sign-ins are recorded and merged; a good sign-in records the default-password warning', async () => {
  await login('wrong-1', '203.0.113.20', 'root');
  await login('wrong-2', '203.0.113.20', 'root');
  const ok = await login('admin', '203.0.113.21');
  assert.equal(ok.status, 200);
  token = ok.body.token;

  const { events } = await audit();
  const failed = events.find(e => e.type === 'login_failed');
  assert.equal(failed.ip, '203.0.113.20');
  assert.equal(failed.count, 2, 'two failures from one address are one entry');
  assert.equal(failed.detail, 'username: root');
  assert.equal(failed.actor, 'anonymous');

  const good = events.find(e => e.type === 'login_ok');
  assert.equal(good.ip, '203.0.113.21');
  assert.match(good.detail, /default password/);
  assert.equal(good.category, 'signin');
});

test('settings changes record the names of the settings and never their values', async () => {
  const r = await srv.request('PUT', '/admin/config', { token, headers: asIp('203.0.113.21'), body: { internalDnsEnabled: false, webhookSecret: SECRET } });
  assert.equal(r.status, 200);
  const s = await srv.request('PUT', '/admin/server-settings', { token, headers: asIp('203.0.113.21'), body: { dnsTimeout: 4000 } });
  assert.equal(s.status, 200);

  const { events } = await audit();
  const cfg = events.find(e => e.type === 'settings_changed');
  assert.equal(cfg.detail, 'internalDnsEnabled, webhookSecret');
  assert.equal(events.find(e => e.type === 'server_settings_changed').detail, 'dnsTimeout');
  assert.ok(!JSON.stringify(events).includes(SECRET));
});

test('watched domains, test notifications and clearing stats are recorded', async () => {
  const add = await srv.request('POST', '/admin/watched', { token, headers: asIp('203.0.113.21'), body: { domain: 'corp.test', source: 'internal', recordTypes: ['A'] } });
  assert.equal(add.status, 201);
  await srv.request('DELETE', `/admin/watched/${add.body.entry.id}`, { token, headers: asIp('203.0.113.21') });

  const t = await srv.request('POST', '/admin/notify/test', { token, headers: asIp('203.0.113.21'), body: { channel: { service: 'webhook', url: `http://127.0.0.1:${hook.address().port}/x` } } });
  assert.equal(t.status, 200);

  assert.equal((await srv.request('POST', '/stats/clear', { token, headers: asIp('203.0.113.21') })).status, 200);

  const { events } = await audit();
  assert.equal(events.find(e => e.type === 'watched_added').detail, 'corp.test (internal): DNS records');
  assert.equal(events.find(e => e.type === 'watched_removed').detail, 'corp.test (internal)');
  assert.equal(events.find(e => e.type === 'notify_test').detail, 'webhook');
  assert.equal(events.find(e => e.type === 'stats_cleared').ip, '203.0.113.21');
  assert.ok(!JSON.stringify(events).includes('/x'), 'webhook URLs are not logged');
});

test('password changes: a wrong current password and a successful change are both recorded', async () => {
  const bad = await srv.request('POST', '/admin/password', { token, headers: asIp('203.0.113.21'), body: { currentPassword: 'nope-nope', newPassword: NEW_PASS } });
  assert.equal(bad.status, 400);
  const short = await srv.request('POST', '/admin/password', { token, body: { currentPassword: 'admin', newPassword: 'short' } });
  assert.equal(short.status, 400);
  const ok = await srv.request('POST', '/admin/password', { token, headers: asIp('203.0.113.21'), body: { currentPassword: 'admin', newPassword: NEW_PASS } });
  assert.equal(ok.status, 200);

  const { events } = await audit('?category=security');
  assert.deepEqual(types(events), ['password_changed', 'password_change_failed']);   // a too-short password is not a security event
});

test('five wrong passwords record the lockout, and attempts while locked out are counted', async () => {
  for (let i = 0; i < 5; i++) await login('guess-' + i, '198.51.100.99');
  await login('guess-more', '198.51.100.99');
  await login('guess-even-more', '198.51.100.99');

  const { events } = await audit('?category=signin');
  const locked  = events.find(e => e.type === 'login_locked');
  const blocked = events.find(e => e.type === 'login_blocked');
  assert.equal(locked.ip, '198.51.100.99');
  assert.equal(blocked.ip, '198.51.100.99');
  assert.equal(blocked.count, 2);
});

test('signing out is recorded, and signing out with a dead token is not', async () => {
  const fresh = (await login(NEW_PASS, '203.0.113.22')).body.token;
  await srv.request('POST', '/admin/logout', { token: fresh, headers: asIp('203.0.113.22') });
  await srv.request('POST', '/admin/logout', { token: fresh, headers: asIp('203.0.113.23') });   // already ended

  const { events } = await audit('?category=signin');
  const outs = events.filter(e => e.type === 'logout');
  assert.equal(outs.length, 1);
  assert.equal(outs[0].ip, '203.0.113.22');
});

test('filters, limits and unknown categories behave', async () => {
  const all = await audit();
  const some = await audit('?limit=3');
  assert.equal(some.events.length, 3);
  assert.deepEqual(some.events, all.events.slice(0, 3), 'newest first');
  assert.ok(all.events.every((e, i, a) => i === 0 || a[i - 1].ts >= e.ts));

  assert.ok((await audit('?category=data')).events.every(e => e.category === 'data'));
  assert.equal((await audit('?category=nonsense')).total, all.total, 'an unknown category means all');
  assert.equal(all.kept, 1000);
});

test('the file on disk holds no passwords, tokens or secrets', async () => {
  await new Promise(r => setTimeout(r, 1500));                         // the log is saved about a second after an event
  const text = fs.readFileSync(path.join(srv.dir, 'audit.json'), 'utf8');
  for (const secret of [SECRET, NEW_PASS, 'admin-pass-never', token]) assert.ok(!text.includes(secret), 'leaked: ' + secret);
  for (const word of ['wrong-1', 'guess-0', 'nope-nope']) assert.ok(!text.includes(word), 'leaked a typed password: ' + word);
  assert.ok(JSON.parse(text).length > 5);
});

test('setup is recorded as an anonymous event', async () => {
  const fresh = await startServer();
  try {
    const r = await fresh.request('POST', '/setup', { headers: asIp('192.0.2.50'), body: { password: 'first-run-passphrase' } });
    assert.equal(r.status, 200);
    const t = (await fresh.request('POST', '/admin/login', { body: { username: 'admin', password: 'first-run-passphrase' } })).body.token;
    const { events } = (await fresh.request('GET', '/admin/audit', { token: t })).body;
    const setup = events.find(e => e.type === 'setup_completed');
    assert.equal(setup.ip, '192.0.2.50');
    assert.equal(setup.actor, 'anonymous');
  } finally { await fresh.stop(); }
});
