'use strict';

const { test, beforeEach } = require('node:test');
const assert  = require('node:assert/strict');
const session = require('../lib/admin/session');

beforeEach(() => session._reset());

// Minimal stand-ins for Node's request and response objects
const fakeReq = (headers = {}, remoteAddress = '10.9.9.9') => ({ headers, socket: { remoteAddress } });
function fakeRes() {
  return { headersSent: false, status: null, body: '', writeHead(s) { this.status = s; this.headersSent = true; }, end(b) { this.body = b; } };
}

test('a new token is valid, an unknown one is not', () => {
  const token = session.createSession();
  assert.equal(session.validateSession(token), true);
  assert.equal(session.validateSession('x'.repeat(43)), false);
  assert.equal(session.validateSession(''), false);
  assert.equal(session.validateSession(null), false);
  assert.equal(session.validateSession('a'.repeat(500)), false);
});

test('tokens are random and not reused', () => {
  const a = session.createSession(), b = session.createSession();
  assert.notEqual(a, b);
  assert.ok(a.length >= 40);
});

test('sessions expire after being idle', () => {
  const t0 = 1_000_000;
  const token = session.createSession(t0);
  assert.equal(session.validateSession(token, t0 + session.SESSION_IDLE_MS - 1), true);   // activity resets the timer
  assert.equal(session.validateSession(token, t0 + 2 * session.SESSION_IDLE_MS), false);
});

test('sessions end at the absolute limit even when active', () => {
  const t0 = 1_000_000;
  const token = session.createSession(t0);
  let t = t0;
  while (t - t0 < session.SESSION_MAX_MS) {            // stay active every hour
    t += 60 * 60 * 1000;
    if (t - t0 <= session.SESSION_MAX_MS) assert.equal(session.validateSession(token, t), true);
  }
  assert.equal(session.validateSession(token, t0 + session.SESSION_MAX_MS + 1), false);
});

test('revokeSession and revokeOtherSessions', () => {
  const a = session.createSession(), b = session.createSession(), c = session.createSession();
  session.revokeSession(a);
  assert.equal(session.validateSession(a), false);
  session.revokeOtherSessions(b);
  assert.equal(session.validateSession(b), true);
  assert.equal(session.validateSession(c), false);
});

test('the number of sessions is capped, dropping the least recently used', () => {
  const first = session.createSession(1);
  for (let i = 0; i < session.MAX_SESSIONS; i++) session.createSession(10 + i);
  assert.equal(session.validateSession(first, 5000), false);
});

test('getToken reads only a Bearer header', () => {
  assert.equal(session.getToken(fakeReq({ authorization: 'Bearer abc123' })), 'abc123');
  assert.equal(session.getToken(fakeReq({ authorization: 'bearer abc123' })), 'abc123');
  assert.equal(session.getToken(fakeReq({ authorization: 'Basic abc123' })), null);
  assert.equal(session.getToken(fakeReq({ 'x-admin-hash': 'abc123' })), null);   // the old header grants nothing
  assert.equal(session.getToken(fakeReq({})), null);
});

test('requireAuth lets a valid token through and answers 401 otherwise', () => {
  const token = session.createSession();

  const ok = fakeRes();
  assert.equal(session.requireAuth(fakeReq({ authorization: `Bearer ${token}` }), ok), true);
  assert.equal(ok.status, null);

  const no = fakeRes();
  assert.equal(session.requireAuth(fakeReq({}), no), false);
  assert.equal(no.status, 401);
  assert.deepEqual(JSON.parse(no.body), { error: 'Unauthorized' });
});

test('five wrong passwords lock an IP out, and the lock expires', () => {
  const ip = '203.0.113.5', t0 = 5_000_000;
  for (let i = 0; i < session.MAX_FAILURES - 1; i++) {
    session.recordFailure(ip, t0 + i);
    assert.equal(session.checkLogin(ip, t0 + i).allowed, true);
  }
  session.recordFailure(ip, t0 + 10);
  const locked = session.checkLogin(ip, t0 + 11);
  assert.equal(locked.allowed, false);
  assert.ok(locked.retryAfterSec > 0 && locked.retryAfterSec <= session.LOCKOUT_MS / 1000);

  assert.equal(session.checkLogin(ip, t0 + session.LOCKOUT_MS + 100).allowed, true);
});

test('a successful login clears earlier failures, and other IPs are unaffected', () => {
  const t0 = 9_000_000;
  for (let i = 0; i < 4; i++) session.recordFailure('198.51.100.1', t0);
  session.recordSuccess('198.51.100.1');
  session.recordFailure('198.51.100.1', t0 + 1);
  assert.equal(session.checkLogin('198.51.100.1', t0 + 2).allowed, true);

  for (let i = 0; i < 5; i++) session.recordFailure('198.51.100.2', t0);
  assert.equal(session.checkLogin('198.51.100.2', t0 + 1).allowed, false);
  assert.equal(session.checkLogin('198.51.100.3', t0 + 1).allowed, true);
});

test('failures older than the window start a fresh count', () => {
  const ip = '192.0.2.77', t0 = 1;
  for (let i = 0; i < 4; i++) session.recordFailure(ip, t0);
  session.recordFailure(ip, t0 + 16 * 60 * 1000);      // 16 minutes later: counts as the first again
  assert.equal(session.checkLogin(ip, t0 + 16 * 60 * 1000 + 1).allowed, true);
});

test('clientIp trusts X-Real-IP only when it is a real IP address', () => {
  assert.equal(session.clientIp(fakeReq({ 'x-real-ip': '203.0.113.9' })), '203.0.113.9');
  assert.equal(session.clientIp(fakeReq({ 'x-real-ip': '2001:db8::1' })), '2001:db8::1');
  assert.equal(session.clientIp(fakeReq({ 'x-real-ip': 'not an ip' }, '172.18.0.5')), '172.18.0.5');
  assert.equal(session.clientIp(fakeReq({}, '172.18.0.5')), '172.18.0.5');
});
