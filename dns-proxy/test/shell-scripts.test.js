'use strict';

// Tests for the two container start-up scripts:
//   dns-proxy/docker-entrypoint.sh            drops from root to the "node" user
//   docker/nginx/40-netrecon-realip.sh        writes the trusted-proxy config for nginx
//
// They need a POSIX shell. On Windows the one that ships with Git is used. The
// real-IP script also needs an nginx binary (set NGINX_BIN, or have nginx on the
// PATH). Anything that is not available is skipped, not failed.

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const ENTRYPOINT = path.join(__dirname, '..', 'docker-entrypoint.sh');
const REALIP     = path.join(__dirname, '..', '..', 'docker', 'nginx', '40-netrecon-realip.sh');

// ── Find a shell ──────────────────────────────────────────────────
function findShell() {
  const candidates = process.platform === 'win32'
    ? ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe', 'sh']
    : ['sh'];
  return candidates.find(c => spawnSync(c, ['-c', 'true']).status === 0) || null;
}
const SHELL = findShell();
const fwd = p => p.replace(/\\/g, '/');                       // forward slashes work in both shells and nginx

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'netrecon-sh-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// nginx for Windows looks for its logs folder relative to the working directory, so run from the nginx folder
const NGINX_CWD = process.env.NGINX_BIN ? path.dirname(process.env.NGINX_BIN) : undefined;

function sh(script, args, env, cwd) {
  return spawnSync(SHELL, [fwd(script), ...(args || [])], {
    env: Object.assign({}, process.env, env || {}), encoding: 'utf8', cwd,
  });
}

