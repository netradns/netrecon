'use strict';
// A check requested while another check of the same entry is running (an edit, or "Check now")
// must not be lost, and a DNS poll that started before the record types were edited must not
// be stored as the new baseline. DNS polling is replaced by a stub so no network is used.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'netrecon-rerun-'));
process.env.STATS_DIR = dir;

let pollCalls = 0, onPoll = null;
const pollerPath = require.resolve('../lib/watcher/poller');
require.cache[pollerPath] = { id: pollerPath, filename: pollerPath, loaded: true, exports: {
  pollDomain: async (entry) => { pollCalls++; return onPoll(entry, pollCalls); },
} };
const watcher = require('../lib/watcher');
const { getWatched } = require('../lib/watcher/snapshot');

after(() => fs.rmSync(dir, { recursive: true, force: true }));

const rec = (type, data) => ({ type, data, ttl: 60 });
function addEntry(id, recordTypes) {
  const watched = getWatched();
  const entry = { id, domain: id + '.example.com', source: 'public', recordTypes, cert: null, expiry: null, interval: 60, lastChecked: null, status: 'pending' };
  watched.domains.push(entry);
  return { watched, entry };
}
const later = ms => new Promise(r => setTimeout(r, ms));

test('a forced check asked for during a running check runs again afterwards', async () => {
  pollCalls = 0;
  const { watched, entry } = addEntry('r1', ['A']);
  let release;
  const gate = new Promise(r => { release = r; });
  onPoll = async (e, n) => { if (n === 1) await gate; return [rec('A', '10.0.0.' + n)]; };
  const first = watcher.checkEntry(entry, watched);
  await later(20);
  await watcher.checkEntry(entry, watched, { force: true });    // returns at once: one is already running
  assert.equal(pollCalls, 1);
  release();
  await first;
  assert.equal(pollCalls, 2, 'the requested check ran once the first one ended');
});

test('a check not forced during a running check is simply skipped', async () => {
  pollCalls = 0;
  const { watched, entry } = addEntry('r2', ['A']);
  let release;
  const gate = new Promise(r => { release = r; });
  onPoll = async (e, n) => { if (n === 1) await gate; return [rec('A', '10.0.0.9')]; };
  const first = watcher.checkEntry(entry, watched);
  await later(20);
  await watcher.checkEntry(entry, watched);                     // the scheduler asking again
  release();
  await first;
  assert.equal(pollCalls, 1);
});

test('a poll for record types that were edited meanwhile is discarded', async () => {
  pollCalls = 0;
  const { watched, entry } = addEntry('r3', ['A', 'MX']);
  let release;
  const gate = new Promise(r => { release = r; });
  onPoll = async (e, n) => {
    if (n === 1) { await gate; return [rec('A', '1.1.1.1'), rec('MX', 'mail.example.com')]; }   // answer for the old types
    return [rec('TXT', 'v=spf1 -all')];                                                         // answer for the new types
  };
  const first = watcher.checkEntry(entry, watched);
  await later(20);
  entry.recordTypes = ['TXT'];                                  // the edit
  delete watched.snapshots[entry.id];
  await watcher.checkEntry(entry, watched, { force: true });    // what the edit route does
  release();
  await first;
  assert.equal(pollCalls, 2);
  assert.deepEqual(watched.snapshots.r3.records, [rec('TXT', 'v=spf1 -all')], 'the baseline is the new types only');
  assert.ok(!watched.changeLog.some(c => c.watchId === 'r3'), 'no false change was logged');
});

test('an entry removed while it was checked is not checked again', async () => {
  pollCalls = 0;
  const { watched, entry } = addEntry('r4', ['A']);
  let release;
  const gate = new Promise(r => { release = r; });
  onPoll = async (e, n) => { if (n === 1) await gate; return [rec('A', '10.0.0.4')]; };
  const first = watcher.checkEntry(entry, watched);
  await later(20);
  await watcher.checkEntry(entry, watched, { force: true });
  watched.domains = watched.domains.filter(d => d !== entry);
  release();
  await first;
  assert.equal(pollCalls, 1);
});
