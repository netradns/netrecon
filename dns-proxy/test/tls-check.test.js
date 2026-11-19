'use strict';

// These tests never touch the network: every case is refused before a socket opens.

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const { checkCert } = require('../lib/tls-check');

test('private IP literals are refused', async () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '169.254.169.254', '172.16.0.1']) {
    const r = await checkCert(ip);
    assert.match(r.error, /private or reserved/, ip);
  }
});

test('non-canonical numeric hosts are refused as invalid', async () => {
  for (const h of ['0177.0.0.1', '2130706433', '127.1', '1.2.3', '999.1.1.1']) {
    const r = await checkCert(h);
    assert.equal(r.error, 'Invalid IP address', h);
  }
});

test('a name that resolves to a private address is refused', async () => {
  for (const ip of ['10.1.2.3', '127.0.0.1', '169.254.169.254', '::1']) {
    const r = await checkCert('evil.example.com', { resolve: async () => ip });
    assert.match(r.error, /private or reserved/, ip);
  }
});

test('a name with no A record reports it', async () => {
  const r = await checkCert('nothing.example.com', { resolve: async () => null });
  assert.match(r.error, /no A record/);
});

test('resolver failures are reported, not thrown', async () => {
  const r = await checkCert('broken.example.com', { resolve: async () => { throw new Error('boom'); } });
  assert.match(r.error, /DNS resolution failed: boom/);
});
