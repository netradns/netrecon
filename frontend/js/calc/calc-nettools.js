// NetRecon — IP Calculator: planning logic and export helpers
// Pure functions (no DOM) for VLSM planning, overlap detection, route summarization and CSV/text export.
// Depends on ip2long / long2ip / getUsable (core/utils.js) and parseCalcInput (calc.js).

'use strict';

// ── CIDR helpers ─────────────────────────────────────────────

// Parse "10.0.0.0/24", "10.0.0.0 255.255.255.0", etc. into a normalized block.
// Returns { network, prefix, end, cidr, hostBitsSet } or { error }.
function parseBlock(text) {
  var p = parseCalcInput(text);
  if (p.error) return { error: p.error };
  var network = (ip2long(p.ip) & prefixToMaskLong(p.prefix)) >>> 0;
  return {
    network:     network,
    prefix:      p.prefix,
    end:         network + Math.pow(2, 32 - p.prefix) - 1,
    cidr:        long2ip(network) + '/' + p.prefix,
    hostBitsSet: ip2long(p.ip) !== network
  };
}

// Split pasted text into entries. Separators are new lines, commas and semicolons.
// "#" starts a comment. Returns [{ text, line }].
function splitEntries(text) {
  var out = [];
  String(text).split(/\r?\n/).forEach(function(line, i) {
    line.replace(/#.*$/, '').split(/[,;]+/).forEach(function(part) {
      part = part.trim();
      if (part) out.push({ text: part, line: i + 1 });
    });
  });
  return out;
}

// Parse every entry. Returns { blocks: [...], errors: ['line 3: ...'], warnings: [...] }.
function parseBlocks(text) {
  var res = { blocks: [], errors: [], warnings: [] };
  splitEntries(text).forEach(function(e) {
    var b = parseBlock(e.text);
    if (b.error) { res.errors.push('Line ' + e.line + ' "' + e.text + '": ' + b.error); return; }
    b.line = e.line;
    b.input = e.text;
    if (b.hostBitsSet) res.warnings.push('Line ' + e.line + ': "' + e.text + '" has host bits set, using ' + b.cidr + '.');
    res.blocks.push(b);
  });
  return res;
}

// Minimal list of CIDR blocks covering the inclusive range [start, end].
function rangeToCidrs(start, end) {
  var out = [];
  while (start <= end) {
    var p = 0;
    // Largest aligned block that starts at `start` and stays inside the range
    while (p < 32 && (start % Math.pow(2, 32 - p) !== 0 || start + Math.pow(2, 32 - p) - 1 > end)) p++;
    out.push({ network: start, prefix: p, cidr: long2ip(start) + '/' + p });
    start += Math.pow(2, 32 - p);
  }
  return out;
}

// ── VLSM planner ─────────────────────────────────────────────

// Smallest prefix with at least `hosts` usable addresses (null if impossible).
function prefixForHosts(hosts, useP2P) {
  if (useP2P && hosts === 2) return 31;
  for (var p = 30; p >= 0; p--) if (getUsable(p) >= hosts) return p;
  return null;
}

// Limits that keep a huge paste from freezing the page
var MAX_REQUIREMENTS = 500;
var MAX_LINE_LENGTH  = 200;

