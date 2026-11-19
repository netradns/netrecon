'use strict';

// Runs the real server and checks the admin login end to end,
// including the old "read the hash from /app-config and replay it" bypass.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sha256 } = require('./helpers/server');

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.stop(); });

const login = (password, username = 'admin') => srv.request('POST', '/admin/login', { body: { username, password } });

test('/app-config is public but contains no password hash or secret', async () => {
  const r = await srv.request('GET', '/app-config');
  assert.equal(r.status, 200);
  assert.ok(!('statsPasswordHash' in r.body));
  assert.ok(!/[0-9a-f]{64}/i.test(r.text), 'no 64-character hash anywhere in the response');
});

test('stats cannot be read or cleared without logging in', async () => {
  assert.equal((await srv.request('GET', '/stats')).status, 401);
  assert.equal((await srv.request('POST', '/stats/clear')).status, 401);
});

test('admin routes reject missing, bogus and old-style credentials', async () => {
  assert.equal((await srv.request('GET', '/admin/config')).status, 401);
  assert.equal((await srv.request('GET', '/admin/config', { token: 'not-a-real-token-at-all-1234567' })).status, 401);

  // The old attack: send the SHA-256 of the password in X-Admin-Hash
  const replay = await srv.request('GET', '/admin/config', { headers: { 'X-Admin-Hash': sha256('admin') } });
  assert.equal(replay.status, 401);
  const asBearer = await srv.request('GET', '/admin/config', { token: sha256('admin') });
  assert.equal(asBearer.status, 401);
});

test('wrong passwords and wrong usernames are refused with the same message', async () => {
  const a = await login('wrong-password');
  const b = await login('admin', 'root');
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
  assert.equal(a.body.error, b.body.error);
  assert.ok(!a.body.token);
});

test('login with the default password works and flags it as the default', async () => {
  const r = await login('admin');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.usingDefault, true);
  assert.ok(r.body.token && r.body.token.length >= 40);

  const cfg   = await srv.request('GET', '/admin/config', { token: r.body.token });
  const stats = await srv.request('GET', '/stats', { token: r.body.token });
  const sess  = await srv.request('GET', '/admin/session', { token: r.body.token });
  assert.equal(cfg.status, 200);
  assert.equal(stats.status, 200);
  assert.equal(sess.status, 200);
  assert.ok(!('adminPassword' in cfg.body) && !('statsPasswordHash' in cfg.body));
});

test('login and session report the address the server sees (from X-Real-IP set by nginx)', async () => {
  const r = await srv.request('POST', '/admin/login', {
    headers: { 'X-Real-IP': '203.0.113.9' }, body: { username: 'admin', password: 'admin' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.clientIp, '203.0.113.9');

  const sess = await srv.request('GET', '/admin/session', { token: r.body.token, headers: { 'X-Real-IP': '198.51.100.4' } });
  assert.equal(sess.body.clientIp, '198.51.100.4');

  // Without the header the connection's own address is used
  const plain = await login('admin');
  assert.match(plain.body.clientIp, /^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/);
});

test('a lockout is per visitor address, not global', async () => {
  const from = ip => srv.request('POST', '/admin/login', { headers: { 'X-Real-IP': ip }, body: { username: 'admin', password: 'wrong-for-lockout-test' } });
  let last;
  for (let i = 0; i < 6; i++) last = await from('192.0.2.200');
  assert.equal(last.status, 429);
  assert.equal((await from('192.0.2.201')).status, 401, 'a different visitor is not affected');
});
test('logout ends the session', async () => {
  const { body: { token } } = await login('admin');
  assert.equal((await srv.request('GET', '/admin/session', { token })).status, 200);
  assert.equal((await srv.request('POST', '/admin/logout', { token })).status, 200);
  assert.equal((await srv.request('GET', '/admin/session', { token })).status, 401);
});

test('changing the password: validation, new hash on disk, other sessions ended', async () => {
  const mine  = (await login('admin')).body.token;
  const other = (await login('admin')).body.token;

  const bad = await srv.request('POST', '/admin/password', { token: mine, body: { currentPassword: 'nope', newPassword: 'a-long-new-password' } });
  assert.equal(bad.status, 400);
  const short = await srv.request('POST', '/admin/password', { token: mine, body: { currentPassword: 'admin', newPassword: 'short' } });
  assert.equal(short.status, 400);
  const noAuth = await srv.request('POST', '/admin/password', { body: { currentPassword: 'admin', newPassword: 'a-long-new-password' } });
  assert.equal(noAuth.status, 401);

  const ok = await srv.request('POST', '/admin/password', { token: mine, body: { currentPassword: 'admin', newPassword: 'a-long-new-password' } });
  assert.equal(ok.status, 200);

  assert.equal((await srv.request('GET', '/admin/session', { token: mine })).status, 200);    // caller stays logged in
  assert.equal((await srv.request('GET', '/admin/session', { token: other })).status, 401);  // everyone else is out

  assert.equal((await login('admin')).status, 401);                  // old password is dead
  const again = await login('a-long-new-password');
  assert.equal(again.status, 200);
  assert.equal(again.body.usingDefault, false);
});

test('repeated wrong passwords lock the client out (429 with Retry-After)', async () => {
  let last;
  for (let i = 0; i < 6; i++) last = await login('definitely-wrong-' + i);
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers.get('retry-after')) > 0);

  // Even the right password is refused while locked
  assert.equal((await login('a-long-new-password')).status, 429);
});
