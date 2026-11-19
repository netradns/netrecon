// NetRecon — DNS Results Rendering — matches netrecon-old exactly

'use strict';

function renderDnsResults(domain, d) {
  var { aRecs, aaaaRecs, cnameRecs, mxRecs, txtRecs, nsRecs, soaRecs, caaRecs, dmarcRecs, dkimRecs, geoData, dnssec } = d;

  var hasSPF   = !!(txtRecs  && txtRecs.find(function(r)  { return r.data.replace(/^"|"$/g,'').startsWith('v=spf1'); }));
  var hasDKIM  = !!(dkimRecs && dkimRecs.length);
  var hasDMARC = !!(dmarcRecs && dmarcRecs.length);

  var delay = 0;
  var html  = '';

  // ── Health bar ───────────────────────────────────────────
  html += '<div class="health-bar" style="animation:fu .2s ease both;animation-delay:' + delay + 'ms">';
  html += '<span class="h-lbl">Email Security</span>';
  html += pill((hasSPF   ? '✓ ' : '✕ ') + 'SPF',   hasSPF   ? 'p-green' : 'p-red');
  html += pill((hasDKIM  ? '✓ ' : '✕ ') + 'DKIM',  hasDKIM  ? 'p-green' : 'p-red');
  html += pill((hasDMARC ? '✓ ' : '✕ ') + 'DMARC', hasDMARC ? 'p-green' : 'p-red');
  if (typeof dnssecPill === 'function') html += dnssecPill(dnssec);   // DNSSEC status, see dns-dnssec.js
  html += '<span class="h-domain">' + h(domain) + '</span>';
  html += '</div>';
  delay += 40;

  // ── 1. A Records ─────────────────────────────────────────
  var aBody = '';
  if (aRecs === null) {
    aBody = errS('Query failed');
  } else if (!aRecs.length) {
    aBody = emptyS();
  } else {
    aBody = '<table class="dt"><thead><tr><th>IP Address</th><th>Location</th><th>Org</th><th>TTL</th></tr></thead><tbody>';
    aRecs.forEach(function(r, i) {
      var geo = geoData[i];
      var loc = geo && !geo.error ? [flag(geo.country), [geo.city, geo.region].filter(Boolean).join(', ')].join(' ') : '—';
      // IP is clickable — runs IP lookup for map + full geo detail
      aBody += '<tr>' +
        '<td><span class="cb" style="cursor:pointer;text-decoration:underline;text-decoration-style:dotted" onclick="ipLookupDirect(\'' + h(r.data) + '\')" title="Click to look up this IP">' + h(r.data) + '</span></td>' +
        '<td class="cd">' + h(loc) + '</td>' +
        '<td class="cd">' + h(geo && geo.org || '—') + '</td>' +
        '<td class="cd">' + ttlFmt(getTTL(r)) + '</td></tr>';
    });
    aBody += '</tbody></table>';
  }
  html += card('sec-a', 'var(--ico-blue)', '◈', 'A Records', 'IPv4 Addresses', aRecs ? aRecs.length : 0, aBody, delay);
  delay += 40;

  // ── 2. AAAA Records ──────────────────────────────────────
  var aaaaBody = '';
  if (!aaaaRecs || !aaaaRecs.length) {
    aaaaBody = emptyS('No IPv6 addresses');
  } else {
    aaaaBody = '<table class="dt"><thead><tr><th>IPv6 Address</th><th>TTL</th></tr></thead><tbody>';
    aaaaRecs.forEach(function(r) {
      aaaaBody += '<tr>' +
        '<td><span class="cb" style="cursor:pointer;text-decoration:underline;text-decoration-style:dotted" onclick="ipLookupDirect(\'' + h(r.data) + '\')" title="Click to look up this IP">' + h(r.data) + '</span></td>' +
        '<td class="cd">' + ttlFmt(getTTL(r)) + '</td></tr>';
    });
    aaaaBody += '</tbody></table>';
  }
  html += card('sec-aaaa', 'var(--ico-green)', '◈', 'AAAA Records', 'IPv6 Addresses', aaaaRecs ? aaaaRecs.length : 0, aaaaBody, delay);
  delay += 40;

  // ── 3. CNAME Records ─────────────────────────────────────
  var cnameBody = '';
  if (!cnameRecs || !cnameRecs.length) {
    cnameBody = emptyS();
  } else {
    cnameBody = '<table class="dt"><thead><tr><th>Alias</th><th>Target</th><th>TTL</th></tr></thead><tbody>';
    cnameRecs.forEach(function(r) {
      cnameBody += '<tr><td class="cm">' + h(r.name || domain) + '</td><td class="cm">→ ' + h(r.data) + '</td><td class="cd">' + ttlFmt(getTTL(r)) + '</td></tr>';
    });
    cnameBody += '</tbody></table>';
  }
  html += card('sec-cname', 'var(--ico-yellow)', '⇢', 'CNAME Records', 'Aliases', cnameRecs ? cnameRecs.length : 0, cnameBody, delay);
  delay += 40;

  // ── 4. MX Records ────────────────────────────────────────
  var mxBody = '';
  if (!mxRecs || !mxRecs.length) {
    mxBody = emptyS('No mail servers configured');
  } else {
    var mxRows = mxRecs.map(function(r) {
      var p = r.data.split(' ');
      return { pri: p[0], host: p.slice(1).join(' '), ttl: getTTL(r) };
    }).sort(function(a, b) { return parseInt(a.pri) - parseInt(b.pri); });
    mxBody = '<table class="dt"><thead><tr><th>Priority</th><th>Mail Server</th><th>TTL</th></tr></thead><tbody>';
    mxRows.forEach(function(r) {
      mxBody += '<tr><td><span class="pri-badge">' + h(r.pri) + '</span></td><td class="cm">' + h(r.host) + '</td><td class="cd">' + ttlFmt(r.ttl) + '</td></tr>';
    });
    mxBody += '</tbody></table>';
  }
  html += card('sec-mx', 'var(--ico-pink)', '✉', 'MX Records', 'Mail Exchange', mxRecs ? mxRecs.length : 0, mxBody, delay);
  delay += 40;

  // ── 5. TXT Records ───────────────────────────────────────
  var txtBody = '';
  var spfRecord = null;
  if (!txtRecs || !txtRecs.length) {
    txtBody = emptyS();
  } else {
    txtBody = '<table class="dt"><thead><tr><th></th><th>Value</th><th>TTL</th></tr></thead><tbody>';
    txtRecs.forEach(function(r) {
      var val = r.data.replace(/^"|"$/g, '');
      if (val.startsWith('v=spf1')) spfRecord = val;
      var label = classifyTxt(val);
      txtBody += '<tr><td style="white-space:nowrap">' + (label ? txtPill(label) : '<span class="cd">TXT</span>') + '</td><td class="cm cw">' + h(val) + '</td><td class="cd">' + ttlFmt(getTTL(r)) + '</td></tr>';
    });
    txtBody += '</tbody></table>';
    if (spfRecord) txtBody += spfBd(spfRecord);
  }
  html += card('sec-txt', 'var(--ico-green)', '≡', 'TXT Records', 'SPF · Verification', txtRecs ? txtRecs.length : 0, txtBody, delay);
  delay += 40;

  // ── 6. DKIM Records ──────────────────────────────────────
  var dkimBody = '';
  if (!dkimRecs || !dkimRecs.length) {
    dkimBody = emptyS('No DKIM selectors found. Checked: default, google, k1, mail, dkim, selector1, selector2');
  } else {
    dkimBody = '<table class="dt"><thead><tr><th>Selector</th><th>Public Key</th><th>TTL</th></tr></thead><tbody>';
    dkimRecs.forEach(function(r) {
      dkimBody += '<tr><td>' + pill(r.selector, 'p-blue') + '</td><td class="cm cw">' + h(r.data) + '</td><td class="cd">' + ttlFmt(r.ttl) + '</td></tr>';
    });
    dkimBody += '</tbody></table>';
  }
  html += card('sec-dkim', 'var(--ico-blue)', '🔑', 'DKIM Records', 'DomainKeys Identified Mail', dkimRecs ? dkimRecs.length : 0, dkimBody, delay);
  delay += 40;

  // ── 7. DMARC Policy ──────────────────────────────────────
  var dmarcBody = '';
  if (!dmarcRecs || !dmarcRecs.length) {
    dmarcBody = emptyS('No DMARC policy found for _dmarc.' + domain);
  } else {
    dmarcBody = '<table class="dt"><thead><tr><th>Field</th><th>Value</th></tr></thead><tbody>';
    dmarcRecs.forEach(function(r) {
      var val     = r.data.replace(/^"|"$/g, '');
      var pMatch  = val.match(/p=(\w+)/);
      var spMatch = val.match(/sp=(\w+)/);
      var pctM    = val.match(/pct=(\d+)/);
      var ruaM    = val.match(/rua=([^;]+)/);
      if (pMatch)  dmarcBody += '<tr><td class="cd">Policy</td><td>' + pill(pMatch[1], pMatch[1]==='reject'?'p-green':pMatch[1]==='quarantine'?'p-yellow':'p-red') + '</td></tr>';
      if (spMatch) dmarcBody += '<tr><td class="cd">Subdomain Policy</td><td class="cm">' + h(spMatch[1]) + '</td></tr>';
      if (pctM)    dmarcBody += '<tr><td class="cd">Enforcement %</td><td class="cm">' + h(pctM[1]) + '</td></tr>';
      if (ruaM)    dmarcBody += '<tr><td class="cd">Report URI</td><td class="cm">' + h(ruaM[1]) + '</td></tr>';
      dmarcBody += '<tr><td class="cd" style="font-size:11.5px">Full Record</td><td class="cm cw" style="font-size:11.5px">' + h(val) + '</td></tr>';
    });
    dmarcBody += '</tbody></table>';
  }
  html += card('sec-dmarc', 'var(--ico-purple)', '🛡', 'DMARC Policy', 'Domain-based Message Authentication', dmarcRecs ? dmarcRecs.length : 0, dmarcBody, delay);
  delay += 40;

  // ── 8. NS Records ────────────────────────────────────────
  var nsBody = '';
  if (!nsRecs || !nsRecs.length) {
    nsBody = emptyS();
  } else {
    nsBody = '<table class="dt"><thead><tr><th>Nameserver</th><th>TTL</th></tr></thead><tbody>';
    nsRecs.forEach(function(r) {
      nsBody += '<tr><td class="cm">' + h(r.data) + '</td><td class="cd">' + ttlFmt(getTTL(r)) + '</td></tr>';
    });
    nsBody += '</tbody></table>';
  }
  html += card('sec-ns', 'var(--ico-green)', '⬡', 'NS Records', 'Authoritative Nameservers', nsRecs ? nsRecs.length : 0, nsBody, delay);
  delay += 40;

  // ── 9. SOA Record ────────────────────────────────────────
  var soaBody = '';
  if (!soaRecs || !soaRecs.length) {
    soaBody = emptyS();
  } else {
    var parts  = soaRecs[0].data.split(' ');
    var labels = ['Primary NS', 'Admin Email', 'Serial', 'Refresh', 'Retry', 'Expire', 'Min TTL'];
    soaBody = '<div class="soa-grid">';
    parts.forEach(function(v, i) {
      soaBody += '<div class="ip-cell"><div class="ip-lbl">' + h(labels[i] || ('Field ' + i)) + '</div><div class="ip-val">' + h(v) + '</div></div>';
    });
    soaBody += '</div>';
  }
  html += card('sec-soa', 'var(--ico-orange)', '◉', 'SOA Record', 'Start of Authority', soaRecs ? soaRecs.length : 0, soaBody, delay);
  delay += 40;

  // ── 10. CAA Records ──────────────────────────────────────
  var caaBody = '';
  if (!caaRecs || !caaRecs.length) {
    caaBody = emptyS('No CAA records — any CA may issue certificates');
  } else {
    caaBody = '<table class="dt"><thead><tr><th>Value</th><th>TTL</th></tr></thead><tbody>';
    caaRecs.forEach(function(r) {
      caaBody += '<tr><td class="cm">' + h(r.data) + '</td><td class="cd">' + ttlFmt(getTTL(r)) + '</td></tr>';
    });
    caaBody += '</tbody></table>';
  }
  html += card('sec-caa', 'var(--ico-teal)', '🔒', 'CAA Records', 'Certificate Authority', caaRecs ? caaRecs.length : 0, caaBody, delay);
  delay += 40;

  // ── 11. DNSSEC status (public lookups only) ───────────────
  if (typeof renderDnssecCard === 'function') html += renderDnssecCard(dnssec, delay);

  document.getElementById('dns-results').innerHTML = '<div class="results">' + html + '</div>';
  if (typeof trackUsage === 'function') trackUsage('dns', domain);
}

