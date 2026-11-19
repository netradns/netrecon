// NetRecon — Windows DHCP scope export
// Builds a PowerShell script (DhcpServer module) for the subnet that was just calculated.
// The script is meant to be run directly on the Windows DHCP server.
// Nothing is sent anywhere. The script is only generated for the user to copy or download.

'use strict';

var _dhcpCtx   = null;   // calculation result the dialog was built for
var _dhcpSaved = { desc: '', dns: '', domain: '', lease: '8' };

// Quote a value as a PowerShell single-quoted string
function psq(s) {
  s = String(s).replace(/[\r\n]+/g, ' ')
               .replace(/[\u2018\u2019\u201A\u201B]/g, "'");   // PowerShell treats curly quotes as quotes
  return "'" + s.replace(/'/g, "''") + "'";
}

// Trimmed value of an input (empty string if the element is missing)
function dhcpVal(id) { var e = calcEl(id); return e ? e.value.trim() : ''; }

// ── Button in the results (called from renderCalcResults) ────
function renderDhcpPanel(r) {
  if (r.prefix > 30) return '';          // a DHCP scope needs at least 2 usable hosts
  _dhcpCtx = r;
  return '<div class="dhcp-cta"><div><div class="dhcp-cta-t">Windows DHCP scope</div>' +
    '<div class="dhcp-cta-s">Generate the PowerShell to create this scope. Run it on the DHCP server.</div></div>' +
    '<button class="calc-btn" onclick="dhcpOpen()">Create DHCP scope</button></div>';
}

// ── Modal ────────────────────────────────────────────────────
function dhcpField(id, label, value, placeholder, wide) {
  return '<label class="dhcp-f' + (wide ? ' wide' : '') + '"><span>' + label + '</span>' +
    '<input id="' + id + '" class="calc-field" type="text" value="' + h(value) + '" placeholder="' + h(placeholder || '') + '" ' +
    'autocomplete="off" spellcheck="false" oninput="dhcpGenerate()"/></label>';
}

function dhcpOpen() {
  var r = _dhcpCtx;
  if (!r) return;
  var s = _dhcpSaved;
  var first = ip2long(r.firstHost);
  var gw = r.firstHost;                           // gateway = first usable (.1)
  var start = long2ip(first + 1);                 // pool starts right after it (.2)
  var end = r.lastHost;                           // pool ends at the last usable (.254)

  dhcpClose();
  var m = document.createElement('div');
  m.className = 'dhcp-modal';
  m.id = 'dhcpModal';
  m.onclick = function(e) { if (e.target === m) dhcpClose(); };

  var html = '<div class="dhcp-dialog" role="dialog" aria-modal="true" aria-label="Create DHCP scope">';
  html += '<div class="dhcp-hdr"><div><div class="dhcp-title">Create DHCP scope</div>' +
    '<div class="dhcp-sub">' + h(r.network) + '/' + r.prefix + ' &nbsp;&middot;&nbsp; ' + h(r.mask) + '</div></div>' +
    '<button class="dhcp-x" onclick="dhcpClose()" aria-label="Close">&times;</button></div>';
  html += '<div class="dhcp-body">';
  html += '<div class="dhcp-grid">';
  html += dhcpField('dhcpName', 'Scope name', r.scopeName || (r.network + '/' + r.prefix), 'e.g. HQ Users VLAN 10');
  html += dhcpField('dhcpDesc', 'Description (optional)', s.desc, '');
  html += dhcpField('dhcpDns',  'DNS servers (optional)', s.dns, 'e.g. 192.168.1.10, 192.168.1.11', true);
  html += '</div>';
  html += '<div class="dhcp-auto">Auto-filled: gateway <b>' + h(gw) + '</b> &nbsp;&middot;&nbsp; pool <b>' + h(start) + '</b> to <b>' + h(end) + '</b> &nbsp;&middot;&nbsp; mask <b>' + h(r.mask) + '</b></div>';
  html += '<details class="dhcp-adv"><summary>Advanced (change addresses, exclusions, lease)</summary><div class="dhcp-grid">';
  html += dhcpField('dhcpStart',  'Start IP', start, '');
  html += dhcpField('dhcpEnd',    'End IP', end, '');
  html += dhcpField('dhcpGw',     'Gateway (router)', gw, 'blank = none');
  html += dhcpField('dhcpDomain', 'DNS domain', s.domain, 'e.g. corp.contoso.com');
  html += dhcpField('dhcpLease',  'Lease (days)', s.lease, '8');
  html += '<label class="dhcp-f wide"><span>Excluded ranges (one per line, e.g. 192.168.1.2-192.168.1.20 for static devices)</span>' +
    '<textarea id="dhcpExcl" class="calc-field" rows="2" spellcheck="false" oninput="dhcpGenerate()"></textarea></label>';
  html += '</div></details>';
  html += '<div id="dhcpMsgs"></div>';
  html += '<div class="dhcp-codehdr"><span>PowerShell</span><button class="dhcp-copy" id="dhcpCopyBtn" onclick="dhcpCopy()">Copy</button></div>';
  html += '<pre class="dhcp-out" id="dhcpOut"></pre>';
  html += '</div>';
  html += '<div class="dhcp-foot"><span class="dhcp-hint">Review, then run in PowerShell (as admin) on the DHCP server.</span>' +
    '<button class="calc-btn calc-btn-sec" onclick="dhcpDownload()">Download .ps1</button></div>';
  html += '</div>';
  m.innerHTML = html;
  document.body.appendChild(m);
  document.addEventListener('keydown', dhcpEsc);

  dhcpGenerate();
}

// Open the dialog for any subnet (used by the VLSM planner)
function dhcpOpenFor(ip, prefix, scopeName) {
  if (prefix > 30) return;
  _dhcpCtx = buildCalcResult(ip, prefix);
  _dhcpCtx.scopeName = scopeName;
  dhcpOpen();
}

function dhcpEsc(e) { if (e.key === 'Escape') dhcpClose(); }

function dhcpClose() {
  var m = calcEl('dhcpModal');
  if (m) m.parentNode.removeChild(m);
  document.removeEventListener('keydown', dhcpEsc);
}

// ── Validation + script generation ───────────────────────────
function dhcpBuild() {
  var r = _dhcpCtx, errors = [], warnings = [];
  var first = ip2long(r.firstHost), last = ip2long(r.lastHost);

  function ipOk(v, what) {
    if (!isDottedQuad(v)) { errors.push(what + ' "' + v + '" is not a valid IP address.'); return false; }
    var n = ip2long(v);
    if (n < first || n > last) { errors.push(what + ' ' + v + ' is outside the usable range ' + r.firstHost + ' - ' + r.lastHost + '.'); return false; }
    return true;
  }

  var name = dhcpVal('dhcpName'), desc = dhcpVal('dhcpDesc');
  var start = dhcpVal('dhcpStart'), end = dhcpVal('dhcpEnd'), gw = dhcpVal('dhcpGw');
  var dns = dhcpVal('dhcpDns').split(/[\s,;]+/).filter(Boolean);
  var domain = dhcpVal('dhcpDomain'), leaseRaw = dhcpVal('dhcpLease') || '8';

  if (!name) errors.push('Enter a scope name.');
  var okStart = ipOk(start, 'Start IP'), okEnd = ipOk(end, 'End IP');
  if (okStart && okEnd && ip2long(start) > ip2long(end)) errors.push('Start IP must not be after End IP.');
  if (gw) ipOk(gw, 'Gateway');
  dns.forEach(function(d) { if (!isDottedQuad(d)) errors.push('DNS server "' + d + '" is not a valid IP address.'); });
  if (domain && !/^[A-Za-z0-9._-]+$/.test(domain)) errors.push('DNS domain contains invalid characters.');
  if (!/^\d+$/.test(leaseRaw) || +leaseRaw < 1 || +leaseRaw > 999) errors.push('Lease must be a whole number of days from 1 to 999.');

  // Exclusions
  var excl = [];
  dhcpVal('dhcpExcl').split(/\r?\n/).forEach(function(line) {
    line = line.trim();
    if (!line) return;
    var m = line.split(/\s*-\s*/);
    var a = m[0], b = m.length > 1 ? m[1] : m[0];
    if (m.length > 2) { errors.push('Exclusion "' + line + '" is not in the form start-end.'); return; }
    if (!ipOk(a, 'Exclusion start') || !ipOk(b, 'Exclusion end')) return;
    if (ip2long(a) > ip2long(b)) { errors.push('Exclusion "' + line + '" starts after it ends.'); return; }
    excl.push({ a: a, b: b, note: '' });
  });

  // If the gateway is moved inside the pool, exclude it so it is never leased.
  if (gw && isDottedQuad(gw) && okStart && okEnd) {
    var g = ip2long(gw);
    if (g >= ip2long(start) && g <= ip2long(end) &&
        !excl.some(function(x) { return g >= ip2long(x.a) && g <= ip2long(x.b); })) {
      excl.push({ a: gw, b: gw, note: 'gateway' });
      warnings.push('The gateway ' + gw + ' is inside the pool, so it was added as an exclusion.');
    }
  }

  if (errors.length) return { errors: errors, warnings: warnings };

  var L = [];
  L.push('# Generated by NetRecon IP Calculator');
  var label = name.replace(/[\r\n]+/g, ' '), cidr = r.network + '/' + r.prefix;
  L.push('# Scope: ' + label + (label === cidr ? '' : '  (' + cidr + ')'));
  L.push('# Run on the Windows DHCP server, in PowerShell as administrator. Review first.');
  L.push('$ErrorActionPreference = ' + psq('Stop'));
  L.push('$ScopeId = ' + psq(r.network));
  L.push('');
  L.push('# Create the scope');
  L.push('Add-DhcpServerv4Scope -Name ' + psq(name) +
    (desc ? ' -Description ' + psq(desc) : '') +
    ' -StartRange ' + start + ' -EndRange ' + end + ' -SubnetMask ' + r.mask +
    ' -LeaseDuration (New-TimeSpan -Days ' + (+leaseRaw) + ') -State Active');

  if (excl.length) {
    L.push('');
    L.push('# Exclusions (addresses the server will not hand out)');
    excl.forEach(function(x) {
      L.push('Add-DhcpServerv4ExclusionRange -ScopeId $ScopeId -StartRange ' + x.a + ' -EndRange ' + x.b +
        (x.note ? '   # ' + x.note : ''));
    });
  }

  var opts = '';
  if (gw) opts += ' -Router ' + gw;
  if (dns.length) opts += ' -DnsServer ' + dns.join(',');
  if (domain) opts += ' -DnsDomain ' + psq(domain);
  if (opts) {
    L.push('');
    L.push('# Scope options (gateway, DNS)');
    L.push('Set-DhcpServerv4OptionValue -ScopeId $ScopeId' + opts);
  }

  L.push('');
  L.push('# Verify');
  L.push('Get-DhcpServerv4Scope -ScopeId $ScopeId | Format-List');

  return { errors: [], warnings: warnings, script: L.join('\r\n') + '\r\n' };
}

function dhcpGenerate() {
  var out = calcEl('dhcpOut'), msgs = calcEl('dhcpMsgs');
  if (!out || !msgs || !_dhcpCtx) return;

  _dhcpSaved = { desc: dhcpVal('dhcpDesc'), dns: dhcpVal('dhcpDns'), domain: dhcpVal('dhcpDomain'),
    lease: dhcpVal('dhcpLease') || '8' };

  var res = dhcpBuild();
  var m = '';
  res.errors.forEach(function(e) { m += '<div class="calc-msg-err">&#10007; ' + h(e) + '</div>'; });
  res.warnings.forEach(function(w) { m += '<div class="calc-msg-warn">&#9888; ' + h(w) + '</div>'; });
  msgs.innerHTML = m;

  window._dhcpScript = res.script || '';
  out.textContent = res.script || '';
  out.style.display = res.script ? '' : 'none';
  var cb = calcEl('dhcpCopyBtn'); if (cb) cb.disabled = !res.script;
}

function dhcpCopy() {
  copyText(window._dhcpScript, calcEl('dhcpCopyBtn'), 'Copy');
}

function dhcpDownload() {
  if (!window._dhcpScript) return;
  downloadText('dhcp-scope-' + _dhcpCtx.network + '-' + _dhcpCtx.prefix + '.ps1', window._dhcpScript);
}