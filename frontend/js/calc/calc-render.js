// NetRecon — IP Calculator rendering: summary, details grid, binary view, supernets and subnet splits.

'use strict';

// Draws the full result for one subnet into the container element.
// r comes from buildCalcResult() in calc.js.
function renderCalcResults(r, container) {
  var html = '';

  // ── CIDR Summary Banner ──────────────────────────────────
  html += '<div class="cidr-summary">';
  html += '<div class="cidr-banner">';
  html += '<div>';
  html += '<div class="cidr-network">' + h(r.network) + '/' + r.prefix + '</div>';
  html += '<div class="cidr-desc">/' + r.prefix + ' = ' + h(r.mask) + ' &nbsp;&middot;&nbsp; ' + r.ipClass + ' &nbsp;·&nbsp; ' + formatNumber(r.totalHosts) + ' total IPs &nbsp;·&nbsp; ' + formatNumber(r.usableHosts) + ' usable</div>';
  html += '</div>';
  html += pill(r.rfc.label, r.rfc.cls);
  html += '</div>';

  // ── Details grid ─────────────────────────────────────────
  html += '<div class="cidr-grid">';
  [
    { label: 'Network Address',   value: r.network,                   accent: true  },
    { label: 'Broadcast Address', value: r.broadcast,                 accent: false },
    { label: 'Subnet Mask',       value: r.mask,                      accent: false },
    { label: 'Wildcard Mask',     value: r.wildcard,                  accent: false },
    { label: 'First Host',        value: r.firstHost,                 accent: true  },
    { label: 'Last Host',         value: r.lastHost,                  accent: true  },
    { label: 'Total Addresses',   value: formatNumber(r.totalHosts),  accent: false },
    { label: 'Usable Hosts',      value: formatNumber(r.usableHosts), accent: true  }
  ].forEach(function(f) {
    html += '<div class="cidr-cell copyable" data-copy="' + h(String(f.value)) + '" title="Click to copy"><div class="cidr-lbl">' + f.label + '</div>';
    html += '<div class="cidr-val' + (f.accent ? ' accent' : '') + '">' + h(String(f.value)) + '</div></div>';
  });
  html += '</div></div>';

  // ── Windows DHCP scope export ────────────────────────────
  if (typeof renderDhcpPanel === 'function') html += renderDhcpPanel(r);

  if (typeof renderCalcExportBar === 'function') html += renderCalcExportBar(r);

  // ── Binary Representation ────────────────────────────────
  html += '<div class="cidr-inner" style="animation:fu .22s ease both">';
  html += '<div class="cidr-inner-hdr">';
  // "01" icon with colored background — matches old version
  html += '<div class="ch-ico" style="background:var(--ico-blue);color:var(--blue);font-family:\'DM Mono\',monospace;font-size:10px;font-weight:700">01</div>';
  html += '<div class="cidr-inner-title">Binary Representation</div>';
  html += '<span style="font-size:11px;color:var(--text-3);margin-left:4px">/' + r.prefix + ' network · ' + (32 - r.prefix) + ' host bits</span>';
  html += '</div>';
  html += '<div class="bit-display">';
  html += renderBitRow('IP',       r.networkLong);
  html += renderBitRow('Network',  r.networkLong);
  html += renderBitRow('Mask',     r.maskLong);
  html += renderBitRow('Wildcard', r.wildcardLong);
  html += '</div></div>';

  // ── Supernet Summary ─────────────────────────────────────
  // Shows the parent networks that contain this subnet — useful for
  // route summarization, BGP aggregation, and firewall rule planning.
  // Only shown for prefixes > /8 (no supernet above /8 makes sense).
  if (r.prefix > 8) {
    html += '<div class="cidr-inner" style="animation:fu .22s ease both">';
    html += '<div class="cidr-inner-hdr">';
    html += '<div class="ch-ico" style="background:var(--ico-purple);color:var(--purple)">';
    html += '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5" stroke="currentColor" stroke-width="1.3"/><path d="M4 6h4M6 4v4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
    html += '</div>';
    html += '<div class="cidr-inner-title">Supernet Summary</div>';
    html += '<span style="font-size:11px;color:var(--text-3);margin-left:4px">parent networks containing /' + r.prefix + '</span>';
    html += '</div>';
    html += '<div class="card-body">' + renderSupernets(r) + '</div>';
    html += '</div>';
  }

  // ── Subnet Splits ────────────────────────────────────────
  if (r.prefix <= 28) {
    html += '<div class="cidr-inner" style="animation:fu .22s ease both">';
    html += '<div class="cidr-inner-hdr">';
    // Circle-dot icon with colored background — matches old version ◉
    html += '<div class="ch-ico" style="background:var(--ico-green);color:var(--green)">';
    html += '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5" stroke="currentColor" stroke-width="1.3"/><circle cx="6" cy="6" r="2" fill="currentColor"/></svg>';
    html += '</div>';
    html += '<div class="cidr-inner-title">Subnet Split Options</div>';
    html += '<span style="font-size:11px;color:var(--text-3);margin-left:4px">Click row to expand</span>';
    html += '</div>';
    html += '<div class="card-body">' + renderSplitTable(r) + '</div>';
    html += '</div>';
  }

  container.innerHTML = '<div class="calc-results">' + html + '</div>';
}

