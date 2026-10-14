// A mail server that keeps what it is sent — for the local suites only.
//
// start.sh points the test copy of the shop at it (SMTP_HOST=127.0.0.1, port 2525),
// so the e-mails a real order would send can be read back and checked: who they
// went to, from whom, and their subject. Nothing leaves this machine.
//
//   SINK_LOG=/path/mail.jsonl node smtp-sink.mjs        one JSON line per message
//   SINK_REFUSE_AUTH=1 …                                answers every login with Google's 535
//
// Speaks just enough SMTP for nodemailer: EHLO with AUTH PLAIN/LOGIN, MAIL, RCPT,
// DATA, RSET, NOOP, QUIT. No TLS (nodemailer stays plain when STARTTLS is not offered).
import net from 'node:net';
import fs from 'node:fs';

const PORT = Number(process.env.SINK_PORT || 2525);
const LOG = process.env.SINK_LOG || '/tmp/reklamx-mail.jsonl';
const REFUSE = process.env.SINK_REFUSE_AUTH === '1';
const REFUSAL = '535-5.7.8 Username and Password not accepted. Learn more at\r\n535 5.7.8 https://support.google.com/mail/?p=BadCredentials';

/** RFC 2047 words ("=?UTF-8?Q?New_paid_order?=") back to text, as a mail client shows them. */
const decodeWords = (s) =>
  s
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(/=\?([^?]+)\?([QqBb])\?([^?]*)\?=/g, (_, _charset, enc, text) => {
      if (enc.toUpperCase() === 'B') return Buffer.from(text, 'base64').toString('utf8');
      const bytes = text.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));
      return Buffer.from(bytes, 'latin1').toString('utf8');
    });

const header = (data, name) => {
  // Unfold continuation lines first, then read the one header.
  const head = data.split(/\r\n\r\n/)[0].replace(/\r\n[ \t]+/g, ' ');
  const m = head.match(new RegExp(`^${name}:\\s*(.*)$`, 'mi'));
  return m ? decodeWords(m[1].trim()) : '';
};

net
  .createServer((sock) => {
    let mode = 'cmd';
    let buf = '';
    let mail = { from: '', to: [] };
    const say = (s) => sock.write(`${s}\r\n`);
    say('220 reklamx-sink ESMTP');
    sock.on('error', () => {});
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      for (;;) {
        if (mode === 'data') {
          const end = buf.indexOf('\r\n.\r\n');
          if (end < 0) return;
          const data = buf.slice(0, end);
          buf = buf.slice(end + 5);
          fs.appendFileSync(
            LOG,
            `${JSON.stringify({
              at: new Date().toISOString(),
              from: mail.from,
              to: mail.to,
              subject: header(data, 'Subject'),
              replyTo: header(data, 'Reply-To'),
              size: data.length,
            })}\n`,
          );
          mail = { from: '', to: [] };
          mode = 'cmd';
          say('250 2.0.0 OK queued');
          continue;
        }
        const at = buf.indexOf('\r\n');
        if (at < 0) return;
        const line = buf.slice(0, at);
        buf = buf.slice(at + 2);
        const up = line.toUpperCase();
        if (mode === 'login-user') {
          mode = 'login-pass';
          say('334 UGFzc3dvcmQ6');
        } else if (mode === 'login-pass') {
          mode = 'cmd';
          say(REFUSE ? REFUSAL : '235 2.7.0 Accepted');
        } else if (up.startsWith('EHLO') || up.startsWith('HELO')) {
          sock.write('250-reklamx-sink\r\n250-AUTH PLAIN LOGIN\r\n250-8BITMIME\r\n250 SMTPUTF8\r\n');
        } else if (up.startsWith('AUTH PLAIN')) {
          say(REFUSE ? REFUSAL : '235 2.7.0 Accepted');
        } else if (up.startsWith('AUTH LOGIN')) {
          mode = 'login-user';
          say('334 VXNlcm5hbWU6');
        } else if (up.startsWith('MAIL FROM:')) {
          mail.from = line.slice(10).trim().replace(/^<|>.*$/g, '');
          say('250 2.1.0 OK');
        } else if (up.startsWith('RCPT TO:')) {
          mail.to.push(line.slice(8).trim().replace(/^<|>.*$/g, ''));
          say('250 2.1.5 OK');
        } else if (up === 'DATA') {
          mode = 'data';
          say('354 Go ahead');
        } else if (up === 'QUIT') {
          say('221 2.0.0 Bye');
          sock.end();
        } else {
          say('250 2.0.0 OK');
        }
      }
    });
  })
  .listen(PORT, '127.0.0.1', () => console.log(`smtp sink on 127.0.0.1:${PORT} → ${LOG}${REFUSE ? ' (refusing logins)' : ''}`));
