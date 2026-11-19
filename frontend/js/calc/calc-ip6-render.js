// NetRecon - IPv6 calculator rendering
// Shows the result for an IPv6 block using the same look as the IPv4 results.
// Maths is in calc-ip6.js. runCalc() in calc.js hands IPv6 input to runCalc6() below.
'use strict';

// ── Entry point (called from runCalc) ────────────────────────
function runCalc6(raw, silent, out) {
  var s = raw.trim();
  window._calcLast = null;      // the IPv4 result is gone, so the planner must not reuse it
  // Just a prefix such as "/64": explain it, no address needed
  var only = s.match(/^\/(\d{2,3})$/);
  if (only) {
    var bare = parseInt(only[1], 10);
    if (bare > 128) {
      if (!silent) out.innerHTML = '<div class="calc-error">\u2715 ' + h('Invalid prefix /' + bare + ' (must be 0\u2013128)') + '</div>';
      return;
    }
    if (!silent) trackUsage('calc', raw);
    window._calc6Last = s;
    renderPrefix6Info(bare, out);
    return;
  }
  var p = ip6ParseInput(raw);
  if (p.error) {
    if (silent) return;
    out.innerHTML = '<div class="calc-error">\u2715 ' + h(p.error) + '</div>';   // may echo user input, so escape
    return;
  }
  if (!silent) trackUsage('calc', raw);
  window._calc6Last = s;
  renderCalc6Results(ip6Build(p.ip, p.prefix, raw), out);
}

// One copyable value in the details grid
function calc6Cell(label, value, accent, copy) {
  return '<div class="cidr-cell copyable" data-copy="' + h(copy === undefined ? value : copy) + '" title="Click to copy">' +
    '<div class="cidr-lbl">' + label + '</div>' +
    '<div class="cidr-val' + (accent ? ' accent' : '') + '" style="word-break:break-all">' + h(value) + '</div></div>';
}

// A titled box like the Binary / Supernet / Split boxes in the IPv4 result
function calc6Section(iconHtml, title, sub, body) {
  return '<div class="cidr-inner" style="animation:fu .22s ease both"><div class="cidr-inner-hdr">' + iconHtml +
    '<div class="cidr-inner-title">' + title + '</div>' +
    '<span style="font-size:11px;color:var(--text-3);margin-left:4px">' + sub + '</span></div>' + body + '</div>';
}

// Number of /64 networks in a block (a /64 is the standard size of one LAN)
function calc6SubnetCount(prefix) {
  return prefix <= 64 ? ip6Size(64 - prefix) : null;
}

// ── Full result ──────────────────────────────────────────────
function renderCalc6Results(r, container) {
  var html = '<div class="cidr-summary"><div class="cidr-banner"><div>';
  html += '<div class="cidr-network" style="word-break:break-all">' + h(r.netStr) + '/' + r.prefix + '</div>';
  html += '<div class="cidr-desc">IPv6 &nbsp;&middot;&nbsp; ' + h(r.size) + ' addresses' + (r.use ? ' &nbsp;&middot;&nbsp; ' + h(r.use) : '') + '</div>';
  html += '</div>' + pill(r.type.label, r.type.cls) + '</div><div class="cidr-grid">';
  html += calc6Cell('Network Address', r.netStr, true);
  html += calc6Cell('Prefix Length', '/' + r.prefix, false);
  html += calc6Cell('First Address', r.firstStr, true);
  html += calc6Cell('Last Address', r.lastStr, true);
  html += calc6Cell('Total Addresses', r.size, false, String(IP6_B(1) << IP6_B(r.hostBits)));
  var n64 = calc6SubnetCount(r.prefix);
  if (n64) html += calc6Cell('/64 Networks', n64, false, String(IP6_B(1) << IP6_B(64 - r.prefix)));
  html += calc6Cell('Expanded Form', r.expanded, false);
  html += calc6Cell('Address Type', r.type.label, false);
  if (r.reverse) html += calc6Cell('Reverse DNS Zone', r.reverse, false);
  html += '</div></div>';
  html += renderCalc6ExportBar(r);
  // Hex view with the network part and the host part marked
  var icon = '<div class="ch-ico" style="background:var(--ico-blue);color:var(--blue);font-family:\'DM Mono\',monospace;font-size:10px;font-weight:700">0x</div>';
  html += calc6Section(icon, 'Address Layout', '/' + r.prefix + ' network \u00b7 ' + r.hostBits + ' host bits',
    '<div class="bit-display">' + renderHex6Row('Network', r.network, r.prefix) + renderHex6Row('Last', r.last, r.prefix) +
    '<div class="v6-key"><span class="bit-b one v6-sw"></span> network part <span class="bit-b zero v6-sw"></span> host part' +
    (r.prefix % 4 ? ' <span class="bit-b v6-mix v6-sw"></span> digit shared by both' : '') + '</div></div>');
  // Supernets
  var sup = ip6Supernets(r);
  if (sup.length) {
    var sIcon = '<div class="ch-ico" style="background:var(--ico-purple);color:var(--purple)"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5" stroke="currentColor" stroke-width="1.3"/><path d="M4 6h4M6 4v4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg></div>';
    html += calc6Section(sIcon, 'Supernet Summary', 'parent blocks containing /' + r.prefix, '<div class="card-body">' + renderSupernets6(r, sup) + '</div>');
  }
  // Splits
  var splits = ip6SplitPrefixes(r.prefix);
  if (splits.length) {
    var pIcon = '<div class="ch-ico" style="background:var(--ico-green);color:var(--green)"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5" stroke="currentColor" stroke-width="1.3"/><circle cx="6" cy="6" r="2" fill="currentColor"/></svg></div>';
    html += calc6Section(pIcon, 'Subnet Split Options', 'Click row to expand', '<div class="card-body">' + renderSplit6(r, splits) + '</div>');
  }
  container.innerHTML = '<div class="calc-results">' + html + '</div>';
}

