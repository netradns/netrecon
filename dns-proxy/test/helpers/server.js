'use strict';

// Starts the real dns-proxy (server.js) on a free port with its own empty data
// directory, so tests exercise the actual routes. Requests are made with fetch.

const { spawn } = require('child_process');
const fs   = require('fs');
const os   = require('os');
const net  = require('net');
const path = require('path');
const crypto = require('crypto');

/** Ask the OS for a free TCP port. */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/**
 * @param {Object}  [opts]
 * @param {Object}  [opts.config] - Written to config.json before start (e.g. a legacy password hash)
 * @param {Object}  [opts.env]    - Extra environment variables
 * @param {string}  [opts.dataDir] - Use this existing data directory instead of a fresh one
 * @returns {Promise<{ url, dir, request, stop }>}
 */
async function startServer(opts) {
  const o    = opts || {};
  const dir  = o.dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'netrecon-srv-'));
  const port = await freePort();
  if (o.config) fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(o.config));

  const env = Object.assign({}, process.env, { PORT: String(port), STATS_DIR: dir, DNS_SERVERS: '' }, o.env);
  delete env.STATS_PASSWORD;
  if (o.env && o.env.STATS_PASSWORD) env.STATS_PASSWORD = o.env.STATS_PASSWORD;

  const child = spawn(process.execPath, [path.join(__dirname, '..', '..', 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });

  const url = `http://127.0.0.1:${port}`;

  // Wait until /health answers
  const deadline = Date.now() + 10000;
  for (;;) {
    try { if ((await fetch(url + '/health')).ok) break; } catch { /* not up yet */ }
    if (Date.now() > deadline) { child.kill(); throw new Error('server did not start:\n' + log); }
    await new Promise(r => setTimeout(r, 100));
  }

  /** fetch wrapper: returns { status, body, headers } with the body parsed as JSON when possible. */
  async function request(method, route, { body, headers, token } = {}) {
    const h = Object.assign({}, headers || {});
    if (token) h['Authorization'] = 'Bearer ' + token;
    if (body !== undefined) h['Content-Type'] = 'application/json';
    const res  = await fetch(url + route, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let parsed = text;
    try { parsed = JSON.parse(text); } catch { /* keep text */ }
    return { status: res.status, body: parsed, headers: res.headers, text };
  }

  /** Stop the server. The data directory is deleted unless the caller supplied it or asks to keep it. */
  async function stop(opts) {
    child.kill();
    await new Promise(r => child.once('exit', r));
    if (!o.dataDir && !(opts && opts.keepData)) fs.rmSync(dir, { recursive: true, force: true });
  }

  return { url, dir, request, stop, log: () => log };
}

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');

module.exports = { startServer, sha256 };
