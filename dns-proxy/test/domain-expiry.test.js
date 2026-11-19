'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const exp      = require('../lib/watcher/domain-expiry');

const DAY  = 86400000;
const NOW  = Date.UTC(2026, 5, 1, 12, 0, 0);
const WARN = [60, 30, 14, 7];

/** A successful rdap.lookupDomain() result expiring `days` from NOW. */
function found(days, over) {
  return Object.assign({
    status: 'ok', domain: 'example.com', registeredDomain: 'example.com', server: 'rdap.verisign.com',
    registrar: 'Example Registrar', registered: Date.UTC(2010, 0, 1), expires: days === null ? null : NOW + days * DAY, updated: NOW - DAY,
    statuses: ['client transfer prohibited'], nameservers: ['ns1.example.com'],
    flags: { onHold: false, redemption: false, pendingDelete: false },
  }, over || {});
}
const types = events => events.map(e => e.type);

test('normalizeWarnDays cleans, sorts, dedupes and falls back to 60/30/14/7', () => {
  assert.deepEqual(exp.normalizeWarnDays([7, 90, 30]), [90, 30, 7]);
  assert.deepEqual(exp.normalizeWarnDays(['14', 14, 0, -1, 400, 'x', 2.5]), [14]);
  assert.deepEqual(exp.normalizeWarnDays([]), [60, 30, 14, 7]);
  assert.deepEqual(exp.normalizeWarnDays(null), [60, 30, 14, 7]);
  assert.equal(exp.normalizeWarnDays([1, 2, 3, 4, 5, 6, 7, 8]).length, 6);
});

test('a registration far from expiry is quiet and ok', () => {
  const { state, events } = exp.evaluateExpiry(null, found(400), WARN, NOW);
  assert.deepEqual(events, []);
  assert.equal(state.status, 'ok');
  assert.equal(state.daysLeft, 400);
  assert.equal(state.registrar, 'Example Registrar');
});

test('crossing a threshold alerts once, then again at the next one', () => {
  // The registration expires 50 days after NOW; thresholds are 60, 30, 14 and 7 days
  let r = exp.evaluateExpiry(null, found(50), WARN, NOW);
  assert.deepEqual(types(r.events), ['expiring']);                    // 50 days left: inside 60
  assert.equal(r.state.status, 'expiring');

  r = exp.evaluateExpiry(r.state, found(50), WARN, NOW + 12 * 3600000);
  assert.deepEqual(r.events, [], 'the same threshold does not repeat');

  r = exp.evaluateExpiry(r.state, found(50), WARN, NOW + 25 * DAY);   // 25 days left: now inside 30 as well
  assert.deepEqual(types(r.events), ['expiring']);

  r = exp.evaluateExpiry(r.state, found(50), WARN, NOW + 26 * DAY);   // 24 days left: nothing new
  assert.deepEqual(r.events, []);

  r = exp.evaluateExpiry(r.state, found(50), WARN, NOW + 37 * DAY);   // 13 days left: inside 14
  assert.deepEqual(types(r.events), ['expiring']);
  assert.equal(r.state.daysLeft, 13);
});
test('already inside several thresholds: one alert, not four', () => {
  const r = exp.evaluateExpiry(null, found(5), WARN, NOW);
  assert.deepEqual(types(r.events), ['expiring']);
  assert.deepEqual(Object.keys(r.state.alerted).sort(), ['14', '30', '60', '7']);
});

test('an expired registration alerts, then reminds once a day', () => {
  let r = exp.evaluateExpiry(null, found(-3), WARN, NOW);
  assert.deepEqual(types(r.events), ['expired']);
  assert.equal(r.state.status, 'expired');

  r = exp.evaluateExpiry(r.state, found(-3), WARN, NOW + 6 * 3600000);
  assert.deepEqual(r.events, []);
  r = exp.evaluateExpiry(r.state, found(-3), WARN, NOW + DAY + 1000);
  assert.deepEqual(types(r.events), ['expired']);
});

test('renewal is announced and resets the thresholds', () => {
  let r = exp.evaluateExpiry(null, found(10), WARN, NOW);
  assert.deepEqual(types(r.events), ['expiring']);

  r = exp.evaluateExpiry(r.state, found(10 + 365), WARN, NOW + DAY);
  assert.deepEqual(types(r.events), ['renewed']);
  assert.equal(r.state.status, 'ok');
  assert.deepEqual(r.state.alerted, {});

  // a year on, the next cycle warns again
  r = exp.evaluateExpiry(r.state, found(10 + 365), WARN, NOW + 330 * DAY);
  assert.deepEqual(types(r.events), ['expiring']);
});

test('a tiny change in the expiry timestamp is not a renewal', () => {
  const first = exp.evaluateExpiry(null, found(100), WARN, NOW).state;
  const r = exp.evaluateExpiry(first, found(100, { expires: first.expires + 3600000 }), WARN, NOW + DAY);
  assert.deepEqual(r.events, []);
});

