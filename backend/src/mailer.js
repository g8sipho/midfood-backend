// Outgoing email. The only mail MidFood sends today is the "forgot password"
// code, so this stays deliberately small: one SMTP account, one function.
//
// Configure with four values in Render -> Environment (see GO-LIVE.md):
//   SMTP_HOST  e.g. mail.midfood.co.za (the Axxess/cPanel mail server)
//   SMTP_PORT  465 (SSL) or 587 (STARTTLS)
//   SMTP_USER  the mailbox, e.g. noreply@midfood.co.za
//   SMTP_PASS  that mailbox's password
//   MAIL_FROM  optional; defaults to "MidFood <SMTP_USER>"
//
// Until those are set, isConfigured() is false and the password-reset route
// tells the customer to phone instead of pretending an email went out.
const nodemailer = require('nodemailer');

let transport = null;
// The tests (and local development without SMTP) read what would have been
// sent from here instead of a mailbox.
const outbox = [];

function isConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransport() {
  if (transport) return transport;
  const port = Number(process.env.SMTP_PORT || 465);
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transport;
}

// send({ to, subject, text }) -> true if it went out (or was captured in
// test mode), false if email is not configured. Throws if the SMTP server
// refuses the message, so the caller can tell the customer.
async function send({ to, subject, text }) {
  const from = process.env.MAIL_FROM || `MidFood <${process.env.SMTP_USER || 'noreply@midfood.co.za'}>`;
  if (process.env.NODE_ENV === 'test') {
    outbox.push({ to, from, subject, text });
    return true;
  }
  if (!isConfigured()) return false;
  await getTransport().sendMail({ from, to, subject, text });
  return true;
}

module.exports = { send, isConfigured, outbox };