// ── renderBitRow — uses <span> matching old version ──────────
function renderBitRow(label, ipLong) {
  var bin = toBin(ipLong);
  var octets = [bin.slice(0,8), bin.slice(8,16), bin.slice(16,24), bin.slice(24,32)].map(function(octet) {
    return '<span class="bit-octet">' +
      octet.split('').map(function(b) {
        return '<span class="bit-b ' + (b === '1' ? 'one' : 'zero') + '">' + b + '</span>';
      }).join('') + '</span>';
  }).join('');
  return '<div class="bit-row"><div class="bit-label">' + label + '</div><div class="bit-segments">' + octets + '</div></div>';
}

// ── Subnet split table — single table, detail as <tr> ────────
// Matches old version exactly: one table, summary <tr> + detail <tr> pairs.
// Detail <tr> uses display:none / display:table-row via .open class.
function renderSplitTable(r) {
  var prefixes = [r.prefix+1, r.prefix+2, r.prefix+3, r.prefix+4].filter(function(p) { return p <= 30; });

  var html = '<table class="dt"><thead><tr>';
  html += '<th>Prefix</th>';
  html += '<th>Subnets</th>';
  html += '<th>IPs / Subnet</th>';
  html += '<th>Usable Hosts</th>';
  html += '<th>First Subnet</th>';
  html += '<th style="width:20px"></th>';
  html += '</tr></thead><tbody>';

  prefixes.forEach(function(newPrefix, idx) {
    var numSubnets = Math.pow(2, newPrefix - r.prefix);
    var subnetSize = Math.pow(2, 32 - newPrefix);
    var usable     = getUsable(newPrefix);
    var maxShow    = Math.min(numSubnets, 8);
    var detailId   = 'split-' + idx;
    var firstSubnet = long2ip(r.networkLong) + '/' + newPrefix;

    // ── Summary row ──────────────────────────────────────
    html += '<tr class="split-row" onclick="toggleSplitDetail(\'' + detailId + '\', this)">';
    html += '<td>' + pill('/' + newPrefix, 'p-blue') + '</td>';
    html += '<td class="cd">' + formatNumber(numSubnets) + '</td>';
    html += '<td class="cd">' + formatNumber(subnetSize) + '</td>';
    html += '<td class="cm">' + formatNumber(usable) + '</td>';
    html += '<td class="cd">' + h(firstSubnet) + '</td>';
    html += '<td><svg width="12" height="12" viewBox="0 0 12 12" fill="none" style="transition:transform .18s"><path d="M2 4l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></td>';
    html += '</tr>';

    // ── Detail row — hidden until clicked ────────────────
    html += '<tr class="split-detail" id="' + detailId + '">';
    html += '<td colspan="6" style="padding:0;background:var(--bg)">';
    html += '<table class="dt" style="width:100%"><tbody>';

    // Label row — "Example Subnets for /25 split of 192.168.1.0/24"
    html += '<tr style="background:var(--bg)">';
    html += '<td colspan="6" style="padding:8px 18px 4px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3)">';
    html += 'Example Subnets &nbsp;·&nbsp; /' + newPrefix + ' split of ' + h(r.network) + '/' + r.prefix;
    html += '</td></tr>';

    // Sub-header row
    html += '<tr>';
    html += '<th style="font-size:10px;background:var(--bg)">Subnet</th>';
    html += '<th style="font-size:10px;background:var(--bg)">First Host</th>';
    html += '<th style="font-size:10px;background:var(--bg)">Last Host</th>';
    html += '<th style="font-size:10px;background:var(--bg)">Broadcast</th>';
    html += '<th style="font-size:10px;background:var(--bg)">Hosts</th>';
    html += '<th style="background:var(--bg)"></th>';
    html += '</tr>';

    for (var i = 0; i < maxShow; i++) {
      var netLong = r.networkLong + i * subnetSize;
      var bcLong  = (netLong + subnetSize - 1) >>> 0;
      var fh = newPrefix < 31 ? long2ip(netLong + 1) : long2ip(netLong);
      var lh = newPrefix < 31 ? long2ip(bcLong - 1)  : long2ip(bcLong);
      html += '<tr style="background:var(--bg)">';
      html += '<td class="cb">' + h(long2ip(netLong)) + '/' + newPrefix + '</td>';
      html += '<td class="cd">' + h(fh) + '</td>';
      html += '<td class="cd">' + h(lh) + '</td>';
      html += '<td class="cd">' + h(long2ip(bcLong)) + '</td>';
      html += '<td class="cd">' + formatNumber(usable) + '</td>';
      html += '<td></td>';
      html += '</tr>';
    }

    if (numSubnets > maxShow) {
      html += '<tr style="background:var(--bg)"><td colspan="6" class="cd" style="font-style:italic">…and ' + formatNumber(numSubnets - maxShow) + ' more subnets</td></tr>';
    }

    html += '</tbody></table></td></tr>';
  });

  html += '</tbody></table>';
  return html;
}

