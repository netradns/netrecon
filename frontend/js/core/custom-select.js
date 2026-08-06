// NetRecon — Custom Select
// Replaces native <select> elements with app-native styled dropdowns.
// The original <select> stays hidden in the DOM so all existing
// .value reads and onchange handlers continue to work unchanged.
//
// Usage:
//   Add class="f-select" to any <select> to auto-init on load.
//   Or call initCustomSelect(el) directly for dynamic selects.

'use strict';

function initCustomSelect(select) {
  if (!select || select._customSelectInit) return;
  select._customSelectInit = true;
  select.style.display = 'none';

  // ── Build wrapper ─────────────────────────────────────────
  var wrap = document.createElement('div');
  wrap.className = 'cs-wrap';
  if (select.style.width)  wrap.style.width  = select.style.width;
  if (select.style.height) wrap.style.height = select.style.height;
  select.parentNode.insertBefore(wrap, select);
  wrap.appendChild(select);

  // Trigger button
  var trigger = document.createElement('div');
  trigger.className = 'cs-trigger';
  trigger.setAttribute('tabindex', '0');
  trigger.innerHTML =
    '<span class="cs-value"></span>' +
    '<svg class="cs-arrow" width="8" height="8" viewBox="0 0 10 10" fill="none">' +
      '<path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';
  wrap.appendChild(trigger);

  // Dropdown panel
  var panel = document.createElement('div');
  panel.className = 'cs-panel';
  wrap.appendChild(panel);

  // ── Sync helpers ──────────────────────────────────────────
  function syncOptions() {
    panel.innerHTML = '';
    Array.from(select.options).forEach(function(opt) {
      var item = document.createElement('div');
      item.className = 'cs-option' + (opt.selected ? ' selected' : '');
      item.textContent = opt.text;
      item.dataset.value = opt.value;
      item.addEventListener('mousedown', function(e) {
        e.preventDefault();
        select.value = opt.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        close();
        syncValue();
      });
      panel.appendChild(item);
    });
  }

  function syncValue() {
    var sel = select.options[select.selectedIndex];
    trigger.querySelector('.cs-value').textContent = sel ? sel.text : '';
    panel.querySelectorAll('.cs-option').forEach(function(item) {
      item.classList.toggle('selected', item.dataset.value === select.value);
    });
  }

  // ── Open / close ──────────────────────────────────────────
  function open() {
    wrap.classList.add('open');
    trigger.classList.add('open');
    panel.classList.add('open');
    var rect = trigger.getBoundingClientRect();
    var spaceBelow = window.innerHeight - rect.bottom;
    panel.style.maxHeight = Math.min(240, spaceBelow > 160 ? spaceBelow - 8 : 200) + 'px';
  }

  function close() {
    wrap.classList.remove('open');
    trigger.classList.remove('open');
    panel.classList.remove('open');
  }

  trigger.addEventListener('click', function() {
    if (wrap.classList.contains('open')) { close(); return; }
    // Close any other open custom selects
    document.querySelectorAll('.cs-wrap.open').forEach(function(w) {
      w.classList.remove('open');
      w.querySelector('.cs-trigger') && w.querySelector('.cs-trigger').classList.remove('open');
      w.querySelector('.cs-panel')   && w.querySelector('.cs-panel').classList.remove('open');
    });
    open();
    var handler = function(e) {
      if (!wrap.contains(e.target)) {
        close();
        document.removeEventListener('click', handler, true);
      }
    };
    setTimeout(function() { document.addEventListener('click', handler, true); }, 0);
  });

  // Keyboard navigation
  trigger.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); trigger.click(); }
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      var idx = select.selectedIndex + (e.key === 'ArrowDown' ? 1 : -1);
      if (idx >= 0 && idx < select.options.length) {
        select.selectedIndex = idx;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        syncValue();
      }
    }
  });

  // Watch for dynamic option changes
  var observer = new MutationObserver(function() {
    syncOptions();
    syncValue();
  });
  observer.observe(select, { childList: true });

  // Disconnect observer when select is removed from DOM (prevents memory leak)
  var removalObserver = new MutationObserver(function() {
    if (!document.contains(select)) {
      observer.disconnect();
      removalObserver.disconnect();
    }
  });
  removalObserver.observe(document.body, { childList: true, subtree: true });

  syncOptions();
  syncValue();
}

function initAllCustomSelects(root) {
  (root || document).querySelectorAll('select.f-select').forEach(initCustomSelect);
}

// Auto-init static selects on load
document.addEventListener('DOMContentLoaded', function() {
  initAllCustomSelects();
});
