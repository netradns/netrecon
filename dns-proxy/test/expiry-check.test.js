'use strict';

// The runner with a fake registry and a fake alert sender: no network, no clock.

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const { checkDomainExpiry } = require('../lib/watcher/expiry-check');

const DAY = 86400000;
const NOW = Date.UTC(2026, 5, 1, 12, 0, 0);

const entry = () => ({ id: 'abc', domain: 'example.com', source: 'public', expiry: { enabled: true, warnDays: [60, 30, 14, 7] } });
const watched = () => ({ domains: [], snapshots: {}, certs: {}, expiries: {}, changeLog: [] });
const found = (days, over) => Object.assign({
  status: 'ok', domain: 'example.com', registeredDomain: 'example.com', registrar: 'Example Registrar', server: 'rdap.example',
  registered: Date.UTC(2010, 0, 1), expires: NOW + days * DAY, updated: NOW, statuses: [], nameservers: [], flags: {},
}, over || {});

/** A fake lookup that records its calls and answers from a queue. */
function fakeLookup(...answers) {
  const calls = [];
  const fn = async (domain, opts) => { calls.push({ domain, opts }); const a = answers.length > 1 ? answers.shift() : answers[0]; if (a instanceof Error) throw a; return a; };
  fn.calls = calls;
  return fn;
}
const fakeAlert = () => { const sent = []; const fn = async (e, ev, st) => { sent.push({ type: ev.type, state: st }); }; fn.sent = sent; return fn; };
const tick = () => new Promise(r => setImmediate(r));

test('a first check stores the state, sets the status and alerts when already inside a threshold', async () => {
  const e = entry(), w = watched(), alert = fakeAlert(), lookup = fakeLookup(found(20));
  const r = await checkDomainExpiry(e, w, { lookup, alert, now: NOW });
  await tick();

  assert.equal(r.state.status, 'expiring');
  assert.equal(w.expiries.abc.daysLeft, 20);
  assert.equal(e.expiryStatus, 'expiring');
  assert.deepEqual(alert.sent.map(a => a.type), ['expiring']);
  assert.equal(lookup.calls[0].domain, 'example.com');

  assert.equal(w.changeLog.length, 1);
  assert.equal(w.changeLog[0].kind, 'expiry');
  assert.deepEqual(w.changeLog[0].changes, []);
  assert.match(w.changeLog[0].expiryEvents[0].message, /^Registration expires in 20 days/);
});

test('the schedule: twice a day normally, hourly after a failure, any time when forced', async () => {
  const e = entry(), w = watched(), alert = fakeAlert();
  const lookup = fakeLookup(found(400));

  await checkDomainExpiry(e, w, { lookup, alert, now: NOW });
  assert.equal(await checkDomainExpiry(e, w, { lookup, alert, now: NOW + 11 * 3600000 }), null, 'not due after 11 hours');
  assert.notEqual(await checkDomainExpiry(e, w, { lookup, alert, now: NOW + 12 * 3600000 + 1 }), null, 'due after 12 hours');
  assert.notEqual(await checkDomainExpiry(e, w, { lookup, alert, now: NOW + 12 * 3600000 + 5, force: true }), null, 'forced');
  assert.equal(lookup.calls.at(-1).opts.fresh, true, 'a forced check skips the cache');

  // After a failed lookup the next try comes sooner
  const e2 = entry(), w2 = watched();
  const bad = fakeLookup({ status: 'error', message: 'The registry did not answer in time' });
  await checkDomainExpiry(e2, w2, { lookup: bad, alert, now: NOW });
  assert.equal(await checkDomainExpiry(e2, w2, { lookup: bad, alert, now: NOW + 30 * 60000 }), null);
  assert.notEqual(await checkDomainExpiry(e2, w2, { lookup: bad, alert, now: NOW + 61 * 60000 }), null);
});

test('the same threshold is not announced twice across checks', async () => {
  const e = entry(), w = watched(), alert = fakeAlert(), lookup = fakeLookup(found(20));
  await checkDomainExpiry(e, w, { lookup, alert, now: NOW });
  await checkDomainExpiry(e, w, { lookup, alert, now: NOW + 13 * 3600000 });
  await tick();
  assert.equal(alert.sent.length, 1);
  assert.equal(w.changeLog.length, 1);
});

test('renewal is logged and alerted', async () => {
  const e = entry(), w = watched(), alert = fakeAlert();
  await checkDomainExpiry(e, w, { lookup: fakeLookup(found(20)), alert, now: NOW });
  await checkDomainExpiry(e, w, { lookup: fakeLookup(found(20 + 365)), alert, now: NOW + DAY });
  await tick();
  assert.deepEqual(alert.sent.map(a => a.type), ['expiring', 'renewed']);
  assert.equal(e.expiryStatus, 'ok');
});

test('a registry that is not supported is a state, with no alert and no history entry', async () => {
  const e = entry(), w = watched(), alert = fakeAlert();
  const r = await checkDomainExpiry(e, w, { lookup: fakeLookup({ status: 'unsupported', tld: 'io' }), alert, now: NOW });
  await tick();
  assert.equal(e.expiryStatus, 'unsupported');
  assert.equal(r.state.tld, 'io');
  assert.deepEqual(alert.sent, []);
  assert.equal(w.changeLog.length, 0);
});

test('a lookup that throws is recorded as a failed check instead of escaping', async () => {
  const e = entry(), w = watched(), alert = fakeAlert();
  const r = await checkDomainExpiry(e, w, { lookup: fakeLookup(new Error('socket hang up')), alert, now: NOW });
  assert.equal(r.state.ok, false);
  assert.match(r.state.error, /socket hang up/);
});

test('a failing alert sender does not break the check', async () => {
  const e = entry(), w = watched();
  const alert = async () => { throw new Error('webhook is down'); };
  const r = await checkDomainExpiry(e, w, { lookup: fakeLookup(found(5)), alert, now: NOW });
  await tick();
  assert.equal(r.state.status, 'expiring');
  assert.equal(w.changeLog.length, 1);
});

test('the history is capped like the DNS history', async () => {
  const e = entry(), w = watched();
  w.changeLog = Array.from({ length: 100 }, (_, i) => ({ watchId: 'other', ts: i, changes: [] }));
  await checkDomainExpiry(e, w, { lookup: fakeLookup(found(5)), alert: fakeAlert(), now: NOW });
  assert.equal(w.changeLog.length, 100);
  assert.equal(w.changeLog.at(-1).kind, 'expiry');
});
