// ── NetRecon — Notification Channel: Discord ─────────────────────
// Sends rich embed messages via a Discord Incoming Webhook URL.
//
// Discord webhooks don't support interactive button components —
// action links are included as plain markdown links in the description.

'use strict';

const https = require('https');
const http  = require('http');
const { intColor, timestamp } = require('../format');

/**
 * Sends a Discord embed message to the given Webhook URL.
 *
 * @param {string} url     - Discord Webhook URL
 * @param {string} title   - Embed title
 * @param {Array}  fields  - [{ label: string, value: string }]
 * @param {string} level   - info | warning | success | danger
 * @param {Object} [actions] - { viewUrl?: string }
 */
async function send(url, title, fields = [], level = 'info', actions) {
  if (!url) return;

  // Build description from fields as bold label: value pairs
  let description = fields.map(f => `**${f.label}:** ${f.value}`).join('\n');

  // Append action links as markdown since Discord webhooks don't support buttons
  if (actions?.viewUrl) {
    description += `\n\n[Open NetRecon](${actions.viewUrl})`;
  }

  const payload = JSON.stringify({
    embeds: [{
      title,
      description,
      color:  intColor(level),
      footer: { text: `NetRecon · ${timestamp()}` },
    }],
  });

  await post(url, payload);
}

// ── HTTP POST helper ──────────────────────────────────────────────
function post(url, payload) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod    = parsed.protocol === 'https:' ? https : http;

    const req = mod.request({
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout:  8000,
    }, res => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        reject(new Error(`Discord returned HTTP ${res.statusCode}`));
        return;
      }
      res.resume();
      resolve();
    });

    req.on('error',   reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Discord webhook timeout')); });
    req.write(payload);
    req.end();
  });
}

module.exports = { send };
