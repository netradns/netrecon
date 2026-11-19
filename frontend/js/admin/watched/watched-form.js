// ── NetRecon Admin — Add Watched Domain Form ─────────────────────
// Handles the "Watch" form in the Watched Domains page.
// Validates input and calls POST /api/admin/watched.
//
// An entry can watch DNS records, a TLS certificate, a domain registration,
// or any mix of them:
//   - Domain, DNS records only            example.com + A, MX, TXT
//   - Domain, certificate only            example.com + no records + certificate on
//   - Domain, registration only           example.com + no records + registration on
//   - IP address (certificate only)       10.0.0.5 + certificate on
// Nothing here requires a domain or a public certificate. Internal servers,
// IP addresses and self-signed certificates all work (choose Internal DNS).
// Registration expiry is the one exception: it only exists for public domains.

'use strict';

// Warning presets for certificate expiry (days before the certificate ends)
const CERT_WARN_PRESETS = [
  { value: '30,14,7',   label: 'Standard: 30, 14 and 7 days before' },
  { value: '14,7,3',    label: 'Auto-renewing (e.g. Let\'s Encrypt): 14, 7 and 3 days' },
  { value: '60,30,14,7', label: 'Early warning: 60, 30, 14 and 7 days' },
];

// Warning presets for domain registration expiry
const EXPIRY_WARN_PRESETS = [
  { value: '60,30,14,7',    label: 'Standard: 60, 30, 14 and 7 days before' },
  { value: '90,60,30,14,7', label: 'Early warning: 90, 60, 30, 14 and 7 days' },
  { value: '30,14,7',       label: 'Short: 30, 14 and 7 days' },
];

// Record types ticked by default
const DEFAULT_WATCH_TYPES = ['A', 'MX', 'TXT', 'NS'];

// ── Render the add form ───────────────────────────────────────────
/**
 * Returns the HTML for the Watch form panel.
 * Rendered once by watched.js into the page shell.
 * @returns {string} HTML string
 */
