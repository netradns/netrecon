'use strict';
// The merged Activity feed: audit log + notification deliveries + watch alerts.
// The three logs are real modules writing into a temporary data directory.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'netrecon-activity-'));
process.env.STATS_DIR = dir;

const audit    = require('../lib/admin/audit');
const notify   = require('../lib/notify/log');
const activity = require('../lib/admin/activity');
const { getWatched } = require('../lib/watcher/snapshot');

after(() => fs.rmSync(dir, { recursive: true, force: true }));

const wait = ms => new Promise(r => setTimeout(r, ms));

// One event from each source, a few milliseconds apart so the order is known
let seeded;
async function seed() {
  if (seeded) return;
  seeded = true;
  audit.record('login_ok', { ip: '10.0.0.1', detail: 'username: admin' });                       await wait(5);
  notify.appendLog('c1', 'slack', 'record_changed', true, null, 120);                            await wait(5);
  notify.appendLog('c2', 'webhook', 'cert_expiring', false, 'connect failed for https://hooks.example.com/T000/B000/secret-token', 40); await wait(5);
  getWatched().changeLog.push({ watchId: 'w1', domain: 'example.com', ts: Date.now(), changes: [
    { type: 'added', recordType: 'A', data: '1.2.3.4' }, { type: 'removed', recordType: 'A', data: '5.6.7.8' },
    { type: 'added', recordType: 'MX', data: 'mail.example.com' }, { type: 'added', recordType: 'TXT', data: 'v=spf1' } ] });
  await wait(5);
  getWatched().changeLog.push({ watchId: 'w2', domain: 'example.org', ts: Date.now(), kind: 'cert', changes: [],
    certEvents: [{ type: 'expiring', message: 'Certificate expires in 14 days' }] });
  await wait(5);
  getWatched().changeLog.push({ watchId: 'w3', domain: 'example.net', ts: Date.now(), kind: 'expiry', changes: [],
    expiryEvents: [{ type: 'expiring', message: 'Registration expires in 30 days' }, { type: 'renewed', message: 'Renewed' }] });
  await wait(5);
  audit.record('watch_failing', { actor: 'system', detail: 'example.com: timeout' });            await wait(5);
  audit.record('server_started', { actor: 'system', detail: 'Listening on port 8080' });
}

test('everything is merged newest first', async () => {
  await seed();
  const { events, total } = activity.getActivity({});
  assert.equal(total, 8);
  assert.deepEqual(events.map(e => e.type), [
    'server_started', 'watch_failing', 'alert_expiry', 'alert_cert', 'alert_dns', 'notify_failed', 'notify_ok', 'login_ok']);
  for (let i = 1; i < events.length; i++) assert.ok(events[i - 1].ts >= events[i].ts);
});

test('each group shows only its own events', async () => {
  await seed();
  const types = c => activity.getActivity({ category: c }).events.map(e => e.type);
  assert.deepEqual(types('delivery'), ['notify_failed', 'notify_ok']);
  assert.deepEqual(types('alerts'), ['watch_failing', 'alert_expiry', 'alert_cert', 'alert_dns']);
  assert.deepEqual(types('signin'), ['login_ok']);
  assert.deepEqual(types('system'), ['server_started']);
  assert.deepEqual(types('data'), []);
});

test('an unknown group means everything', async () => {
  await seed();
  assert.equal(activity.getActivity({ category: 'nonsense' }).total, 8);
  assert.equal(activity.getActivity({ category: '__proto__' }).total, 8);
});

test('paging: limit, offset and the total of all matches', async () => {
  await seed();
  const p1 = activity.getActivity({ limit: 3, offset: 0 });
  const p2 = activity.getActivity({ limit: 3, offset: 3 });
  const p3 = activity.getActivity({ limit: 3, offset: 6 });
  assert.deepEqual([p1.events.length, p2.events.length, p3.events.length], [3, 3, 2]);
  assert.equal(p1.total, 8);
  assert.equal(p3.total, 8);
  const all = p1.events.concat(p2.events, p3.events).map(e => e.type);
  assert.deepEqual(all, activity.getActivity({}).events.map(e => e.type), 'pages add up to the full list');
  assert.equal(activity.getActivity({ limit: 3, offset: 50 }).events.length, 0);
  assert.equal(activity.getActivity({ limit: 3, offset: 50 }).total, 8);
});

test('odd paging values are made safe', async () => {
  await seed();
  assert.equal(activity.getActivity({ limit: 0 }).events.length, 8);       // 0 is not a page size: default
  assert.equal(activity.getActivity({ limit: -5 }).events.length, 1);      // clamped to at least 1
  assert.equal(activity.getActivity({ limit: 'abc', offset: 'x' }).events.length, 8);
  assert.equal(activity.getActivity({ limit: 999999 }).events.length, 8);
  assert.equal(activity.getActivity({ limit: 2, offset: -4 }).events.length, 2);
});

test('web addresses in delivery errors are hidden', async () => {
  await seed();
  const failed = activity.getActivity({ category: 'delivery' }).events.find(e => e.type === 'notify_failed');
  assert.match(failed.detail, /^webhook: cert_expiring - connect failed for \[address hidden\]/);
  assert.ok(!failed.detail.includes('secret-token'));
  assert.ok(!failed.detail.includes('hooks.example.com'));
  assert.equal(activity.hideUrls('see ftp://x.example/y and http://a.b/c'), 'see [address hidden] and [address hidden]');
});

test('alerts are described in plain words', async () => {
  await seed();
  const byType = t => activity.getActivity({ category: 'alerts' }).events.find(e => e.type === t);
  assert.equal(byType('alert_dns').detail, 'example.com: +A 1.2.3.4, -A 5.6.7.8, +MX mail.example.com and 1 more');
  assert.equal(byType('alert_cert').detail, 'example.org: Certificate expires in 14 days');
  assert.equal(byType('alert_expiry').detail, 'example.net: Registration expires in 30 days; Renewed');
  assert.equal(byType('alert_dns').actor, 'system');
});

test('delivery events carry the service, the event and the time taken', async () => {
  await seed();
  const ok = activity.getActivity({ category: 'delivery' }).events.find(e => e.type === 'notify_ok');
  assert.equal(ok.detail, 'slack: record_changed (120 ms)');
  assert.equal(ok.category, 'delivery');
});

test('the 24 hour summary counts sign-ins, failures and changes', async () => {
  audit.record('login_failed', { ip: '9.9.9.9', detail: 'username: root' });
  audit.record('login_failed', { ip: '9.9.9.9', detail: 'username: root' });      // merged: counts as 2
  audit.record('settings_changed', { detail: 'webhookSecret' });
  const s = activity.summary24h();
  assert.equal(s.signIns, 1);
  assert.equal(s.failed, 2);
  assert.equal(s.changes, 1);
  // Events older than a day are not counted
  assert.deepEqual(activity.summary24h(Date.now() + 3 * 86400000), { signIns: 0, failed: 0, changes: 0 });
});

test('the event types for system events are known to the audit log', () => {
  assert.equal(audit.CATEGORY.server_started, 'system');
  assert.equal(audit.CATEGORY.watch_failing, 'alerts');
});