// ── docker-entrypoint.sh ──────────────────────────────────────────
describe('dns-proxy docker-entrypoint.sh', { skip: !SHELL && 'no POSIX shell available' }, () => {
  const stubs = path.join(tmp, 'stubs');
  const log   = path.join(stubs, 'calls.log');

  // The script is run through a small wrapper that replaces id, mkdir and chown with shell
  // functions (they win over any real command), so the root path can run on any machine
  // without touching the real /data. su-exec is a stub program on the PATH.
  const wrapper = path.join(stubs, 'wrapper.sh');
  before(() => {
    fs.mkdirSync(stubs, { recursive: true });
    fs.writeFileSync(wrapper, [
      'id() { echo "${FAKE_UID:-0}"; }',
      'mkdir() { :; }',
      'chown() { echo "chown $*" >> "$CALL_LOG"; }',
      '. "' + fwd(ENTRYPOINT) + '"',
    ].join('\n') + '\n');
    fs.writeFileSync(path.join(stubs, 'su-exec'),
      '#!/bin/sh\necho "su-exec $*" >> "$CALL_LOG"\nshift\nif [ "$1" = test ]; then exit "${TEST_RESULT:-0}"; fi\nexec "$@"\n', { mode: 0o755 });
  });

  const run = env => {
    fs.writeFileSync(log, '');
    const withStubs = env && env.NO_SU_EXEC ? (process.env.PATH || '') : fwd(stubs) + path.delimiter + (process.env.PATH || '');
    const r = sh(wrapper, ['echo', 'started'], Object.assign({ PATH: withStubs, CALL_LOG: fwd(log) }, env));
    return { r, calls: fs.readFileSync(log, 'utf8') };
  };

  test('as root it fixes /data ownership and starts the app as the node user', () => {
    const { r, calls } = run({ FAKE_UID: '0', TEST_RESULT: '0' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /started/);
    assert.match(calls, /chown -R node:node \/data/);
    assert.match(calls, /su-exec node test -w \/data/);
    assert.match(calls, /su-exec node echo started/);
  });

  test('if /data cannot be made writable it still starts, as root, with a clear message', () => {
    const { r, calls } = run({ FAKE_UID: '0', TEST_RESULT: '1' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /started/);
    assert.ok(!/su-exec node echo started/.test(calls), 'must not drop privileges when that would lose the data');
    assert.match(r.stderr, /Running as root/);
  });

  test('when not root it just starts the app', () => {
    const { r, calls } = run({ FAKE_UID: '1000' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /started/);
    assert.equal(calls, '');
  });

  test('without su-exec it still starts the app', () => {
    const { r } = run({ FAKE_UID: '0', NO_SU_EXEC: '1' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /started/);
  });
});

// ── 40-netrecon-realip.sh ─────────────────────────────────────────
function nginxUsable() {
  if (!SHELL) return null;
  const bin = process.env.NGINX_BIN || 'nginx';
  const probe = path.join(tmp, 'probe.conf');
  fs.writeFileSync(probe, 'events {}\nhttp {}\n');
  const r = spawnSync(bin, ['-t', '-c', probe], { encoding: 'utf8', cwd: NGINX_CWD });
  return r.status === 0 ? bin : null;
}
const NGINX = nginxUsable();

describe('nginx 40-netrecon-realip.sh', { skip: !NGINX && 'needs a POSIX shell and a working nginx (set NGINX_BIN)' }, () => {
  let n = 0;
  function generate(env) {
    const out = path.join(tmp, `realip-${++n}.conf`);
    const r = sh(REALIP, [], Object.assign({ NGINX_BIN: NGINX, NETRECON_REALIP_CONF: fwd(out) }, env), NGINX_CWD);
    return { r, conf: fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '' };
  }
  const trusted = conf => [...conf.matchAll(/^set_real_ip_from (\S+);$/gm)].map(m => m[1]);

  test('by default it trusts private networks and reads X-Forwarded-For', () => {
    const { r, conf } = generate({});
    assert.equal(r.status, 0, r.stderr);
    for (const net of ['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10', 'fc00::/7']) {
      assert.ok(trusted(conf).includes(net), net);
    }
    assert.match(conf, /^real_ip_header X-Forwarded-For;$/m);
    assert.match(conf, /^real_ip_recursive on;$/m);
    assert.ok(!trusted(conf).includes('0.0.0.0/0'), 'the whole internet must never be trusted by default');
  });

  test('TRUSTED_PROXIES adds to the defaults (commas, spaces and IPv6)', () => {
    const { conf } = generate({ TRUSTED_PROXIES: '35.191.0.0/16,130.211.0.0/22 203.0.113.7 2001:db8::/32' });
    for (const net of ['35.191.0.0/16', '130.211.0.0/22', '203.0.113.7', '2001:db8::/32', '10.0.0.0/8']) {
      assert.ok(trusted(conf).includes(net), net);
    }
  });

  test('invalid entries are ignored and cannot inject configuration', () => {
    const { r, conf } = generate({ TRUSTED_PROXIES: '999.1.1.1,1.2.3.4/99,},198.51.100.0/24,1.1.1.1; deny all' });
    assert.equal(r.status, 0);
    assert.ok(trusted(conf).includes('198.51.100.0/24'));
    assert.ok(trusted(conf).includes('1.1.1.1'));
    assert.ok(!trusted(conf).includes('999.1.1.1'));
    assert.ok(!trusted(conf).includes('1.2.3.4/99'));
    assert.ok(!/deny|\}|server|listen/.test(conf.replace(/^#.*$/gm, '')), 'nothing but set_real_ip_from and the two real_ip directives');
    assert.match(r.stderr, /Ignoring TRUSTED_PROXIES entry "999\.1\.1\.1"/);
  });

  test('REAL_IP_HEADER can name another header, and nonsense falls back', () => {
    assert.match(generate({ REAL_IP_HEADER: 'CF-Connecting-IP' }).conf, /^real_ip_header CF-Connecting-IP;$/m);
    const bad = generate({ REAL_IP_HEADER: 'X-Fwd; } server {' });
    assert.match(bad.conf, /^real_ip_header X-Forwarded-For;$/m);
    assert.match(bad.r.stderr, /REAL_IP_HEADER must be a header name/);
  });

  test('the generated file is accepted by nginx', () => {
    const { conf } = generate({ TRUSTED_PROXIES: '203.0.113.0/24' });
    const file = path.join(tmp, 'final.conf'), wrapper = path.join(tmp, 'final-wrapper.conf');
    fs.writeFileSync(file, conf);
    fs.writeFileSync(wrapper, `events {}\nhttp {\n  include ${fwd(file)};\n}\n`);
    assert.equal(spawnSync(NGINX, ['-t', '-c', wrapper], { encoding: 'utf8', cwd: NGINX_CWD }).status, 0);
  });
});
