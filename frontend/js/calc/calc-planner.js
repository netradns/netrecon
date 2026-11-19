// NetRecon — IP Calculator: tabs, VLSM planner, overlap checker, summarizer and result export (UI)
// Logic lives in calc-nettools.js. This file only builds and wires the interface.

'use strict';

// Limits that keep a huge paste from freezing the page
var MAX_OVERLAP_ENTRIES = 3000;     // overlap check compares every pair
var MAX_SUMMARY_ENTRIES = 5000;
var MAX_SUMMARY_ROWS    = 500;      // rows drawn on screen (exports include every route)
var MAX_PASTE_CHARS     = 200000;   // textarea size limit

// Last output of each tool, kept so the export buttons can use it
var _plan = { vlsm: null, overlap: null, summarize: null };

// Raw value of an input (empty string if the element is missing)
function pVal(id) { var e = calcEl(id); return e ? e.value : ''; }

function msgList(items, cls, icon) {
  return items.map(function(m) { return '<div class="' + cls + '">' + icon + ' ' + h(m) + '</div>'; }).join('');
}

function exportBar(tool, copyLabel) {
  return '<div class="plan-export">' +
    '<button class="calc-btn calc-btn-sec" onclick="planExport(\'' + tool + '\',\'csv\')">Download CSV</button>' +
    '<button class="calc-btn calc-btn-sec" onclick="planExport(\'' + tool + '\',\'txt\')">Download .txt</button>' +
    '<button class="calc-btn calc-btn-sec" onclick="planExport(\'' + tool + '\',\'copy\',this)">' + (copyLabel || 'Copy') + '</button></div>';
}

// Run `fn` shortly after the user stops typing
function debounced(fn, ms) {
  var t = null;
  return function() { clearTimeout(t); t = setTimeout(fn, ms || 300); };
}

// ── Tabs ─────────────────────────────────────────────────────
var CALC_TABS = [
  { id: 'calc',      label: 'Calculator' },
  { id: 'vlsm',      label: 'VLSM Planner' },
  { id: 'overlap',   label: 'Overlap Check' },
  { id: 'summarize', label: 'Summarize' }
];

function showCalcTab(id) {
  var hero = document.querySelector('#page-calc .calc-hero'), results = calcEl('calc-results');
  if (hero) hero.style.display = id === 'calc' ? '' : 'none';
  if (results) results.style.display = id === 'calc' ? '' : 'none';
  CALC_TABS.forEach(function(t) {
    var btn = calcEl('calcTab-' + t.id), panel = calcEl('calcPanel-' + t.id);
    if (btn) btn.classList.toggle('active', t.id === id);
    if (panel) panel.style.display = t.id === id ? '' : 'none';
  });
  // Start the planner from the subnet last calculated
  if (id === 'vlsm' && !pVal('vlsmBase').trim() && window._calcLast) {
    calcEl('vlsmBase').value = window._calcLast.network + '/' + window._calcLast.prefix;
    vlsmRun();
  }
}

// Load a subnet into the main calculator
function calcOpenCidr(cidr) {
  showCalcTab('calc');
  calcQuick(cidr);
}

// ── VLSM planner ─────────────────────────────────────────────
var VLSM_EXAMPLE = 'Users 100\nServers 30\nVoIP 50\nPrinters 10\nWAN link 2';

function vlsmPanel() {
  return '<div class="plan-title">VLSM Subnet Planner</div>' +
    '<div class="plan-sub">Enter a network block and the subnets you need. Each one gets the smallest subnet that fits, largest first, with no gaps or overlaps.</div>' +
    '<div class="plan-row"><label class="plan-f"><span>Network block</span>' +
    '<input id="vlsmBase" class="calc-field" type="text" placeholder="e.g. 10.0.0.0/22" autocomplete="off" spellcheck="false"/></label>' +
    '<label class="plan-chk"><input type="checkbox" id="vlsmP2P"/> Use /31 for 2-host links</label></div>' +
    '<label class="plan-f"><span>Subnets needed (one per line: name, then number of hosts)</span>' +
    '<textarea id="vlsmReq" class="calc-field" rows="6" maxlength="' + MAX_PASTE_CHARS + '" spellcheck="false" placeholder="Users 100&#10;Servers 30&#10;Printers 10"></textarea></label>' +
    '<div class="calc-examples"><span class="calc-ex-lbl">Example:</span>' +
    '<span class="calc-chip" onclick="vlsmExample()">Fill in a sample plan</span></div>' +
    '<div class="plan-tip"><b>Tips:</b> Host counts are usable hosts, so 100 hosts becomes a /25 (126 usable). Add room for growth. ' +
    'Click a subnet to open it in the calculator, or DHCP to generate a Windows DHCP scope for it.</div>' +
    '<div id="vlsmOut"></div>';
}

