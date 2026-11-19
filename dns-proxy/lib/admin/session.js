// ── NetRecon — Admin Sessions and Login Throttling ───────────────
// After a correct password the server issues a random session token.
// The browser sends it as "Authorization: Bearer <token>" on admin requests.
//
// Why a header token and not a cookie: it works the same over HTTP and
// HTTPS and from an IP address, and it cannot be sent by another website,
// so there is no cross-site request forgery to defend against.
//
// Sessions live in memory. Restarting the container logs everyone out,
// which is acceptable for an admin panel. Only a SHA-256 of each token is
// kept, so a memory dump does not reveal usable tokens.
//
// Login throttling is per client IP, on top of the nginx rate limit:
// 5 wrong passwords in 15 minutes locks that IP out for 15 minutes.

'use strict';

const crypto = require('crypto');
const net    = require('net');

const SESSION_IDLE_MS = 2 * 60 * 60 * 1000;    // logged out after 2 hours of no use
const SESSION_MAX_MS  = 12 * 60 * 60 * 1000;   // and always after 12 hours
const MAX_SESSIONS    = 50;

const MAX_FAILURES    = 5;
const FAILURE_WINDOW  = 15 * 60 * 1000;
const LOCKOUT_MS      = 15 * 60 * 1000;
const MAX_TRACKED_IPS = 10000;

// tokenHash -> { created, lastSeen }
const sessions = new Map();
// ip -> { count, first, lockedUntil }
const failures = new Map();

const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');

// ── Sessions ──────────────────────────────────────────────────────

/** Remove sessions that are past either limit. */
function sweepSessions(now) {
  for (const [key, s] of sessions) {
    if (now - s.created > SESSION_MAX_MS || now - s.lastSeen > SESSION_IDLE_MS) sessions.delete(key);
  }
}

/**
 * Start a new session.
 * @returns {string} The token to give the browser (not stored anywhere in plain form)
 */
function createSession(now = Date.now()) {
  sweepSessions(now);

  // Keep memory bounded: drop the oldest session when full
  if (sessions.size >= MAX_SESSIONS) {
    const oldest = [...sessions.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen)[0];
    if (oldest) sessions.delete(oldest[0]);
  }

  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(hashToken(token), { created: now, lastSeen: now });
  return token;
}

/**
 * True if the token belongs to a live session. A valid check counts as
 * activity and resets the idle timer.
 */
function validateSession(token, now = Date.now()) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return false;

  const key = hashToken(token);
  const s   = sessions.get(key);
  if (!s) return false;

  if (now - s.created > SESSION_MAX_MS || now - s.lastSeen > SESSION_IDLE_MS) {
    sessions.delete(key);
    return false;
  }
  s.lastSeen = now;
  return true;
}

function revokeSession(token) {
  if (typeof token === 'string') sessions.delete(hashToken(token));
}

/** End every session except the one making the request (used after a password change). */
function revokeOtherSessions(keepToken) {
  const keep = typeof keepToken === 'string' ? hashToken(keepToken) : null;
  for (const key of [...sessions.keys()]) {
    if (key !== keep) sessions.delete(key);
  }
}

/** Read the bearer token from a request, or null. */
function getToken(req) {
  const m = /^Bearer\s+(\S+)$/i.exec(String(req.headers['authorization'] || '').trim());
  return m ? m[1] : null;
}

/**
 * Route guard. Returns true when the request carries a live session token.
 * Otherwise sends 401 and returns false, so callers write:
 *   if (!requireAuth(req, res)) return;
 */
function requireAuth(req, res) {
  if (validateSession(getToken(req))) return true;

  if (!res.headersSent) {
    const body = JSON.stringify({ error: 'Unauthorized' });
    res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(body);
  }
  return false;
}

// ── Login throttling ──────────────────────────────────────────────

/**
 * The caller's IP. nginx sets X-Real-IP and the proxy is not reachable from
 * outside the Docker network, so the header can be trusted. Falls back to
 * the socket address when the header is missing or not an IP.
 */
function clientIp(req) {
  const header = String(req.headers['x-real-ip'] || '').trim();
  return net.isIP(header) ? header : (req.socket && req.socket.remoteAddress) || 'unknown';
}

/**
 * Is this IP allowed to try a password right now?
 * @returns {{ allowed: boolean, retryAfterSec?: number }}
 */
function checkLogin(ip, now = Date.now()) {
  const f = failures.get(ip);
  if (f && f.lockedUntil > now) {
    return { allowed: false, retryAfterSec: Math.ceil((f.lockedUntil - now) / 1000) };
  }
  return { allowed: true };
}

/** Count a failed attempt, and lock the IP out after too many. */
function recordFailure(ip, now = Date.now()) {
  if (failures.size >= MAX_TRACKED_IPS) {
    for (const [key, f] of failures) {
      if (now - f.first > FAILURE_WINDOW && f.lockedUntil <= now) failures.delete(key);
    }
    if (failures.size >= MAX_TRACKED_IPS) failures.clear();
  }

  let f = failures.get(ip);
  if (!f || now - f.first > FAILURE_WINDOW) {
    f = { count: 0, first: now, lockedUntil: 0 };
    failures.set(ip, f);
  }
  f.count++;
  if (f.count >= MAX_FAILURES) f.lockedUntil = now + LOCKOUT_MS;
}

function recordSuccess(ip) {
  failures.delete(ip);
}

/** Test helper: forget all sessions and throttling state. */
function _reset() {
  sessions.clear();
  failures.clear();
}

module.exports = {
  SESSION_IDLE_MS, SESSION_MAX_MS, MAX_SESSIONS, MAX_FAILURES, LOCKOUT_MS,
  createSession, validateSession, revokeSession, revokeOtherSessions,
  getToken, requireAuth, clientIp,
  checkLogin, recordFailure, recordSuccess, _reset,
};
