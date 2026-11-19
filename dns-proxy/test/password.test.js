'use strict';

// Each test file runs in its own process, so this temp data dir is private to it.
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netrecon-pw-'));
process.env.STATS_DIR = dataDir;
delete process.env.STATS_PASSWORD;            // use the built-in default ("admin")

const { test, after } = require('node:test');
const assert   = require('node:assert/strict');
const crypto   = require('crypto');
const password = require('../lib/admin/password');
const { getConfig, saveConfig, invalidateCache } = require('../lib/admin/config-store');

after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const configOnDisk = () => fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8');

test('before any change, the default password works and is flagged as default', async () => {
  assert.equal(password.isUsingDefaultPassword(), true);
  assert.equal(await password.verifyPassword('admin'), true);
  assert.equal(await password.verifyPassword('wrong'), false);
  assert.equal(await password.verifyPassword(''), false);
  assert.equal(await password.verifyPassword(undefined), false);
});

test('hashes are salted scrypt and never contain the password', async () => {
  const a = await password.hashPassword('s3cret-passphrase');
  const b = await password.hashPassword('s3cret-passphrase');
  assert.match(a, /^scrypt\$16384\$8\$1\$/);
  assert.notEqual(a, b);                       // fresh salt every time
  assert.ok(!a.includes('s3cret-passphrase'));
});

test('changePassword rejects a wrong current password', async () => {
  const r = await password.changePassword('nope', 'a-new-password');
  assert.equal(r.ok, false);
  assert.match(r.error, /Current password is incorrect/);
});

test('changePassword enforces length and a real change', async () => {
  assert.match((await password.changePassword('admin', 'short')).error, /at least 8/);
  assert.match((await password.changePassword('admin', 'x'.repeat(257))).error, /at most 256/);
  assert.match((await password.changePassword('admin', 'admin')).error, /must be different/);
});

test('changePassword stores a salted hash and the old password stops working', async () => {
  const r = await password.changePassword('admin', 'a-new-password');
  assert.deepEqual(r, { ok: true });

  assert.equal(password.isUsingDefaultPassword(), false);
  assert.equal(await password.verifyPassword('a-new-password'), true);
  assert.equal(await password.verifyPassword('admin'), false);

  const disk = configOnDisk();
  assert.ok(!disk.includes('a-new-password'), 'plaintext must not be stored');
  assert.match(getConfig().adminPassword, /^scrypt\$/);
  assert.equal(getConfig().statsPasswordHash, null);
});

test('a legacy SHA-256 hash still works once, then is upgraded to scrypt', async () => {
  saveConfig({ adminPassword: null, statsPasswordHash: crypto.createHash('sha256').update('legacy-pass').digest('hex') });
  invalidateCache();                                  // behave like a fresh start reading the old file

  assert.equal(await password.verifyPassword('wrong-pass'), false);
  assert.match(getConfig().statsPasswordHash, /^[0-9a-f]{64}$/, 'a failed login must not upgrade anything');

  assert.equal(await password.verifyPassword('legacy-pass'), true);
  assert.match(getConfig().adminPassword, /^scrypt\$/);
  assert.equal(getConfig().statsPasswordHash, null);

  assert.equal(await password.verifyPassword('legacy-pass'), true);   // now verified via scrypt
  assert.equal(await password.verifyPassword('wrong-pass'), false);
});

test('very long inputs are rejected without hashing them', async () => {
  assert.equal(await password.verifyPassword('x'.repeat(300)), false);
});
