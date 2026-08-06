// ── NetRecon — Notification Channel: Slack ────────────────────────
// Sends Slack Block Kit messages via an Incoming Webhook URL.
//
// Message structure:
//   - Title as a bold section block
//   - Fields rendered as two-column mrkdwn section blocks
//   - Optional action buttons (view link for DNS change alerts)
//
// To add a new field type or layout, edit the blocks array below.
// The send() signature is the same across all channel files —
// a contributor can add a new channel by copying this file.

'use strict';

const https = require('https');
const http  = require('http');
const { hexColor } = require('../format');

/**
 * Sends a Slack Block Kit message to the given Incoming Webhook URL.
 *
 * @param {string} url     - Slack Incoming Webhook URL
 * @param {string} title   - Message title (bold)
 * @param {Array}  fields  - [{ label: string, value: string }]
 * @param {string} level   - info | warning | success | danger
 * @param {Object} [actions] - { viewUrl?: string } — optional action links
 */
async function send(url, title, fields = [], level = 'info', actions) {
  if (!url) return;

  // Build field blocks — Slack requires max 10 fields per section, 2 columns
  const fieldBlocks = fields.map(f => ({
    type: 'mrkdwn',
    text: `*${f.label}*\n${f.value}`,
  }));

  const blocks = [
    { type: 'section', text: { type: 'mrkdwn', text: `*${title}*` } },
  ];

  // Chunk fields into pairs for two-column layout
  for (let i = 0; i < fieldBlocks.length; i += 2) {
    blocks.push({ type: 'section', fields: fieldBlocks.slice(i, i + 2) });
  }

  // Add a divider before action buttons if present
  if (actions?.viewUrl) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'actions',
      elements: [{
        type:  'button',
        text:  { type: 'plain_text', text: 'Open NetRecon' },
        url:   actions.viewUrl,
      }],
    });
  }

  const payload = JSON.stringify({
    attachments: [{
      color:  hexColor(level),
      blocks,
    }],
  });

  await post(url, payload);
}

// ── HTTP POST helper ──────────────────────────────────────────────
// Uses Node's built-in http/https — no external dependencies.
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
      // Check for non-2xx — webhook rejected the message
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        reject(new Error(`Slack returned HTTP ${res.statusCode}`));
        return;
      }
      res.resume();
      resolve();
    });

    req.on('error',   reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Slack webhook timeout')); });
    req.write(payload);
    req.end();
  });
}

module.exports = { send };