// ── IP results — three separate cards matching old version exactly ─
function renderIpResults(ip, geo, ptrRecs) {
  var out    = document.getElementById('dns-results');
  var html   = '<div class="results">';
  var isIPv6 = ip.includes(':');

  // ── Card 1: IP Information (sec-ipinfo) ──────────────────
  var infoBody = '';
  if (!geo || geo.error) {
    // Show the IP address and a clear message — for IPv6 explain why geo is limited
    infoBody = '<div class="ip-hero"><div><div class="ip-hero-addr">' + h(ip) + '</div>';
    if (isIPv6) infoBody += '<div class="ip-hero-rdns">IPv6 — geolocation coverage is limited</div>';
    infoBody += '</div></div>';
    infoBody += '<div class="empty-s">' + (isIPv6
      ? 'Geolocation data is not widely available for IPv6 addresses. Check the PTR record below.'
      : 'Geolocation data unavailable for this IP.') + '</div>';
  } else {
    var flagEmoji = flag(geo.country);
    // Build field list — filter out nulls (matches old version)
    var fields = [
      ['Hostname',             geo.hostname || null],
      ['City',                 geo.city     || null],
      ['Region',               geo.region   || null],
      ['Country',              geo.country  ? flagEmoji + ' ' + geo.country : null],
      ['Postal',               geo.postal   || geo.zip || null],
      ['Timezone',             geo.timezone || null],
      ['ASN / Org',            geo.org      || null],
      ['Geographic Location',  geo.loc      || null]
    ].filter(function(f) { return f[1]; });

    infoBody = '<div class="ip-hero">' +
      '<div><div class="ip-hero-addr">' + h(ip) + '</div>' +
      (geo.hostname ? '<div class="ip-hero-rdns">' + h(geo.hostname) + '</div>' : '') +
      '</div>' +
      (geo.country ? pill(flagEmoji + ' ' + [geo.city, geo.region].filter(Boolean).join(', '), 'p-blue') : '') +
      '</div>' +
      '<div class="ip-grid">' +
      fields.map(function(f) {
        // Make ASN number clickable — opens BGP.he.net for prefix/route info
        if (f[0] === 'ASN / Org' && f[1]) {
          var asnMatch = f[1].match(/^AS(\d+)/i);
          var val = asnMatch
            ? '<a href="https://bgp.he.net/AS' + asnMatch[1] + '" target="_blank" rel="noopener" ' +
              'style="color:var(--blue);text-decoration:none" title="View ASN prefixes on BGP.he.net">' +
              h(f[1]) + ' ↗</a>'
            : h(f[1]);
          return '<div class="ip-cell"><div class="ip-lbl">' + h(f[0]) + '</div><div class="ip-val">' + val + '</div></div>';
        }
        return '<div class="ip-cell"><div class="ip-lbl">' + h(f[0]) + '</div><div class="ip-val">' + h(f[1]) + '</div></div>';
      }).join('') +
      '</div>';
  }
  html += card('sec-ipinfo', 'var(--ico-blue)', '◈', 'IP Information', 'Geolocation & Network', undefined, infoBody, 0);

  // ── Card 2: PTR Record (sec-ptr) ─────────────────────────
  var ptrBody = '';
  if (!ptrRecs || !ptrRecs.length) {
    ptrBody = emptyS('No PTR record found');
  } else {
    ptrBody = '<table class="dt"><thead><tr><th>Hostname</th><th>TTL</th></tr></thead><tbody>';
    ptrRecs.forEach(function(r) {
      ptrBody += '<tr><td class="cm">' + h(r.data) + '</td><td class="cd">' + ttlFmt(getTTL(r)) + '</td></tr>';
    });
    ptrBody += '</tbody></table>';
  }
  html += card('sec-ptr', 'var(--ico-teal)', '⇠', 'PTR Record', 'Reverse DNS', ptrRecs ? ptrRecs.length : 0, ptrBody, 40);

  // ── Card 3: Map (sec-map) ────────────────────────────────
  var hasLoc = geo && geo.loc && !geo.error;
  var mapBody = hasLoc
    ? '<div class="ip-map-wrap"><div id="ip-map"></div></div>'
    : '<div class="empty-s">Map not available for this IP</div>';
  html += card('sec-map', 'var(--ico-green)', '🗺', 'Map', 'Geographic Location', undefined, mapBody, 80);

  html += '</div>';
  out.innerHTML = html;

  // Init Leaflet map
  if (hasLoc && typeof L !== 'undefined') {
    setTimeout(function() {
      destroyMap();
      var mapEl = document.getElementById('ip-map');
      if (!mapEl) return;
      var coords = geo.loc.split(',').map(Number);
      _mapInstance = L.map('ip-map', { zoomControl: true, attributionControl: true })
        .setView(coords, 10);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 18
      }).addTo(_mapInstance);
      // Custom dot marker (matches old version)
      var dotIcon = L.divIcon({
        className: '',
        html: '<div style="width:14px;height:14px;border-radius:50%;background:var(--blue);border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)"></div>',
        iconSize: [14, 14],
        iconAnchor: [7, 7]
      });
      L.marker(coords, { icon: dotIcon }).addTo(_mapInstance)
        .bindPopup('<b style="font-family:\'DM Mono\',monospace;font-size:13px">' + h(ip) + '</b><br>' +
          '<span style="font-size:11px;color:#666">' +
          [geo.city, geo.region, geo.country].filter(Boolean).join(', ') +
          '</span>').openPopup();
    }, 150);
  }

  if (typeof trackUsage === 'function') trackUsage('ip', ip);
}
