#!/usr/bin/env node
// The owner's shipping settings (src/lib/shipping.ts) — prices and countries he
// sets in the dashboard, read by the checkout, the server and the Google feed.
//
// WHY IT EXISTS
// This is money that leaves on every order. A review of the first design found
// six ways it could quietly sell delivery for 0 kr or to the wrong country — an
// emptied country list meaning "everywhere", a new country inheriting the home
// price, a damaged setting falling back to defaults, '__proto__' as a country,
// a negative or NaN price read as free. Each has a check here.
//
// Usage:  node scripts/test-shipping.mjs

import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'reklamx-shipping-'));
const out = join(dir, 's.mjs');
await build({ entryPoints: [join(ROOT, 'src/lib/shipping.ts')], outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const s = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });

let failed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ✅ ${name}`);
  else { failed += 1; console.error(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`); }
};
const menu = (settings, code) => s.shippingOptions(settings, code).map((o) => `${o.id}:${o.fee}`);

console.log('\n== never saved → exactly what the shop charged before ==\n');
const D = s.normaliseShipping(undefined);
check('Sweden: standard 99, express 169, pickup 0', menu(D, 'SE'), ['standard:99', 'express:169', 'pickup:0']);
check('the same five countries checkout listed, Sweden home', [D.homeCountry, D.countries.map((c) => c.code).join(',')], ['SE', 'SE,NO,DK,FI,DE']);
check('orders keep the titles they always had', D.methods.map((m) => s.orderTitleOf(m)),
  ['Standard delivery (DHL / DSV / UPS)', 'Express delivery (DHL / DSV / UPS)', 'Pick up at the print shop']);
check('…and checkout the names it always showed', [s.methodName(D.methods[0], 'sv'), s.methodNote(D.methods[0], 'en')], ['Standardleverans', 'DHL, DSV or UPS']);

console.log('\n== his settings ==\n');
const mine = {
  homeCountry: 'SE',
  countries: [
    { code: 'SE', name: 'Sverige', enabled: true },
    { code: 'NO', name: 'Norge', enabled: true },
    { code: 'NL', name: 'Nederländerna', enabled: true }, // added, not priced yet
    { code: 'DE', name: 'Deutschland', enabled: false }, // switched off
  ],
  methods: [
    { id: 'express', enabled: true, name: { en: 'Express' }, prices: { SE: 189 } }, // dragged first; Sweden only
    { id: 'standard', enabled: true, name: { en: 'Standard' }, prices: { SE: 99, NO: 249, DE: 199 } },
    { id: 'pickup', enabled: true, name: { en: 'Pickup' }, fee: 0 },
  ],
};
const M = s.normaliseShipping(mine);
check('his order of the methods is the menu order', menu(M, 'SE'), ['express:189', 'standard:99', 'pickup:0']);
check('a price per country: Norway pays its own price, express not offered there', menu(M, 'NO'), ['standard:249', 'pickup:0']);
check('a NEW country is not for sale until priced — pickup only', menu(M, 'NL'), ['pickup:0']);
check('a switched-off country gets no delivery, even with a price', menu(M, 'DE'), ['pickup:0']);
check('a country he does not have gets no delivery', menu(M, 'US'), ['pickup:0']);
check('feeFor: offered, and not offered (null — never 0)', [s.feeFor(M, 'standard', 'NO'), s.feeFor(M, 'express', 'NO'), s.feeFor(M, 'standard', 'NL')], [249, null, null]);