// Eight groups of four hex digits. Each digit is marked network, host, or shared when the prefix cuts through it.
function renderHex6Row(label, value, prefix) {
  var hex = ip6Expand(value).replace(/:/g, '');
  var groups = '';
  for (var g = 0; g < 8; g++) {
    var digits = '';
    for (var d = 0; d < 4; d++) {
      var i = g * 4 + d;                       // digit number 0..31, each digit is 4 bits
      var cls = (i + 1) * 4 <= prefix ? 'one' : i * 4 >= prefix ? 'zero' : 'v6-mix';
      digits += '<span class="bit-b ' + cls + ' v6-d">' + hex.charAt(i) + '</span>';
    }
    groups += '<span class="bit-octet">' + digits + '</span>';
  }
  return '<div class="bit-row"><div class="bit-label">' + label + '</div><div class="bit-segments">' + groups + '</div></div>';
}

function renderSupernets6(r, sup) {
  var html = '<table class="dt"><thead><tr><th>Supernet</th><th>Contains</th><th>Your /' + r.prefix + ' is</th></tr></thead><tbody>';
  sup.forEach(function(s) {
    html += '<tr class="supernet-row" style="cursor:pointer" onclick="calcQuick(\'' + s.cidr + '\')" title="Click to calculate ' + s.cidr + '">' +
      '<td>' + pill('/' + s.prefix, 'p-purple') + ' <span class="cd">' + h(s.network) + '</span></td>' +
      '<td class="cd">' + ip6Group(s.holds) + ' /' + r.prefix + ' blocks</td>' +
      '<td class="cd">block ' + ip6Group(s.slot) + ' of ' + ip6Group(s.holds) + '</td></tr>';
  });
  return html + '</tbody></table><div style="font-size:11px;color:var(--text-3);padding:8px 18px">Click any row to calculate that supernet</div>';
}

// Same layout as the IPv4 split table: a summary row, then a hidden row with example subnets
function renderSplit6(r, prefixes) {
  var html = '<table class="dt"><thead><tr><th>Prefix</th><th>Subnets</th><th>Addresses / Subnet</th><th>First Subnet</th><th style="width:20px"></th></tr></thead><tbody>';
  prefixes.forEach(function(p, idx) {
    var sp = ip6Split(r, p, 8);
    var id = 'split6-' + idx;
    html += '<tr class="split-row" onclick="toggleSplitDetail(\'' + id + '\', this)">' +
      '<td>' + pill('/' + p, 'p-blue') + (ip6Use(p) ? ' <span class="cd">' + h(ip6Use(p).split('.')[0]) + '</span>' : '') + '</td>' +
      '<td class="cd">' + h(ip6Group(sp.count)) + '</td>' +
      '<td class="cd">' + h(ip6Size(128 - p)) + '</td>' +
      '<td class="cd">' + h(sp.rows[0].cidr) + '</td>' +
      '<td><svg width="12" height="12" viewBox="0 0 12 12" fill="none" style="transition:transform .18s"><path d="M2 4l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></td></tr>';
    html += '<tr class="split-detail" id="' + id + '"><td colspan="5" style="padding:0;background:var(--bg)"><table class="dt" style="width:100%"><tbody>' +
      '<tr style="background:var(--bg)"><td colspan="3" style="padding:8px 18px 4px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3)">' +
      'Example Subnets &nbsp;&middot;&nbsp; /' + p + ' split of ' + h(r.netStr) + '/' + r.prefix + '</td></tr>' +
      '<tr><th style="font-size:10px;background:var(--bg)">Subnet</th><th style="font-size:10px;background:var(--bg)">First Address</th><th style="font-size:10px;background:var(--bg)">Last Address</th></tr>';
    sp.rows.forEach(function(row) {
      html += '<tr style="background:var(--bg)"><td class="cb">' + h(row.cidr) + '</td><td class="cd">' + h(row.first) + '</td><td class="cd">' + h(row.last) + '</td></tr>';
    });
    if (sp.count > IP6_B(sp.rows.length)) {
      html += '<tr style="background:var(--bg)"><td colspan="3" class="cd" style="font-style:italic">\u2026and ' + h(ip6Group(sp.count - IP6_B(sp.rows.length))) + ' more subnets</td></tr>';
    }
    html += '</tbody></table></td></tr>';
  });
  return html + '</tbody></table>';
}

