// NetRecon — Cloud CIDR Planning
// AWS VPC, GCP VPC, and Azure VNet subnet allocation

'use strict';

var _activeProvider = 'aws';

// ── Init — render all tier lists on load ─────────────────────
document.addEventListener('DOMContentLoaded', function() {
  ['aws', 'gcp', 'azure'].forEach(function(p) { renderTierList(p); });
  // Init custom selects on the static cloud form dropdowns
  if (typeof initAllCustomSelects === 'function') {
    ['aws-region','aws-azs','gcp-region','gcp-regions','azure-region','azure-azs'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) initCustomSelect(el);
    });
  }
});

// ── Switch provider tab ──────────────────────────────────────
function switchCloudTab(provider) {
  _activeProvider = provider;
  document.querySelectorAll('.cloud-tab').forEach(function(tab) {
    tab.classList.toggle('active', tab.getAttribute('data-p') === provider);
  });
  ['aws', 'gcp', 'azure'].forEach(function(p) {
    var f = document.getElementById('cloud-form-' + p);
    if (f) f.style.display = p === provider ? 'block' : 'none';
  });
}

// ── Get current tiers from DOM ───────────────────────────────
function getTiers(provider) {
  var list = document.getElementById(provider + '-tier-list');
  if (!list) return [];
  var rows = list.querySelectorAll('.sb-tier-row');
  var tiers = [];
  rows.forEach(function(row) {
    var nameEl  = row.querySelector('.sb-tier-name');
    var sizeEl  = row.querySelector('.sb-tier-size');
    var colorEl = row.querySelector('.sb-swatch-pick');
    tiers.push({
      name:  nameEl  ? nameEl.value  : '',
      size:  sizeEl  ? sizeEl.value  : '24',
      color: colorEl ? colorEl.dataset.color : '#3b82f6'
    });
  });
  return tiers;
}

// ── Render tier list ─────────────────────────────────────────
function renderTierList(provider) {
  var container = document.getElementById(provider + '-tier-list');
  if (!container) return;
  // Destroy any existing custom select wrappers to prevent accumulation
  container.querySelectorAll('.cs-wrap').forEach(function(w) {
    var sel = w.querySelector('select');
    if (sel) w.parentNode.insertBefore(sel, w);
    w.remove();
  });
  container.innerHTML = '';
  TIER_PRESETS[provider].forEach(function(tier, idx) {
    var row = makeTierRow(provider, tier, idx);
    container.appendChild(row);
    var sel = row.querySelector('select.f-select');
    if (sel && typeof initCustomSelect === 'function') initCustomSelect(sel);
  });
}

// ── Build a single tier row DOM element ──────────────────────
function makeTierRow(provider, tier, idx) {
  var row = document.createElement('div');
  row.className = 'sb-tier-row';
  row.dataset.index = idx;

  // Name input
  var nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'sb-tier-input sb-tier-name';
  nameInput.value = tier.name;
  nameInput.placeholder = 'Subnet name';
  row.appendChild(nameInput);

  // Size select — descending with usable hosts inline
  var sizeSelect = document.createElement('select');
  sizeSelect.className = 'sb-tier-select sb-tier-size f-select';
  [28, 27, 26, 25, 24, 23, 22, 21, 20].forEach(function(p) {
    var opt = document.createElement('option');
    opt.value = String(p);
    opt.textContent = '/' + p + ' (' + formatNumber(getUsable(p)) + ' hosts)';
    if (String(p) === String(tier.size)) opt.selected = true;
    sizeSelect.appendChild(opt);
  });
  row.appendChild(sizeSelect);

  // Color swatch
  var swatch = document.createElement('div');
  swatch.className = 'sb-swatch-pick';
  swatch.style.background = tier.color;
  swatch.dataset.color = tier.color;
  swatch.title = 'Change color';
  swatch.onclick = function() { openColorPicker(provider, idx); };
  row.appendChild(swatch);

  // Remove button
  var removeBtn = document.createElement('button');
  removeBtn.className = 'sb-remove-btn';
  removeBtn.title = 'Remove tier';
  removeBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><circle cx="5" cy="5" r="4" stroke="currentColor" stroke-width="1.2"/><path d="M3 5h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
  removeBtn.onclick = function() {
    TIER_PRESETS[provider].splice(idx, 1);
    renderTierList(provider);
  };
  row.appendChild(removeBtn);

  return row;
}

// ── Add tier ─────────────────────────────────────────────────
function addTier(provider) {
  TIER_PRESETS[provider].push({
    name:  'Subnet ' + (TIER_PRESETS[provider].length + 1),
    size:  '24',
    color: COLOR_PALETTE[TIER_PRESETS[provider].length % COLOR_PALETTE.length]
  });
  renderTierList(provider);
}

