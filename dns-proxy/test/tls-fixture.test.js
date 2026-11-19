'use strict';

// Real TLS handshakes against a local server, to prove checkCert reads certificates correctly.

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const { serveCert } = require('./helpers/tls-fixture');
const { checkCert } = require('../lib/tls-check');

test('checkCert reads the expiry, subject and issuer of a self-signed certificate', async () => {
  const srv = await serveCert({ notBeforeDays: -1, notAfterDays: 10, cn: 'fixture.test' });
  try {
    const r = await checkCert('127.0.0.1', { port: srv.port, allowPrivate: true });
    assert.equal(r.error, undefined);
    assert.equal(r.commonName, 'fixture.test');
    assert.match(r.subject, /CN=fixture\.test/);
    assert.ok(r.daysLeft === 9 || r.daysLeft === 10, `daysLeft was ${r.daysLeft}`);
    assert.equal(r.expired, false);
    assert.equal(r.authorized, false);                 // self-signed
    assert.ok(r.fingerprint.length > 20);
  } finally { await srv.close(); }
});

test('an expired certificate is reported as expired with negative days', async () => {
  const srv = await serveCert({ notBeforeDays: -60, notAfterDays: -3 });
  try {
    const r = await checkCert('127.0.0.1', { port: srv.port, allowPrivate: true });
    assert.equal(r.expired, true);
    assert.ok(r.daysLeft <= -3 && r.daysLeft >= -4, `daysLeft was ${r.daysLeft}`);
  } finally { await srv.close(); }
});

test('the same local server is refused when private addresses are not allowed', async () => {
  const srv = await serveCert({ notBeforeDays: -1, notAfterDays: 30 });
  try {
    const r = await checkCert('127.0.0.1', { port: srv.port });           // public-tool defaults
    assert.match(r.error, /private or reserved/);
  } finally { await srv.close(); }
});

test('a closed port reports an error instead of hanging', async () => {
  const srv = await serveCert({ notBeforeDays: -1, notAfterDays: 30 });
  const port = srv.port;
  await srv.close();
  const r = await checkCert('127.0.0.1', { port, allowPrivate: true, timeoutMs: 2000 });
  assert.ok(r.error, 'expected an error');
});
