// ── NetRecon — Notification Formatters ───────────────────────────
// Shared color maps and helper utilities used by all channel senders.
//
// Why a separate file?
//   Each channel (Slack, Teams, Discord, etc.) needs to map a semantic
//   level ("warning", "danger") to a service-specific color value.
//   Centralising this means a contributor adding a new channel just
//   imports these helpers rather than duplicating the mapping.
//
// Adding a new level:
//   1. Add it to COLORS_HEX and COLORS_INT below
//   2. All existing channels pick it up automatically

'use strict';

// ── Hex colors (used by Slack attachment borders, email) ──────────
const COLORS_HEX = {
  info:    '#2563eb', // blue
  warning: '#d97706', // amber
  success: '#059669', // green
  danger:  '#dc2626', // red
};

// ── Integer colors (used by Discord embeds) ───────────────────────
// Discord requires colors as 24-bit integers, not hex strings.
const COLORS_INT = {
  info:    0x2563eb,
  warning: 0xd97706,
  success: 0x059669,
  danger:  0xdc2626,
};

// ── Teams color names (Adaptive Card color property) ─────────────
const COLORS_TEAMS = {
  info:    'Accent',
  warning: 'Warning',
  success: 'Good',
  danger:  'Attention',
};

/**
 * Returns the hex color for a given level, defaulting to info.
 * @param {string} level - info | warning | success | danger
 * @returns {string} hex color string
 */
function hexColor(level) {
  return COLORS_HEX[level] || COLORS_HEX.info;
}

/**
 * Returns the integer color for a given level (Discord).
 * @param {string} level
 * @returns {number}
 */
function intColor(level) {
  return COLORS_INT[level] || COLORS_INT.info;
}

/**
 * Returns the Teams Adaptive Card color name for a given level.
 * @param {string} level
 * @returns {string}
 */
function teamsColor(level) {
  return COLORS_TEAMS[level] || COLORS_TEAMS.info;
}

/**
 * Returns a standard ISO timestamp string for use in notification footers.
 * @returns {string}
 */
function timestamp() {
  return new Date().toISOString();
}

module.exports = { hexColor, intColor, teamsColor, timestamp };
