// ── NetRecon — Audit Trail Endpoint ──────────────────────────────
// GET /admin/audit?category=<signin|security|config|watch|data>&limit=<n>
//
// Returns the audit trail, newest first. Needs an admin session.
// Kept in its own file so the audit feature does not grow admin/handlers.js.

'use strict';

const { requireAuth } = require('./session');
const { MAX_AUDIT_LOG } = require('../config');
const { getActivity, summary24h, categories } = require('./activity');
const { jsonSafe } = require('../handlers');
const CATEGORIES = categories();
/**
 * Returns { events, total, kept, summary }.
 *   events   one page of the feed, newest first
 *   total    how many events match the filter (for paging)
 *   kept     the most events the audit log keeps
 *   summary  sign-ins, failed attempts and changes in the last 24 hours
 * Query: category (an unknown value means "all"), limit (1 to 500), offset (events to skip).
 */
function handleGetAudit(req, res) {
  if (!requireAuth(req, res)) return;
  const url      = new URL(req.url, 'http://localhost');
  const asked    = url.searchParams.get('category');
  const category = CATEGORIES.has(asked) ? asked : undefined;
  const { events, total } = getActivity({
    category,
    limit:  url.searchParams.get('limit'),
    offset: url.searchParams.get('offset'),
  });
  return jsonSafe(res, 200, { events, total, kept: MAX_AUDIT_LOG, summary: summary24h() });
}
module.exports = { handleGetAudit };