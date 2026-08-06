// NetRecon — Core Utilities
// Shared helper functions used across all modules

'use strict';

// ── HTML escaping ────────────────────────────────────────────────
// Prevents XSS by escaping user input before inserting into DOM
function h(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Pill badges ──────────────────────────────────────────────────
// Creates colored pill badges for status indicators
// Usage: pill('5 records', 'p-green')
function pill(text, className) {
  return '<span class="pill ' + className + '">' + h(text) + '</span>';
}

// ── Collapsible card — count badge shows "N records" (matches old version) ───
function card(id, bgColor, icon, title, subtitle, count, body, delay) {
  var delayStyle = delay ? ' style="animation-delay:' + delay + 'ms"' : '';
  var countBadge = count !== undefined
    ? '<span class="ch-cnt">' + count + ' record' + (count !== 1 ? 's' : '') + '</span>'
    : '';
  var html = '<div class="card"' + delayStyle + ' id="' + id + '">';
  html += '<div class="card-hdr" onclick="tc(\'' + id + '\')">';
  html += '<div class="ch-ico" style="background:' + bgColor + '">' + icon + '</div>';
  html += '<span class="ch-t">' + h(title) + '</span>';
  if (subtitle) html += '<span class="ch-s">' + subtitle + '</span>';
  html += countBadge;
  html += '<svg class="ch-chev" width="12" height="12" viewBox="0 0 12 12" fill="none">';
  html += '<path d="M2.5 4.5L6 7.5L9.5 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>';
  html += '</svg>';
  html += '</div>';
  html += '<div class="card-body">' + body + '</div>';
  html += '</div>';
  return html;
}

// ── Toggle card — old version uses tc() ──────────────────────────
function tc(id) {
  var el = document.getElementById(id);
  if (el) el.classList.toggle('collapsed');
}

// Keep toggleCard as alias for backwards compat
function toggleCard(id) { tc(id); }

// ── Scroll to section — matches old version (60ms delay, smooth scroll) ─────
// Also uncollapses the card if it was collapsed
function scrollToSec(id) {
  setTimeout(function() {
    var el = document.getElementById(id);
    if (!el) return;
    // Uncollapse if collapsed
    if (el.classList.contains('collapsed')) el.classList.remove('collapsed');
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 60);
}

// ── Loading state ────────────────────────────────────────────────
function loadingState(message) {
  return '<div class="load-s"><div class="spin"></div>' + h(message) + '</div>';
}

// ── Error state ──────────────────────────────────────────────────
function errorState(message) {
  return '<div class="error-s">⚠ ' + h(message) + '</div>';
}

// ── Empty state ──────────────────────────────────────────────────
function emptyState(message) {
  return '<div class="empty-s">○ ' + h(message) + '</div>';
}

// ── Usage tracking — writes to localStorage AND server (matches old version) ─
function trackUsage(type, target) {
  // 1. localStorage counters + history (for client-side stats)
  try {
    var stats = JSON.parse(localStorage.getItem('nr-stats') || '{}');
    stats[type] = (stats[type] || 0) + 1;
    localStorage.setItem('nr-stats', JSON.stringify(stats));

    var history = JSON.parse(localStorage.getItem('nr-history') || '[]');
    history.push({ type: type, target: String(target).slice(0, 100), ts: Date.now() });
    if (history.length > 100) history.splice(0, history.length - 100);
    localStorage.setItem('nr-history', JSON.stringify(history));
  } catch(e) {}

  // 2. Server-side aggregated stats
  try {
    fetch('/api/internal-dns/stats/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: type, target: String(target).slice(0, 100) })
    }).catch(function() {});
  } catch(e) {}
}

// ── IP address helpers ───────────────────────────────────────────
function ip2long(ip) {
  var parts = ip.split('.');
  return ((parseInt(parts[0]) << 24) + (parseInt(parts[1]) << 16) + (parseInt(parts[2]) << 8) + parseInt(parts[3])) >>> 0;
}

function long2ip(n) {
  return [(n >>> 24) & 0xFF, (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, n & 0xFF].join('.');
}

// ── Usable hosts — matches old version exactly ───────────────────
// For /31 and /32: returns Math.pow(2, 32-prefix) (no subtraction)
// For others: subtracts 2 (network + broadcast)
function getUsable(prefix) {
  if (prefix >= 31) return Math.pow(2, 32 - prefix);
  return Math.max(0, Math.pow(2, 32 - prefix) - 2);
}

// ── Number formatting — matches old version (no comma separators in main app) ─
function formatNumber(n) {
  return String(n);
}

// ── Copy to clipboard ────────────────────────────────────────────
function copyToClipboard(text, button) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function() {
      if (button) {
        var orig = button.innerHTML;
        button.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        button.classList.add('copied');
        setTimeout(function() {
          button.innerHTML = orig;
          button.classList.remove('copied');
        }, 2000);
      }
    }).catch(function() {
      alert('Copy failed. Please copy manually: ' + text);
    });
  } else {
    // Fallback for older browsers
    var textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      if (button) {
        button.classList.add('copied');
        setTimeout(function() { button.classList.remove('copied'); }, 2000);
      }
    } catch(e) {
      alert('Copy failed. Please copy manually: ' + text);
    }
    document.body.removeChild(textarea);
  }
}

// ── TTL formatting — shared by DNS and IDNS renderers ────────────
// Handles both r.TTL (uppercase, DoH format) and r.ttl (lowercase, proxy format)
function ttlFmt(ttl) {
  if (!ttl) return '—';
  if (ttl < 60)   return ttl + 's';
  if (ttl < 3600) return Math.floor(ttl / 60) + 'm';
  return Math.floor(ttl / 3600) + 'h';
}

function getTTL(r) {
  return r.TTL || r.ttl || 0;
}

// ── Toast notifications ──────────────────────────────────────────
// Shows a brief message at the bottom of the screen.
// Requires a <div class="toast" id="toast"></div> in the HTML.
var _toastTimer = null;
function toast(msg, isError) {
  var el = document.getElementById('toast');
  if (!el) { console.log('[toast]', msg); return; }
  el.textContent = msg;
  el.className = 'toast' + (isError ? ' toast-error' : '');
  // Force reflow before adding .show so the transition plays
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(function() { el.classList.remove('show'); }, 3000);
}
