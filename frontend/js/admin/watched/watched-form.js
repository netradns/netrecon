// ── NetRecon Admin — Add Watched Domain Form ─────────────────────
// Handles the "Add Domain" form in the Watched Domains page.
// Validates input and calls POST /api/admin/watched.

'use strict';

// ── Render the add-domain form ────────────────────────────────────
/**
 * Returns the HTML for the Add Domain form panel.
 * Rendered once by watched.js into the page shell.
 * @returns {string} HTML string
 */
function renderWatchedForm() {
  return `
    <div class="panel" style="margin-bottom:20px" id="addWatchedPanel">
      <div style="font-size:14px;font-weight:600;margin-bottom:4px">Watch a Domain</div>
      <div style="font-size:12px;color:var(--text-3);margin-bottom:14px">
        NetRecon will poll the domain on the configured interval and alert you when any DNS records change.
      </div>
      <div class="field-row">
        <div class="field-group">
          <label class="field-label">Domain</label>
          <input class="f-input mono" id="watchDomain" placeholder="example.com" autocomplete="off" spellcheck="false">
        </div>
        <div class="field-group">
          <label class="field-label">Source</label>
          <select class="f-input f-select" id="watchSource">
            <option value="public">Public DNS</option>
            <option value="internal">Internal DNS</option>
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
        <label class="field-label">Record Types to Watch</label>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px" id="watchRecordTypes">
          ${['A','AAAA','MX','TXT','NS','CNAME','SOA','CAA'].map(t => `
            <label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer">
              <input type="checkbox" value="${t}" ${['A','MX','TXT','NS'].includes(t) ? 'checked' : ''} class="watch-type-cb">
              <span class="mono">${t}</span>
            </label>`).join('')}
          <label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer">
            <input type="checkbox" value="ALL" class="watch-type-cb" onchange="onWatchAllToggle(this)">
            <span style="font-weight:600">ALL</span>
          </label>
        </div>
      </div>

      <button class="btn btn-primary btn-sm" onclick="submitAddWatched()">Add Domain</button>
    </div>`;
}

// ── ALL toggle ────────────────────────────────────────────────────
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
      cb.checked  = ['A', 'MX', 'TXT', 'NS'].includes(cb.value);
    });
  }
}

// ── Submit ────────────────────────────────────────────────────────
/**
 * Reads the form, validates, and calls POST /api/admin/watched.
 */
async function submitAddWatched() {
  const domain   = (document.getElementById('watchDomain')   || {}).value?.trim().toLowerCase() || '';
  const source   = (document.getElementById('watchSource')   || {}).value || 'public';
  const interval = parseInt((document.getElementById('watchInterval') || {}).value || '60', 10);

  if (!domain) { adminToast('Enter a domain name', true); return; }
  if (!/^[a-z0-9._-]+$/.test(domain)) { adminToast('Invalid domain name', true); return; }

  // Collect selected record types
  const allCb = document.querySelector('.watch-type-cb[value="ALL"]');
  let recordTypes;
  if (allCb && allCb.checked) {
    recordTypes = ['ALL'];
  } else {
    recordTypes = Array.from(document.querySelectorAll('.watch-type-cb:checked')).map(cb => cb.value);
    if (!recordTypes.length) { adminToast('Select at least one record type', true); return; }
  }

  try {
    const r = await adminFetch('/api/admin/watched', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ domain, source, recordTypes, interval }),
    });
    const d = await r.json();

    if (r.ok) {
      adminToast(`Now watching ${domain}`);
      // Clear the domain input
      const domainEl = document.getElementById('watchDomain');
      if (domainEl) domainEl.value = '';
      // Reload the table
      loadWatchedPage();
    } else {
      adminToast(d.error || 'Failed to add domain', true);
    }
  } catch (e) {
    adminToast('Error: ' + e.message, true);
  }
}