function vlsmExample() {
  calcEl('vlsmBase').value = '10.0.0.0/22';
  calcEl('vlsmReq').value = VLSM_EXAMPLE;
  vlsmRun();
}

function vlsmRun() {
  var out = calcEl('vlsmOut');
  if (!out) return;
  _plan.vlsm = null;
  var baseText = pVal('vlsmBase').trim(), reqText = pVal('vlsmReq').trim();
  if (!baseText || !reqText) { out.innerHTML = ''; return; }

  var base = parseBlock(baseText);
  if (base.error) { out.innerHTML = msgList([base.error], 'calc-msg-err', '&#10007;'); return; }
  var reqs = parseRequirements(reqText);
  if (!reqs.items.length) { out.innerHTML = msgList(reqs.errors, 'calc-msg-err', '&#10007;'); return; }

  var plan = planVlsm(base, reqs.items, calcEl('vlsmP2P').checked);
  _plan.vlsm = { base: base, plan: plan };

  var pct = plan.total ? (plan.used / plan.total * 100) : 0;
  var html = msgList(reqs.errors, 'calc-msg-err', '&#10007;');
  if (base.hostBitsSet) html += msgList(['Host bits were set in the base block, using ' + base.cidr + '.'], 'calc-msg-warn', '&#9888;');
  plan.unfit.forEach(function(u) {
    html += '<div class="calc-msg-err">&#10007; ' + h(u.item.name) + ' (' + u.item.hosts + ' hosts) does not fit: ' + h(u.reason) + '.</div>';
  });

  html += '<div class="plan-summary"><b>' + formatNumber(plan.used) + '</b> of <b>' + formatNumber(plan.total) + '</b> addresses allocated in ' +
    h(base.cidr) + ' (' + pct.toFixed(1) + '%) &nbsp;&middot;&nbsp; ' + plan.rows.length + ' subnet' + (plan.rows.length === 1 ? '' : 's');
  if (plan.free.length) {
    html += '<div class="plan-free">Free space: ' + plan.free.map(function(f) {
      return '<span class="calc-chip" onclick="calcOpenCidr(\'' + f.cidr + '\')" title="Open in calculator">' + f.cidr + '</span>';
    }).join(' ') + '</div>';
  }
  html += '</div>';

  if (plan.rows.length) {
    html += '<div class="plan-table-wrap"><table class="dt"><thead><tr><th>Name</th><th>Hosts needed</th><th>Subnet</th><th>Mask</th><th>Usable</th><th>Host range</th><th></th></tr></thead><tbody>';
    plan.rows.forEach(function(r, i) {
      html += '<tr><td>' + h(r.name) + '</td><td class="cd">' + formatNumber(r.hosts) + '</td>' +
        '<td class="cb plan-link" onclick="calcOpenCidr(\'' + r.cidr + '\')" title="Open in calculator">' + r.cidr + '</td>' +
        '<td class="cd">' + r.mask + '</td><td class="cm">' + formatNumber(r.usable) + '</td>' +
        '<td class="cd">' + r.first + ' - ' + r.last + '</td>' +
        '<td>' + (r.prefix <= 30 ? '<button class="plan-mini" onclick="vlsmDhcp(' + i + ')">DHCP</button>' : '') + '</td></tr>';
    });
    html += '</tbody></table></div>' + exportBar('vlsm');
  }
  out.innerHTML = html;
}

