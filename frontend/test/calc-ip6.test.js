// Tests for the IPv6 calculator maths (frontend/js/calc/calc-ip6.js).
// The browser script is loaded into a vm context, the same way a page would run it.
// Run with: cd dns-proxy && npm test
'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'calc', 'calc-ip6.js'), 'utf8'), ctx);
const f = name => ctx[name];
const hex = s => BigInt('0x' + s);

test('parses the usual spellings of an address', () => {
  assert.equal(f('ip6Parse')('::'), 0n);
  assert.equal(f('ip6Parse')('::1'), 1n);
  assert.equal(f('ip6Parse')('2001:db8::1'), hex('20010db8000000000000000000000001'));
  assert.equal(f('ip6Parse')('2001:0DB8:0000:0000:0000:0000:0000:0001'), hex('20010db8000000000000000000000001'));
  assert.equal(f('ip6Parse')('[2001:db8::1]'), hex('20010db8000000000000000000000001'));
  assert.equal(f('ip6Parse')('fe80::1%eth0'), hex('fe800000000000000000000000000001'));
  assert.equal(f('ip6Parse')('1::'), hex('00010000000000000000000000000000'));
  assert.equal(f('ip6Parse')('1:2:3:4:5:6:7:8'), hex('00010002000300040005000600070008'));
});

test('parses an IPv4 tail', () => {
  assert.equal(f('ip6Parse')('::ffff:192.0.2.1'), hex('00000000000000000000ffffc0000201'));
  assert.equal(f('ip6Parse')('64:ff9b::1.2.3.4'), hex('0064ff9b000000000000000001020304'));
});

test('rejects text that is not an address', () => {
  const bad = ['', ':::', '1::2::3', '12345::', 'g::1', '1:2:3:4:5:6:7', '1:2:3:4:5:6:7:8:9', '1:2:3:4:5:6:7::8',
    ':1:2:3:4:5:6:7', '1:2:3:4:5:6:7:', '::1.2.3.256', '1.2.3.4', '::1.2.3', '1::2.3', 'hello', '2001:db8::/32'];
  for (const s of bad) assert.equal(f('ip6Parse')(s), null, JSON.stringify(s));
});

test('compresses by the standard rules (RFC 5952)', () => {
  const c = s => f('ip6Compress')(f('ip6Parse')(s));
  assert.equal(c('2001:0db8:0000:0000:0000:0000:0000:0001'), '2001:db8::1');
  assert.equal(c('2001:db8:0:0:1:0:0:1'), '2001:db8::1:0:0:1');      // two equal runs: the first one shortens
  assert.equal(c('2001:db8:0:1:1:1:1:1'), '2001:db8:0:1:1:1:1:1');   // a single zero group is not shortened
  assert.equal(c('2001:db8:0:0:0:1:0:0'), '2001:db8::1:0:0');        // the longer run wins
  assert.equal(c('0:0:0:0:0:0:0:0'), '::');
  assert.equal(c('1:0:0:0:0:0:0:0'), '1::');
  assert.equal(c('0:0:0:0:0:0:0:1'), '::1');
  assert.equal(c('FE80:0:0:0:ABCD:0:0:1'), 'fe80::abcd:0:0:1');
});

test('expands to eight 4-digit groups', () => {
  assert.equal(f('ip6Expand')(f('ip6Parse')('2001:db8::1')), '2001:0db8:0000:0000:0000:0000:0000:0001');
  assert.equal(f('ip6Expand')(f('ip6Parse')('::')), '0000:0000:0000:0000:0000:0000:0000:0000');
});

