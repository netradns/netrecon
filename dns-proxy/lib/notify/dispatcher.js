// ── NetRecon — Notification Dispatcher ───────────────────────────
// Routes notification events to all configured channels.
// This file contains no formatting logic — it only orchestrates.
//
// How it works:
//   1. Reads the active channel list from config-store
//   2. For each channel, calls the appropriate sender module
//   3. Logs every attempt (success or failure) to notify/log.js
//   4. Uses Promise.allSettled so one failing channel never blocks others
//
// Adding a new channel type:
//   1. Create lib/notify/channels/<name>.js exporting send()
//   2. Import it here and add a case to the switch statement
//   3. That's it — no other files need to change

'use strict';

const { getConfig }  = require('../admin/config-store');
const { appendLog }  = require('./log');

// Channel senders — one file per service
const slack   = require('./channels/slack');
const teams   = require('./channels/teams');
const discord = require('./channels/discord');
const webhook = require('./channels/webhook');
const email   = require('./channels/email');

/**
 * Dispatches a notification to every configured channel in parallel.
 * Logs each attempt regardless of success or failure.
 *
 * @param {Object}   opts
 * @param {string}   opts.title             - Notification title
 * @param {Array}    opts.fields            - [{ label, value }] detail fields
 * @param {string}   [opts.level]           - info | warning | success | danger
 * @param {Object}   [opts.actions]         - { viewUrl? } action links
 * @param {Array}    [opts._channelOverride] - Use these channels instead of config
 *                                            (used by the test notification handler)
 * @param {string}   [opts._event]          - Event name for the delivery log
 */
async function dispatch({ title, fields = [], level = 'info', actions, _channelOverride, _event }) {
  const cfg      = getConfig();
  const channels = _channelOverride || (Array.isArray(cfg.notifyChannels) ? cfg.notifyChannels : []);
  const event    = _event || 'dispatch';

  if (!channels.length) return; // nothing to do

  // Fire all channels in parallel — one failure doesn't block others
  await Promise.allSettled(
    channels.map(ch => sendToChannel(ch, title, fields, level, actions, event))
  );
}

// ── Single channel delivery ───────────────────────────────────────
/**
 * Sends a notification to a single channel and logs the result.
 * Errors are caught here — they never propagate to the caller.
 *
 * @param {Object} ch    - Channel config { id, service, url, name }
 * @param {string} title
 * @param {Array}  fields
 * @param {string} level
 * @param {Object} actions
 * @param {string} event
 */
async function sendToChannel(ch, title, fields, level, actions, event) {
  if (!ch.url) return;

  const start = Date.now();

  try {
    switch (ch.service) {
      case 'slack':   await slack.send(ch.url,   title, fields, level, actions); break;
      case 'teams':   await teams.send(ch.url,   title, fields, level, actions); break;
      case 'discord': await discord.send(ch.url, title, fields, level, actions); break;
      case 'webhook': await webhook.send(ch.url, title, fields, level, actions); break;
      case 'email':   await email.send(ch.url,   title, fields, level);          break;
      default:
        console.warn(`[notify] Unknown channel service: ${ch.service}`);
        return;
    }

    appendLog(ch.id || ch.service, ch.service, event, true, null, Date.now() - start);
    console.log(`[notify] Sent via ${ch.service}${ch.name ? ` (${ch.name})` : ''}: ${title}`);

  } catch (err) {
    appendLog(ch.id || ch.service, ch.service, event, false, err.message, Date.now() - start);
    console.error(`[notify] ${ch.service} delivery failed: ${err.message}`);
  }
}

module.exports = { dispatch };
