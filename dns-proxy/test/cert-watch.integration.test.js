'use strict';

// End to end: a real server, a real TLS server presenting a test certificate,
// and a local webhook that receives the alerts.

const http = require('http');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server');
const { serveCert }   = require('./helpers/tls-fixture');

let srv, hook, tlsSrv, token;
const alerts = [];

before(async () => {
  hook = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => { alerts.push(JSON.parse(body)); res.end('ok'); });
  });
  await new Promise(r => hook.listen(0, '127.0.0.1', r));

  tlsSrv = await serveCert({ notBeforeDays: -30, notAfterDays: 10, cn: 'watched.test' });

  srv = await startServer({
    env:    { STATS_PASSWORD: 'integration-pass' },
    config: { setupComplete: true, notifyChannels: [{ id: 'hook', service: 'webhook', name: 'test', url: `http://127.0.0.1:${hook.address().port}/` }] },
  });
  token = (await srv.request('POST', '/admin/login', { body: { username: 'admin', password: 'integration-pass' } })).body.token;
});

after(async () => {
  await srv.stop();
  await tlsSrv.close();
  await new Promise(r => hook.close(r));
});

const watched = () => srv.request('GET', '/admin/watched', { token }).then(r => r.body);
const add = body => srv.request('POST', '/admin/watched', { token, body });

/** Wait until `fn` returns something truthy (the first check runs in the background). */
async function until(fn, what, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting for ' + what + '\n' + srv.log());
    await new Promise(r => setTimeout(r, 100));
  }
}

test('input validation for certificate watches', async () => {
  const cert = { enabled: true, port: tlsSrv.port };

  assert.equal((await add({ domain: '10.0.0.5', source: 'internal', recordTypes: ['A'] })).status, 400);                 // IP needs a cert watch
  assert.equal((await add({ domain: '10.0.0.5', source: 'public', cert })).status, 400);                                   // private IP, public source
  assert.equal((await add({ domain: '0177.0.0.1', source: 'internal', cert })).status, 400);                              // non-canonical IP
  assert.equal((await add({ domain: '999.1.1.1', source: 'internal', cert })).status, 400);
  assert.equal((await add({ domain: 'host.example', source: 'internal', cert: { enabled: true, port: 70000 } })).status, 400);
  assert.equal((await add({ domain: 'host.example', source: 'internal', recordTypes: [] })).status, 400);                  // nothing to watch
  assert.equal((await add({ domain: 'bad domain!', source: 'internal', cert })).status, 400);
  assert.equal((await srv.request('POST', '/admin/watched', { body: { domain: 'x.example' } })).status, 401);              // needs login
});

test('a certificate-only watch of an internal IP: first check, state, status and alert', async () => {
  const r = await add({ domain: '127.0.0.1', source: 'internal', interval: 60, recordTypes: [],
    cert: { enabled: true, port: tlsSrv.port, warnDays: [30, 14, 7] } });
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.entry.recordTypes, []);
  assert.equal(r.body.entry.cert.port, tlsSrv.port);
  const id = r.body.entry.id;

  const w = await until(async () => { const x = await watched(); return x.certs && x.certs[id] && x.certs[id].ok ? x : null; }, 'the first certificate check');
  const state = w.certs[id];
  assert.equal(state.commonName, 'watched.test');
  assert.ok(state.daysLeft === 9 || state.daysLeft === 10, `daysLeft ${state.daysLeft}`);
  assert.equal(state.status, 'expiring');

  const entry = w.domains.find(d => d.id === id);
  assert.equal(entry.certStatus, 'expiring');
  assert.equal(entry.status, 'changed');                       // certificate-only entries mirror the cert in the Status column

  const log = w.changeLog.filter(c => c.watchId === id);
  assert.equal(log.length, 1);
  assert.equal(log[0].kind, 'cert');
  assert.match(log[0].certEvents[0].message, /^Expires in \d+ days/);

  await until(() => alerts.length >= 1, 'the webhook alert');
  assert.match(alerts[0].title, /Certificate Expiring in \d+ days — 127\.0\.0\.1/);
  assert.equal(alerts[0].level, 'warning');
  assert.ok(alerts[0].fields.some(f => f.label === 'Host' && f.value === `127.0.0.1:${tlsSrv.port}`));
});

