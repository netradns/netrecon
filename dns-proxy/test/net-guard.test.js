'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const { parseIPv4, parseIPv6, isPrivateAddress } = require('../lib/net-guard');

test('parseIPv4 accepts canonical addresses only', () => {
  assert.deepEqual(parseIPv4('1.2.3.4'), [1, 2, 3, 4]);
  assert.deepEqual(parseIPv4('0.0.0.0'), [0, 0, 0, 0]);
  assert.equal(parseIPv4('0177.0.0.1'), null);   // octal to the OS, 177 to a naive parser
  assert.equal(parseIPv4('01.2.3.4'), null);
  assert.equal(parseIPv4('256.1.1.1'), null);
  assert.equal(parseIPv4('1.2.3'), null);
  assert.equal(parseIPv4('1.2.3.4.5'), null);
  assert.equal(parseIPv4('2130706433'), null);   // decimal form of 127.0.0.1
  assert.equal(parseIPv4('a.b.c.d'), null);
  assert.equal(parseIPv4(null), null);
});

test('private and reserved IPv4 ranges are blocked', () => {
  for (const ip of ['0.0.0.0', '10.0.0.1', '10.255.255.255', '100.64.0.1', '100.127.255.255',
    '127.0.0.1', '127.1.2.3', '169.254.169.254', '172.16.0.1', '172.31.255.255',
    '192.0.0.1', '192.168.1.1', '198.18.0.1', '198.19.255.255', '224.0.0.1', '240.0.0.1', '255.255.255.255']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
});

test('public IPv4 addresses are allowed', () => {
  for (const ip of ['1.1.1.1', '8.8.8.8', '93.184.216.34', '172.15.255.255', '172.32.0.1',
    '100.63.255.255', '100.128.0.1', '192.0.2.1', '198.17.0.1', '198.20.0.1', '223.255.255.255']) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test('parseIPv6 expands compressed and embedded forms', () => {
  assert.deepEqual(parseIPv6('::1'), [0, 0, 0, 0, 0, 0, 0, 1]);
  assert.deepEqual(parseIPv6('2001:db8::1'), [0x2001, 0xdb8, 0, 0, 0, 0, 0, 1]);
  assert.deepEqual(parseIPv6('::ffff:10.0.0.1'), [0, 0, 0, 0, 0, 0xffff, 0x0a00, 0x0001]);
  assert.equal(parseIPv6('1:2:3:4:5:6:7:8:9'), null);
  assert.equal(parseIPv6('not-an-ip'), null);
});

test('private IPv6 ranges are blocked', () => {
  for (const ip of ['::', '::1', 'fe80::1', 'febf::1', 'fc00::1', 'fd12:3456::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:10.1.2.3', '::ffff:192.168.0.1', '64:ff9b::a00:1']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
});

test('public IPv6 addresses are allowed', () => {
  for (const ip of ['2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8', '64:ff9b::808:808']) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test('anything that is not a canonical IP is treated as unsafe', () => {
  for (const v of ['', 'localhost', '0177.0.0.1', '2130706433', '1.2.3', 'example.com', undefined]) {
    assert.equal(isPrivateAddress(v), true, String(v));
  }
});
