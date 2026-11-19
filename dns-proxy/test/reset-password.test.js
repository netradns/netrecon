'use strict';

// Runs the real reset-password.js against a throwaway data directory.

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server');

const SCRIPT = path.join(__dirname, '..', 'reset-password.js');

function run(dir, env) {
  return spawnSync(process.execPath, [SCRIPT], {
    env: Object.assign({}, process.env, { STATS_DIR: dir, DNS_SERVERS: '' }, env), encoding: 'utf8',
  });
}
const newDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'netrecon-reset-'));
const login = (srv, password) => srv.request('POST', '/admin/login', { body: { username: 'admin', password } });

test('with no arguments it generates a strong password that works after a restart', async () => {
  const dir = newDir();
  // An install whose admin password has been forgotten
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ setupComplete: true, statsPasswordHash: 'f'.repeat(64) }));

  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
  const printed = /Password: (\S+)/.exec(r.stdout);
  assert.ok(printed, 'the new password is printed');
  assert.match(printed[1], /^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);

  const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
  assert.match(cfg.adminPassword, /^scrypt\$/);
  assert.equal(cfg.statsPasswordHash, null);
  assert.ok(!JSON.stringify(cfg).includes(printed[1]), 'the password is not stored in readable form');
  assert.equal(cfg.setupComplete, true, 'other settings are untouched');

  // The server reads the file when it starts, like after "docker compose restart"
  const srv = await startServer({ dataDir: dir });
  try {
    assert.equal((await login(srv, printed[1])).status, 200);
    assert.equal((await login(srv, 'admin')).status, 401);
  } finally { await srv.stop({ keepData: true }); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a chosen password is taken from NEW_PASSWORD and is not echoed back', () => {
  const dir = newDir();
  try {
    const r = run(dir, { NEW_PASSWORD: 'my own good passphrase' });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!r.stdout.includes('my own good passphrase'));
    assert.match(JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')).adminPassword, /^scrypt\$/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a too-short chosen password is refused and nothing is changed', () => {
  const dir = newDir();
  try {
    const r = run(dir, { NEW_PASSWORD: 'short' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /at least 8/);
    assert.equal(fs.existsSync(path.join(dir, 'config.json')), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
