// NetRecon — IP Calculator helpers
// Prefix cheat sheet, host-count finder, click-to-copy and live results.

'use strict';

// ── Shared helpers ───────────────────────────────────────────

// IP currently typed in the calculator, or a default when the box is empty or invalid
function calcBaseIp() {
  var input = calcEl('cidrInput');
  if (!input || parsePrefixOnly(input.value) !== null) return '192.168.1.0';   // "/27" or a bare mask holds no IP
  var p = parseCalcInput(input.value);
  return p.error ? '192.168.1.0' : p.ip;
}

// Recalculate the current IP with a different prefix length
function calcApplyPrefix(prefix) {
  calcQuick(calcBaseIp() + '/' + prefix);
}

// Dotted subnet mask for a prefix length (27 -> "255.255.255.224")
function prefixMask(prefix) {
  return long2ip(prefixToMaskLong(prefix));
}

// ── Prefix cheat sheet ───────────────────────────────────────

// Builds the /8 to /32 reference table. Called the first time the section is opened.
function buildCalcCheatSheet() {
  var el = calcEl('calcCheat');
  if (!el || el.firstChild) return;
  var html = '<table class="dt"><thead><tr><th>Prefix</th><th>Subnet Mask</th><th>Wildcard</th><th>Total IPs</th><th>Usable Hosts</th></tr></thead><tbody>';
  for (var p = 8; p <= 32; p++) {
    html += '<tr class="split-row" onclick="calcApplyPrefix(' + p + ')" title="Calculate with /' + p + '">' +
      '<td>' + pill('/' + p, 'p-blue') + '</td>' +
      '<td class="cd">' + prefixMask(p) + '</td>' +
      '<td class="cd">' + long2ip((~prefixToMaskLong(p)) >>> 0) + '</td>' +
      '<td class="cd">' + formatNumber(Math.pow(2, 32 - p)) + '</td>' +
      '<td class="cm">' + formatNumber(getUsable(p)) + '</td></tr>';
  }
  el.innerHTML = html + '</tbody></table>';
}

// ── "Need a subnet for N hosts?" ─────────────────────────────

// Suggests the smallest subnet with at least N usable hosts. Clicking it applies the prefix to the current IP.
function calcHostFinder() {
  var inp = calcEl('calcHostsIn'), out = calcEl('calcHostsOut');
  if (!inp || !out) return;
  var raw = inp.value.trim();
  if (!raw) { out.innerHTML = ''; return; }

  var n = Number(raw);
  if (!/^\d+$/.test(raw) || n < 1 || n > 4294967294) {
    out.innerHTML = '<span class="calc-hosts-err">Enter a number of hosts from 1 to 4,294,967,294</span>';
    return;
  }
  var p = prefixForHosts(n, false);   // never smaller than a /30
  out.innerHTML = '<span class="calc-chip" onclick="calcApplyPrefix(' + p + ')" title="Calculate with /' + p + '">' +
    '/' + p + ' &nbsp;&middot;&nbsp; ' + prefixMask(p) + ' &nbsp;&middot;&nbsp; ' + formatNumber(getUsable(p)) + ' usable</span>' +
    '<span class="calc-hosts-note">Click to use it with ' + h(calcBaseIp()) + '</span>';
}

// ── Quick answer for a bare prefix or mask ───────────────────

// "What is a /27?" Shows the mask, wildcard and host counts without needing an IP.
function renderPrefixInfo(prefix, container) {
  var mask = prefixMask(prefix);
  var cells = [
    { label: 'Subnet Mask',     value: mask,                                                accent: true  },
    { label: 'Wildcard Mask',   value: long2ip((~prefixToMaskLong(prefix)) >>> 0),          accent: false },
    { label: 'Total Addresses', value: formatNumber(Math.pow(2, 32 - prefix)),              accent: false },
    { label: 'Usable Hosts',    value: formatNumber(getUsable(prefix)),                     accent: true  },
    { label: 'Host Bits',       value: String(32 - prefix),                                 accent: false }
  ];
  var html = '<div class="calc-results"><div class="cidr-summary"><div class="cidr-banner"><div>' +
    '<div class="cidr-network">/' + prefix + ' = ' + h(mask) + '</div>' +
    '<div class="cidr-desc">' + h(cidrClass(prefix)) + ' &nbsp;&middot;&nbsp; ' + formatNumber(getUsable(prefix)) + ' usable hosts</div>' +
    '</div><span class="calc-chip" onclick="calcApplyPrefix(' + prefix + ')" title="Calculate a full subnet with this prefix">' +
    'Use with ' + h(calcBaseIp()) + '/' + prefix + '</span></div><div class="cidr-grid">';
  cells.forEach(function(c) {
    html += '<div class="cidr-cell copyable" data-copy="' + h(c.value) + '" title="Click to copy"><div class="cidr-lbl">' + c.label +
      '</div><div class="cidr-val' + (c.accent ? ' accent' : '') + '">' + h(c.value) + '</div></div>';
  });
  container.innerHTML = html + '</div></div></div>';
}

// ── Click-to-copy on result cells ────────────────────────────

// Copies the cell's data-copy value and briefly shows "Copied!" in its label
function calcCopyCell(cell) {
  var text = cell.getAttribute('data-copy');
  if (!text || !navigator.clipboard) return;
  navigator.clipboard.writeText(text).then(function() {
    var lbl = cell.querySelector('.cidr-lbl');
    if (!lbl) return;
    var original = lbl.getAttribute('data-orig') || lbl.textContent;   // kept so rapid clicks don't lose the label
    lbl.setAttribute('data-orig', original);
    lbl.textContent = 'Copied!';
    cell.classList.add('copied');
    setTimeout(function() { lbl.textContent = original; cell.classList.remove('copied'); }, 1000);
  }).catch(function() {});
}

// ── Wiring ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  // Build the cheat sheet lazily
  var cheat = document.querySelector('.calc-cheat');
  if (cheat) cheat.addEventListener('toggle', function() { if (cheat.open) buildCalcCheatSheet(); });

  var hosts = calcEl('calcHostsIn');
  if (hosts) hosts.addEventListener('input', calcHostFinder);

  // Live results: recalculate shortly after typing stops, once the input has a valid prefix or mask.
  // Skipped when the result on screen already matches (e.g. right after pressing Enter).
  var input = calcEl('cidrInput'), timer = null;
  if (input) input.addEventListener('input', function() {
    clearTimeout(timer);
    timer = setTimeout(function() {
      var p = parseCalcInput(input.value);
      var upToDate = window._calcLast && window._calcLast.raw === input.value.trim();
      // "/27" or a mask on its own. A plain number is not live-matched, since "19" is the start of "192.168...".
      var v = input.value.trim();
      var bare = parsePrefixOnly(v) !== null && (v.charAt(0) === '/' || v.indexOf('.') !== -1);
      if (((!p.error && p.explicit) || bare) && !upToDate) runCalc(null, true);
      calcHostFinder();   // the suggestion mentions the IP being typed
    }, 400);
  });

  // One delegated listener handles every result cell, including ones rendered later
  var results = calcEl('calc-results');
  if (results) results.addEventListener('click', function(e) {
    var cell = e.target.closest ? e.target.closest('.cidr-cell.copyable') : null;
    if (cell) calcCopyCell(cell);
  });
});