console.log('\n== the traps ==\n');
const emptied = s.normaliseShipping({ ...mine, methods: [{ id: 'express', enabled: true, name: { en: 'E' }, prices: {} }, ...mine.methods.slice(1)] });
check('an emptied price list means "nowhere", NOT "everywhere"', menu(emptied, 'SE').filter((x) => x.startsWith('express')), []);
check('a damaged setting is NOT replaced by the defaults', menu(s.normaliseShipping('garbage'), 'SE'), []);
check('…nor a half-damaged one: the readable parts only', menu(s.normaliseShipping({ ...mine, methods: [mine.methods[1]] }), 'SE'), ['standard:99']);
const bad = s.normaliseShipping({
  homeCountry: 'SE',
  countries: [{ code: 'SE', name: 'Sverige', enabled: true }, { code: '__proto__', name: 'x' }, { code: 'UK', name: 'Storbritannien' }],
  methods: [{ id: 'standard', enabled: true, name: { en: 'S' }, prices: JSON.parse('{"SE": -5, "__proto__": 1, "constructor": 2}') },
    { id: 'express', enabled: true, name: { en: 'E' }, prices: { SE: 'NaN' } },
    { id: 'pickup', enabled: true, name: { en: 'P' }, fee: -1 }],
});
check('a negative, NaN or prototype "price" is not offered — never sold as free', menu(bad, 'SE'), []);
check('"UK" is not a country code (GB is), and "__proto__" is nothing', bad.countries.map((c) => c.code), ['SE']);
check('"__proto__" / "constructor" as the delivery country: nothing delivered', [menu(M, '__proto__'), menu(M, 'constructor')], [['pickup:0'], ['pickup:0']]);
check('an invented method id is ignored; a missing one is OFF', s.normaliseShipping({ ...mine, methods: [{ id: 'free', enabled: true, prices: { SE: 0 } }] }).methods.map((m) => `${m.id}:${m.enabled}`), ['standard:false', 'express:false', 'pickup:false']);
check('prices are rounded to öre and "12,5" reads as 12.50', s.normaliseShipping({ ...mine, methods: [{ id: 'standard', enabled: true, name: { en: 'S' }, prices: { SE: '12,5' } }] }).methods[0].prices, { SE: 12.5 });
check('the home country must be on; otherwise the first one that is', [s.normaliseShipping({ ...mine, homeCountry: 'DE' }).homeCountry, s.normaliseShipping({ ...mine, homeCountry: 'XX' }).homeCountry], ['SE', 'SE']);
check('dragging another country to the top does not move home', s.normaliseShipping({ ...mine, countries: [mine.countries[1], mine.countries[0]] }).homeCountry, 'SE');

check('"1.000" / "1,000" are ambiguous (one krona or a thousand?) and refused; spaces are thousands', [s.cleanPrice('1.000'), s.cleanPrice('1,000'), s.cleanPrice('1 000'), s.cleanPrice('149,50'), s.cleanPrice('1.000,50'), s.cleanPrice(' 99 ')], [null, null, 1000, 149.5, null, 99]);
const copy = s.normaliseShipping(undefined);
copy.methods[0].prices.SE = 1;
check('the defaults handed out are a copy: changing one changes nothing for the next request', s.normaliseShipping(undefined).methods[0].prices.SE, 99);

console.log('\n== countries on orders ==\n');
check('an order\'s stored name, a code, any case', [s.countryOf(M, 'Sverige')?.code, s.countryOf(M, 'sverige')?.code, s.countryOf(M, 'se')?.code, s.countryOf(M, 'Atlantis')], ['SE', 'SE', 'SE', null]);
check('only a switched-on country is a delivery country', [s.enabledCountry(M, 'SE')?.code, s.enabledCountry(M, 'DE'), s.enabledCountry(M, 'Sverige')], ['SE', null, null]);

console.log('\n== the Google feed follows his prices ==\n');
check('one line per country he delivers to, the cheapest delivery there, incl. VAT; pickup is not shipping', s.feedShippingLines(M, 0.25), [{ country: 'SE', price: '123.75' }, { country: 'NO', price: '311.25' }]);
check('never-saved settings advertise what checkout charges (99 net = 123.75), not "free"', s.feedShippingLines(D, 0.25)[0], { country: 'SE', price: '123.75' });

console.log('\n== what the save button refuses ==\n');
check('his settings are fine', s.shippingSaveProblems(M), []);
check('a typo\'d code, a duplicate, an empty name', s.shippingSaveProblems({ ...M, countries: [...M.countries, { code: 'UK', name: 'UK', enabled: true }, { code: 'SE', name: 'Sweden', enabled: true }, { code: 'FR', name: ' ', enabled: true }] }).sort(), ['shipErrCountryCode', 'shipErrCountryDuplicate', 'shipErrCountryName']);
check('nothing for sale anywhere, and home switched off', s.shippingSaveProblems({ ...M, homeCountry: 'DE', methods: M.methods.map((m) => ({ ...m, enabled: false })) }).sort(), ['shipErrHome', 'shipErrNothingSold']);
check('a price that is not a number', s.shippingSaveProblems({ ...M, methods: M.methods.map((m) => (m.id === 'standard' ? { ...m, prices: { SE: NaN } } : m)) }), ['shipErrPrice']);
check('"A B" and "A  B" are the same name (the reader would have dropped the second)', s.shippingSaveProblems({ ...M, countries: [...M.countries, { code: 'FR', name: 'Fr ance', enabled: true }, { code: 'BE', name: 'Fr  ance', enabled: true }] }), ['shipErrCountryDuplicate']);
check('a name that is another country\'s code is refused (Denmark named "DE")', s.shippingSaveProblems({ ...M, countries: [...M.countries, { code: 'DK', name: 'DE', enabled: true }] }), ['shipErrCountryDuplicate']);

console.log(failed ? `\n❌ ${failed} check(s) failed\n` : '\n✅ all shipping checks passed\n');
process.exit(failed ? 1 : 0);
