// NetRecon — DNSSEC status for public DNS lookups
// Shows whether a domain's DNS answers are signed and validated.
//
// The server (dns-proxy/lib/dnssec.js) sends one of these statuses:
//   secure    answers are signed and validated
//   insecure  the domain is not signed. This is common and not an error.
//   partial   the zone is signed, but the parent has no DS record, so nobody can validate it
//   bogus     signed, but validation FAILS, so validating resolvers refuse the domain
//   unknown   the check could not be completed
//
// "Not signed" is shown in neutral gray, never red: most domains do not use DNSSEC.

'use strict';

var DNSSEC_LABELS = {
  secure:   { text: '\u2713 Validated', cls: 'p-green'  },
  insecure: { text: 'Not signed',       cls: 'p-gray'   },
  partial:  { text: 'Partial',          cls: 'p-yellow' },
  bogus:    { text: '\u2715 Failing',   cls: 'p-red'    },
  unknown:  { text: 'Unknown',          cls: 'p-gray'   }
};

var DNSSEC_EXPLAIN = {
  secure:   'The answers for this domain are cryptographically signed and were validated. Resolvers can detect forged or tampered responses.',
  insecure: 'This domain does not use DNSSEC. That is common and not an error. DNSSEC adds signatures that let resolvers detect forged DNS answers.',
  partial:  'The zone publishes DNSSEC signatures, but its parent zone has no matching DS record, so resolvers cannot validate it and the signatures protect nothing. Add the DS record at your registrar, or turn DNSSEC off.',
  bogus:    'DNSSEC validation fails for this domain. Resolvers that validate DNSSEC, including Cloudflare, Google and most ISPs, will refuse to resolve it. Common causes are a DS record at the registrar that does not match the zone\'s keys, or expired signatures.',
  unknown:  'The DNSSEC status could not be determined right now.'
};

// ── Small pill for the health bar ────────────────────────────
function dnssecPill(d) {
  if (!d || !DNSSEC_LABELS[d.status]) return '';
  var l = DNSSEC_LABELS[d.status];
  return '<span class="h-lbl" style="margin-left:14px">DNSSEC</span>' + pill(l.text, l.cls);
}

// ── Full card ────────────────────────────────────────────────
function dnssecCell(label, valueHtml) {
  return '<div class="ip-cell"><div class="ip-lbl">' + label + '</div><div class="ip-val">' + valueHtml + '</div></div>';
}

function renderDnssecCard(d, delay) {
  if (!d || !DNSSEC_LABELS[d.status]) return '';
  var l    = DNSSEC_LABELS[d.status];
  var body = '<div style="padding:14px 18px">' + pill(l.text, l.cls) +
    '<div style="font-size:12.5px;color:var(--text-3);margin-top:8px;line-height:1.5">' + h(DNSSEC_EXPLAIN[d.status]) + '</div>';
  if (d.reason && (d.status === 'bogus' || d.status === 'unknown')) {
    body += '<div class="cd" style="margin-top:8px;word-break:break-word">' + h(d.reason) + '</div>';
  }
  body += '</div>';

  // Details only when the zone is signed
  if (d.signer) {
    var cells = '';
    cells += dnssecCell('Signed zone', h(d.signer));

    if (d.algorithm) {
      cells += dnssecCell('Signature algorithm', h(d.algorithm.name) +
        (d.algorithm.weak ? ' ' + pill('outdated', 'p-yellow') : ''));
    }

    if (d.signatureExpires) {
      var days = Math.floor((d.signatureExpires - Date.now()) / 86400000);
      // Many providers re-sign every day or two, so a short remaining time is normal. Only flag expiry.
      var soon = days < 0;
      cells += dnssecCell('Signatures valid until', h(new Date(d.signatureExpires).toLocaleDateString()) +
        ' <span style="font-size:11px;color:' + (soon ? 'var(--red)' : 'var(--text-3)') + '">(' +
        (days < 0 ? 'expired' : days + ' day' + (days === 1 ? '' : 's')) + ')</span>');
    }

    if (d.keys && d.keys.length) {
      var ksk = d.keys.filter(function(k) { return k.role === 'KSK'; }).length;
      var zsk = d.keys.length - ksk;
      cells += dnssecCell('Keys published', ksk + ' key-signing, ' + zsk + ' zone-signing');
    }

    body += '<div class="ip-grid">' + cells + '</div>';

    // DS records held by the parent zone (what the registrar publishes)
    if (d.ds && d.ds.length) {
      body += '<table class="dt"><thead><tr><th>DS key tag</th><th>Algorithm</th><th>Digest</th><th>Digest value</th></tr></thead><tbody>';
      d.ds.forEach(function(r) {
        body += '<tr><td class="cm">' + h(r.keyTag) + '</td>' +
          '<td class="cm">' + h(r.algorithm.name) + (r.algorithm.weak ? ' ' + pill('outdated', 'p-yellow') : '') + '</td>' +
          '<td class="cm">' + h(r.digestType.name) + (r.digestType.weak ? ' ' + pill('outdated', 'p-yellow') : '') + '</td>' +
          '<td class="cm cw" style="font-size:11px">' + h(r.digest) + '</td></tr>';
      });
      body += '</tbody></table>';
    }
  }

  return card('sec-dnssec', 'var(--ico-green)', '\u26BF', 'DNSSEC', 'Signed DNS answers', undefined, body, delay);
}
