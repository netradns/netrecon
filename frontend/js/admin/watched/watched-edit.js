// ── NetRecon Admin — Edit what a watched entry watches ───────────
// The "What is watched" box in the detail slide-in panel. Tick or untick DNS record
// types, the TLS certificate and the domain registration, change the interval,
// then Save. The entry keeps its history, so nothing has to be deleted and added again.
//
// Sends PATCH /api/admin/watched/:id. The server applies the same rules as when
// adding (watched-rules.js), so a refused combination comes back as a message.
// The domain name and source are not editable: that would be a different watch.
//
// Depends on watched-form.js (presets, looksLikeIp), watched-table.js (_watchedState)
// and watched-detail.js (_detailEntry, openWatchedDetail).
'use strict';

const WATCH_EDIT_TYPES = ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'SOA', 'CAA'];

// Baseline of the form as drawn, so "unsaved changes" can be told from "nothing changed"
let _weBase = null;

const _weEl  = id => document.getElementById(id);
const _weEsc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A warning-days dropdown. A value that is not one of the presets is kept as "Current: ...". */
function weWarnSelect(id, presets, current) {
  const cur = (current || []).join(',');
  const known = presets.some(p => p.value === cur);
  const opts = presets.map(p => `<option value="${p.value}"${p.value === cur ? ' selected' : ''}>${_weEsc(p.label)}</option>`);
  if (cur && !known) opts.unshift(`<option value="${_weEsc(cur)}" selected>Current: ${_weEsc(cur.split(',').join(', '))} days</option>`);
  return `<select class="f-input f-select" id="${id}" onchange="weChanged()">${opts.join('')}</select>`;
}

/**
 * HTML for the edit box. Called by renderDetailContent().
 * @param {Object} entry - Watched entry
 */
function renderWatchEditor(entry) {
  const isIp     = looksLikeIp(entry.domain);
  const internal = entry.source === 'internal';
  const types    = entry.recordTypes || [];
  const hasAll   = types.includes('ALL');
  const box      = 'margin-bottom:12px;padding:12px;border:1px solid var(--border);border-radius:6px;background:var(--bg)';
  const row      = 'display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;cursor:pointer';

  // DNS records
  const dns = isIp
    ? `<div style="${box}"><div style="font-size:13px;font-weight:600">DNS records</div>
         <div style="font-size:12px;color:var(--text-3);margin-top:4px">An IP address has no DNS records. It can only be watched by its certificate.</div></div>`
    : `<div style="${box}">
         <div style="font-size:13px;font-weight:600;margin-bottom:6px">DNS records</div>
         <div style="display:flex;flex-wrap:wrap;gap:8px">
           ${WATCH_EDIT_TYPES.map(t => `<label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer">
             <input type="checkbox" class="we-type" value="${t}" ${types.includes(t) ? 'checked' : ''} ${hasAll ? 'disabled' : ''} onchange="weChanged()"><span class="mono">${t}</span></label>`).join('')}
           <label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer">
             <input type="checkbox" class="we-type" id="we-all" value="ALL" ${hasAll ? 'checked' : ''} onchange="weAllToggle(this)"><span style="font-weight:600">ALL</span></label>
         </div>
         <div style="font-size:11px;color:var(--text-3);margin-top:6px">Untick them all to stop watching DNS records. Changing the records starts a fresh comparison, and the history stays.</div>
       </div>`;

  // Certificate
  const cert = entry.cert;
  const certBox = `<div style="${box}">
      <label style="${row}"><input type="checkbox" id="we-cert-on" ${cert ? 'checked' : ''} ${isIp ? 'disabled' : ''} onchange="weChanged()"> TLS certificate</label>
      ${isIp ? '<div style="font-size:12px;color:var(--text-3);margin:4px 0 0 22px">Always on for an IP address.</div>' : ''}
      <div id="we-cert-opts" style="display:${cert ? 'block' : 'none'};margin:10px 0 0 22px">
        <div class="field-row" style="margin-bottom:0">
          <div class="field-group" style="max-width:110px"><label class="field-label">Port</label>
            <input class="f-input mono" id="we-cert-port" value="${cert ? _weEsc(cert.port) : '443'}" inputmode="numeric" autocomplete="off" oninput="weChanged()"></div>
          <div class="field-group"><label class="field-label">Warn me</label>${weWarnSelect('we-cert-warn', CERT_WARN_PRESETS, cert ? cert.warnDays : [30, 14, 7])}</div>
        </div>
      </div>
    </div>`;

  // Registration
  const exp = entry.expiry;
  const noExpiry = isIp ? 'An IP address has no domain registration.' : internal ? 'Internal names are not registered anywhere. Registration watching needs a public domain.' : '';
  const expBox = `<div style="${box};${noExpiry ? 'opacity:.7' : ''}">
      <label style="${row}"><input type="checkbox" id="we-exp-on" ${exp ? 'checked' : ''} ${noExpiry ? 'disabled' : ''} onchange="weChanged()"> Domain registration</label>
      ${noExpiry ? `<div style="font-size:12px;color:var(--text-3);margin:4px 0 0 22px">${noExpiry}</div>` : ''}
      <div id="we-exp-opts" style="display:${exp ? 'block' : 'none'};margin:10px 0 0 22px">
        <div class="field-group" style="max-width:420px"><label class="field-label">Warn me</label>${weWarnSelect('we-exp-warn', EXPIRY_WARN_PRESETS, exp ? exp.warnDays : [60, 30, 14, 7])}</div>
      </div>
    </div>`;

  const interval = `<div class="field-group" style="max-width:240px;margin-bottom:12px"><label class="field-label">Check interval</label>
      <select class="f-input f-select" id="we-interval" onchange="weChanged()">
        ${[[5, 'Every 5 minutes'], [15, 'Every 15 minutes'], [60, 'Every hour'], [360, 'Every 6 hours'], [1440, 'Every 24 hours']]
          .map(o => `<option value="${o[0]}"${Number(entry.interval) === o[0] ? ' selected' : ''}>${o[1]}</option>`).join('')}
      </select></div>`;

  return `<div class="section" style="margin-bottom:16px" id="weBox">
      <div class="section-hdr">
        <div class="section-ico" style="background:var(--blue-light)">&#9998;</div>
        <span class="section-title">What is watched</span>
        <span class="section-sub">Tick or untick, then save</span>
      </div>
      <div style="padding:4px 4px 0">${dns}${certBox}${expBox}${interval}
        <div id="we-msg" style="font-size:12px;color:var(--red);min-height:16px;margin-bottom:8px"></div>
        <div style="display:flex;gap:8px;margin-bottom:12px">
          <button class="btn btn-primary btn-sm" id="we-save" onclick="saveWatchEdit('${_weEsc(entry.id)}')" disabled>Save changes</button>
          <button class="btn btn-ghost btn-sm" id="we-reset" onclick="resetWatchEdit()" disabled>Undo</button>
        </div>
      </div></div>`;
}

