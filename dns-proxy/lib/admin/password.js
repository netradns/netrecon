// ── NetRecon — Admin Password Management ─────────────────────────
// Hashing, verification and changing of the admin password.
//
// Design:
//   - The server checks the password. The browser sends it once at login
//     and never receives any password hash. (Earlier versions served the
//     hash to every visitor, so it was also the key to the admin API.)
//   - Passwords are stored as salted scrypt hashes (built into Node, no
//     dependencies). Plaintext is never written to disk or logs.
//   - Works over plain HTTP, so people who reach NetRecon by IP address
//     without a certificate can still log in. Use HTTPS when you can.
//
// Where the password can come from, checked in this order:
//   1. config.adminPassword      scrypt hash set by the setup wizard or the UI
//   2. config.statsPasswordHash  legacy unsalted SHA-256 from older versions.
//                                Upgraded to scrypt on the next successful login.
//   3. STATS_PASSWORD env var    initial password (default "admin")
//
// Anything in 1 or 2 takes precedence over the env var, so the password can
// be changed from the UI without editing docker-compose.yml.

'use strict';

const crypto = require('crypto');
const { promisify } = require('util');
const { getConfig, saveConfig } = require('./config-store');
const { STATS_PASSWORD } = require('../config');

const scrypt = promisify(crypto.scrypt);

// scrypt cost: N=16384, r=8, p=1 uses about 16 MB per hash
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN  = 32;

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 256;

// ── Hashing ───────────────────────────────────────────────────────

/**
 * Hash a password with a fresh random salt.
 * @param {string} plain
 * @returns {Promise<string>} "scrypt$N$r$p$salt$hash" (salt and hash base64)
 */
async function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(String(plain), salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return ['scrypt', SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString('base64'), hash.toString('base64')].join('$');
}

/**
 * Check a password against a stored scrypt string.
 * Parameters come from the stored string, so the cost can be raised later
 * without breaking existing hashes.
 *
 * @param {string} plain
 * @param {string} stored
 * @returns {Promise<boolean>}
 */
async function verifyScrypt(plain, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const N = parseInt(parts[1], 10), r = parseInt(parts[2], 10), p = parseInt(parts[3], 10);
  if (!(N > 1 && r > 0 && p > 0)) return false;

  const salt     = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  if (!salt.length || !expected.length) return false;

  const actual = await scrypt(String(plain), salt, expected.length, { N, r, p });
  return crypto.timingSafeEqual(actual, expected);
}

/** SHA-256 hex digest. Only used to read legacy hashes and to compare strings. */
function sha256Hex(str) {
  return crypto.createHash('sha256').update(String(str)).digest('hex');
}

/** Constant-time string comparison (digests are always the same length). */
function safeEqual(a, b) {
  return crypto.timingSafeEqual(
    crypto.createHash('sha256').update(String(a)).digest(),
    crypto.createHash('sha256').update(String(b)).digest()
  );
}

// ── Verification ──────────────────────────────────────────────────

/**
 * Check a submitted password against whichever source is active.
 * A correct password that matched a legacy SHA-256 hash is re-saved as scrypt.
 *
 * @param {string} plain
 * @returns {Promise<boolean>}
 */
async function verifyPassword(plain) {
  if (typeof plain !== 'string' || plain.length === 0 || plain.length > MAX_PASSWORD_LENGTH) return false;

  const cfg = getConfig();

  if (cfg.adminPassword) {
    return verifyScrypt(plain, cfg.adminPassword);
  }

  if (cfg.statsPasswordHash) {
    const ok = safeEqual(sha256Hex(plain), String(cfg.statsPasswordHash).toLowerCase());
    if (ok) {
      await setPassword(plain);          // upgrade to scrypt; the legacy hash is dropped
      console.log('[INFO] Admin password upgraded to a salted hash');
    }
    return ok;
  }

  return safeEqual(plain, STATS_PASSWORD);
}

/**
 * True while the password is still the built-in default ("admin") and has
 * never been changed. The admin UI uses this to show a reminder.
 */
function isUsingDefaultPassword() {
  const cfg = getConfig();
  return !cfg.adminPassword && !cfg.statsPasswordHash && STATS_PASSWORD === 'admin';
}

// ── Changing the password ─────────────────────────────────────────

/**
 * Returns an error message if the password is not acceptable, otherwise null.
 * @param {string} pw
 */
function validateNewPassword(pw) {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (pw.length > MAX_PASSWORD_LENGTH) return `Password must be at most ${MAX_PASSWORD_LENGTH} characters`;
  return null;
}

/**
 * Store a new password as a salted scrypt hash.
 * Clears the legacy hash so only one source remains.
 * @param {string} plain
 */
async function setPassword(plain) {
  saveConfig({ adminPassword: await hashPassword(plain), statsPasswordHash: null });
}

/**
 * Verify the current password and set a new one.
 *
 * @param {string} current
 * @param {string} next
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function changePassword(current, next) {
  if (!(await verifyPassword(current))) return { ok: false, error: 'Current password is incorrect' };

  if (next === current) return { ok: false, error: 'New password must be different from the current password' };

  const problem = validateNewPassword(next);
  if (problem) return { ok: false, error: problem };

  await setPassword(next);
  console.log('[INFO] Admin password changed via UI');
  return { ok: true };
}

module.exports = {
  MIN_PASSWORD_LENGTH,
  hashPassword,
  verifyPassword,
  isUsingDefaultPassword,
  validateNewPassword,
  setPassword,
  changePassword,
};