function renderWatchedForm() {
  return `
    <div class="panel" style="margin-bottom:20px" id="addWatchedPanel">
      <div style="font-size:14px;font-weight:600;margin-bottom:4px">Watch a Domain, Certificate or Registration</div>
      <div style="font-size:12px;color:var(--text-3);margin-bottom:14px">
        NetRecon checks on the interval you choose and alerts you when DNS records change, a TLS certificate is about to expire,
        or a domain registration is running out. Each is optional, so use whichever you need.
        Servers without a public domain work too: enter an IP address and turn on certificate monitoring.
      </div>
      <div class="field-row">
        <div class="field-group">
          <label class="field-label">Domain or IP address</label>
          <input class="f-input mono" id="watchDomain" placeholder="example.com or 10.0.0.5" autocomplete="off" spellcheck="false" oninput="refreshWatchAvailability()">
        </div>
        <div class="field-group">
          <label class="field-label">Source</label>
          <select class="f-input f-select" id="watchSource" onchange="refreshWatchAvailability()">
            <option value="public">Public DNS</option>
            <option value="internal">Internal DNS (your own servers)</option>
          </select>
        </div>
        <div class="field-group">
          <label class="field-label">Check Interval</label>
          <select class="f-input f-select" id="watchInterval">
            <option value="5">Every 5 minutes</option>
            <option value="15">Every 15 minutes</option>
            <option value="60" selected>Every hour</option>
            <option value="360">Every 6 hours</option>
            <option value="1440">Every 24 hours</option>
          </select>
        </div>
      </div>

      <!-- Record type checkboxes -->
      <div style="margin-bottom:14px">
        <label class="field-label">DNS record types to watch <span style="font-weight:400;color:var(--text-3)">(leave all unticked to watch only the certificate or registration)</span></label>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px" id="watchRecordTypes">
          ${['A','AAAA','MX','TXT','NS','CNAME','SOA','CAA'].map(t => `
            <label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer">
              <input type="checkbox" value="${t}" ${DEFAULT_WATCH_TYPES.includes(t) ? 'checked' : ''} class="watch-type-cb">
              <span class="mono">${t}</span>
            </label>`).join('')}
          <label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer">
            <input type="checkbox" value="ALL" class="watch-type-cb" onchange="onWatchAllToggle(this)">
            <span style="font-weight:600">ALL</span>
          </label>
        </div>
      </div>

      <!-- TLS certificate monitoring -->
      <div style="margin-bottom:14px;padding:12px;border:1px solid var(--border);border-radius:6px;background:var(--bg)">
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;cursor:pointer">
          <input type="checkbox" id="watchCertOn" onchange="onWatchCertToggle(this)">
          Also monitor the TLS certificate
        </label>
        <div style="font-size:12px;color:var(--text-3);margin:4px 0 0 22px">
          Alerts when the certificate is close to expiring, has expired, or has been replaced.
          Works with self-signed and internal certificates. For servers on your own network, set Source to Internal DNS.
        </div>
        <div id="watchCertOptions" style="display:none;margin:12px 0 0 22px">
          <div class="field-row" style="margin-bottom:0">
            <div class="field-group" style="max-width:130px">
              <label class="field-label">Port</label>
              <input class="f-input mono" id="watchCertPort" value="443" inputmode="numeric" autocomplete="off">
            </div>
            <div class="field-group">
              <label class="field-label">Warn me</label>
              <select class="f-input f-select" id="watchCertWarn">
                ${CERT_WARN_PRESETS.map(p => `<option value="${p.value}">${p.label}</option>`).join('')}
              </select>
            </div>
          </div>
          <div style="font-size:11px;color:var(--text-3);margin-top:6px">
            Common ports: 443 (HTTPS), 636 (LDAPS), 8443 (alternate HTTPS), 993 and 995 (mail), 3389 (Remote Desktop).
          </div>
        </div>
      </div>

      <!-- Domain registration monitoring -->
      <div style="margin-bottom:14px;padding:12px;border:1px solid var(--border);border-radius:6px;background:var(--bg)" id="watchExpiryBox">
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;cursor:pointer" id="watchExpiryLabel">
          <input type="checkbox" id="watchExpiryOn" onchange="onWatchExpiryToggle(this)">
          Also monitor the domain registration
        </label>
        <div style="font-size:12px;color:var(--text-3);margin:4px 0 0 22px">
          Alerts before the domain registration expires, and if it is put on hold or lapses and is registered again.
          Uses RDAP, which most major extensions support (.com, .net, .org, .uk, .ca, .fr, .app, .dev and many more)
          but not all (for example .io, .de and .us). Public domains only.
        </div>
        <div id="watchExpiryNote" style="display:none;font-size:12px;color:var(--yellow);margin:6px 0 0 22px"></div>
        <div id="watchExpiryOptions" style="display:none;margin:12px 0 0 22px">
          <div class="field-group" style="max-width:420px">
            <label class="field-label">Warn me</label>
            <select class="f-input f-select" id="watchExpiryWarn">
              ${EXPIRY_WARN_PRESETS.map(p => `<option value="${p.value}">${p.label}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>

      <button class="btn btn-primary btn-sm" onclick="submitAddWatched()">Add</button>
    </div>`;
}

// ── Form toggles ──────────────────────────────────────────────────

/**
 * When "ALL" is checked, uncheck and disable individual type checkboxes.
 * When "ALL" is unchecked, re-enable them and restore the defaults.
 */
function onWatchAllToggle(allCb) {
  const cbs = document.querySelectorAll('.watch-type-cb:not([value="ALL"])');
  if (allCb.checked) {
    // Disable all individual checkboxes — ALL supersedes them
    cbs.forEach(cb => { cb.checked = false; cb.disabled = true; });
  } else {
    // Re-enable and restore defaults
    cbs.forEach(cb => {
      cb.disabled = false;
      cb.checked  = DEFAULT_WATCH_TYPES.includes(cb.value);
    });
  }
}

/** Show the port and warning options only while certificate monitoring is ticked. */
function onWatchCertToggle(cb) {
  const opts = document.getElementById('watchCertOptions');
  if (opts) opts.style.display = cb.checked ? 'block' : 'none';
}

/** Show the warning options only while registration monitoring is ticked. */
function onWatchExpiryToggle(cb) {
  const opts = document.getElementById('watchExpiryOptions');
  if (opts) opts.style.display = cb.checked ? 'block' : 'none';
}

/**
 * Registration monitoring only exists for public domains, so it is switched off
 * (and explained) while the source is Internal DNS or the entry is an IP address.
 */
function refreshWatchAvailability() {
  const cb   = document.getElementById('watchExpiryOn');
  const note = document.getElementById('watchExpiryNote');
  if (!cb || !note) return;

  const domain   = ((document.getElementById('watchDomain') || {}).value || '').trim();
  const internal = ((document.getElementById('watchSource') || {}).value) === 'internal';

  let reason = '';
  if (looksLikeIp(domain)) reason = 'An IP address has no domain registration to watch.';
  else if (internal)       reason = 'Internal names are not registered anywhere. Choose Public DNS to watch a registration.';

  cb.disabled = !!reason;
  if (reason && cb.checked) { cb.checked = false; onWatchExpiryToggle(cb); }
  note.textContent   = reason;
  note.style.display = reason ? 'block' : 'none';

  const label = document.getElementById('watchExpiryLabel');
  if (label) label.style.opacity = reason ? '0.6' : '';
}

// ── Helpers ───────────────────────────────────────────────────────

/** True for something that looks like a dotted IPv4 address (four numbers). */
function looksLikeIp(s) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(s);
}

// ── Submit ────────────────────────────────────────────────────────
/**
 * Reads the form, validates, and calls POST /api/admin/watched.
 */
async function submitAddWatched() {
  const domain   = (document.getElementById('watchDomain')   || {}).value?.trim().toLowerCase() || '';
  const source   = (document.getElementById('watchSource')   || {}).value || 'public';
  const interval = parseInt((document.getElementById('watchInterval') || {}).value || '60', 10);
  const certOn   = !!(document.getElementById('watchCertOn') || {}).checked;
  const expiryOn = !!(document.getElementById('watchExpiryOn') || {}).checked;

  if (!domain) { adminToast('Enter a domain name or IP address', true); return; }
  if (!/^[a-z0-9._-]+$/.test(domain)) { adminToast('Invalid domain name', true); return; }

  // Certificate settings
  let cert = null;
  if (certOn) {
    const port = parseInt((document.getElementById('watchCertPort') || {}).value, 10);
    if (!(port >= 1 && port <= 65535)) { adminToast('Enter a port from 1 to 65535', true); return; }
    const warnDays = ((document.getElementById('watchCertWarn') || {}).value || '30,14,7').split(',').map(Number);
    cert = { enabled: true, port, warnDays };
  }

  // Domain registration settings
  let expiry = null;
  if (expiryOn) {
    const warnDays = ((document.getElementById('watchExpiryWarn') || {}).value || '60,30,14,7').split(',').map(Number);
    expiry = { enabled: true, warnDays };
  }

  // Record types
  const allCb = document.querySelector('.watch-type-cb[value="ALL"]');
  let recordTypes;
  if (allCb && allCb.checked) {
    recordTypes = ['ALL'];
  } else {
    recordTypes = Array.from(document.querySelectorAll('.watch-type-cb:checked')).map(cb => cb.value);
  }

  // An IP address has no DNS records, so it can only be a certificate watch
  if (looksLikeIp(domain)) {
    if (!cert) { adminToast('An IP address has no DNS records. Tick "Also monitor the TLS certificate".', true); return; }
    recordTypes = [];
  } else if (!recordTypes.length && !cert && !expiry) {
    adminToast('Pick at least one record type, or tick certificate or registration monitoring', true);
    return;
  }

  try {
    const r = await adminFetch('/api/admin/watched', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ domain, source, recordTypes, interval, cert, expiry }),
    });
    const d = await r.json();

    if (r.ok) {
      adminToast(`Now watching ${domain}`);
      const domainEl = document.getElementById('watchDomain');
      if (domainEl) domainEl.value = '';
      loadWatchedPage();
      // The first certificate or registration check runs in the background; refresh once more shortly after
      if (cert || expiry) setTimeout(loadWatchedPage, 2500);
    } else {
      adminToast(d.error || 'Failed to add', true);
    }
  } catch (e) {
    adminToast('Error: ' + e.message, true);
  }
}
