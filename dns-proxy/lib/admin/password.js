// ── NetRecon — Admin Password Management ─────────────────────────
// Handles password hashing and verification for the admin login gate.
//
// Design:
//   - Passwords are stored as SHA-256 hashes only. Plaintext never
//     persists anywhere — not in logs, not in config files.
//   - The initial password comes from the STATS_PASSWORD env var
//     (hashed at startup in this file as ENV_PASSWORD_HASH).
//   - Once changed via the UI, the new hash is written to config.json
//     and takes precedence over the env var hash on every login check.
//   - This means you can change the password without restarting the
//     container or editing docker-compose.yml.
//
// Why SHA-256 and not bcrypt?
//   This is an internal self-hosted tool, not a public-facing auth system.
//   SHA-256 is fast, has no dependencies, and is sufficient for this
//   threat model. The hash is never transmitted — comparison happens
//   client-side (browser Web Crypto) against the hash served by /app-config.

'use strict';

const crypto = require('crypto');
const { getConfig, saveConfig } = require('./config-store');
const { STATS_PASSWORD } = require('../config');

// ── Hash helper ───────────────────────────────────────────────────
/**
 * Returns the SHA-256 hex digest of a string.
 * Used for both hashing new passwords and verifying submitted ones.
 *
 * @param {string} plaintext
 * @returns {string} 64-character hex string
 */
function hashPassword(plaintext) {
  return crypto.createHash('sha256').update(String(plaintext)).digest('hex');
}

// ── Env var hash (computed once at startup) ───────────────────────
// Pre-computed so we don't re-hash on every login attempt.
const ENV_PASSWORD_HASH = hashPassword(STATS_PASSWORD);

// ── Get the active password hash ─────────────────────────────────
/**
 * Returns the currently active password hash.
 * Prefers the hash stored in config.json (set via UI) over the
 * env var hash (set via docker-compose.yml).
 *
 * This allows password changes to take effect immediately without
 * a container restart.
 *
 * @returns {string} SHA-256 hex hash of the current password
 */
function getActiveHash() {
  const cfg = getConfig();
  // If a hash has been set via the UI, use it; otherwise fall back to env var
  return cfg.statsPasswordHash || ENV_PASSWORD_HASH;
}

// ── Change password ───────────────────────────────────────────────
/**
 * Validates the current password and sets a new one.
 * Returns { ok: true } on success or { ok: false, error: string } on failure.
 *
 * @param {string} currentHash - SHA-256 hash of the current password
 *                               (submitted by the browser, never plaintext)
 * @param {string} newHash     - SHA-256 hash of the new password
 * @returns {{ ok: boolean, error?: string }}
 */
function changePassword(currentHash, newHash) {
  // Validate inputs — both must be 64-char hex strings
  const hexRe = /^[0-9a-f]{64}$/i;
  if (!hexRe.test(currentHash)) return { ok: false, error: 'Invalid current password format' };
  if (!hexRe.test(newHash))     return { ok: false, error: 'Invalid new password format' };

  // Verify the current password matches
  if (currentHash !== getActiveHash()) {
    return { ok: false, error: 'Current password is incorrect' };
  }

  // Prevent setting the same password again
  if (newHash === getActiveHash()) {
    return { ok: false, error: 'New password must be different from the current password' };
  }

  // Persist the new hash — this takes effect immediately for all future logins
  saveConfig({ statsPasswordHash: newHash });
  console.log('[INFO] Admin password changed via UI');

  return { ok: true };
}

module.exports = { hashPassword, getActiveHash, changePassword, ENV_PASSWORD_HASH };
