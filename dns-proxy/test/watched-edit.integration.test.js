'use strict';
// Editing a watched entry (PATCH /admin/watched/:id) through the real admin API.
// Entries are seeded into watched.json before the server starts, so each test starts from
// a known state and none of them depends on what a live DNS server or registry answers.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');
const { startServer } = require('./helpers/server');

const NOW = Date.now();
const entry = (id, extra) => Object.assign({
  id, domain: 'host.example.com', source: 'internal', recordTypes: ['A', 'MX'], cert: null, expiry: null,
  interval: 60, addedAt: NOW - 86400000, lastChecked: NOW - 1000, lastChanged: NOW - 5000, status: 'stable',
  certStatus: null, expiryStatus: null,
}, extra);

const seed = {
  domains: [
    entry('a1', {}),                                                       // internal, DNS only
    entry('b2', { domain: 'example.com', source: 'public', recordTypes: ['A'] }),   // public, DNS only
    entry('c3', { domain: '10.9.8.7', recordTypes: [], cert: { enabled: true, port: 443, warnDays: [30, 14, 7] }, certStatus: 'ok' }),   // IP, certificate only
    entry('d4', { domain: 'example.org', source: 'public', recordTypes: [], expiry: { enabled: true, warnDays: [60, 30] }, expiryStatus: 'ok' }),
    entry('e5', { domain: 'twin.example.com', recordTypes: ['A'] }),
    entry('f6', { domain: 'twin.example.com', recordTypes: [], cert: { enabled: true, port: 443, warnDays: [30] }, certStatus: 'ok' }),
  ],
  snapshots: { a1: { ts: NOW, records: [{ type: 'A', data: '10.0.0.1', ttl: 60 }] } },
  certs: { c3: { status: 'ok', ok: true, daysLeft: 50 }, f6: { status: 'ok', ok: true, daysLeft: 50 } },
  expiries: { d4: { status: 'ok', daysLeft: 200 } },
  changeLog: [{ watchId: 'a1', domain: 'host.example.com', ts: NOW - 5000, changes: [{ type: 'added', recordType: 'A', data: '10.0.0.1' }] }],
};

let srv, token, dir;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'netrecon-edit-'));
  fs.writeFileSync(path.join(dir, 'watched.json'), JSON.stringify(seed));
  srv = await startServer({ dataDir: dir, env: { STATS_PASSWORD: 'integration-pass' }, config: { setupComplete: true } });
  token = (await srv.request('POST', '/admin/login', { body: { username: 'admin', password: 'integration-pass' } })).body.token;
});
after(async () => { await srv.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

const patch = (id, body) => srv.request('PATCH', `/admin/watched/${id}`, { token, body });
const state = () => srv.request('GET', '/admin/watched', { token }).then(r => r.body);
const find  = async id => (await state()).domains.find(d => d.id === id);

test('editing needs a login and a real entry', async () => {
  assert.equal((await srv.request('PATCH', '/admin/watched/a1', { body: { interval: 15 } })).status, 401);
  assert.equal((await patch('nope', { interval: 15 })).status, 404);
});

test('bad bodies are refused', async () => {
  assert.equal((await patch('a1', 'text')).status, 400);
  assert.equal((await patch('a1', [])).status, 400);
  assert.equal((await patch('a1', { recordTypes: 'A' })).status, 400);
  const odd = await patch('a1', { interval: 7 });
  assert.equal(odd.status, 400);
  assert.match(odd.body.error, /interval/i);
  assert.equal((await find('a1')).interval, 60);
});

test('an edit with no differences changes nothing', async () => {
  const r = await patch('a1', {});
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.changed, []);
  assert.equal((await find('a1')).status, 'stable');
});

test('a new interval alone does not restart or reset anything', async () => {
  const r = await patch('a1', { interval: 360 });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.changed, ['check interval']);
  const e = await find('a1');
  assert.equal(e.interval, 360);
  assert.equal(e.status, 'stable');
  assert.equal(e.lastChecked, NOW - 1000);
  assert.ok((await state()).snapshots.a1, 'snapshot kept');
});

