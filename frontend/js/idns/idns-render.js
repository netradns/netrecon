// NetRecon — Internal DNS Results Rendering

'use strict';

function renderIdnsResults(query, records, server) {
  var out = document.getElementById('idns-results');

  if (!records.length) {
    out.innerHTML = '<div class="results"><div class="card" style="animation:fu .2s ease both">' +
      '<div class="card-hdr" style="cursor:default">' +
      '<div class="ch-ico" style="background:var(--ico-yellow)">◈</div>' +
      '<span class="ch-t">No records found</span>' +
      '<span class="ch-s">for ' + h(query) + '</span></div>' +
      '<div class="card-body"><div class="empty-s">No DNS records returned. ' +
      'The name may not exist in the internal zone, or the record type was not found.</div>' +
      '</div></div></div>';
    return;
  }

  // Group by type
  var groups = {};
  records.forEach(function(r) {
    var t = r.type || 'UNKNOWN';
    if (!groups[t]) groups[t] = [];
    groups[t].push(r);
  });

  var typeCfg = {
    A:    { ico: '◈', bg: 'var(--ico-blue)',   label: 'A Records',    sub: 'IPv4 Addresses' },
    AAAA: { ico: '◈', bg: 'var(--ico-green)',  label: 'AAAA Records', sub: 'IPv6 Addresses' },
    CNAME:{ ico: '⇢', bg: 'var(--ico-yellow)', label: 'CNAME Records',sub: 'Aliases'        },
    MX:   { ico: '✉', bg: 'var(--ico-pink)',   label: 'MX Records',   sub: 'Mail Exchange'  },
    SRV:  { ico: '⚙', bg: 'var(--ico-purple)', label: 'SRV Records',  sub: 'Service Locator'},
    TXT:  { ico: '≡', bg: 'var(--ico-green)',  label: 'TXT Records',  sub: 'Text'           },
    NS:   { ico: '⬡', bg: 'var(--ico-green)',  label: 'NS Records',   sub: 'Nameservers'    },
    PTR:  { ico: '⇠', bg: 'var(--ico-teal)',   label: 'PTR Records',  sub: 'Reverse DNS'    }
  };

  // Summary health bar
  var html = '<div class="health-bar" style="animation:fu .2s ease both">' +
    '<span class="h-lbl">Internal DNS</span>' +
    pill(records.length + ' record' + (records.length !== 1 ? 's' : ''), 'p-green');
  Object.keys(groups).forEach(function(t) {
    html += pill(groups[t].length + ' ' + t, 'p-blue');
  });
  html += '<span class="h-domain">' + h(query) + '</span>' +
    '<span style="margin-left:8px;font-size:11px;color:var(--text-3);font-family:\'DM Mono\',monospace">via ' + h(server) + '</span>' +
    '</div>';

  // Cards per type — all include TTL column
  var delay = 40;
  Object.keys(groups).forEach(function(type) {
    var recs = groups[type];
    var cfg  = typeCfg[type] || { ico: '◈', bg: 'var(--ico-blue)', label: type + ' Records', sub: '' };
    var body = '';

    if (type === 'A' || type === 'AAAA') {
      body = '<table class="dt"><thead><tr><th>IP Address</th><th>Hostname</th><th>TTL</th></tr></thead><tbody>';
      recs.forEach(function(r) {
        body += '<tr><td class="cb">' + h(r.data) + '</td><td class="cd">' + h(r.name) + '</td><td class="cd">' + ttlFmt(r.TTL || r.ttl) + '</td></tr>';
      });
      body += '</tbody></table>';

    } else if (type === 'CNAME') {
      body = '<table class="dt"><thead><tr><th>Alias</th><th>Target</th><th>TTL</th></tr></thead><tbody>';
      recs.forEach(function(r) {
        body += '<tr><td class="cm">' + h(r.name) + '</td><td class="cm">→ ' + h(r.data) + '</td><td class="cd">' + ttlFmt(r.TTL || r.ttl) + '</td></tr>';
      });
      body += '</tbody></table>';

    } else if (type === 'MX') {
      var mxRows = recs.map(function(r) {
        var p = r.data.split(' ');
        return { pri: p[0], host: p.slice(1).join(' '), ttl: r.TTL || r.ttl };
      }).sort(function(a, b) { return parseInt(a.pri) - parseInt(b.pri); });
      body = '<table class="dt"><thead><tr><th>Priority</th><th>Mail Server</th><th>TTL</th></tr></thead><tbody>';
      mxRows.forEach(function(r) {
        body += '<tr><td><span class="pri-badge">' + h(r.pri) + '</span></td><td class="cm">' + h(r.host) + '</td><td class="cd">' + ttlFmt(r.ttl) + '</td></tr>';
      });
      body += '</tbody></table>';

    } else if (type === 'SRV') {
      body = '<table class="dt"><thead><tr><th>Priority</th><th>Weight</th><th>Port</th><th>Target</th><th>TTL</th></tr></thead><tbody>';
      recs.forEach(function(r) {
        body += '<tr>' +
          '<td><span class="pri-badge">' + h(String(r.priority != null ? r.priority : '')) + '</span></td>' +
          '<td class="cd">' + h(String(r.weight != null ? r.weight : '')) + '</td>' +
          '<td class="cb">' + h(String(r.port   != null ? r.port   : '')) + '</td>' +
          '<td class="cm">' + h(r.target || r.data) + '</td>' +
          '<td class="cd">' + ttlFmt(r.TTL || r.ttl) + '</td>' +
          '</tr>';
      });
      body += '</tbody></table>';

    } else {
      // TXT, NS, PTR, and anything else
      body = '<table class="dt"><thead><tr><th>' + type + ' Data</th><th>TTL</th></tr></thead><tbody>';
      recs.forEach(function(r) {
        body += '<tr><td class="cm cw">' + h(r.data) + '</td><td class="cd">' + ttlFmt(r.TTL || r.ttl) + '</td></tr>';
      });
      body += '</tbody></table>';
    }

    html += card('idns-sec-' + type, cfg.bg, cfg.ico, cfg.label, cfg.sub, recs.length, body, delay);
    delay += 40;
  });

  out.innerHTML = '<div class="results">' + html + '</div>';
}
