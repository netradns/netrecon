// ── NetRecon Admin — General Settings ────────────────────────────
// Manages the General tab in the Settings page.
// Handles:
//   - Internal DNS enabled/disabled toggle
//   - DNS / IP Lookup quick links (configurable, pointer-drag reorder)
//   - Internal DNS quick links (configurable, pointer-drag reorder)
//
// Reordering uses pointer events (mousedown/mousemove/mouseup) — NOT
// the HTML5 Drag and Drop API, which is unreliable for list reordering
// (events fire on child elements, drop events get swallowed, etc.).
//
// Raw label/value data is stored in data-label / data-value attributes
// on each row — never read from textContent.

'use strict';

// ── Escape helper (prefixed to avoid global collision) ────────────
function _qlEsc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Load ──────────────────────────────────────────────────────────
function loadGeneralSettings(config) {
  var toggle = document.getElementById('internalDnsToggle');
  if (toggle) {
    // Explicitly set to the boolean value from the server
    toggle.checked = (config.internalDnsEnabled === true || config.internalDnsEnabled === undefined);
  }
  updateInternalDnsLabel();
  renderQuickLinksList('dnsQuickLinksList',  config.dnsQuickLinks  || []);
  renderQuickLinksList('idnsQuickLinksList', config.idnsQuickLinks || []);
}

// ── Internal DNS toggle ───────────────────────────────────────────
async function onInternalDnsToggle() {
  var toggle = document.getElementById('internalDnsToggle');
  if (!toggle) return;

  var enabled = toggle.checked;
  updateInternalDnsLabel();

  try {
    var r = await adminFetch('/api/admin/config', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ internalDnsEnabled: enabled }),
    });
    var d = await r.json();
    if (r.ok) {
      adminToast('Internal DNS ' + (enabled ? 'enabled' : 'disabled'));
    } else {
      // Revert the toggle on failure
      toggle.checked = !enabled;
      updateInternalDnsLabel();
      adminToast(d.error || 'Save failed', true);
    }
  } catch (e) {
    // Revert the toggle on error
    toggle.checked = !enabled;
    updateInternalDnsLabel();
    adminToast('Error: ' + e.message, true);
  }
}

function updateInternalDnsLabel() {
  const toggle = document.getElementById('internalDnsToggle');
  const label  = document.getElementById('internalDnsLabel');
  if (!toggle || !label) return;
  label.textContent = toggle.checked
    ? 'Internal DNS is enabled — the Internal DNS tool is visible to users'
    : 'Internal DNS is disabled — the Internal DNS tool is hidden from users';
  label.style.color = toggle.checked ? 'var(--green)' : 'var(--text-3)';
}

// ── Quick links rendering ─────────────────────────────────────────
function renderQuickLinksList(containerId, links) {
  const el = document.getElementById(containerId);
  if (!el) return;

  if (!links.length) {
    el.innerHTML = '<div style="font-size:12px;color:var(--text-3);padding:6px 0">No quick links configured. Add one below.</div>';
    return;
  }

  el.innerHTML = links.map((l, idx) =>
    `<div class="ql-dnd-row"
          data-index="${idx}"
          data-label="${_qlEsc(l.label)}"
          data-value="${_qlEsc(l.value)}"
          style="display:flex;align-items:center;gap:8px;padding:7px 8px;border:1px solid var(--border);border-radius:6px;margin-bottom:5px;background:var(--surface);user-select:none">
      <span class="ql-drag-handle" title="Drag to reorder"
            style="color:var(--text-3);cursor:grab;font-size:14px;line-height:1;padding:0 4px;flex-shrink:0">⠿</span>
      <span class="ql-chip" style="pointer-events:none;flex-shrink:0">${_qlEsc(l.label)}</span>
      <span class="mono" style="font-size:11px;color:var(--text-3);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;pointer-events:none">${_qlEsc(l.value)}</span>
      <button class="btn btn-ghost btn-sm ql-remove-btn"
              data-container="${containerId}" data-index="${idx}"
              style="color:var(--red);flex-shrink:0">Remove</button>
    </div>`
  ).join('');

  // Delegated click for Remove
  el.onclick = (e) => {
    const btn = e.target.closest('.ql-remove-btn');
    if (!btn) return;
    _qlRemove(
      btn.getAttribute('data-container'),
      parseInt(btn.getAttribute('data-index'), 10)
    );
  };

  // Attach pointer-based reorder
  _qlAttachReorder(el, containerId);
}

// ── Read links from DOM data attributes ───────────────────────────
function _qlReadLinks(containerId) {
  return Array.from(
    document.querySelectorAll('#' + containerId + ' .ql-dnd-row')
  ).map(function(row) {
    return {
      label: row.getAttribute('data-label') || '',
      value: row.getAttribute('data-value') || '',
    };
  });
}

