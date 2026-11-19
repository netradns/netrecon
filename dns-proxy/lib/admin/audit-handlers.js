// ── NetRecon — Audit Trail Endpoint ──────────────────────────────
// GET /admin/audit?category=<signin|security|config|watch|data>&limit=<n>
//
// Returns the audit trail, newest first. Needs an admin session.
// Kept in its own file so the audit feature does not grow admin/handlers.js.

'use strict';

const { requireAuth } = require('./session');
const { getLog, CATEGORY } = require('./audit');
const { MAX_AUDIT_LOG } = require('../config');
const { jsonSafe } = require('../handlers');

const CATEGORIES = new Set(Object.values(CATEGORY));

/**
 * Returns { events: [...], total, kept } where `kept` is the most events the log holds.
 * An unknown category is treated as "all".
 */
function handleGetAudit(req, res) {
  if (!requireAuth(req, res)) return;

  const url      = new URL(req.url, 'http://localhost');
  const asked    = url.searchParams.get('category');
  const category = CATEGORIES.has(asked) ? asked : undefined;
  const limit    = url.searchParams.get('limit');

  const events = getLog({ category, limit });
  return jsonSafe(res, 200, { events, total: events.length, kept: MAX_AUDIT_LOG });
}

module.exports = { handleGetAudit };