// Parse "Name 100", "Name, 100", "Name: 100" or just "100".
// Returns { items: [{ name, hosts, order }], errors: [...] }.
function parseRequirements(text) {
  var out = { items: [], errors: [] };
  String(text).split(/\r?\n/).forEach(function(line, i) {
    line = line.replace(/#.*$/, '').trim();
    if (!line) return;
    if (line.length > MAX_LINE_LENGTH) { out.errors.push('Line ' + (i + 1) + ' is too long.'); return; }
    if (out.items.length >= MAX_REQUIREMENTS) {
      if (!out.capped) out.errors.push('Only the first ' + MAX_REQUIREMENTS + ' subnets are planned.');
      out.capped = true;
      return;
    }
    var m = line.match(/^(.*?)[\s,:=]+(\d+)$/) || line.match(/^()(\d+)$/);
    if (!m) { out.errors.push('Line ' + (i + 1) + ' "' + line + '": expected a name and a host count, e.g. Users 100'); return; }
    var hosts = parseInt(m[2], 10);
    if (hosts < 1) { out.errors.push('Line ' + (i + 1) + ': host count must be at least 1.'); return; }
    out.items.push({ name: m[1].trim() || 'Subnet ' + (out.items.length + 1), hosts: hosts, order: out.items.length });
  });
  return out;
}

// Allocate subnets from `base` (a parseBlock result), largest first so everything stays aligned.
function planVlsm(base, items, useP2P) {
  var plan = { rows: [], unfit: [], free: [], used: 0, total: Math.pow(2, 32 - base.prefix) };
  var cursor = base.network;

  items.slice().sort(function(a, b) { return b.hosts - a.hosts || a.order - b.order; }).forEach(function(it) {
    var prefix = prefixForHosts(it.hosts, useP2P);
    if (prefix === null) { plan.unfit.push({ item: it, reason: 'needs more than a /0 can hold' }); return; }
    if (prefix < base.prefix) { plan.unfit.push({ item: it, reason: 'needs a /' + prefix + ', larger than the base block' }); return; }
    var size = Math.pow(2, 32 - prefix);
    if (cursor + size - 1 > base.end) { plan.unfit.push({ item: it, reason: 'not enough space left in ' + base.cidr }); return; }
    var net = cursor, bc = net + size - 1;
    plan.rows.push({
      name: it.name, hosts: it.hosts, prefix: prefix, network: net,
      cidr: long2ip(net) + '/' + prefix, mask: long2ip(prefixToMaskLong(prefix)),
      usable: getUsable(prefix), size: size,
      first: long2ip(prefix >= 31 ? net : net + 1), last: long2ip(prefix >= 31 ? bc : bc - 1),
      broadcast: long2ip(bc)
    });
    cursor += size;
    plan.used += size;
  });

  if (cursor <= base.end) plan.free = rangeToCidrs(cursor, base.end);
  return plan;
}

// ── Overlap detection ────────────────────────────────────────

var MAX_OVERLAPS = 1000;

// Compare every pair of blocks (fine for a few thousand). Two CIDR blocks either do not touch or one
// contains the other. Returns { found: [{ type: 'duplicate'|'contains', a, b }], truncated }
// where `a` is the larger block. Stops after MAX_OVERLAPS so a pathological list cannot flood the page.
function findOverlaps(blocks) {
  var found = [];
  for (var i = 0; i < blocks.length; i++) {
    for (var j = i + 1; j < blocks.length; j++) {
      var a = blocks[i], b = blocks[j];
      if (a.end < b.network || b.end < a.network) continue;      // disjoint
      if (found.length >= MAX_OVERLAPS) return { found: found, truncated: true };
      if (a.network === b.network && a.prefix === b.prefix) found.push({ type: 'duplicate', a: a, b: b });
      else if (a.prefix <= b.prefix) found.push({ type: 'contains', a: a, b: b });
      else found.push({ type: 'contains', a: b, b: a });
    }
  }
  return { found: found, truncated: false };
}

// ── Summarization ────────────────────────────────────────────

// Merge overlapping or adjacent blocks, then return the minimal CIDR list covering exactly the same addresses.
function summarizeBlocks(blocks) {
  var sorted = blocks.slice().sort(function(a, b) { return a.network - b.network || a.end - b.end; });
  var merged = [];
  sorted.forEach(function(b) {
    var last = merged[merged.length - 1];
    if (last && b.network <= last.end + 1) last.end = Math.max(last.end, b.end);
    else merged.push({ network: b.network, end: b.end });
  });
  var cidrs = [], addresses = 0;
  merged.forEach(function(m) {
    addresses += m.end - m.network + 1;
    rangeToCidrs(m.network, m.end).forEach(function(c) { cidrs.push(c); });
  });

  // Single block covering everything, and how many extra addresses it drags in
  var single = null;
  if (merged.length) {
    var lo = merged[0].network, hi = merged[merged.length - 1].end, p = 32;
    while (p > 0 && Math.floor(lo / Math.pow(2, 32 - p)) !== Math.floor(hi / Math.pow(2, 32 - p))) p--;
    var net = Math.floor(lo / Math.pow(2, 32 - p)) * Math.pow(2, 32 - p);
    single = { cidr: long2ip(net) + '/' + p, extra: Math.pow(2, 32 - p) - addresses };
  }
  return { cidrs: cidrs, addresses: addresses, single: single };
}

// ── Export helpers ───────────────────────────────────────────

// Quote a CSV field. Also neutralizes spreadsheet formulas (=, +, -, @) in text typed by users.
function csvField(v) {
  var s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCsv(rows) {
  return rows.map(function(r) { return r.map(csvField).join(','); }).join('\r\n') + '\r\n';
}

// Fixed-width text table from rows (first row is the header)
function toTextTable(rows) {
  var widths = [];
  rows.forEach(function(r) { r.forEach(function(c, i) { widths[i] = Math.max(widths[i] || 0, String(c).length); }); });
  return rows.map(function(r) {
    return r.map(function(c, i) { return String(c).padEnd(widths[i]); }).join('  ').replace(/\s+$/, '');
  }).join('\r\n') + '\r\n';
}

function downloadText(filename, text, mime) {
  var blob = new Blob(['\uFEFF' + text], { type: (mime || 'text/plain') + ';charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function() { URL.revokeObjectURL(a.href); }, 1000);
}

function copyText(text, btn, label) {
  if (!text || !navigator.clipboard) return;
  navigator.clipboard.writeText(text).then(function() {
    if (!btn) return;
    var old = label || btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(function() { btn.textContent = old; }, 1500);
  }).catch(function() {});
}

// Rows for exporting one calculated subnet. splitPrefix (optional) adds a list of every subnet of that size.
var MAX_EXPORT_SUBNETS = 4096;
function buildSubnetExport(r, splitPrefix) {
  var details = [
    ['Field', 'Value'],
    ['Network', r.network + '/' + r.prefix],
    ['Subnet Mask', r.mask],
    ['Wildcard Mask', r.wildcard],
    ['Broadcast', r.broadcast],
    ['First Host', r.firstHost],
    ['Last Host', r.lastHost],
    ['Total Addresses', r.totalHosts],
    ['Usable Hosts', r.usableHosts],
    ['Type', r.rfc.label]
  ];
  var splits = null;
  if (splitPrefix && splitPrefix > r.prefix && splitPrefix <= 32) {
    var count = Math.min(Math.pow(2, splitPrefix - r.prefix), MAX_EXPORT_SUBNETS);
    var size = Math.pow(2, 32 - splitPrefix);
    splits = [['Subnet', 'Mask', 'First Host', 'Last Host', 'Broadcast', 'Usable Hosts']];
    for (var i = 0; i < count; i++) {
      var net = r.networkLong + i * size, bc = net + size - 1;
      splits.push([long2ip(net) + '/' + splitPrefix, long2ip(prefixToMaskLong(splitPrefix)),
        long2ip(splitPrefix >= 31 ? net : net + 1), long2ip(splitPrefix >= 31 ? bc : bc - 1), long2ip(bc), getUsable(splitPrefix)]);
    }
  }
  return { details: details, splits: splits };
}
