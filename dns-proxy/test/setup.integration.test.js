'use strict';

// Upgrades from older versions and the first-run setup wizard, against the real server.

const fs   = require('fs');
const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sha256 } = require('./helpers/server');

const login = (srv, password) => srv.request('POST', '/admin/login', { body: { username: 'admin', password } });
const readConfig = srv => JSON.parse(fs.readFileSync(path.join(srv.dir, 'config.json'), 'utf8'));

test('an existing install with an old SHA-256 hash keeps working and is upgraded on first login', async () => {
  const srv = await startServer({ config: { setupComplete: true, statsPasswordHash: sha256('legacy-pass') } });
  try {
    assert.equal((await login(srv, 'admin')).status, 401);          // the env default no longer applies
    assert.equal((await login(srv, 'wrong')).status, 401);
    assert.equal(readConfig(srv).statsPasswordHash, sha256('legacy-pass'), 'a failed login must not change the file');

    const ok = await login(srv, 'legacy-pass');
    assert.equal(ok.status, 200);
    assert.equal(ok.body.usingDefault, false);

    const cfg = readConfig(srv);
    assert.match(cfg.adminPassword, /^scrypt\$/);
    assert.equal(cfg.statsPasswordHash, null);
    assert.ok(!JSON.stringify(cfg).includes('legacy-pass'));

    assert.equal((await login(srv, 'legacy-pass')).status, 200);   // still works after the upgrade
  } finally { await srv.stop(); }
});

test('STATS_PASSWORD from the environment is used when nothing else is set', async () => {
  const srv = await startServer({ env: { STATS_PASSWORD: 'from-the-environment' } });
  try {
    assert.equal((await login(srv, 'admin')).status, 401);
    const ok = await login(srv, 'from-the-environment');
    assert.equal(ok.status, 200);
    assert.equal(ok.body.usingDefault, false);
  } finally { await srv.stop(); }
});

test('first-run setup: validates the password, runs once, and the new password logs in', async () => {
  const srv = await startServer();
  try {
    assert.equal((await srv.request('GET', '/setup/status')).body.setupComplete, false);

    const weak = await srv.request('POST', '/setup', { body: { password: 'abc' } });
    assert.equal(weak.status, 400);
    assert.match(weak.body.error, /at least 8/);

    const bad = await srv.request('POST', '/setup', { body: { password: 'a-good-password', dnsServers: 'not-an-ip' } });
    assert.equal(bad.status, 400);

    const ok = await srv.request('POST', '/setup', { body: { password: 'a-good-password' } });
    assert.equal(ok.status, 200);

    const cfg = readConfig(srv);
    assert.match(cfg.adminPassword, /^scrypt\$/);
    assert.ok(!JSON.stringify(cfg).includes('a-good-password'));

    assert.equal((await srv.request('POST', '/setup', { body: { password: 'another-password' } })).status, 403);

    assert.equal((await login(srv, 'admin')).status, 401);
    assert.equal((await login(srv, 'a-good-password')).status, 200);
    assert.equal((await srv.request('GET', '/app-config')).body.setupComplete, true);
  } finally { await srv.stop(); }
});
