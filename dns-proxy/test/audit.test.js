'use strict';

// Each test file runs in its own process, so this data dir is private to it.
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netrecon-audit-'));
process.env.STATS_DIR = dataDir;

const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const AUDIT_JS = require.resolve('../lib/admin/audit');
const CONFIG_JS = require.resolve('../lib/config');
let audit = require('../lib/admin/audit');

const auditFile   = path.join(dataDir, 'audit.json');
const pendingFile = path.join(dataDir, 'audit-pending.ndjson');

/** A fresh copy of the module, as after a server restart. */
function restart() {
  delete require.cache[AUDIT_JS];
  delete require.cache[CONFIG_JS];
  audit = require('../lib/admin/audit');
}

beforeEach(() => {
  fs.rmSync(auditFile, { force: true });
  fs.rmSync(pendingFile, { force: true });
  restart();
});
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('events are returned newest first with their category', () => {
  audit.record('login_ok',         { ip: '10.0.0.5', actor: 'anonymous', detail: 'ok' });
  audit.record('password_changed', { ip: '10.0.0.5' });
  audit.record('watched_added',    { ip: '10.0.0.5', detail: 'example.com' });

  const log = audit.getLog();
  assert.deepEqual(log.map(e => e.type), ['watched_added', 'password_changed', 'login_ok']);
  assert.deepEqual(log.map(e => e.category), ['watch', 'security', 'signin']);
  assert.equal(log[0].ip, '10.0.0.5');
  assert.equal(log[0].actor, 'admin');
  assert.ok(Math.abs(log[0].ts - Date.now()) < 5000);
});

test('unknown event types are ignored', () => {
  audit.record('made_up_event', { detail: 'x' });
  audit.record(undefined);
  assert.equal(audit.getLog().length, 0);
});

test('filtering by category and limiting the count', () => {
  for (let i = 0; i < 5; i++) audit.record('login_ok', { detail: `n${i}` });
  audit.record('settings_changed', { detail: 'internalDnsEnabled' });

  assert.equal(audit.getLog({ category: 'signin' }).length, 5);
  assert.equal(audit.getLog({ category: 'config' }).length, 1);
  assert.equal(audit.getLog({ category: 'data' }).length, 0);
  assert.equal(audit.getLog({ limit: 2 }).length, 2);
  assert.equal(audit.getLog({ limit: 2 })[0].type, 'settings_changed');
});

test('repeated failed sign-ins from one address are merged into one counted entry', () => {
  for (let i = 0; i < 40; i++) audit.record('login_failed', { ip: '203.0.113.9', actor: 'anonymous', detail: 'username: admin' });
  const log = audit.getLog();
  assert.equal(log.length, 1);
  assert.equal(log[0].count, 40);

  // A different address or a different username is a separate entry
  audit.record('login_failed', { ip: '203.0.113.10', actor: 'anonymous', detail: 'username: admin' });
  audit.record('login_failed', { ip: '203.0.113.9',  actor: 'anonymous', detail: 'username: root' });
  assert.equal(audit.getLog().length, 3);
});

test('other events are never merged, even when identical', () => {
  audit.record('password_changed', { ip: '10.0.0.5' });
  audit.record('password_changed', { ip: '10.0.0.5' });
  assert.equal(audit.getLog().length, 2);
});

test('a flood of failed sign-ins cannot push real history out of the log', () => {
  audit.record('password_changed', { ip: '10.0.0.5' });
  for (let i = 0; i < 3000; i++) audit.record('login_failed', { ip: '198.51.100.7', detail: 'username: admin' });
  assert.ok(audit.getLog({ category: 'security' }).length === 1);
});

test('the log is capped, dropping the oldest events', () => {
  for (let i = 0; i < 1100; i++) audit.record('watched_added', { detail: `host${i}.example` });
  const all = audit.getLog({ limit: 5000 });
  assert.equal(all.length, 1000);
  assert.equal(all[0].detail, 'host1099.example');
  assert.equal(all[all.length - 1].detail, 'host100.example');
});

test('free text is reduced to printable ASCII and limited in length', () => {
  audit.record('login_failed', { ip: '1.2.3.4', detail: 'username: ' + 'x'.repeat(500) + '\u0000\n\r<script>\u00e9' });
  const e = audit.getLog()[0];
  assert.ok(e.detail.length <= 200);
  assert.ok(/^[\x20-\x7E]*$/.test(e.detail));

  audit.record('login_failed', { ip: '1.2.3.5', detail: 'caf\u00e9\u202e\ud83d\ude00' });
  assert.equal(audit.getLog()[0].detail, 'caf????');   // e-acute, a right-to-left mark and an emoji (two UTF-16 units)
});

test('events survive a restart', () => {
  audit.record('password_changed', { ip: '10.0.0.5', detail: 'kept' });
  audit.flush();
  restart();
  const log = audit.getLog();
  assert.equal(log.length, 1);
  assert.equal(log[0].detail, 'kept');
});

test('a damaged log file starts a fresh log instead of crashing', () => {
  fs.writeFileSync(auditFile, '{ this is not json');
  restart();
  assert.deepEqual(audit.getLog(), []);
  audit.record('logout');
  assert.equal(audit.getLog().length, 1);
});

test('events queued by a command-line tool are picked up at the next start', () => {
  audit.queueCliEvent('password_reset_cli', 'via command line');
  audit.queueCliEvent('not_a_real_event', 'ignored');
  fs.appendFileSync(pendingFile, 'garbage line\n');
  assert.ok(fs.existsSync(pendingFile));

  restart();
  const log = audit.getLog();
  assert.equal(log.length, 1);
  assert.equal(log[0].type, 'password_reset_cli');
  assert.equal(log[0].actor, 'cli');
  assert.equal(fs.existsSync(pendingFile), false, 'the queue file is removed once read');
});