test('checking again does not repeat the alert, and a duplicate watch is refused', async () => {
  const entry = (await watched()).domains.find(d => d.domain === '127.0.0.1');
  const before = alerts.length;

  const r = await srv.request('POST', `/admin/watched/${entry.id}/check`, { token });
  assert.equal(r.status, 200);
  assert.equal(r.body.cert.status, 'expiring');
  await new Promise(res => setTimeout(res, 300));
  assert.equal(alerts.length, before, 'no repeat alert for the same threshold');

  const dup = await add({ domain: '127.0.0.1', source: 'internal', recordTypes: [], cert: { enabled: true, port: tlsSrv.port } });
  assert.equal(dup.status, 409);

  assert.equal((await srv.request('POST', '/admin/watched/doesnotexist/check', { token })).status, 404);
});

test('renewing the certificate is detected and announced', async () => {
  const entry = (await watched()).domains.find(d => d.domain === '127.0.0.1');
  const before = alerts.length;

  tlsSrv.setCert({ notBeforeDays: -1, notAfterDays: 90, cn: 'watched.test' });
  const r = await srv.request('POST', `/admin/watched/${entry.id}/check`, { token });
  assert.equal(r.body.cert.status, 'ok');
  assert.ok(r.body.cert.daysLeft >= 89);

  await until(() => alerts.length > before, 'the renewal alert');
  assert.match(alerts[alerts.length - 1].title, /Certificate Renewed/);
  assert.equal(alerts[alerts.length - 1].level, 'success');

  const w = await watched();
  assert.equal(w.domains.find(d => d.id === entry.id).status, 'stable');
});

test('an expired certificate raises an alert and the entry shows an error', async () => {
  const second = await serveCert({ notBeforeDays: -60, notAfterDays: -2, cn: 'old.test' });
  try {
    const before = alerts.length;
    const r = await add({ domain: '127.0.0.1', source: 'internal', recordTypes: [], cert: { enabled: true, port: second.port } });
    assert.equal(r.status, 201);                                // a different port is a different certificate watch
    const id = r.body.entry.id;

    await until(() => alerts.length > before, 'the expired alert');
    assert.match(alerts[alerts.length - 1].title, /Certificate Expired — 127\.0\.0\.1/);
    assert.equal(alerts[alerts.length - 1].level, 'danger');

    const w = await watched();
    assert.equal(w.certs[id].status, 'expired');
    assert.equal(w.domains.find(d => d.id === id).status, 'error');
  } finally { await second.close(); }
});

test('removing a watch also removes its certificate state', async () => {
  const w = await watched();
  const entry = w.domains[0];
  assert.ok(w.certs[entry.id]);
  assert.equal((await srv.request('DELETE', `/admin/watched/${entry.id}`, { token })).status, 200);
  const after = await watched();
  assert.equal(after.certs[entry.id], undefined);
  assert.ok(!after.changeLog.some(c => c.watchId === entry.id));
});

test('existing DNS-only entries keep working unchanged', async () => {
  const r = await add({ domain: 'corp.test', source: 'internal', recordTypes: ['A', 'MX'], interval: 15 });
  assert.equal(r.status, 201);
  assert.equal(r.body.entry.cert, null);
  assert.deepEqual(r.body.entry.recordTypes, ['A', 'MX']);

  // Same host and source cannot watch DNS twice
  assert.equal((await add({ domain: 'corp.test', source: 'internal', recordTypes: ['TXT'] })).status, 409);
  // but the certificate of a host whose DNS is watched can be added alongside it
  const both = await add({ domain: 'corp.test', source: 'internal', recordTypes: [], cert: { enabled: true, port: 443 } });
  assert.equal(both.status, 201);
});
