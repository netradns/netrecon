// NetRecon — reset the admin password from the command line.
//
// For when the password is forgotten. Run it inside the dns-proxy container,
// then restart the container so the running server picks up the change and
// everyone is signed out:
//
//   docker compose exec -u node dns-proxy node reset-password.js
//   docker compose restart dns-proxy
//
// With no arguments a strong random password is generated and printed once.
// To choose your own, pass it in the environment instead of on the command
// line, so it does not end up in shell history:
//
//   docker compose exec -u node -e NEW_PASSWORD='your new password' dns-proxy node reset-password.js

'use strict';

const crypto = require('crypto');
const { setPassword, validateNewPassword } = require('./lib/admin/password');
const { queueCliEvent } = require('./lib/admin/audit');

// Readable random password: 4 groups of 4 letters and digits, no look-alike characters
function generatePassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const group = () => Array.from(crypto.randomBytes(4), b => alphabet[b % alphabet.length]).join('');
  return [group(), group(), group(), group()].join('-');
}

(async () => {
  const chosen   = process.env.NEW_PASSWORD;
  const password = chosen !== undefined && chosen !== '' ? chosen : generatePassword();

  const problem = validateNewPassword(password);
  if (problem) {
    console.error(`Not changed: ${problem}.`);
    process.exit(1);
  }

  await setPassword(password);
  queueCliEvent('password_reset_cli', 'reset with reset-password.js');   // shown in the admin Activity page after the restart

  console.log('The admin password has been reset.');
  if (!chosen) {
    console.log('');
    console.log(`  Username: admin`);
    console.log(`  Password: ${password}`);
    console.log('');
    console.log('Write it down now. It is not stored anywhere in readable form.');
  }
  console.log('Restart the container so the change takes effect and everyone is signed out:');
  console.log('  docker compose restart dns-proxy');
})().catch(err => {
  console.error(`Could not reset the password: ${err.message}`);
  process.exit(1);
});