// ── Toggle split detail row ──────────────────────────────────
function toggleSplitDetail(id, triggerRow) {
  var detail = document.getElementById(id);
  if (!detail) return;
  var open = detail.classList.toggle('open');
  var chev = triggerRow ? triggerRow.querySelector('svg') : null;
  if (chev) chev.style.transform = open ? 'rotate(180deg)' : '';
}

// ── Supernet Summary ─────────────────────────────────────────
// Shows up to 4 parent networks (prefix -1 through -4, min /8).
// Each row is clickable — loads that supernet in the calculator.
function renderSupernets(r) {
  // Build supernet prefixes: go up 1-4 levels, stop at /8
  var prefixes = [];
  for (var i = 1; i <= 4; i++) {
    var p = r.prefix - i;
    if (p < 8) break;
    prefixes.push(p);
  }
  if (!prefixes.length) return '<div class="empty-s">No supernets above /8</div>';

  var html = '<table class="dt"><thead><tr>';
  html += '<th>Supernet</th>';
  html += '<th>Contains</th>';
  html += '<th>Total IPs</th>';
  html += '<th>Your /' + r.prefix + ' is</th>';
  html += '</tr></thead><tbody>';

  prefixes.forEach(function(newPrefix) {
    var superNetwork = (r.networkLong & prefixToMaskLong(newPrefix)) >>> 0;
    var superNetIP   = long2ip(superNetwork);
    var superCidr    = superNetIP + '/' + newPrefix;
    var totalInSuper = Math.pow(2, 32 - newPrefix);
    var subnetsCount = Math.pow(2, r.prefix - newPrefix);

    // Which subnet number is our network within the supernet?
    var subnetSize   = Math.pow(2, 32 - r.prefix);
    var offset       = (r.networkLong - superNetwork) / subnetSize;
    var position     = 'subnet ' + (offset + 1) + ' of ' + formatNumber(subnetsCount);

    html += '<tr class="supernet-row" style="cursor:pointer" onclick="calcQuick(\'' + superCidr + '\')" title="Click to calculate ' + superCidr + '">';
    html += '<td>' + pill('/' + newPrefix, 'p-purple') + ' <span class="cd">' + h(superNetIP) + '</span></td>';
    html += '<td class="cd">' + formatNumber(subnetsCount) + ' /' + r.prefix + ' networks</td>';
    html += '<td class="cd">' + formatNumber(totalInSuper) + ' IPs</td>';
    html += '<td class="cd">' + position + '</td>';
    html += '</tr>';
  });

  html += '</tbody></table>';
  html += '<div style="font-size:11px;color:var(--text-3);padding:8px 18px">Click any row to calculate that supernet</div>';
  return html;
}