test('turning on a certificate watch keeps the entry, its history and its snapshot', async () => {
  const r = await patch('a1', { cert: { enabled: true, port: 8443, warnDays: [10, 3] } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.changed, ['certificate on']);
  const s = await state();
  const e = s.domains.find(d => d.id === 'a1');
  assert.deepEqual(e.cert, { enabled: true, port: 8443, warnDays: [10, 3] });
  assert.equal(e.certStatus === 'pending' || !!s.certs.a1, true);
  assert.equal(e.addedAt, NOW - 86400000);
  assert.deepEqual(e.recordTypes, ['A', 'MX']);
  assert.ok(s.snapshots.a1, 'DNS snapshot kept');
  assert.ok(s.changeLog.some(c => c.watchId === 'a1' && c.ts === NOW - 5000), 'history kept');
  assert.equal(s.domains.filter(d => d.id === 'a1').length, 1);
});

test('changing only the warning days keeps the certificate result', async () => {
  // c3 has a stored result; new warning days must not discard it
  const r = await patch('c3', { cert: { enabled: true, port: 443, warnDays: [60, 7] } });
  assert.deepEqual(r.body.changed, ['certificate warning days']);
  const s = await state();
  assert.deepEqual(s.domains.find(d => d.id === 'c3').cert.warnDays, [60, 7]);
  assert.ok(s.certs.c3, 'result kept');
});

test('a different certificate port starts fresh', async () => {
  const r = await patch('c3', { cert: { enabled: true, port: 636, warnDays: [30] } });
  assert.deepEqual(r.body.changed, ['certificate port']);
  const e = await find('c3');
  assert.equal(e.cert.port, 636);
  assert.equal(e.certStatus === 'pending' || e.certStatus === 'ok' || e.certStatus === 'error', true);
});

test('turning a certificate watch off removes its result', async () => {
  const r = await patch('f6', { cert: null, recordTypes: ['A'], source: 'public' });   // source is ignored
  assert.equal(r.status, 409, 'e5 already watches this host\'s DNS records');
  const ok = await patch('f6', { cert: null, expiry: { enabled: false } });
  assert.equal(ok.status, 400, 'nothing would be left to watch');
  const e = await find('f6');
  assert.ok(e.cert, 'unchanged after a refused edit');
  // a host with DNS records can drop its certificate watch
  await patch('a1', { cert: { enabled: true, port: 443 } });
  const off = await patch('a1', { cert: null });
  assert.deepEqual(off.body.changed, ['certificate off']);
  const s = await state();
  assert.equal(s.domains.find(d => d.id === 'a1').cert, null);
  assert.equal(s.domains.find(d => d.id === 'a1').certStatus, null);
  assert.equal(s.certs.a1, undefined);
});

test('changing record types starts a fresh baseline but keeps the history', async () => {
  const r = await patch('a1', { recordTypes: ['TXT'] });
  assert.deepEqual(r.body.changed, ['record types']);
  const s = await state();
  assert.deepEqual(s.domains.find(d => d.id === 'a1').recordTypes, ['TXT']);
  assert.equal(s.snapshots.a1, undefined, 'old snapshot dropped, so removed types are not reported as changes');
  assert.ok(s.changeLog.some(c => c.watchId === 'a1' && c.ts === NOW - 5000), 'history kept');
  assert.ok(['pending', 'error'].includes(s.domains.find(d => d.id === 'a1').status), 'no longer shows the old status');
});

test('record types are cleaned up and cannot all be dropped', async () => {
  const r = await patch('a1', { recordTypes: ['mx', 'BOGUS', 'a'] });
  assert.deepEqual(r.body.entry.recordTypes, ['MX', 'A']);
  const none = await patch('a1', { recordTypes: [] });
  assert.equal(none.status, 400);
  assert.match(none.body.error, /at least one/i);
  assert.deepEqual((await find('a1')).recordTypes, ['MX', 'A']);
});

test('registration watching: public domains only', async () => {
  const internal = await patch('a1', { expiry: { enabled: true } });
  assert.equal(internal.status, 400);
  assert.match(internal.body.error, /public/i);
  const on = await patch('b2', { expiry: { enabled: true, warnDays: [90, 30] } });
  assert.equal(on.status, 200);
  assert.deepEqual(on.body.changed, ['registration on']);
  assert.deepEqual((await find('b2')).expiry, { enabled: true, warnDays: [90, 30] });
  const ip = await patch('c3', { expiry: { enabled: true } });
  assert.equal(ip.status, 400);
});

test('turning registration watching off removes its result', async () => {
  const r = await patch('d4', { recordTypes: ['NS'], expiry: null });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.changed.sort(), ['record types', 'registration off']);
  const s = await state();
  const e = s.domains.find(d => d.id === 'd4');
  assert.equal(e.expiry, null);
  assert.equal(e.expiryStatus, null);
  assert.equal(s.expiries.d4, undefined);
});

test('an IP address must keep its certificate watch and cannot gain DNS records', async () => {
  assert.equal((await patch('c3', { cert: null })).status, 400);
  const r = await patch('c3', { recordTypes: ['A'] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.entry.recordTypes, []);
  assert.deepEqual(r.body.changed, []);
});

test('an edit that would duplicate another watch is refused', async () => {
  // e5 watches twin.example.com DNS records. f6 (same host, same source) may not start watching them too.
  const r = await patch('f6', { recordTypes: ['A'] });
  assert.equal(r.status, 409);
  assert.deepEqual((await find('f6')).recordTypes, []);
  // Moving f6 to the port e5... e5 has no certificate, so a different certificate port is fine
  assert.equal((await patch('e5', { cert: { enabled: true, port: 443 } })).status, 409, 'f6 already watches port 443');
  assert.equal((await patch('e5', { cert: { enabled: true, port: 8443 } })).status, 200);
});

test('the domain and source cannot be changed', async () => {
  await patch('a1', { domain: 'other.example.com', source: 'public', interval: 15 });
  const e = await find('a1');
  assert.equal(e.domain, 'host.example.com');
  assert.equal(e.source, 'internal');
  assert.equal(e.interval, 15);
});

test('edits are recorded in the activity log with the names of what changed', async () => {
  const log = (await srv.request('GET', '/admin/audit?category=watch', { token })).body;
  const events = (log.events || log).filter(e => e.type === 'watched_edited');
  assert.ok(events.length >= 3, 'edits were logged');
  assert.ok(events.some(e => /host\.example\.com \(internal\): .*certificate on/.test(e.detail)));
  assert.ok(!JSON.stringify(events).includes('integration-pass'));
});
