#!/usr/bin/env node
// Where the parcel goes — the packing slip, the work order, the staff card, the
// shop's e-mail and the Zendr draft must all agree.
//
// WHY IT EXISTS
// Checkout's "deliver to a different address" form had no country field, so
// every separate address was stored as Sweden; and once it had one, it turned
// out that only Zendr and the Drive sheet ever read the separate address — the
// slip in the box printed the billing one. This asserts the shared rule
// (src/lib/deliveryAddress.ts) and the Zendr draft built from the same order.
//
// Usage:  node scripts/test-delivery-address.mjs
// Exit:   0 = every case passes, 1 = a parcel would go to the wrong place

import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), 'reklamx-delivery-'));
const entry = join(outDir, 'entry.ts');
writeFileSync(entry, [
  `export * from ${JSON.stringify(join(ROOT, 'src/lib/deliveryAddress.ts'))};`,
  `export { draftFromOrder } from ${JSON.stringify(join(ROOT, 'src/lib/zendr.ts'))};`,
].join('\n'));
const outFile = join(outDir, 'bundle.mjs');
await build({ entryPoints: [entry], outfile: outFile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const { deliveryAddressOf, draftFromOrder } = await import(pathToFileURL(outFile).href);
rmSync(outDir, { recursive: true, force: true });

let failed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ✅ ${name}`);
  else {
    failed += 1;
    console.error(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`);
  }
};

const billing = {
  firstName: 'Anna', lastName: 'Svensson', company: 'Anna AB', email: 'anna@example.se', phone: '070-123 45 67',
  address1: 'Storgatan 1', address2: 'Plan 3', postcode: '111 22', city: 'Stockholm', country: 'Sverige',
};
const separate = {
  ...billing,
  differentShippingAddress: true,
  shippingAddressDetails: {
    company: 'Lager GmbH', firstName: 'Max', lastName: 'Muster',
    address1: 'Hauptstraße 5', postcode: '60311', city: 'Frankfurt', country: 'Deutschland',
  },
};

console.log('\n== deliveryAddressOf ==\n');
const home = deliveryAddressOf({ customerName: 'Anna Svensson', customerDetails: billing });
check('no separate address: the billing one', [home.address1, home.city, home.country, home.separate], ['Storgatan 1', 'Stockholm', 'Sverige', false]);
const away = deliveryAddressOf({ customerName: 'Anna Svensson', customerDetails: separate });
check('a separate address is where it goes', [away.name, away.company, away.address1, away.city, away.country, away.separate], ['Max Muster', 'Lager GmbH', 'Hauptstraße 5', 'Frankfurt', 'Deutschland', true]);
check('…and the billing second line is NOT glued onto it', away.address2, '');
const blank = deliveryAddressOf({ customerName: 'Anna', customerDetails: { ...billing, differentShippingAddress: true, shippingAddressDetails: { firstName: 'X' } } });
check('a ticked but empty separate form falls back to billing', [blank.address1, blank.separate], ['Storgatan 1', false]);
const oldSeparate = deliveryAddressOf({ customerDetails: { ...billing, country: 'Norge', differentShippingAddress: true, shippingAddressDetails: { address1: 'Gate 2', city: 'Oslo' } } });
check('an old separate address with no country takes the billing one', oldSeparate.country, 'Norge');
const legacy = deliveryAddressOf({ customerName: 'Old Order', shippingAddress: { street: 'Gamla vägen 9', city: 'Malmö' } });
check('an order from before customerDetails still has an address', [legacy.address1, legacy.city], ['Gamla vägen 9', 'Malmö']);

console.log('\n== The Zendr draft from the same order ==\n');
const sender = { contact: { name: 'Shop' }, address: { addressLine1: 'x', postalCode: '1', postalTown: 'y', countryCode: 'SE' } };
const draft = draftFromOrder({ id: '202600099', customerName: 'Anna Svensson', customerDetails: separate, items: [] }, sender);
check('the parcel goes to Germany', [draft.receiver.address.countryCode, draft.receiver.address.postalTown], ['DE', 'Frankfurt']);
check('the phone keeps the BILLING country code (+46), not +49', draft.receiver.contact.phoneNumber, '+46701234567');
check('no billing second line on the German address', draft.receiver.address.addressLine2 ?? null, null);
const homeDraft = draftFromOrder({ id: '202600100', customerName: 'Anna Svensson', customerDetails: billing, items: [] }, sender);
check('without a separate address the billing second line is kept', homeDraft.receiver.address.addressLine2, 'Plan 3');

console.log('\n== Zendr and the countries the owner adds (round 16) ==\n');
const nl = { firstName: 'Jan', lastName: 'de Vries', email: 'jan@x.nl', phone: '06 1234 5678', address1: 'Damrak 1', postcode: '1012 LG', city: 'Amsterdam', country: 'Nederländerna' };
const nlDraft = draftFromOrder({ id: '202600101', deliveryCountryCode: 'NL', customerName: 'Jan de Vries', customerDetails: nl, items: [] }, sender);
check('the order\'s stored delivery code is what Zendr gets', nlDraft.receiver.address.countryCode, 'NL');
check('a Dutch national number gets +31 — not a "Swedish" +46', nlDraft.receiver.contact.phoneNumber, '+31612345678');
const oldNl = draftFromOrder({ id: '202600102', customerName: 'Jan de Vries', customerDetails: nl, items: [] }, sender);
check('an order from before the code: read from the address ("Nederländerna" → NL)', oldNl.receiver.address.countryCode, 'NL');
let refused = null;
try { draftFromOrder({ id: '202600103', customerName: 'X', customerDetails: { ...nl, country: 'Atlantis', phone: '+31 6 1234 5678' }, items: [] }, sender); }
catch (e) { refused = String(e.message); }
check('a country nobody can name is REFUSED, not drafted as Sweden', /Atlantis/.test(refused ?? ''), true);
const unknownPhone = draftFromOrder({ id: '202600104', deliveryCountryCode: 'NL', customerName: 'X', customerDetails: { ...nl, country: 'Atlantis' }, items: [] }, sender);
check('a national number from an unknown country is left out, not given +46', unknownPhone.receiver.contact.phoneNumber ?? null, null);

const legacyNoCountry = draftFromOrder({ id: '202600105', customerName: 'Old', customerDetails: { firstName: 'Old', address1: 'Gatan 1', postcode: '111 22', city: 'Stockholm', phone: '070-1' }, items: [] }, sender);
check('an order from before checkout asked for a country is drafted as Sweden, as it always was', legacyNoCountry.receiver.address.countryCode, 'SE');
let protoRefused = null;
try { draftFromOrder({ id: '202600106', customerName: 'X', customerDetails: { ...nl, country: '__proto__' }, items: [] }, sender); }
catch (e) { protoRefused = String(e.message); }
check('"__proto__" as a country is refused, not passed as one', /__proto__/.test(protoRefused ?? ''), true);
const pt = draftFromOrder({ id: '202600107', deliveryCountryCode: 'PT', buyerCountryCode: 'PT', customerName: 'Ana', customerDetails: { ...nl, country: 'Portugal', phone: '912 345 678' }, items: [] }, sender);
check('a country he added ("Portugal") gets its own dialling code from the order\'s code: +351', pt.receiver.contact.phoneNumber, '+351912345678');

console.log(failed ? `\n❌ ${failed} check(s) failed\n` : '\n✅ all delivery-address checks passed\n');
process.exit(failed ? 1 : 0);
