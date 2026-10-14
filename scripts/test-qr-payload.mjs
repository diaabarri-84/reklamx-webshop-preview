#!/usr/bin/env node
// What a QR code says — src/lib/qrPayload.ts (designer v2): every form to its text
// and back, and every one of them encodes (src/lib/designQr.ts).
//
//   node scripts/test-qr-payload.mjs
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'reklamx-qrp-'));
await build({
  stdin: {
    contents: [
      `export * from ${JSON.stringify(join(ROOT, 'src/lib/qrPayload.ts'))};`,
      `export { qrPath, cleanQrSpec, QR_MAX_TEXT } from ${JSON.stringify(join(ROOT, 'src/lib/designQr.ts'))};`,
    ].join('\n'),
    resolveDir: ROOT,
    loader: 'ts',
  },
  outfile: join(dir, 'q.mjs'), bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
});
const Q = await import(pathToFileURL(join(dir, 'q.mjs')).href);
rmSync(dir, { recursive: true, force: true });

let failed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ✅ ${name}`);
  else { failed += 1; console.error(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`); }
};

console.log('\n== each form to its text ==\n');
check('a bare address gets https://', Q.qrPayload('url', { url: ' shop.reklamx.se/p/1 ' }), 'https://shop.reklamx.se/p/1');
check('an address with its own scheme is kept', Q.qrPayload('url', { url: 'http://x.se' }), 'http://x.se');
check('a phone number: digits and the leading +, the (0) no phone dials dropped', Q.qrPayload('phone', { phone: '+46 (0)70-123 45 67' }), 'tel:+46701234567');
check('an e-mail with a subject and a message', Q.qrPayload('email', { email: 'info@reklamx.se', subject: 'Offert & pris', body: 'Hej!' }), 'mailto:info@reklamx.se?subject=Offert%20%26%20pris&body=Hej!');
check('an SMS', Q.qrPayload('sms', { phone: '070 123', body: 'Boka: tid' }), 'SMSTO:070123:Boka: tid');
check('Wi-Fi, its special characters escaped', Q.qrPayload('wifi', { ssid: 'Café;Gäst', password: 'a:b,c"d\\e', security: 'WPA' }), 'WIFI:T:WPA;S:Café\\;Gäst;P:a\\:b\\,c\\"d\\\\e;;');
check('an open Wi-Fi has no password', Q.qrPayload('wifi', { ssid: 'Öppen', password: 'ignored', security: 'nopass' }), 'WIFI:T:nopass;S:Öppen;;');
const card = Q.qrPayload('vcard', { first: 'Åsa', last: 'Öberg', org: 'Reklam, X; AB', title: 'VD', phone: '+46 70 1', email: 'asa@x.se', web: 'x.se', street: 'Storgatan 1', zip: '111 22', city: 'Stockholm', country: 'Sverige' });
check('a contact card (vCard 3.0), commas and semicolons escaped', card.split('\n'), [
  'BEGIN:VCARD', 'VERSION:3.0', 'N:Öberg;Åsa;;;', 'FN:Åsa Öberg', 'ORG:Reklam\\, X\\; AB', 'TITLE:VD', 'TEL;TYPE=CELL:+46701',
  'EMAIL:asa@x.se', 'URL:x.se', 'ADR;TYPE=WORK:;;Storgatan 1;Stockholm;;111 22;Sverige', 'END:VCARD',
]);
check('nothing filled in: no code', [Q.qrPayload('url', {}), Q.qrPayload('phone', { phone: '+' }), Q.qrPayload('vcard', {}), Q.qrPayload('wifi', {}), Q.qrPayload('text', { text: '  ' })], [null, null, null, null, null]);

console.log('\n== and back, to be changed ==\n');
const round = (kind, fields) => {
  const text = Q.qrPayload(kind, fields);
  const back = Q.parseQrPayload(text);
  return back.kind === kind && Q.qrPayload(back.kind, back.fields) === text;
};
check('a link', round('url', { url: 'https://x.se/a?b=1' }), true);
check('a phone number', round('phone', { phone: '+4670123' }), true);
check('an e-mail with subject and message', round('email', { email: 'a@b.se', subject: 'Hej & då', body: 'Rad 1\nRad 2' }), true);
check('an SMS with a colon in it', round('sms', { phone: '070', body: 'kl: 10' }), true);
check('Wi-Fi with escaped characters', round('wifi', { ssid: 'A;B:C', password: 'p\\;,"', security: 'WEP' }), true);
check('a contact card', round('vcard', { first: 'Åsa', last: 'Öberg', org: 'A, B; C', phone: '+4670', email: 'a@b.se', web: 'x.se', street: 'G 1', zip: '1', city: 'S', country: 'SE' }), true);
check('anything else reads as text', Q.parseQrPayload('Hello there'), { kind: 'text', fields: { text: 'Hello there' } });
// Code review DSN-14: a lone % made decodeURIComponent throw, and the designer fell over.
check('a lone % in an e-mail address reads back as it was typed — never a throw', Q.parseQrPayload('mailto:50%off@x.se?subject=Hej'), { kind: 'email', fields: { email: '50%off@x.se', subject: 'Hej', body: '' } });
check('…a real escape is still undone', Q.parseQrPayload('mailto:a%40b.se').fields.email, 'a@b.se');
check('an address with a port gets https:// ("shop.se:8080" is not a scheme)', Q.qrPayload('url', { url: 'shop.se:8080/x' }), 'https://shop.se:8080/x');
check('…a real scheme is still kept as typed', ['tel:+46701', 'mailto:a@b.se', 'git+ssh://x.se/r'].map((url) => Q.qrPayload('url', { url })), ['tel:+46701', 'mailto:a@b.se', 'git+ssh://x.se/r']);

console.log('\n== how a code prints: contrast ==\n');
const ratio = (a, b) => {
  const r = Q.contrastRatio(a, b);
  return r === null ? null : Math.round(r * 100) / 100;
};
check('black on white is 21:1, either way round', [ratio('#000000', '#ffffff'), ratio('#fff', '#000')], [21, 21]);
check('the same colour is 1:1', ratio('#2d2e83', 'rgb(45, 46, 131)'), 1);
check('a white code on the shop\'s navy reads (white codes are not refused)', Q.contrastRatio('#ffffff', '#2d2e83') >= Q.QR_MIN_CONTRAST, true);
check('a yellow code on white does not (under 3:1)', Q.contrastRatio('#ffed00', '#ffffff') < Q.QR_MIN_CONTRAST, true);
check('anything that is not a plain colour: nothing can be said', [Q.contrastRatio('url(x)', '#fff'), Q.contrastRatio('#000', ''), Q.contrastRatio('rgba(0,0,0,0.5)', '#fff')], [null, null, null]);
check('the smallest square worth printing is 0.3 mm', Q.QR_MIN_MODULE_MM, 0.3);

console.log('\n== every one of them encodes ==\n');
for (const [kind, fields] of [['url', { url: 'x.se' }], ['vcard', { first: 'Åsa', last: 'Öberg', org: 'AB', phone: '+46701234567', email: 'a@b.se' }], ['wifi', { ssid: 'Gäst', password: 'hemligt' }]]) {
  const spec = Q.cleanQrSpec({ text: Q.qrPayload(kind, fields), ecc: 'M' });
  check(`${kind}: a code is drawn`, !!spec && !!Q.qrPath(spec)?.d, true);
}

console.log(failed ? `\n❌ ${failed} check(s) failed\n` : '\n✅ QR payloads hold\n');
process.exit(failed ? 1 : 0);