function vlsmDhcp(i) {
  var row = _plan.vlsm && _plan.vlsm.plan.rows[i];
  if (row) dhcpOpenFor(long2ip(row.network), row.prefix, row.name);
}

function vlsmRows() {
  var p = _plan.vlsm.plan;
  var rows = [['Name', 'Hosts Needed', 'Subnet', 'Mask', 'Usable Hosts', 'First Host', 'Last Host', 'Broadcast']];
  p.rows.forEach(function(r) { rows.push([r.name, r.hosts, r.cidr, r.mask, r.usable, r.first, r.last, r.broadcast]); });
  p.unfit.forEach(function(u) { rows.push([u.item.name, u.item.hosts, 'NOT ALLOCATED', u.reason, '', '', '', '']); });
  p.free.forEach(function(f) { rows.push(['(free)', '', f.cidr, '', '', '', '', '']); });
  return rows;
}

// ── Overlap checker ──────────────────────────────────────────
function overlapPanel() {
  return '<div class="plan-title">Overlap Checker</div>' +
    '<div class="plan-sub">Paste a list of subnets (one per line, or separated by commas). Finds duplicates and subnets that contain each other. Masks work too, e.g. 10.0.0.0 255.255.0.0. Use # for comments.</div>' +
    '<label class="plan-f"><span>Subnets</span><textarea id="overlapIn" class="calc-field" rows="7" maxlength="' + MAX_PASTE_CHARS + '" spellcheck="false" placeholder="10.0.0.0/16&#10;10.0.5.0/24&#10;192.168.1.0/24"></textarea></label>' +
    '<div class="plan-tip"><b>Tips:</b> Run this before adding a new VLAN or VPN subnet, or to audit a firewall or routing list. ' +
    'You can paste a column straight from a spreadsheet.</div>' +
    '<div id="overlapOut"></div>';
}

function overlapRun() {
  var out = calcEl('overlapOut');
  if (!out) return;
  _plan.overlap = null;
  var text = pVal('overlapIn').trim();
  if (!text) { out.innerHTML = ''; return; }

  var parsed = parseBlocks(text);
  var html = msgList(parsed.errors, 'calc-msg-err', '&#10007;') + msgList(parsed.warnings, 'calc-msg-warn', '&#9888;');
  if (parsed.blocks.length > MAX_OVERLAP_ENTRIES) {
    out.innerHTML = html + msgList(['Too many entries (' + parsed.blocks.length + '). The limit is ' + MAX_OVERLAP_ENTRIES + '.'], 'calc-msg-err', '&#10007;');
    return;
  }
  var result = findOverlaps(parsed.blocks), found = result.found;
  _plan.overlap = { found: found, count: parsed.blocks.length };

  if (!found.length) {
    html += '<div class="plan-ok">&#10003; No overlaps found in ' + parsed.blocks.length + ' subnet' + (parsed.blocks.length === 1 ? '' : 's') + '.</div>';
  } else {
    html += '<div class="plan-summary"><b>' + found.length + (result.truncated ? '+' : '') + '</b> overlap' + (found.length === 1 ? '' : 's') + ' found in ' + parsed.blocks.length + ' subnets.' +
      (result.truncated ? ' Showing the first ' + found.length + '.' : '') + '</div>';
    html += '<div class="plan-table-wrap"><table class="dt"><thead><tr><th>Problem</th><th>Block</th><th>Other block</th></tr></thead><tbody>';
    found.forEach(function(f) {
      html += '<tr><td>' + (f.type === 'duplicate' ? pill('Duplicate', 'p-red') : pill('Contains', 'p-yellow')) + '</td>' +
        '<td class="cb">' + f.a.cidr + ' <span class="cd">(line ' + f.a.line + ')</span></td>' +
        '<td class="cb">' + f.b.cidr + ' <span class="cd">(line ' + f.b.line + ')</span></td></tr>';
    });
    html += '</tbody></table></div>' + exportBar('overlap');
  }
  out.innerHTML = html;
}

