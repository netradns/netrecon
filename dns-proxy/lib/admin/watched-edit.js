// ── NetRecon Admin — Edit a watched entry ────────────────────────
// PATCH /admin/watched/:id
//
// Changes what an existing entry watches without deleting it, so its ID,
// change history and settings stay. The domain name and the source cannot be
// changed: that would be a different watch, so remove it and add it again.
//
// Body (every field optional, anything left out stays as it is):
//   recordTypes: string[]            DNS record types to watch. [] stops watching DNS records.
//   interval:    number              Minutes between checks.
//   cert:        { enabled, port, warnDays } | null    Turn the TLS certificate watch on, change it, or off.
//   expiry:      { enabled, warnDays }       | null    Same for the domain registration watch.
//
// Allowed combinations are decided by watched-rules.js, the same code that
// checks a new watch, so adding and editing follow the same rules.
'use strict';
const session = require('./session');
const audit   = require('./audit');
const { resolveSettings, findClash, VALID_INTERVALS } = require('./watched-rules');
const { getWatched, saveWatched }    = require('../watcher/snapshot');
const watcher = require('../watcher');
const { jsonSafe } = require('../handlers');

const sameList = (a, b) => [...(a || [])].sort().join(',') === [...(b || [])].sort().join(',');

/**
 * Works out what an edit changes. Returns a list of plain-language names, used for
 * the audit log and the response, and flags telling the handler what state to reset.
 */
function describeChanges(entry, s) {
  const names = [];
  const dns   = !sameList(entry.recordTypes, s.recordTypes);
  if (dns) names.push('record types');
  if (entry.interval !== s.interval) names.push('check interval');

  const hadCert = !!entry.cert, hasCert = !!s.cert;
  const certPort = hadCert && hasCert && entry.cert.port !== s.cert.port;
  if (!hadCert && hasCert) names.push('certificate on');
  else if (hadCert && !hasCert) names.push('certificate off');
  else if (certPort) names.push('certificate port');
  else if (hadCert && hasCert && !sameList(entry.cert.warnDays, s.cert.warnDays)) names.push('certificate warning days');

  const hadExp = !!entry.expiry, hasExp = !!s.expiry;
  if (!hadExp && hasExp) names.push('registration on');
  else if (hadExp && !hasExp) names.push('registration off');
  else if (hadExp && hasExp && !sameList(entry.expiry.warnDays, s.expiry.warnDays)) names.push('registration warning days');

  // Anything other than a new interval or new warning days needs a fresh look at the host
  const needsCheck = dns || !hadCert !== !hasCert || certPort || !hadExp !== !hasExp;
  return { names, dns, certPort, needsCheck };
}

async function handleEditWatched(req, res, id, readBody) {
  if (!session.requireAuth(req, res)) return;

  let body;
  try { body = JSON.parse(await readBody(req)); }
  catch { return jsonSafe(res, 400, { error: 'Invalid JSON body' }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return jsonSafe(res, 400, { error: 'Invalid JSON body' });
  }
  if ('recordTypes' in body && !Array.isArray(body.recordTypes)) {
    return jsonSafe(res, 400, { error: 'recordTypes must be a list' });
  }

  // Adding falls back to 60 minutes for an odd value. An edit says so instead of changing it silently.
  if ('interval' in body && !VALID_INTERVALS.has(Number(body.interval))) {
    return jsonSafe(res, 400, { error: 'Invalid interval. Choose 5, 15, 60, 360 or 1440 minutes.' });
  }

  const watched = getWatched();
  const entry   = watched.domains.find(d => d.id === id);
  if (!entry) return jsonSafe(res, 404, { error: 'Watched domain not found' });

  const has = k => Object.prototype.hasOwnProperty.call(body, k);
  const settings = resolveSettings(entry.domain, entry.source, {
    recordTypes: has('recordTypes') ? body.recordTypes : entry.recordTypes,
    cert:        has('cert')        ? body.cert        : entry.cert,
    expiry:      has('expiry')      ? body.expiry      : entry.expiry,
    interval:    has('interval')    ? body.interval    : entry.interval,
  });
  if (!settings.ok) return jsonSafe(res, settings.status, { error: settings.error });
  if (findClash(watched.domains, entry.domain, entry.source, settings, entry.id)) {
    return jsonSafe(res, 409, { error: `Another watch for ${entry.domain} (${entry.source}) already covers that` });
  }

  const change = describeChanges(entry, settings);
  if (!change.names.length) return jsonSafe(res, 200, { ok: true, entry, changed: [] });

  // ── Apply ──
  const hadCert = !!entry.cert, hadExp = !!entry.expiry;
  entry.interval    = settings.interval;
  entry.recordTypes = settings.recordTypes;
  entry.cert        = settings.cert;
  entry.expiry      = settings.expiry;
  watched.certs     = watched.certs || {};
  watched.expiries  = watched.expiries || {};

  // A different set of record types starts from a fresh baseline, so records that are no
  // longer watched are not reported as removed.
  if (change.dns) delete watched.snapshots[id];

  // A new certificate or registration watch, or a new port, has no earlier result to compare with
  if (!settings.cert) { entry.certStatus = null; delete watched.certs[id]; }
  else if (!hadCert || change.certPort) { entry.certStatus = 'pending'; delete watched.certs[id]; }
  if (!settings.expiry) { entry.expiryStatus = null; delete watched.expiries[id]; }
  else if (!hadExp) { entry.expiryStatus = 'pending'; delete watched.expiries[id]; }

  // Until the check below finishes, show an entry whose checks changed as pending
  // Also mark it due, so the scheduler picks it up within a minute if the check below is skipped
  if (change.needsCheck) entry.lastChecked = null;
  if (change.needsCheck && (change.dns || !settings.recordTypes.length)) entry.status = 'pending';

  saveWatched(watched);
  audit.record('watched_edited', {
    ip: session.clientIp(req),
    detail: `${entry.domain} (${entry.source}): ${change.names.join(', ')}`,
  });

  if (change.needsCheck) {
    watcher.checkNow(entry).catch(err => console.error(`[watcher] Check after edit failed for ${entry.domain}: ${err.message}`));
  }
  return jsonSafe(res, 200, { ok: true, entry, changed: change.names });
}

module.exports = { handleEditWatched };