/** Called after the panel HTML is in the page. */
function initWatchEditor() {
  const box = _weEl('weBox');
  if (!box) return;
  if (typeof initAllCustomSelects === 'function') initAllCustomSelects(box);
  _weBase = JSON.stringify(weRead());
  weChanged();
}

/** The values currently in the editor. */
function weRead() {
  const on = id => !!(_weEl(id) || {}).checked;
  const val = id => (_weEl(id) || {}).value || '';
  return {
    recordTypes: Array.from(document.querySelectorAll('.we-type:checked')).map(c => c.value),
    certOn: on('we-cert-on'), certPort: val('we-cert-port').trim(), certWarn: val('we-cert-warn'),
    expOn: on('we-exp-on'), expWarn: val('we-exp-warn'),
    interval: parseInt(val('we-interval'), 10),
  };
}

function weIsDirty() {
  return !!_weEl('weBox') && _weBase !== null && JSON.stringify(weRead()) !== _weBase;
}

/** ALL replaces the single types, as in the add form. */
function weAllToggle(cb) {
  document.querySelectorAll('.we-type:not(#we-all)').forEach(c => {
    c.disabled = cb.checked;
    if (cb.checked) c.checked = false;
    else c.checked = DEFAULT_WATCH_TYPES.includes(c.value);
  });
  weChanged();
}

/** Any control changed: show or hide options, check the values and enable Save. */
function weChanged() {
  const r = weRead();
  const certOpts = _weEl('we-cert-opts'), expOpts = _weEl('we-exp-opts');
  if (certOpts) certOpts.style.display = r.certOn ? 'block' : 'none';
  if (expOpts)  expOpts.style.display  = r.expOn  ? 'block' : 'none';
  let msg = '';
  const port = Number(r.certPort);
  if (r.certOn && !(/^\d+$/.test(r.certPort) && port >= 1 && port <= 65535)) msg = 'Enter a port from 1 to 65535.';
  else if (!r.recordTypes.length && !r.certOn && !r.expOn) msg = 'Keep at least one thing watched. To stop watching this entry, use Remove.';
  const dirty = weIsDirty();
  const m = _weEl('we-msg'); if (m) m.textContent = msg;
  const save = _weEl('we-save'); if (save) save.disabled = !dirty || !!msg;
  const undo = _weEl('we-reset'); if (undo) undo.disabled = !dirty;
}

/** Put the panel back to what is saved. */
function resetWatchEdit() {
  const entry = _detailEntry;
  if (entry && _watchedState) openWatchedDetail(entry, _watchedState);
}

/** Send the changes. On success the table and the panel are refreshed. */
async function saveWatchEdit(id) {
  if (weIsDirty() === false) return;
  const r = weRead();
  const save = _weEl('we-save'), msg = _weEl('we-msg');
  if (save) { save.disabled = true; save.textContent = 'Saving…'; }
  const body = {
    recordTypes: r.recordTypes,
    cert:     r.certOn ? { enabled: true, port: Number(r.certPort), warnDays: r.certWarn.split(',').map(Number) } : null,
    expiry:   r.expOn  ? { enabled: true, warnDays: r.expWarn.split(',').map(Number) } : null,
    interval: r.interval,
  };
  try {
    const res = await adminFetch('/api/admin/watched/' + encodeURIComponent(id), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (msg) msg.textContent = d.error || 'Could not save the changes';
      if (save) { save.disabled = false; save.textContent = 'Save changes'; }
      return;
    }
    adminToast(d.changed && d.changed.length ? 'Saved: ' + d.changed.join(', ') : 'Nothing to change');
    await loadWatchedPage();
    weReopen(id);
    // The first check of anything new runs in the background; show its result shortly after
    setTimeout(async () => { await loadWatchedPage(); if (!weIsDirty()) weReopen(id); }, 2500);
  } catch (e) {
    if (msg) msg.textContent = 'Error: ' + e.message;
    if (save) { save.disabled = false; save.textContent = 'Save changes'; }
  }
}

/** Redraw the open panel for an entry from the freshly loaded state. */
function weReopen(id) {
  if (!_detailEntry || _detailEntry.id !== id || !_watchedState) return;
  const fresh = (_watchedState.domains || []).find(d => d.id === id);
  if (fresh) openWatchedDetail(fresh, _watchedState);
}
