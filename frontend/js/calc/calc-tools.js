// NetRecon — IP Calculator helpers
// Prefix cheat sheet, host-count finder, IP-in-subnet check, click-to-copy and live results.

'use strict';

// ── Shared helpers ───────────────────────────────────────────

// IP currently typed in the calculator, or a default when the box is empty or invalid
function calcBaseIp() {
  var input = calcEl('cidrInput');
  var p = input ? parseCalcInput(input.value) : null;
  return (p && !p.error) ? p.ip : '192.168.1.0';
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

// ── Is this IP inside the calculated subnet? ─────────────────

function calcCheckIp() {
  var inp = calcEl('calcCheckIp'), out = calcEl('calcCheckOut');
  var last = window._calcLast;          // set by runCalc()
  if (!inp || !out || !last) return;

  var v = inp.value.trim();
  if (!v) { out.innerHTML = ''; return; }
  if (!isDottedQuad(v)) { out.innerHTML = '<span class="calc-check-no">Not a valid IP</span>'; return; }

  var n = ip2long(v), cidr = last.network + '/' + last.prefix;
  if (n >= last.networkLong && n <= last.broadcastLong) {
    out.innerHTML = '<span class="calc-check-yes">&#10003; Inside ' + h(cidr) + ' (address ' +
      formatNumber(n - last.networkLong + 1) + ' of ' + formatNumber(last.broadcastLong - last.networkLong + 1) + ')</span>';
  } else {
    out.innerHTML = '<span class="calc-check-no">&#10007; Outside ' + h(cidr) + '</span>';
  }
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
      if (!p.error && p.explicit && !upToDate) runCalc(null, true);
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
