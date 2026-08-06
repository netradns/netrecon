// ── NetRecon — Notification Channel: Email (raw SMTP) ────────────
// Sends plain-text email alerts via a configured SMTP server.
// Uses raw TCP sockets — no external dependencies (no nodemailer).
//
// Supports:
//   - Unauthenticated relay (leave user/pass blank, port 25)
//   - Implicit TLS / SMTPS (port 465, set secure: true)
//   - Plain STARTTLS is NOT implemented — use port 465 for TLS
//     or port 25/587 for unauthenticated relay.
//     A contributor can add STARTTLS by upgrading the socket after
//     the EHLO/STARTTLS exchange.
//
// SMTP config comes from /data/config.json (set via admin Settings UI).
// See admin/config-store.js for the smtpConfig schema.
//
// ── SMTP response buffering ───────────────────────────────────────
// SMTP servers may send multi-line responses (e.g. "250-EHLO\r\n250 OK")
// across multiple TCP segments. We buffer incoming data and only advance
// the state machine when we see a complete final response line
// (a line whose 4th character is a space, not a dash).
// Format: "NNN SP text\r\n" = final line, "NNN-text\r\n" = continuation.

'use strict';

const net = require('net');
const tls = require('tls');
const { getConfig } = require('../../admin/config-store');

/**
 * Sends a plain-text email alert.
 *
 * @param {string} toAddress - Recipient email address
 * @param {string} title     - Email subject / alert title
 * @param {Array}  fields    - [{ label: string, value: string }]
 * @param {string} level     - info | warning | success | danger
 */
async function send(toAddress, title, fields = [], level = 'info') {
  const cfg  = getConfig();
  const smtp = cfg.smtpConfig;

  if (!smtp || !smtp.host) {
    throw new Error('SMTP not configured — set SMTP settings in admin panel');
  }

  // Sanitize all header values to prevent CRLF injection
  const from    = (smtp.from || `NetRecon <netrecon@${smtp.host}>`).replace(/[\r\n]/g, '');
  const to      = toAddress.replace(/[\r\n]/g, '');
  const subject = `[NetRecon] ${title}`.replace(/[\r\n]/g, ' ');

  // Extract bare email for SMTP envelope (MAIL FROM / RCPT TO expect bare addresses).
  // The full "Display Name <addr>" format is only used in the From: header.
  const envFrom = from.includes('<') ? (from.match(/<([^>]+)>/) || [])[1] || from : from;
  const envTo   = to.includes('<')   ? (to.match(/<([^>]+)>/)   || [])[1] || to   : to;

  // Build plain-text body
  const bodyLines = fields.map(f => `${f.label}: ${f.value}`).join('\n');
  const body = [
    'NetRecon Alert',
    '='.repeat(40),
    '',
    title,
    '',
    bodyLines,
    '',
    `Timestamp: ${new Date().toISOString()}`,
    '',
  ].join('\n');

  return sendRaw({ smtp, from, envFrom, to, envTo, subject, body });
}

// ── Raw SMTP sender ───────────────────────────────────────────────
/**
 * Sends an email via raw SMTP using a buffered step-based state machine.
 * Supports:
 *   - Unauthenticated relay (no user/pass)
 *   - AUTH PLAIN (when user + pass are provided)
 *   - Implicit TLS on port 465 (set secure: true)
 *   - Plain TCP on port 25/587 (STARTTLS not implemented)
 */
function sendRaw({ smtp, from, envFrom, to, envTo, subject, body }) {
  return new Promise((resolve, reject) => {
    // Build the SMTP conversation steps dynamically.
    const steps = [null, `EHLO netrecon\r\n`];

    // AUTH PLAIN if credentials are configured
    if (smtp.user && smtp.pass) {
      const authStr = Buffer.from(`\0${smtp.user}\0${smtp.pass}`).toString('base64');
      steps.push(`AUTH PLAIN ${authStr}\r\n`);
    }

    // Envelope uses bare email addresses (no display names)
    steps.push(`MAIL FROM:<${envFrom}>\r\n`);
    steps.push(`RCPT TO:<${envTo}>\r\n`);
    steps.push(`DATA\r\n`);
    // Headers use the full from/to (with display names if present)
    steps.push(`From: ${from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nDate: ${new Date().toUTCString()}\r\nX-Mailer: NetRecon\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n.\r\n`);
    steps.push(`QUIT\r\n`);

    let step     = 0;
    let buf      = '';    // accumulates incoming bytes until a complete response
    let resolved = false;

    const done = (err) => {
      if (resolved) return;
      resolved = true;
      sock.destroy();
      if (err) reject(err); else resolve();
    };

    // Create socket — TLS for port 465 (implicit TLS), plain for everything else
    const sock = smtp.secure
      ? tls.connect({ host: smtp.host, port: smtp.port || 465, rejectUnauthorized: false })
      : net.createConnection({ host: smtp.host, port: smtp.port || 587 });

    sock.setTimeout(15000);
    sock.on('timeout', () => done(new Error('SMTP timeout')));
    sock.on('error',   err => done(err));

    sock.on('data', chunk => {
      // Accumulate data into the line buffer
      buf += chunk.toString();

      // Process all complete response lines in the buffer.
      // A response is complete when we see a line where position 3 is a space:
      //   "250 OK\r\n"       → final line (advance state)
      //   "250-EHLO\r\n"     → continuation line (keep buffering)
      //   "354 Start input"  → final line for DATA command
      let newline;
      while ((newline = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, newline + 1);
        buf = buf.slice(newline + 1);

        // Check if this is a continuation line (4th char is '-')
        // If so, keep buffering — don't advance the state machine yet
        if (line.length >= 4 && line[3] === '-') continue;

        // This is a final response line — check for errors
        const code = parseInt(line.slice(0, 3), 10);
        if (code >= 400 && step > 0) {
          return done(new Error(`SMTP ${code} at step ${step}: ${line.trim()}`));
        }

        // Advance to the next step
        step++;
        if (step < steps.length && steps[step]) {
          sock.write(steps[step]);
        } else if (step >= steps.length) {
          done(null); // all steps complete
        }
      }
    });

    sock.on('close', () => {
      if (!resolved) {
        // Closed before we finished — only OK if we sent QUIT (step 6)
        done(step >= steps.length - 1
          ? null
          : new Error(`SMTP connection closed early at step ${step}`));
      }
    });
  });
}

module.exports = { send };
