'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const cert     = require('../lib/watcher/cert');

const DAY = cert.DAY_MS;
const NOW = Date.UTC(2025, 5, 1, 12, 0, 0);                 // fixed clock: 2025-06-01 12:00 UTC
const WARN = [30, 14, 7];

/** A successful checkCert() result expiring `days` from NOW. */
function good(days, over) {
  return Object.assign({
    validFrom: new Date(NOW - 60 * DAY).toUTCString(),
    validTo:   new Date(NOW + days * DAY).toUTCString(),
    fingerprint: 'AA:BB', issuer: 'CN=Test CA', issuerOrg: 'Test CA', subject: 'CN=host', commonName: 'host',
    sans: ['host'], serialNumber: '01', protocol: 'TLSv1.3', authorized: true, authError: null,
  }, over || {});
}
const types = events => events.map(e => e.type);

test('normalizeWarnDays cleans, sorts, dedupes and falls back', () => {
  assert.deepEqual(cert.normalizeWarnDays([7, 30, 14]), [30, 14, 7]);
  assert.deepEqual(cert.normalizeWarnDays([7, 7, '14', 0, -3, 400, 2.5, 'x']), [14, 7]);
  assert.deepEqual(cert.normalizeWarnDays([]), [30, 14, 7]);
  assert.deepEqual(cert.normalizeWarnDays(undefined), [30, 14, 7]);
  assert.equal(cert.normalizeWarnDays([1, 2, 3, 4, 5, 6, 7, 8]).length, 6);
});

test('normalizePort defaults to 443 and rejects invalid ports', () => {
  assert.equal(cert.normalizePort(undefined), 443);
  assert.equal(cert.normalizePort(''), 443);
  assert.equal(cert.normalizePort('636'), 636);
  assert.equal(cert.normalizePort(8443), 8443);
  for (const bad of [0, 65536, -1, 'abc', 1.5]) assert.equal(cert.normalizePort(bad), null, String(bad));
});

test('a healthy certificate produces no events and status ok', () => {
  const { state, events } = cert.evaluateCert(null, good(90), WARN, NOW);
  assert.deepEqual(events, []);
  assert.equal(state.status, 'ok');
  assert.equal(state.daysLeft, 90);
  assert.equal(state.ok, true);
});

test('crossing a threshold alerts once, and only once', () => {
  let r = cert.evaluateCert(null, good(25), WARN, NOW);
  assert.deepEqual(types(r.events), ['expiring']);
  assert.equal(r.state.status, 'expiring');

  // Same certificate checked again an hour later: no repeat
  r = cert.evaluateCert(r.state, good(25), WARN, NOW + 3600000);
  assert.deepEqual(r.events, []);

  // Two weeks later it crosses the next threshold
  r = cert.evaluateCert(r.state, good(25), WARN, NOW + 12 * DAY);   // same certificate, 13 days left now
  assert.deepEqual(types(r.events), ['expiring']);
  assert.equal(r.state.daysLeft, 13);
});

test('a certificate already inside several thresholds alerts once, not three times', () => {
  const r = cert.evaluateCert(null, good(5), WARN, NOW);
  assert.deepEqual(types(r.events), ['expiring']);
  assert.deepEqual(Object.keys(r.state.alerted).sort(), ['14', '30', '7']);

  const again = cert.evaluateCert(r.state, good(4), WARN, NOW + DAY);
  assert.deepEqual(again.events, []);
});

test('thresholds are inclusive on the boundary day', () => {
  assert.deepEqual(types(cert.evaluateCert(null, good(30), WARN, NOW).events), ['expiring']);
  assert.deepEqual(types(cert.evaluateCert(null, good(31), WARN, NOW).events), []);
});

test('an expired certificate alerts, then reminds once a day', () => {
  let r = cert.evaluateCert(null, good(-2), WARN, NOW);
  assert.deepEqual(types(r.events), ['expired']);
  assert.equal(r.state.status, 'expired');
  assert.ok(r.state.daysLeft < 0);

  r = cert.evaluateCert(r.state, good(-2), WARN, NOW + 3 * 3600000);        // 3 hours later: quiet
  assert.deepEqual(r.events, []);
  assert.equal(r.state.status, 'expired');

  r = cert.evaluateCert(r.state, good(-3), WARN, NOW + DAY + 1000);         // a day later: reminder
  assert.deepEqual(types(r.events), ['expired']);
});