// ── "/64" on its own ─────────────────────────────────────────
function renderPrefix6Info(prefix, container) {
  var host = 128 - prefix, n64 = calc6SubnetCount(prefix), use = ip6Use(prefix);
  var cells = calc6Cell('Prefix Length', '/' + prefix, true) +
    calc6Cell('Total Addresses', ip6Size(host), true, String(IP6_B(1) << IP6_B(host))) +
    calc6Cell('Network Bits', String(prefix), false) +
    calc6Cell('Host Bits', String(host), false) +
    (n64 ? calc6Cell('/64 Networks', n64, false, String(IP6_B(1) << IP6_B(64 - prefix))) : '');
  container.innerHTML = '<div class="calc-results"><div class="cidr-summary"><div class="cidr-banner"><div>' +
    '<div class="cidr-network">/' + prefix + '</div>' +
    '<div class="cidr-desc">IPv6 &nbsp;&middot;&nbsp; ' + h(ip6Size(host)) + ' addresses' + (use ? ' &nbsp;&middot;&nbsp; ' + h(use) : '') + '</div>' +
    '</div></div><div class="cidr-grid">' + cells + '</div></div></div>';
}

// ── Export (CSV / text) ──────────────────────────────────────
function renderCalc6ExportBar(r) {
  var opts = '<option value="0">Block details only</option>';
  ip6SplitPrefixes(r.prefix).slice(0, 3).forEach(function(p) {     // +4, +8, +12 bits: up to 4096 rows
    opts += '<option value="' + p + '">+ every /' + p + ' subnet (' + ip6Group(IP6_B(1) << IP6_B(p - r.prefix)) + ')</option>';
  });
  window._calc6ExportCtx = r;
  return '<div class="dhcp-cta"><div><div class="dhcp-cta-t">Export</div>' +
    '<div class="dhcp-cta-s">Download these results as CSV or text.</div></div>' +
    '<div class="plan-export"><select id="calc6ExportSplit" class="calc-field plan-sel">' + opts + '</select>' +
    '<button class="calc-btn calc-btn-sec" onclick="calc6Export(\'csv\')">CSV</button>' +
    '<button class="calc-btn calc-btn-sec" onclick="calc6Export(\'txt\')">.txt</button></div></div>';
}

function calc6Export(kind) {
  var r = window._calc6ExportCtx;
  if (!r) return;
  var details = [['Field', 'Value'],
    ['Network', r.netStr + '/' + r.prefix], ['Expanded', r.expanded], ['Prefix length', '/' + r.prefix],
    ['First address', r.firstStr], ['Last address', r.lastStr], ['Total addresses', String(IP6_B(1) << IP6_B(r.hostBits))],
    ['Type', r.type.label]];
  if (r.reverse) details.push(['Reverse DNS zone', r.reverse]);
  var sel = calcEl('calc6ExportSplit');
  var p = sel ? parseInt(sel.value, 10) || 0 : 0;
  var splits = null;
  if (p) {
    splits = [['Subnet', 'First address', 'Last address']];
    ip6Split(r, p, 4096).rows.forEach(function(row) { splits.push([row.cidr, row.first, row.last]); });
  }
  var name = 'subnet-' + r.netStr.replace(/:+/g, '-').replace(/-$/, '') + '-' + r.prefix;
  if (kind === 'csv') downloadText(name + '.csv', toCsv(splits ? details.concat([[]], splits) : details), 'text/csv');
  else downloadText(name + '.txt', toTextTable(details) + (splits ? '\r\n' + toTextTable(splits) : ''));
}
