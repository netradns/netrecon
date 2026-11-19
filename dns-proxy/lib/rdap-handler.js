// ── NetRecon — Domain Registration Endpoint ──────────────────────
// GET /rdap?domain=example.com
//
// Public endpoint behind the lookup page's "Domain Registration" card.
// Always answers 200 with a result whose `status` says what happened
// (ok, notfound, unsupported, invalid, error). 400 only when no domain is given.
// Kept in its own file so the RDAP feature does not grow handlers.js.

'use strict';

const { lookupDomain } = require('./rdap');
const { jsonSafe }     = require('./handlers');

async function handleRdap(req, res, query) {
  const domain = String((query && query.domain) || '').trim();
  if (!domain) return jsonSafe(res, 400, { error: 'domain parameter required' });

  const result = await lookupDomain(domain);
  const daysLeft = result.expires ? Math.floor((result.expires - Date.now()) / 86400000) : null;
  return jsonSafe(res, 200, Object.assign({ daysLeft }, result));
}

module.exports = { handleRdap };
