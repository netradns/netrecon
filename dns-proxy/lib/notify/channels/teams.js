// ── NetRecon — Notification Channel: Microsoft Teams ─────────────
// Sends Adaptive Card messages via a Teams Incoming Webhook URL.
//
// Uses the Workflows-based webhook (the modern replacement for the
// deprecated Office 365 Connector). Adaptive Cards v1.4.
//
// Note: Teams webhooks don't support interactive buttons via the
// Workflows connector — action links are included as OpenUrl actions
// which open in the browser when clicked.

'use strict';

const https = require('https');
const http  = require('http');
const { teamsColor, timestamp } = require('../format');

/**
 * Sends a Teams Adaptive Card message to the given Incoming Webhook URL.
 *
 * @param {string} url     - Teams Incoming Webhook URL
 * @param {string} title   - Card title
 * @param {Array}  fields  - [{ label: string, value: string }]
 * @param {string} level   - info | warning | success | danger
 * @param {Object} [actions] - { viewUrl?: string }
 */
async function send(url, title, fields = [], level = 'info', actions) {
  if (!url) return;

  // Build the card body — title, fact set, timestamp
  const body = [
    {
      type:   'TextBlock',
      text:   title,
      weight: 'Bolder',
      size:   'Medium',
      color:  teamsColor(level),
      wrap:   true,
    },
    // Render all fields as a FactSet (label: value pairs)
    {
      type:  'FactSet',
      facts: fields.map(f => ({ title: f.label, value: f.value })),
    },
    {
      type:     'TextBlock',
      text:     `NetRecon · ${timestamp()}`,
      size:     'Small',
      isSubtle: true,
    },
  ];

  // Action buttons — Teams supports OpenUrl actions in Adaptive Cards
  const cardActions = [];
  if (actions?.viewUrl) {
    cardActions.push({ type: 'Action.OpenUrl', title: 'Open NetRecon', url: actions.viewUrl });
  }

  const payload = JSON.stringify({
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      content: {
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        type:    'AdaptiveCard',
        version: '1.4',
        body,
        ...(cardActions.length ? { actions: cardActions } : {}),
      },
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
        reject(new Error(`Teams returned HTTP ${res.statusCode}`));
        return;
      }
      res.resume();
      resolve();
    });

    req.on('error',   reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Teams webhook timeout')); });
    req.write(payload);
    req.end();
  });
}

module.exports = { send };