// ── Pointer-based drag reorder ────────────────────────────────────
// How it works:
//   1. mousedown on the ⠿ handle starts the drag
//   2. mousemove on document swaps rows when the cursor crosses a row midpoint
//   3. mouseup on document ends the drag and saves
//
// This is 100% reliable because we control the entire event flow —
// no browser DnD API quirks, no child element interception issues.
function _qlAttachReorder(container, containerId) {
  var dragRow   = null;  // the row element being dragged
  var dragIdx   = -1;    // current index of the dragged row
  var startY    = 0;     // mousedown Y for threshold check
  var dragging  = false; // true once we've moved past the threshold

  container.addEventListener('mousedown', function(e) {
    // Only start drag from the handle
    var handle = e.target.closest('.ql-drag-handle');
    if (!handle) return;

    var row = handle.closest('.ql-dnd-row');
    if (!row) return;

    e.preventDefault();
    dragRow  = row;
    dragIdx  = parseInt(row.getAttribute('data-index'), 10);
    startY   = e.clientY;
    dragging = false;

    // Visual feedback immediately
    row.style.opacity    = '0.6';
    row.style.boxShadow  = '0 0 0 2px var(--blue)';
    row.style.zIndex     = '10';
    row.style.position   = 'relative';
  });

  document.addEventListener('mousemove', function(e) {
    if (!dragRow) return;

    // Require 4px movement before starting the drag (prevents accidental drags)
    if (!dragging) {
      if (Math.abs(e.clientY - startY) < 4) return;
      dragging = true;
    }

    // Find which row the cursor is over by checking midpoints
    var rows = container.querySelectorAll('.ql-dnd-row');
    var targetIdx = -1;

    for (var i = 0; i < rows.length; i++) {
      var rect = rows[i].getBoundingClientRect();
      var mid  = rect.top + rect.height / 2;
      if (e.clientY < mid) { targetIdx = i; break; }
    }
    // If cursor is below all rows, target is the last position
    if (targetIdx === -1) targetIdx = rows.length - 1;

    // Swap if the target is different from current position
    if (targetIdx !== dragIdx && targetIdx >= 0) {
      // Move the DOM element directly for instant visual feedback
      var rows2  = Array.from(container.querySelectorAll('.ql-dnd-row'));
      var target = rows2[targetIdx];
      if (targetIdx > dragIdx) {
        // Moving down — insert after the target
        target.after(dragRow);
      } else {
        // Moving up — insert before the target
        target.before(dragRow);
      }
      // Update all data-index attributes to reflect new order
      container.querySelectorAll('.ql-dnd-row').forEach(function(r, i) {
        r.setAttribute('data-index', i);
        var rmBtn = r.querySelector('.ql-remove-btn');
        if (rmBtn) rmBtn.setAttribute('data-index', i);
      });
      dragIdx = targetIdx;
    }
  });

  document.addEventListener('mouseup', function() {
    if (!dragRow) return;

    // Reset visual state
    dragRow.style.opacity   = '';
    dragRow.style.boxShadow = '';
    dragRow.style.zIndex    = '';
    dragRow.style.position  = '';

    // Save the new order if we actually dragged
    if (dragging) {
      var links = _qlReadLinks(containerId);
      var key   = containerId === 'dnsQuickLinksList' ? 'dnsQuickLinks' : 'idnsQuickLinks';
      saveQuickLinks(key, links);
    }

    dragRow  = null;
    dragIdx  = -1;
    dragging = false;
  });
}

// ── Remove ────────────────────────────────────────────────────────
async function _qlRemove(containerId, idx) {
  var key   = containerId === 'dnsQuickLinksList' ? 'dnsQuickLinks' : 'idnsQuickLinks';
  var links = _qlReadLinks(containerId).filter(function(_, i) { return i !== idx; });
  renderQuickLinksList(containerId, links);
  await saveQuickLinks(key, links);
}

// ── Add ───────────────────────────────────────────────────────────
async function addQuickLink(key) {
  var isIdns      = key === 'idnsQuickLinks';
  var labelId     = isIdns ? 'idnsQlLabel' : 'dnsQlLabel';
  var valueId     = isIdns ? 'idnsQlValue' : 'dnsQlValue';
  var containerId = isIdns ? 'idnsQuickLinksList' : 'dnsQuickLinksList';

  var label = (document.getElementById(labelId) || {}).value?.trim() || '';
  var value = (document.getElementById(valueId) || {}).value?.trim() || '';

  if (!value) { adminToast('Enter a domain or hostname', true); return; }

  var links = _qlReadLinks(containerId);
  links.push({ label: label || value, value: value });

  renderQuickLinksList(containerId, links);
  await saveQuickLinks(key, links);

  var lEl = document.getElementById(labelId);
  var vEl = document.getElementById(valueId);
  if (lEl) lEl.value = '';
  if (vEl) vEl.value = '';
}

// ── Save ──────────────────────────────────────────────────────────
async function saveQuickLinks(key, links) {
  try {
    var r = await adminFetch('/api/admin/config', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: links }),
    });
    var d = await r.json();
    if (r.ok) adminToast('Saved');
    else      adminToast(d.error || 'Save failed', true);
  } catch (e) { adminToast('Error: ' + e.message, true); }
}