// ── Color picker modal ───────────────────────────────────────
function openColorPicker(provider, idx) {
  var existing = document.querySelector('.color-picker-overlay');
  if (existing) existing.remove();

  var overlay = document.createElement('div');
  overlay.className = 'color-picker-overlay';
  overlay.onclick = function() { overlay.remove(); };

  var modal = document.createElement('div');
  modal.className = 'color-picker-modal';
  modal.onclick = function(e) { e.stopPropagation(); };

  var currentColor = TIER_PRESETS[provider][idx] ? TIER_PRESETS[provider][idx].color : '#3b82f6';

  var html = '<div class="color-picker-title">Choose Color</div>';
  html += '<div class="color-picker-grid">';
  COLOR_PALETTE.forEach(function(color) {
    var sel = color === currentColor ? ' selected' : '';
    html += '<div class="color-swatch' + sel + '" style="background:' + color + '" onclick="pickColor(\'' + provider + '\',' + idx + ',\'' + color + '\')" title="' + color + '">';
    if (sel) html += '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8l4 4 6-8" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    html += '</div>';
  });
  html += '</div>';
  html += '<div class="color-picker-custom"><label>Custom:</label>';
  html += '<input type="color" value="' + currentColor + '" onchange="pickColor(\'' + provider + '\',' + idx + ',this.value)"/></div>';

  modal.innerHTML = html;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

function pickColor(provider, idx, color) {
  if (TIER_PRESETS[provider][idx]) TIER_PRESETS[provider][idx].color = color;
  renderTierList(provider);
  var overlay = document.querySelector('.color-picker-overlay');
  if (overlay) overlay.remove();
}

// ── Zone name helpers ────────────────────────────────────────
function getAwsAzNames(region, count) {
  var zones = ['a','b','c','d','e','f'];
  var names = [];
  for (var i = 0; i < count; i++) names.push(region + zones[i % zones.length]);
  return names;
}

function getGcpRegionNames(primaryRegion, extraCount) {
  var all = ['us-central1','us-east1','us-west1','europe-west1','asia-southeast1','asia-northeast1'];
  var names = [primaryRegion];
  all.filter(function(r) { return r !== primaryRegion; }).slice(0, extraCount).forEach(function(r) { names.push(r); });
  return names;
}

function getAzureAzNames(region, count) {
  var names = [];
  for (var i = 1; i <= count; i++) names.push(region + ' — Zone ' + i);
  return names;
}

// ── Generate cloud plan ──────────────────────────────────────
function generateCloud(provider) {
  var cidrInput = document.getElementById(provider + '-cidr');
  var cidr = cidrInput ? cidrInput.value.trim() : '';

  if (!cidr.includes('/')) {
    document.getElementById('cloud-results').innerHTML = '<div class="calc-error">⚠ Please enter a valid CIDR block (e.g. 10.0.0.0/16)</div>';
    return;
  }

  var parts = cidr.split('/');
  var baseIP = parts[0];
  var prefix = parseInt(parts[1], 10);

  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(baseIP) || baseIP.split('.').some(o => parseInt(o) > 255) || prefix < 8 || prefix > 28) {
    document.getElementById('cloud-results').innerHTML = '<div class="calc-error">⚠ Invalid CIDR. Use a prefix between /8 and /28.</div>';
    return;
  }

  var tiers = getTiers(provider);
  if (!tiers.length) {
    document.getElementById('cloud-results').innerHTML = '<div class="calc-error">⚠ Add at least one subnet tier.</div>';
    return;
  }

  var mask       = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;
  var networkLong = (ip2long(baseIP) & mask) >>> 0;
  var networkIP   = long2ip(networkLong);
  var totalIPs    = Math.pow(2, 32 - prefix);

  var zoneNames;
  var vpcLabel, zoneLabel;

  if (provider === 'aws') {
    var region = document.getElementById('aws-region').value;
    var azCount = parseInt(document.getElementById('aws-azs').value);
    zoneNames = getAwsAzNames(region, azCount);
    vpcLabel  = 'VPC';
    zoneLabel = 'AZ';
  } else if (provider === 'gcp') {
    var gcpRegion = document.getElementById('gcp-region').value;
    var extraRegions = parseInt(document.getElementById('gcp-regions').value);
    zoneNames = getGcpRegionNames(gcpRegion, extraRegions);
    vpcLabel  = 'VPC Network';
    zoneLabel = 'Region';
  } else {
    var azureRegion = document.getElementById('azure-region').value;
    var azureAZs = parseInt(document.getElementById('azure-azs').value);
    zoneNames = getAzureAzNames(azureRegion, azureAZs);
    vpcLabel  = 'VNet';
    zoneLabel = 'AZ';
  }

  trackUsage('cloud', cidr);
  renderCloudResult(
    document.getElementById('cloud-results'),
    provider, networkIP, prefix, networkLong, totalIPs,
    tiers, zoneNames, vpcLabel, zoneLabel
  );
}
