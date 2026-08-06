// ── NetRecon — Notification Channel: Generic Webhook ─────────────
// POSTs a structured JSON payload to any HTTP(S) endpoint.
// If a webhook secret is configured in admin settings, it's included
// as the X-Webhook-Secret header so receivers can verify authenticity.
//
// Payload format:
//   {
//     source:    "netrecon",
//     title:     string,
//     level:     "info" | "warning" | "success" | "danger",
//     fields:    [{ label, value }],
//     actions:   { viewUrl? } | null,
//     timestamp: ISO string
//   }

'use strict';

const https = require('https');
const http  = require('http');
const { timestamp } = require('../format');
const { getConfig } = require('../../admin/config-store');

/**
 * POSTs a JSON notification payload to the given webhook URL.
 * Includes X-Webhook-Secret header if configured.
 */
async function send(url, title, fields = [], level = 'info', actions) {
  if (!url) return;

  const payload = JSON.stringify({
    source:    'netrecon',
    title,
    level,
    fields,
    actions:   actions || null,
    timestamp: timestamp(),
  });

  // Include webhook secret if configured
  const cfg     = getConfig();
  const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) };
  if (cfg.webhookSecret) {
    headers['X-Webhook-Secret'] = cfg.webhookSecret;
  }

  await post(url, payload, headers);
}

// ── HTTP POST helper ──────────────────────────────────────────────
function post(url, payload, headers) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod    = parsed.protocol === 'https:' ? https : http;

    const req = mod.request({
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   'POST',
      headers:  headers || { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout:  8000,
    }, res => {
      // Non-2xx is treated as a delivery failure by the dispatcher
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        reject(new Error(`Webhook returned HTTP ${res.statusCode}`));
        return;
      }
      res.resume();
      resolve();
    });

    req.on('error',   reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Webhook timeout')); });
    req.write(payload);
    req.end();
  });
}

module.exports = { send };