test('a new registration date means the domain lapsed and was registered again', () => {
  const first = exp.evaluateExpiry(null, found(100), WARN, NOW).state;
  const r = exp.evaluateExpiry(first, found(365, { registered: NOW - DAY, registrar: 'Someone Else Ltd' }), WARN, NOW + DAY);
  assert.ok(types(r.events).includes('reregistered'));
  assert.equal(r.events.find(e => e.type === 'reregistered').previousRegistrar, 'Example Registrar');
});

test('hold, redemption and pending delete are announced once per change', () => {
  let r = exp.evaluateExpiry(null, found(200, { flags: { onHold: true, redemption: false, pendingDelete: false } }), WARN, NOW);
  assert.deepEqual(types(r.events), ['lifecycle']);
  assert.deepEqual(r.events[0].problems, ['on hold']);
  assert.equal(r.state.status, 'expiring', 'a hold needs attention even with time left');

  r = exp.evaluateExpiry(r.state, found(200, { flags: { onHold: true, redemption: false, pendingDelete: false } }), WARN, NOW + DAY);
  assert.deepEqual(r.events, [], 'the same problem does not repeat');

  r = exp.evaluateExpiry(r.state, found(200, { flags: { onHold: true, redemption: true, pendingDelete: false } }), WARN, NOW + 2 * DAY);
  assert.deepEqual(r.events[0].problems, ['redemption period', 'on hold']);

  r = exp.evaluateExpiry(r.state, found(200), WARN, NOW + 3 * DAY);            // cleared
  assert.deepEqual(r.events, []);
  assert.equal(r.state.status, 'ok');
});

test('a domain that disappears is reported once; one that never existed is not', () => {
  const first = exp.evaluateExpiry(null, found(30), WARN, NOW).state;
  let r = exp.evaluateExpiry(first, { status: 'notfound', domain: 'example.com' }, WARN, NOW + DAY);
  assert.deepEqual(types(r.events), ['notfound']);
  assert.equal(r.state.status, 'notfound');
  r = exp.evaluateExpiry(r.state, { status: 'notfound' }, WARN, NOW + 2 * DAY);
  assert.deepEqual(r.events, []);

  const never = exp.evaluateExpiry(null, { status: 'notfound' }, WARN, NOW);
  assert.deepEqual(never.events, []);
  assert.equal(never.state.status, 'notfound');
});

test('a TLD without RDAP, or a registry with no expiry date, is a quiet state, not an alert', () => {
  const u = exp.evaluateExpiry(null, { status: 'unsupported', tld: 'io' }, WARN, NOW);
  assert.deepEqual(u.events, []);
  assert.equal(u.state.status, 'unsupported');
  assert.equal(u.state.tld, 'io');

  const n = exp.evaluateExpiry(null, found(null), WARN, NOW);
  assert.deepEqual(n.events, []);
  assert.equal(n.state.status, 'noexpiry');
  assert.equal(n.state.expires, null);
});

test('errors alert only after repeated failures, keep the last known details, and recovery is announced', () => {
  let state = exp.evaluateExpiry(null, found(100), WARN, NOW).state;
  const fail = { status: 'error', message: 'The registry did not answer in time' };

  let r = exp.evaluateExpiry(state, fail, WARN, NOW + 1);
  assert.deepEqual(r.events, []);
  assert.equal(r.state.status, 'ok');
  assert.equal(r.state.expires, state.expires);

  r = exp.evaluateExpiry(r.state, fail, WARN, NOW + 2);
  r = exp.evaluateExpiry(r.state, fail, WARN, NOW + 3);
  assert.deepEqual(types(r.events), ['error']);
  assert.equal(r.state.status, 'error');

  r = exp.evaluateExpiry(r.state, fail, WARN, NOW + 4);
  assert.deepEqual(r.events, [], 'no repeat while it keeps failing');

  r = exp.evaluateExpiry(r.state, found(100), WARN, NOW + 5);
  assert.deepEqual(types(r.events), ['recovered']);
  assert.equal(r.state.status, 'ok');
});

test('invalid or missing results are handled like errors, never thrown', () => {
  assert.equal(exp.evaluateExpiry(null, { status: 'invalid' }, WARN, NOW).state.ok, false);
  assert.equal(exp.evaluateExpiry(null, undefined, WARN, NOW).state.ok, false);
});

test('describeEvent gives readable one-liners', () => {
  const { state } = exp.evaluateExpiry(null, found(10), WARN, NOW);
  assert.equal(exp.describeEvent({ type: 'expiring' }, state), 'Registration expires in 10 days (2026-06-11)');
  assert.match(exp.describeEvent({ type: 'expired' }, { daysLeft: -1, expires: NOW - DAY }), /^Registration expired 1 day ago/);
  assert.match(exp.describeEvent({ type: 'renewed', previousExpires: NOW }, state), /Renewed: now expires 2026-06-11 \(was 2026-06-01\)/);
  assert.match(exp.describeEvent({ type: 'lifecycle', problems: ['on hold'] }, state), /marked the domain: on hold/);
  assert.match(exp.describeEvent({ type: 'notfound' }, state), /no longer registered/);
});