test('compress then parse returns the same value', () => {
  for (const s of ['::', '::1', '2001:db8::', 'fe80::1:2:3', 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', '1:0:0:2:0:0:0:3']) {
    const n = f('ip6Parse')(s);
    assert.equal(f('ip6Parse')(f('ip6Compress')(n)), n);
    assert.equal(f('ip6Parse')(f('ip6Expand')(n)), n);
  }
});

test('reads calculator input', () => {
  const p = f('ip6ParseInput');
  assert.equal(p('2001:db8::/32').prefix, 32);
  assert.equal(p('2001:db8::/32').explicit, true);
  assert.equal(p('2001:db8:: /48').prefix, 48);
  assert.equal(p('2001:db8:: / 48').prefix, 48);
  assert.equal(p('[2001:db8::]/64').prefix, 64);
  assert.equal(p('::/0').prefix, 0);
  const bare = p('2001:db8::1');
  assert.equal(bare.prefix, 128);
  assert.equal(bare.explicit, false);
});

test('gives clear errors for bad input', () => {
  const p = f('ip6ParseInput');
  assert.match(p('2001:db8::/129').error, /0.128/);
  assert.match(p('2001:db8::/abc').error, /Invalid prefix/);
  assert.match(p('2001:db8::/-1').error, /Invalid prefix/);
  assert.match(p('2001:zz::/32').error, /Invalid IPv6/);
  assert.match(p('x'.repeat(200)).error, /too long/);
});

test('detects IPv6 input without catching IPv4 input', () => {
  const is = f('isIp6Input');
  assert.equal(is('2001:db8::/32'), true);
  assert.equal(is('::1'), true);
  assert.equal(is('/64'), true);
  assert.equal(is('/33'), true);
  assert.equal(is('/27'), false);
  assert.equal(is('/32'), false);
  assert.equal(is('192.168.1.0/24'), false);
  assert.equal(is('192.168.1.0 255.255.255.0'), false);
  assert.equal(is('255.255.255.224'), false);
  assert.equal(is('27'), false);
  assert.equal(is(''), false);
});

test('live typing only fires for a complete answer', () => {
  const ready = f('ip6Ready');
  assert.equal(ready('2001:db8::/32'), true);
  assert.equal(ready('2001:db8::'), false);        // no prefix yet
  assert.equal(ready('2001:db8::/129'), false);
  assert.equal(ready('2001:db8::/'), false);
  assert.equal(ready('/64'), true);
  assert.equal(ready('/129'), false);
  assert.equal(ready('192.168.1.0/24'), false);
});

test('builds a /64', () => {
  const p = f('ip6ParseInput')('2001:db8:abcd:12::1/64');
  const r = f('ip6Build')(p.ip, p.prefix);
  assert.equal(r.netStr, '2001:db8:abcd:12::');
  assert.equal(r.lastStr, '2001:db8:abcd:12:ffff:ffff:ffff:ffff');
  assert.equal(r.firstStr, '2001:db8:abcd:12::');
  assert.equal(r.expanded, '2001:0db8:abcd:0012:0000:0000:0000:0000');
  assert.equal(r.size, '2^64 (18,446,744,073,709,551,616)');
  assert.equal(r.hostBits, 64);
  assert.equal(r.type.label, 'Documentation');
  assert.equal(r.hostSet, true);
  assert.match(r.use, /SLAAC/);
});

test('builds the smallest and largest blocks', () => {
  const one = f('ip6Build')(f('ip6Parse')('2001:db8::5'), 128);
  assert.equal(one.size, '1');
  assert.equal(one.firstStr, one.lastStr);
  const p127 = f('ip6Build')(f('ip6Parse')('2001:db8::5'), 127);
  assert.equal(p127.netStr, '2001:db8::4');
  assert.equal(p127.lastStr, '2001:db8::5');
  assert.equal(p127.size, '2');
  const all = f('ip6Build')(0n, 0);
  assert.equal(all.lastStr, 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff');
  assert.equal(all.size, '2^128 (340,282,366,920,938,463,463,374,607,431,768,211,456)');
});

test('names the address type, only when the whole block fits the range', () => {
  const t = (s) => { const p = f('ip6ParseInput')(s); return f('ip6Build')(p.ip, p.prefix).type.label; };
  assert.equal(t('::/128'), 'Unspecified');
  assert.equal(t('::1/128'), 'Loopback');
  assert.equal(t('::ffff:192.0.2.1/128'), 'IPv4-mapped');
  assert.equal(t('64:ff9b::/96'), 'NAT64');
  assert.equal(t('2001:db8::/32'), 'Documentation');
  assert.equal(t('2002::/16'), '6to4');
  assert.equal(t('2001::/32'), 'Teredo');
  assert.equal(t('fd12:3456:789a::/48'), 'Unique Local (ULA)');
  assert.equal(t('fe80::1/64'), 'Link-Local');
  assert.equal(t('ff02::1/128'), 'Multicast');
  assert.equal(t('2606:4700::/32'), 'Global Unicast');
  assert.equal(t('2000::/3'), 'Global Unicast');
  // These blocks are larger than the special range that starts at the same address
  assert.equal(t('2001::/16'), 'Global Unicast');
  assert.equal(t('2001:db8::/31'), 'Global Unicast');
  assert.equal(t('::/0'), 'Other / reserved');
  assert.equal(t('4000::/3'), 'Other / reserved');
});

test('builds the reverse DNS zone only on a 4-bit boundary', () => {
  const rev = s => { const p = f('ip6ParseInput')(s); return f('ip6Build')(p.ip, p.prefix).reverse; };
  assert.equal(rev('2001:db8::/32'), '8.b.d.0.1.0.0.2.ip6.arpa');
  assert.equal(rev('2001:db8:abcd:12::/64'), '2.1.0.0.d.c.b.a.8.b.d.0.1.0.0.2.ip6.arpa');
  assert.equal(rev('::/0'), 'ip6.arpa');
  assert.equal(rev('2001:db8::/33'), null);
  assert.equal(rev('2001:db8::/48'), '0.0.0.0.8.b.d.0.1.0.0.2.ip6.arpa');
});

test('splits a block into subnets', () => {
  const p = f('ip6ParseInput')('2001:db8::/32');
  const r = f('ip6Build')(p.ip, p.prefix);
  const s = f('ip6Split')(r, 36, 8);
  assert.equal(s.count, 16n);
  assert.equal(s.rows.length, 8);
  assert.equal(s.rows[0].cidr, '2001:db8::/36');
  assert.equal(s.rows[1].cidr, '2001:db8:1000::/36');
  assert.equal(s.rows[0].last, '2001:db8:fff:ffff:ffff:ffff:ffff:ffff');
  const big = f('ip6Split')(r, 48, 8);
  assert.equal(big.count, 65536n);
  assert.equal(big.rows[7].cidr, '2001:db8:7::/48');
  const few = f('ip6Split')(f('ip6Build')(p.ip, 124), 128, 8);
  assert.equal(few.count, 16n);
  assert.equal(few.rows.length, 8);
});

test('offers splits 4, 8, 12 and 16 bits down, never past /128', () => {
  assert.deepEqual(Array.from(f('ip6SplitPrefixes')(32)), [36, 40, 44, 48]);
  assert.deepEqual(Array.from(f('ip6SplitPrefixes')(120)), [124, 128]);
  assert.deepEqual(Array.from(f('ip6SplitPrefixes')(124)), [128]);
  assert.deepEqual(Array.from(f('ip6SplitPrefixes')(128)), []);
});

test('lists supernets every 4 bits down to /8', () => {
  const p = f('ip6ParseInput')('2001:db8::/32');
  const sup = f('ip6Supernets')(f('ip6Build')(p.ip, p.prefix));
  assert.deepEqual(Array.from(sup, s => s.cidr), ['2001:db0::/28', '2001:d00::/24', '2001::/20', '2001::/16']);
  assert.equal(sup[0].holds, 16n);
  assert.equal(sup[0].slot, 9n);
  const none = f('ip6Supernets')(f('ip6Build')(0n, 8));
  assert.equal(none.length, 0);
  const low = f('ip6Supernets')(f('ip6Build')(hex('20000000000000000000000000000000'), 12));
  assert.deepEqual(Array.from(low, s => s.cidr), ['2000::/8']);
});

test('groups big numbers with commas', () => {
  assert.equal(f('ip6Group')(1234567n), '1,234,567');
  assert.equal(f('ip6Group')(999n), '999');
  assert.equal(f('ip6Size')(8), '256');
  assert.equal(f('ip6Size')(16), '65,536');
  assert.equal(f('ip6Size')(20), '2^20 (1,048,576)');
});