function overlapRows() {
  var rows = [['Problem', 'Block', 'Block Line', 'Other Block', 'Other Block Line']];
  _plan.overlap.found.forEach(function(f) {
    rows.push([f.type === 'duplicate' ? 'Duplicate' : 'Contains', f.a.cidr, f.a.line, f.b.cidr, f.b.line]);
  });
  return rows;
}

// ── Summarize / merge ────────────────────────────────────────
function summarizePanel() {
  return '<div class="plan-title">Summarize / Merge</div>' +
    '<div class="plan-sub">Paste subnets and get the smallest list of routes that covers exactly the same addresses. Overlapping and adjacent subnets are merged, for example two neighboring /24s become one /23.</div>' +
    '<label class="plan-f"><span>Subnets</span><textarea id="summarizeIn" class="calc-field" rows="7" maxlength="' + MAX_PASTE_CHARS + '" spellcheck="false" placeholder="10.0.0.0/24&#10;10.0.1.0/24&#10;10.0.2.0/24&#10;10.0.3.0/24"></textarea></label>' +
    '<div class="plan-tip"><b>Tips:</b> Use the result to shorten route tables, firewall rules and ACLs. Only subnets that line up on a boundary are merged, ' +
    'so the result never covers addresses you did not list.</div>' +
    '<div id="summarizeOut"></div>';
}

function summarizeRun() {
  var out = calcEl('summarizeOut');
  if (!out) return;
  _plan.summarize = null;
  var text = pVal('summarizeIn').trim();
  if (!text) { out.innerHTML = ''; return; }

  var parsed = parseBlocks(text);
  var html = msgList(parsed.errors, 'calc-msg-err', '&#10007;') + msgList(parsed.warnings, 'calc-msg-warn', '&#9888;');
  if (parsed.blocks.length > MAX_SUMMARY_ENTRIES) {
    out.innerHTML = html + msgList(['Too many entries (' + parsed.blocks.length + '). The limit is ' + MAX_SUMMARY_ENTRIES + '.'], 'calc-msg-err', '&#10007;');
    return;
  }
  if (!parsed.blocks.length) { out.innerHTML = html; return; }

  var res = summarizeBlocks(parsed.blocks);
  _plan.summarize = res;

  html += '<div class="plan-summary"><b>' + parsed.blocks.length + '</b> subnet' + (parsed.blocks.length === 1 ? '' : 's') +
    ' &rarr; <b>' + res.cidrs.length + '</b> route' + (res.cidrs.length === 1 ? '' : 's') +
    ' &nbsp;&middot;&nbsp; ' + formatNumber(res.addresses) + ' addresses';
  if (res.single && res.cidrs.length > 1) {
    html += '<div class="plan-free">One block <span class="calc-chip" onclick="calcOpenCidr(\'' + res.single.cidr + '\')">' + res.single.cidr +
      '</span> would cover everything but also includes ' + formatNumber(res.single.extra) + ' addresses you did not list.</div>';
  }
  html += '</div>';

  html += '<div class="plan-table-wrap"><table class="dt"><thead><tr><th>Route</th><th>Mask</th><th>Range</th><th>Addresses</th></tr></thead><tbody>';
  res.cidrs.slice(0, MAX_SUMMARY_ROWS).forEach(function(c) {
    var size = Math.pow(2, 32 - c.prefix);
    html += '<tr><td class="cb plan-link" onclick="calcOpenCidr(\'' + c.cidr + '\')" title="Open in calculator">' + c.cidr + '</td>' +
      '<td class="cd">' + long2ip(prefixToMaskLong(c.prefix)) + '</td>' +
      '<td class="cd">' + long2ip(c.network) + ' - ' + long2ip(c.network + size - 1) + '</td>' +
      '<td class="cm">' + formatNumber(size) + '</td></tr>';
  });
  html += '</tbody></table></div>';
  if (res.cidrs.length > MAX_SUMMARY_ROWS) {
    html += msgList(['Showing the first ' + MAX_SUMMARY_ROWS + ' of ' + res.cidrs.length + ' routes. Downloads include all of them.'], 'calc-msg-warn', '&#9888;');
  }
  html += exportBar('summarize', 'Copy routes');
  out.innerHTML = html;
}

