// NetRecon — Cloud CIDR Results Rendering
// Matches netrecon-old renderCloudResult output exactly

'use strict';

function renderCloudResult(container, provider, networkIP, prefix, networkLong, totalIPs, tiers, zoneNames, vpcLabel, zoneLabel) {

  // ── Allocate subnets across zones ────────────────────────
  var cursor   = networkLong;
  var overflow = false;
  var totalNeeded = zoneNames.length * tiers.reduce(function(a, t) { return a + Math.pow(2, 32 - parseInt(t.size)); }, 0);
  if (totalNeeded > totalIPs) overflow = true;

  var zones = [];
  zoneNames.forEach(function(zoneName) {
    var subnets = [];
    tiers.forEach(function(tier) {
      var size = Math.pow(2, 32 - parseInt(tier.size));
      if ((cursor - networkLong) + size > totalIPs) {
        subnets.push({ name: tier.name, cidr: 'OVERFLOW', color: tier.color, hosts: 0, overflow: true });
      } else {
        subnets.push({ name: tier.name, cidr: long2ip(cursor) + '/' + tier.size, color: tier.color, hosts: getUsable(parseInt(tier.size)), overflow: false });
        cursor += size;
      }
    });
    zones.push({ zone: zoneName, subnets: subnets });
  });

  var usedIPs  = Math.min(totalNeeded, totalIPs);
  var freeIPs  = totalIPs - usedIPs;

  // ── Provider accent colors ───────────────────────────────
  var accentBg  = { aws: 'rgba(255,153,0,.08)', gcp: 'rgba(66,133,244,.08)', azure: 'rgba(0,120,212,.08)' };
  var accentCol = { aws: '#ff9900', gcp: '#4285f4', azure: '#0078d4' };
  var provLabel = { aws: 'AWS', gcp: 'GCP', azure: 'Azure' };

  var html = '';

  // Overflow warning
  if (overflow) {
    html += '<div class="overflow-warn">⚠ Subnet allocation exceeds the ' + networkIP + '/' + prefix + ' CIDR block. Use a larger VPC CIDR or reduce subnet sizes.</div>';
  }

  // ── VPC Banner ───────────────────────────────────────────
  html += '<div class="vpc-banner">';
  html += '<div class="vpc-banner-top" style="background:' + accentBg[provider] + '">';
  html += '<div>';
  html += '<div class="vpc-cidr-text" style="color:' + accentCol[provider] + '">' + h(networkIP) + '/' + prefix + '</div>';
  html += '<div class="vpc-desc">' + h(vpcLabel) + ' · ' + h(zoneNames[0] ? zoneNames[0].split(' ')[0] : '') + ' · ' + formatNumber(totalIPs) + ' IPs total</div>';
  html += '</div>';
  html += '<div style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap">';
  html += pill(zoneNames.length + ' ' + (provider === 'gcp' ? 'Regions' : 'AZs'), 'p-blue');
  html += pill(tiers.length + ' tiers', 'p-gray');
  html += pill(zoneNames.length * tiers.length + ' subnets', 'p-teal');
  html += '</div>';
  html += '</div>';

  // VPC meta grid
  html += '<div class="vpc-meta-grid">';
  html += '<div class="vpc-meta-cell"><div class="vpc-meta-lbl">Network</div><div class="vpc-meta-val">' + h(networkIP) + '/' + prefix + '</div></div>';
  html += '<div class="vpc-meta-cell"><div class="vpc-meta-lbl">Total IPs</div><div class="vpc-meta-val">' + formatNumber(totalIPs) + '</div></div>';
  html += '<div class="vpc-meta-cell"><div class="vpc-meta-lbl">IPs Used</div><div class="vpc-meta-val" style="color:' + (freeIPs > 0 ? 'var(--green)' : 'var(--red)') + '">' + formatNumber(usedIPs) + '</div></div>';
  html += '<div class="vpc-meta-cell"><div class="vpc-meta-lbl">Subnet Tiers</div><div class="vpc-meta-val">' + tiers.length + '</div></div>';
  html += '<div class="vpc-meta-cell"><div class="vpc-meta-lbl">' + zoneLabel + 's</div><div class="vpc-meta-val">' + zoneNames.length + '</div></div>';
  html += '</div>';
  html += '</div>'; // /vpc-banner

  // ── Legend ───────────────────────────────────────────────
  html += '<div class="subnet-legend">';
  tiers.forEach(function(tier) {
    html += '<div class="legend-item"><div class="legend-swatch" style="background:' + tier.color + '"></div>';
    html += h(tier.name) + '<span style="white-space:nowrap;font-family:\'DM Mono\',monospace;font-size:11px;color:var(--text-3)">/' + tier.size + '</span></div>';
  });
  html += '</div>';

  // ── AZ / Region cards ────────────────────────────────────
  html += '<div class="az-grid">';
  zones.forEach(function(zone, zi) {
    var zoneCidrs = zone.subnets.filter(function(s) { return !s.overflow; }).map(function(s) { return s.name + ': ' + s.cidr; }).join('\n');
    html += '<div class="az-card" style="animation-delay:' + ((zi + 1) * 40) + 'ms">';
    html += '<div class="az-card-hdr" style="background:' + accentBg[provider] + '">';
    html += '<div class="az-card-title" style="color:' + accentCol[provider] + '">' + zoneLabel + '</div>';
    html += '<span class="az-card-sub" style="margin-left:6px;color:var(--text)">' + h(zone.zone) + '</span>';
    html += '<span class="az-card-sub">' + zone.subnets.length + ' subnets</span>';
    // Use data-copy attribute to avoid inline string escaping issues
    html += '<button class="copy-card-btn copy-az-btn" data-copy="' + h(zoneCidrs) + '" title="Copy CIDRs">';
    html += '<svg width="12" height="12" viewBox="0 0 15 15" fill="none"><rect x="5" y="5" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M10 5V3.5A1.5 1.5 0 008.5 2h-5A1.5 1.5 0 002 3.5v5A1.5 1.5 0 003.5 10H5" stroke="currentColor" stroke-width="1.3"/></svg>';
    html += '</button>';
    html += '</div>';

    zone.subnets.forEach(function(subnet) {
      if (subnet.overflow) {
        html += '<div class="subnet-row-out"><div class="subnet-swatch" style="background:' + subnet.color + '"></div>';
        html += '<span class="subnet-name">' + h(subnet.name) + '</span>';
        html += '<span class="subnet-cidr" style="color:var(--red)">OVERFLOW</span></div>';
      } else {
        html += '<div class="subnet-row-out"><div class="subnet-swatch" style="background:' + subnet.color + '"></div>';
        html += '<span class="subnet-name">' + h(subnet.name) + '</span>';
        html += '<span class="subnet-cidr">' + h(subnet.cidr) + '</span>';
        html += '<span class="subnet-hosts">(' + formatNumber(subnet.hosts) + ')</span></div>';
      }
    });

    html += '</div>'; // /az-card
  });
  html += '</div>'; // /az-grid

  // ── Implementation Notes ─────────────────────────────────
  var notes = {
    aws: [
      '• <b>Internet Gateway</b> — attach to VPC; add 0.0.0.0/0 route in public subnet route tables',
      '• <b>NAT Gateway</b> — deploy in each public subnet; route 0.0.0.0/0 from private subnets',
      '• <b>Route Tables</b> — separate RTs per tier; public → IGW, private → NAT, DB → local only',
      '• <b>Security Groups</b> — allow 443 from ALB to app tier; restrict DB to app tier CIDR only',
      '• <b>VPC Flow Logs</b> — enable at VPC level; send to CloudWatch for security visibility'
    ],
    gcp: [
      '• <b>Subnets are Regional</b> — subnets are regional; all zones in a region share the same subnet',
      '• <b>Cloud Router + NAT</b> — deploy one Cloud Router per region for outbound internet access',
      '• <b>Firewall Rules</b> — VPC-level; use network tags to target specific instance groups',
      '• <b>Private Google Access</b> — enable on subnets to reach Google APIs without public IPs',
      '• <b>Shared VPC</b> — for multi-project architectures; host project owns the VPC'
    ],
    azure: [
      '• <b>Network Security Groups (NSG)</b> — attach to subnets; use inbound/outbound rules',
      '• <b>Azure Bastion</b> — deploy in AzureBastionSubnet (/26 min) for RDP/SSH without public IPs',
      '• <b>Private Endpoints</b> — use to reach PaaS services (SQL, Storage, KeyVault) privately',
      '• <b>Azure Firewall / NVA</b> — deploy in dedicated subnet; route 0.0.0.0/0 through it',
      '• <b>DDoS Protection</b> — enable standard plan on the VNet for volumetric attack protection'
    ]
  };

  html += '<div class="notes-card"><div class="notes-hdr">';
  html += '<span style="font-size:12px;font-weight:600;color:var(--text-3);text-transform:uppercase;letter-spacing:.06em;padding:3px">' + provLabel[provider] + ' Architecture Notes</span>';
  html += '</div><div class="notes-body">';
  (notes[provider] || []).forEach(function(note) {
    html += '<div>' + note + '</div>';
  });
  html += '</div></div>';

  // ── Export bar — rendered ABOVE results so it persists ──────
  var exportBar = '<div class="cloud-export-bar">' +
    '<button class="export-btn" onclick="exportCloudToXlsx()" title="Export to Excel">' +
    '<svg width="13" height="13" viewBox="0 0 15 15" fill="none"><path d="M2 10v2.5a1 1 0 001 1h9a1 1 0 001-1V10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M7.5 1v8M4.5 6.5L7.5 9.5 10.5 6.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
    ' Export XLSX</button></div>';

  container.innerHTML = exportBar + '<div class="cloud-results">' + html + '</div>';

  // Wire copy buttons via event delegation (avoids inline onclick escaping issues)
  container.querySelectorAll('.copy-az-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var text = btn.getAttribute('data-copy') || '';
      copyToClipboard(text, btn);
    });
  });
}

