// NetRecon — URL Hash Routing + Copy Buttons
// Matches netrecon-old exactly:
//   setHash(['dns','google.com'])  → #dns/google.com
//   setHash(['ip','8.8.8.8'])      → #ip/8.8.8.8
//   setHash(['calc','10.0.0.0/24'])→ #calc/10.0.0.0%2F24
//   setHash(['cloud','aws','10.0.0.0/16']) → #cloud/aws/10.0.0.0%2F16
//   setHash(['idns','host.corp'])  → #idns/host.corp

'use strict';

// ── Hash writer ───────────────────────────────────────────────
function setHash(parts) {
  var hash = '#' + parts.map(encodeURIComponent).join('/');
  try {
    history.replaceState(null, '', hash);
  } catch(e) {
    window.location.hash = hash;
  }
}

// ── Hash reader — runs on load and hashchange ─────────────────
function readHash() {
  var raw = window.location.hash.replace(/^#/, '');
  if (!raw) return;

  var parts = raw.split('/').map(decodeURIComponent);
  var page  = parts[0];
  if (!page) return;

  function activatePage(pageId, navId) {
    document.querySelectorAll('.page').forEach(function(p) { p.classList.remove('active'); });
    document.querySelectorAll('.sb-item').forEach(function(b) { b.classList.remove('active'); });
    var pg = document.getElementById('page-' + pageId);
    var nb = document.getElementById('nav-' + navId);
    if (pg) pg.classList.add('active');
    if (nb) nb.classList.add('active');
    // Update topbar title
    var titleEl = document.getElementById('topbar-title');
    if (titleEl && PAGE_TITLES[pageId]) titleEl.innerHTML = PAGE_TITLES[pageId];
  }

  setTimeout(function() {
    if ((page === 'dns' || page === 'ip') && parts[1]) {
      activatePage('dns', 'dns');
      var inp = document.getElementById('domainInput');
      if (inp) { inp.value = parts[1]; runLookup(); }

    } else if (page === 'idns' && parts[1]) {
      activatePage('idns', 'idns');
      var inp = document.getElementById('idnsInput');
      if (inp) { inp.value = parts[1]; runIdnsLookup(); }

    } else if (page === 'calc' && parts[1]) {
      activatePage('calc', 'calc');
      var inp = document.getElementById('cidrInput');
      if (inp) { inp.value = parts[1]; runCalc(); }

    } else if (page === 'cloud' && parts[1] && parts[2]) {
      activatePage('cloud', 'cloud');
      if (typeof switchCloudTab === 'function') switchCloudTab(parts[1]);
      var inp = document.getElementById(parts[1] + '-cidr');
      if (inp) inp.value = parts[2];
      if (typeof generateCloud === 'function') generateCloud(parts[1]);
    }
  }, 150);
}

window.addEventListener('load', readHash);
window.addEventListener('hashchange', readHash);

// ── Wrap quick links to also set hash ────────────────────────
// DNS quick links
var _origDnsQuick = window.dnsQuick;
window.dnsQuick = function(domain) {
  setHash(['dns', domain]);
  if (_origDnsQuick) _origDnsQuick(domain);
  else {
    var inp = document.getElementById('domainInput');
    if (inp) { inp.value = domain; runLookup(); }
  }
};

// Calc quick links
var _origCalcQuick = window.calcQuick;
window.calcQuick = function(cidr) {
  setHash(['calc', cidr]);
  if (_origCalcQuick) _origCalcQuick(cidr);
  else {
    var inp = document.getElementById('cidrInput');
    if (inp) { inp.value = cidr; runCalc(); }
  }
};

// IDNS quick links
var _origIdnsQuick = window.idnsQuickLookup;
window.idnsQuickLookup = function(val) {
  if (val) setHash(['idns', val]);
  if (_origIdnsQuick) _origIdnsQuick(val);
  else {
    var inp = document.getElementById('idnsInput');
    if (inp) { inp.value = val; runIdnsLookup(); }
  }
};

// Set hash on DNS lookup run
var _origRunLookup = window.runLookup;
window.runLookup = function() {
  var inp = document.getElementById('domainInput');
  if (inp && inp.value.trim()) {
    var val = inp.value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim();
    var isIP = /^(\d{1,3}\.){3}\d{1,3}$/.test(val);
    setHash([isIP ? 'ip' : 'dns', val]);
  }
  if (_origRunLookup) return _origRunLookup.apply(this, arguments);
};

// Set hash on calc run
var _origRunCalc = window.runCalc;
window.runCalc = function() {
  var inp = document.getElementById('cidrInput');
  if (inp && inp.value.trim()) setHash(['calc', inp.value.trim()]);
  if (_origRunCalc) return _origRunCalc.apply(this, arguments);
};

// Set hash on IDNS run
var _origRunIdns = window.runIdnsLookup;
window.runIdnsLookup = function() {
  var inp = document.getElementById('idnsInput');
  if (inp && inp.value.trim()) setHash(['idns', inp.value.trim()]);
  if (_origRunIdns) return _origRunIdns.apply(this, arguments);
};

// Set hash on cloud generate
var _origGenerateCloud = window.generateCloud;
window.generateCloud = function(provider) {
  var inp = document.getElementById(provider + '-cidr');
  if (inp && inp.value.trim()) setHash(['cloud', provider, inp.value.trim()]);
  if (_origGenerateCloud) return _origGenerateCloud.apply(this, arguments);
};

// ── Copy buttons — injected into result card headers ──────────
(function() {
  var COPY_SVG = '<svg width="13" height="13" viewBox="0 0 15 15" fill="none">' +
    '<rect x="5" y="5" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.3"/>' +
    '<path d="M10 5V3.5A1.5 1.5 0 008.5 2h-5A1.5 1.5 0 002 3.5v5A1.5 1.5 0 003.5 10H5" stroke="currentColor" stroke-width="1.3"/></svg>';
  var CHECK_SVG = '<svg width="13" height="13" viewBox="0 0 15 15" fill="none">' +
    '<path d="M3.5 8l3 3 5-6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function extractCardText(card) {
    var body = card.querySelector('.card-body');
    if (!body) return '';
    var lines = [];
    body.querySelectorAll('table.dt').forEach(function(tbl) {
      var headers = [];
      tbl.querySelectorAll('thead th').forEach(function(th) { headers.push(th.textContent.trim()); });
      if (headers.length) lines.push(headers.join('\t'));
      tbl.querySelectorAll('tbody tr').forEach(function(tr) {
        var cells = [];
        tr.querySelectorAll('td').forEach(function(td) { cells.push(td.textContent.trim()); });
        if (cells.length) lines.push(cells.join('\t'));
      });
      lines.push('');
    });
    body.querySelectorAll('.ip-cell, .cidr-cell').forEach(function(cell) {
      var lbl = cell.querySelector('.ip-lbl, .cidr-lbl');
      var val = cell.querySelector('.ip-val, .cidr-val');
      if (lbl && val) lines.push(lbl.textContent.trim() + ': ' + val.textContent.trim());
    });
    var hero = body.querySelector('.ip-hero-addr');
    if (hero) lines.unshift(hero.textContent.trim());
    return lines.join('\n').trim();
  }

  function extractCalcText(container) {
    var lines = [];
    var banner = container.querySelector('.cidr-banner');
    if (banner) {
      var net = banner.querySelector('.cidr-network');
      if (net) lines.push(net.textContent.trim());
    }
    container.querySelectorAll('.cidr-cell').forEach(function(cell) {
      var lbl = cell.querySelector('.cidr-lbl');
      var val = cell.querySelector('.cidr-val');
      if (lbl && val) lines.push(lbl.textContent.trim() + ': ' + val.textContent.trim());
    });
    container.querySelectorAll('table.dt').forEach(function(tbl) {
      lines.push('');
      var headers = [];
      tbl.querySelectorAll('thead th').forEach(function(th) { headers.push(th.textContent.trim()); });
      if (headers.length) lines.push(headers.join('\t'));
      tbl.querySelectorAll('tbody tr').forEach(function(tr) {
        if (tr.classList.contains('split-detail')) return;
        var cells = [];
        tr.querySelectorAll('td').forEach(function(td) { cells.push(td.textContent.trim()); });
        if (cells.length) lines.push(cells.join('\t'));
      });
    });
    return lines.join('\n').trim();
  }

  function doCopy(text, btn) {
    if (!text) return;
    navigator.clipboard.writeText(text).then(function() {
      btn.innerHTML = CHECK_SVG;
      btn.classList.add('copied');
      setTimeout(function() { btn.innerHTML = COPY_SVG; btn.classList.remove('copied'); }, 1500);
    }).catch(function() {});
  }

  function injectCopyButtons(container) {
    // Result cards
    container.querySelectorAll('.card').forEach(function(card) {
      var hdr = card.querySelector('.card-hdr');
      if (!hdr || hdr.querySelector('.copy-card-btn')) return;
      if (!card.querySelector('.card-body') || card.querySelector('.error-s') || card.querySelector('.empty-s')) return;
      var btn = document.createElement('button');
      btn.className = 'copy-card-btn';
      btn.title = 'Copy to clipboard';
      btn.innerHTML = COPY_SVG;
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        doCopy(extractCardText(card), btn);
      });
      var chev = hdr.querySelector('.ch-chev');
      if (chev) hdr.insertBefore(btn, chev);
      else hdr.appendChild(btn);
    });

    // CIDR summary (calc)
    container.querySelectorAll('.cidr-summary').forEach(function(summary) {
      var banner = summary.querySelector('.cidr-banner');
      if (!banner || banner.querySelector('.copy-card-btn')) return;
      var btn = document.createElement('button');
      btn.className = 'copy-card-btn';
      btn.title = 'Copy to clipboard';
      btn.innerHTML = COPY_SVG;
      btn.style.marginLeft = '8px';
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        doCopy(extractCalcText(summary.closest('.calc-results') || summary), btn);
      });
      banner.appendChild(btn);
    });
  }

  // Observe all result containers
  ['dns-results', 'idns-results', 'calc-results'].forEach(function(id) {
    var el = document.getElementById(id);
    if (!el) return;
    var obs = new MutationObserver(function() {
      obs.disconnect();
      setTimeout(function() {
        injectCopyButtons(el);
        obs.observe(el, { childList: true, subtree: true });
      }, 50);
    });
    obs.observe(el, { childList: true, subtree: true });
  });
})();