function summarizeRows() {
  var rows = [['Route', 'Mask', 'First Address', 'Last Address', 'Addresses']];
  _plan.summarize.cidrs.forEach(function(c) {
    var size = Math.pow(2, 32 - c.prefix);
    rows.push([c.cidr, long2ip(prefixToMaskLong(c.prefix)), long2ip(c.network), long2ip(c.network + size - 1), size]);
  });
  return rows;
}

// ── Export for the three tools ───────────────────────────────
var PLAN_EXPORT = {
  vlsm:      { rows: vlsmRows,      file: 'vlsm-plan',         list: null },
  overlap:   { rows: overlapRows,   file: 'overlap-report',   list: null },
  summarize: { rows: summarizeRows, file: 'summarized-routes', list: function() { return _plan.summarize.cidrs.map(function(c) { return c.cidr; }).join('\r\n'); } }
};

function planExport(tool, kind, btn) {
  var def = PLAN_EXPORT[tool];
  if (!def || !_plan[tool]) return;
  var rows = def.rows();
  if (kind === 'csv') downloadText(def.file + '.csv', toCsv(rows), 'text/csv');
  else if (kind === 'txt') downloadText(def.file + '.txt', toTextTable(rows));
  else if (kind === 'copy') copyText(def.list ? def.list() : toTextTable(rows), btn);
}

// ── Export for the main calculator result ────────────────────
function renderCalcExportBar(r) {
  var opts = '<option value="0">Subnet details only</option>';
  for (var p = r.prefix + 1; p <= Math.min(30, r.prefix + 12); p++) {
    opts += '<option value="' + p + '">+ every /' + p + ' subnet (' + formatNumber(Math.pow(2, p - r.prefix)) + ')</option>';
  }
  window._calcExportCtx = r;
  return '<div class="dhcp-cta"><div><div class="dhcp-cta-t">Export</div>' +
    '<div class="dhcp-cta-s">Download these results as CSV or text.</div></div>' +
    '<div class="plan-export"><select id="calcExportSplit" class="calc-field plan-sel">' + opts + '</select>' +
    '<button class="calc-btn calc-btn-sec" onclick="calcExportMain(\'csv\')">CSV</button>' +
    '<button class="calc-btn calc-btn-sec" onclick="calcExportMain(\'txt\')">.txt</button></div></div>';
}

function calcExportMain(kind) {
  var r = window._calcExportCtx;
  if (!r) return;
  var ex = buildSubnetExport(r, parseInt(pVal('calcExportSplit'), 10) || 0);
  var name = 'subnet-' + r.network + '-' + r.prefix;
  if (kind === 'csv') {
    downloadText(name + '.csv', toCsv(ex.splits ? ex.details.concat([[]], ex.splits) : ex.details), 'text/csv');
  } else {
    downloadText(name + '.txt', toTextTable(ex.details) + (ex.splits ? '\r\n' + toTextTable(ex.splits) : ''));
  }
}

// ── Setup ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  var tabs = calcEl('calcTabs'), host = calcEl('calcToolPanels');
  if (!tabs || !host) return;

  tabs.innerHTML = CALC_TABS.map(function(t) {
    return '<button class="calc-tab' + (t.id === 'calc' ? ' active' : '') + '" id="calcTab-' + t.id + '" onclick="showCalcTab(\'' + t.id + '\')">' + t.label + '</button>';
  }).join('');

  var panels = { vlsm: vlsmPanel(), overlap: overlapPanel(), summarize: summarizePanel() };
  host.innerHTML = Object.keys(panels).map(function(id) {
    return '<div class="plan-panel" id="calcPanel-' + id + '" style="display:none">' + panels[id] + '</div>';
  }).join('');

  var vlsm = debounced(vlsmRun), overlap = debounced(overlapRun), summarize = debounced(summarizeRun);
  ['vlsmBase', 'vlsmReq'].forEach(function(id) { calcEl(id).addEventListener('input', vlsm); });
  calcEl('vlsmP2P').addEventListener('change', vlsmRun);
  calcEl('overlapIn').addEventListener('input', overlap);
  calcEl('summarizeIn').addEventListener('input', summarize);
});