// ── Export to XLSX ───────────────────────────────────────────
function exportCloudToXlsx() {
  if (typeof XLSX === 'undefined') { alert('XLSX library not loaded. Please refresh the page.'); return; }
  var container = document.getElementById('cloud-results');
  if (!container || !container.querySelector('.az-card')) {
    alert('Generate a cloud plan first.');
    return;
  }

  // Summary row from banner
  var summaryRows = [['Field', 'Value']];
  var cidrEl = container.querySelector('.vpc-cidr-text');
  if (cidrEl) summaryRows.push(['Network CIDR', cidrEl.textContent.trim()]);
  var descEl = container.querySelector('.vpc-desc');
  if (descEl) summaryRows.push(['Description', descEl.textContent.trim()]);
  container.querySelectorAll('.vpc-meta-cell').forEach(function(cell) {
    var lbl = cell.querySelector('.vpc-meta-lbl');
    var val = cell.querySelector('.vpc-meta-val');
    if (lbl && val) summaryRows.push([lbl.textContent.trim(), val.textContent.trim()]);
  });

  // Subnet rows
  var subnetRows = [['Zone / Region', 'Subnet Name', 'CIDR', 'Usable Hosts']];
  container.querySelectorAll('.az-card').forEach(function(card) {
    // Zone name is in the second az-card-sub span
    var subs = card.querySelectorAll('.az-card-sub');
    var azTitle = subs.length >= 2 ? subs[1].textContent.trim() : (subs[0] ? subs[0].textContent.trim() : '');
    card.querySelectorAll('.subnet-row-out').forEach(function(row) {
      var name  = (row.querySelector('.subnet-name')  || {}).textContent || '';
      var cidr  = (row.querySelector('.subnet-cidr')  || {}).textContent || '';
      var hosts = (row.querySelector('.subnet-hosts') || {}).textContent || '';
      if (cidr.trim() !== 'OVERFLOW') {
        subnetRows.push([azTitle, name.trim(), cidr.trim(), hosts.replace(/[()]/g, '').trim()]);
      }
    });
  });

  var wb = XLSX.utils.book_new();

  var wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary['!cols'] = [{ wch: 20 }, { wch: 36 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

  var wsSubnets = XLSX.utils.aoa_to_sheet(subnetRows);
  wsSubnets['!cols'] = [{ wch: 28 }, { wch: 24 }, { wch: 18 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsSubnets, 'Subnets');

  // Generate filename from CIDR
  var cidrSlug = cidrEl ? cidrEl.textContent.trim().replace(/[\/\.]/g, '-') : 'plan';
  XLSX.writeFile(wb, 'netrecon-cloud-' + cidrSlug + '.xlsx');
}
