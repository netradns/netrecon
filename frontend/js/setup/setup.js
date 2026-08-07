// ── NetRecon — First-Run Setup Wizard ────────────────────────────
// Handles the one-time setup flow that runs on first launch.
//
// The setup wizard is shown instead of the main app when the backend
// reports setupComplete === false. Once the user submits the form,
// the page reloads and the normal app appears.
//
// This script is loaded on index.html. It checks setup status on
// page load and injects the wizard overlay if setup is needed.
//
// After setup, this script does nothing — the status check returns
// setupComplete: true and the wizard never appears again.

'use strict';

(async function checkSetupStatus() {
  try {
    var r = await fetch('/api/setup/status', { cache: 'no-store' });
    if (!r.ok) return; // If the endpoint fails, assume setup is done
    var d = await r.json();
    if (d.setupComplete === false) {
      showSetupWizard();
    }
  } catch (e) {
    // Network error or backend not ready — don't block the app
    console.warn('[setup] Status check failed:', e.message);
  }
})();

/**
 * Injects the setup wizard overlay into the page.
 * Hides the sidebar and main content until setup is complete.
 */
function showSetupWizard() {
  // Hide the main app
  var sidebar = document.getElementById('sidebar');
  var main    = document.querySelector('.main');
  var overlay = document.getElementById('sbOverlay');
  if (sidebar) sidebar.style.display = 'none';
  if (main)    main.style.display    = 'none';
  if (overlay) overlay.style.display = 'none';

  // Create the wizard overlay
  var wizard = document.createElement('div');
  wizard.id = 'setup-wizard';
  wizard.innerHTML = [
    '<div class="setup-container">',
    '  <div class="setup-header">',
    '    <img src="images/netrecon.png" alt="NetRecon" width="40" height="40" style="border-radius:8px">',
    '    <div>',
    '      <div class="setup-title">Welcome to NetRecon</div>',
    '      <div class="setup-subtitle">Let\'s get you set up. This only takes a moment.</div>',
    '    </div>',
    '  </div>',
    '',
    '  <form id="setupForm" autocomplete="off">',
    '    <div class="setup-section">',
    '      <div class="setup-section-title">Admin Password</div>',
    '      <div class="setup-section-desc">Set a password for the admin panel. You\'ll use this to access settings, stats, and watched domains.</div>',
    '      <div class="setup-field">',
    '        <label for="setupPassword">Password</label>',
    '        <input type="password" id="setupPassword" placeholder="Choose a password (min 4 characters)" required minlength="4" autocomplete="new-password">',
    '      </div>',
    '      <div class="setup-field">',
    '        <label for="setupPasswordConfirm">Confirm Password</label>',
    '        <input type="password" id="setupPasswordConfirm" placeholder="Re-enter password" required minlength="4" autocomplete="new-password">',
    '      </div>',
    '    </div>',
    '',
    '    <div class="setup-section">',
    '      <div class="setup-section-title">Internal DNS Servers <span class="setup-optional">(optional)</span></div>',
    '      <div class="setup-section-desc">If you want to resolve internal/private hostnames (e.g., server.corp.local), enter your DNS server IPs below. Leave blank if you only need public DNS lookups.</div>',
    '      <div class="setup-field">',
    '        <label for="setupDnsServers">DNS Server IPs</label>',
    '        <input type="text" id="setupDnsServers" placeholder="e.g., 192.168.1.10, 192.168.1.11" autocomplete="off">',
    '      </div>',
    '    </div>',
    '',
    '    <div class="setup-actions">',
    '      <button type="submit" class="setup-btn" id="setupSubmitBtn">',
    '        Complete Setup',
    '      </button>',
    '    </div>',
    '',
    '    <div class="setup-error" id="setupError" style="display:none"></div>',
    '  </form>',
    '',
    '  <div class="setup-footer">',
    '    All settings can be changed later in the admin panel.',
    '  </div>',
    '</div>',
  ].join('\n');

  document.body.appendChild(wizard);

  // Bind form submission
  document.getElementById('setupForm').addEventListener('submit', handleSetupSubmit);
}

/**
 * Handles the setup form submission.
 * Validates inputs, sends to backend, reloads on success.
 */
async function handleSetupSubmit(e) {
  e.preventDefault();

  var password = document.getElementById('setupPassword').value.trim();
  var confirm  = document.getElementById('setupPasswordConfirm').value.trim();
  var dns      = document.getElementById('setupDnsServers').value.trim();
  var errorEl  = document.getElementById('setupError');
  var btn      = document.getElementById('setupSubmitBtn');

  // Clear previous error
  errorEl.style.display = 'none';

  // Validate
  if (password.length < 4) {
    showSetupError('Password must be at least 4 characters.');
    return;
  }
  if (password !== confirm) {
    showSetupError('Passwords do not match.');
    return;
  }

  // Disable button
  btn.disabled = true;
  btn.textContent = 'Setting up…';

  try {
    var r = await fetch('/api/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password:   password,
        dnsServers: dns,
      }),
    });

    var d = await r.json();

    if (r.ok && d.ok) {
      // Success — reload the page to show the normal app
      window.location.reload();
    } else {
      showSetupError(d.error || 'Setup failed. Please try again.');
      btn.disabled = false;
      btn.textContent = 'Complete Setup';
    }
  } catch (err) {
    showSetupError('Connection error: ' + err.message);
    btn.disabled = false;
    btn.textContent = 'Complete Setup';
  }
}

function showSetupError(msg) {
  var el = document.getElementById('setupError');
  if (el) {
    el.textContent = msg;
    el.style.display = 'block';
  }
}