test('renewal is reported and resets the alerts for the new certificate', () => {
  let r = cert.evaluateCert(null, good(10), WARN, NOW);
  assert.deepEqual(types(r.events), ['expiring']);

  const renewed = good(90, { fingerprint: 'CC:DD' });
  r = cert.evaluateCert(r.state, renewed, WARN, NOW + DAY);
  assert.deepEqual(types(r.events), ['renewed']);
  assert.equal(r.events[0].issuerChanged, false);
  assert.equal(r.state.status, 'ok');
  assert.deepEqual(r.state.alerted, {});

  // The new certificate gets its own warnings when its time comes
  r = cert.evaluateCert(r.state, good(90, { fingerprint: 'CC:DD' }), WARN, NOW + 61 * DAY);   // 29 days left
  assert.deepEqual(types(r.events), ['expiring']);
});

test('a replacement that expires sooner, or from a new issuer, is flagged', () => {
  const first = cert.evaluateCert(null, good(90), WARN, NOW).state;

  let r = cert.evaluateCert(first, good(30, { fingerprint: 'EE:FF' }), WARN, NOW);
  assert.ok(types(r.events).includes('changed'));
  assert.ok(!types(r.events).includes('renewed'));

  r = cert.evaluateCert(first, good(365, { fingerprint: '11:22', issuer: 'CN=Other CA' }), WARN, NOW);
  assert.deepEqual(types(r.events), ['renewed']);
  assert.equal(r.events[0].issuerChanged, true);
});

test('errors alert only after repeated failures, then recovery is announced', () => {
  let state = cert.evaluateCert(null, good(90), WARN, NOW).state;

  let r = cert.evaluateCert(state, { error: 'Connection timed out' }, WARN, NOW + 1);
  assert.deepEqual(r.events, []);
  assert.equal(r.state.status, 'ok');                     // one blip does not flip the status
  assert.equal(r.state.validTo, state.validTo);           // last known details are kept

  r = cert.evaluateCert(r.state, { error: 'Connection timed out' }, WARN, NOW + 2);
  assert.deepEqual(r.events, []);

  r = cert.evaluateCert(r.state, { error: 'Connection timed out' }, WARN, NOW + 3);
  assert.deepEqual(types(r.events), ['error']);
  assert.equal(r.state.status, 'error');

  r = cert.evaluateCert(r.state, { error: 'Connection timed out' }, WARN, NOW + 4);  // still failing: no spam
  assert.deepEqual(r.events, []);

  r = cert.evaluateCert(r.state, good(90), WARN, NOW + 5);
  assert.deepEqual(types(r.events), ['recovered']);
  assert.equal(r.state.status, 'ok');
  assert.equal(r.state.errorStreak, 0);
});

test('a first check that fails does not crash and starts pending', () => {
  const r = cert.evaluateCert(null, { error: 'DNS resolution failed: boom' }, WARN, NOW);
  assert.equal(r.state.ok, false);
  assert.equal(r.state.status, 'pending');
  assert.deepEqual(r.events, []);
});

test('a certificate without a readable expiry date is treated as an error', () => {
  const r = cert.evaluateCert(null, good(10, { validTo: 'not a date' }), WARN, NOW);
  assert.equal(r.state.ok, false);
  assert.match(r.state.error, /no readable expiry/);
});

test('self-signed certificates are fine: authorized=false alone raises nothing', () => {
  const r = cert.evaluateCert(null, good(200, { authorized: false, authError: 'DEPTH_ZERO_SELF_SIGNED_CERT' }), WARN, NOW);
  assert.deepEqual(r.events, []);
  assert.equal(r.state.status, 'ok');
  assert.equal(r.state.authorized, false);
});

test('describeEvent gives readable one-liners', () => {
  const { state } = cert.evaluateCert(null, good(10), WARN, NOW);
  assert.match(cert.describeEvent({ type: 'expiring' }, state), /^Expires in 10 days \(2025-06-11\)$/);
  assert.match(cert.describeEvent({ type: 'expired' }, { daysLeft: -1, validTo: NOW - DAY }), /^Expired 1 day ago/);
  assert.match(cert.describeEvent({ type: 'renewed', previousValidTo: NOW }, state), /Renewed: now valid until 2025-06-11 \(was 2025-06-01\)/);
  assert.match(cert.describeEvent({ type: 'error', message: 'nope' }, state), /Could not check the certificate: nope/);
});
