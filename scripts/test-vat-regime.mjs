#!/usr/bin/env node
// Which VAT applies — src/lib/vatRegime.ts.
//
// WHY IT EXISTS
// Every case here decides whether the shop charges 25% or 0%, and the two
// mistakes are not symmetrical. Charging VAT that was not due is corrected with
// an apology. NOT charging VAT that WAS due is money the shop owes Skatteverket
// out of its own pocket, found at an audit, with interest.
//
// So the test is written the same way the code is: the 0% paths must require
// every condition, and everything unclear must land on the standard rate.
//
// Usage:  node scripts/test-vat-regime.mjs
// Exit:   0 = nothing is zero-rated on a guess

import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), 'reklamx-vat-'));
const outFile = join(outDir, 'vatRegime.mjs');
await build({
  entryPoints: [join(ROOT, 'src', 'lib', 'vatRegime.ts')],
  outfile: outFile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
});
const V = await import(pathToFileURL(outFile).href);
rmSync(outDir, { recursive: true, force: true });
const { decideVatRegime, toCountryCode, vatNumberLooksValid, normaliseVatNumber } = V;

let failed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) console.log(`  ✅ ${name}`);
  else { failed += 1; console.error(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`); }
};
const ok = (name, cond, detail) => {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed += 1; console.error(`  ❌ ${name}${detail ? `\n       ${detail}` : ''}`); }
};
const decide = (o) => decideVatRegime({ standardRate: 0.25, ...o });

console.log('\ntoCountryCode — free text a human typed');
check('Swedish for Sweden', toCountryCode('Sverige'), 'SE');
check('English', toCountryCode('Sweden'), 'SE');
check('a code', toCountryCode('SE'), 'SE');
check('lower case', toCountryCode('  sverige '), 'SE');
check('Danish', toCountryCode('Danmark'), 'DK');
check('Norway is NOT in the EU', toCountryCode('Norge'), 'NO');
check('the UK is not either', toCountryCode('United Kingdom'), 'GB');
// A code nobody issues must not become a country: "SX" as a country would make
// the order an export and zero-rate it.
check('an unknown two-letter code is not a country', toCountryCode('SX'), null);
check('nonsense is not a country', toCountryCode('asdf'), null);
check('empty is not a country', toCountryCode(''), null);
check('null is not a country', toCountryCode(null), null);

console.log('\nvatNumberLooksValid — shape only, and it says so');
ok('a real-shaped Swedish number', vatNumberLooksValid('SE556677889901', 'SE'));
ok('a real-shaped German number', vatNumberLooksValid('DE123456789', 'DE'));
ok('a real-shaped Dutch number', vatNumberLooksValid('NL123456789B01', 'NL'));
ok('spaces and dashes are ignored', vatNumberLooksValid('DE 123-456 789', 'DE'));
ok('no prefix is not a VAT number', !vatNumberLooksValid('123456789', 'DE'));
ok('the wrong length is refused', !vatNumberLooksValid('DE12345', 'DE'));
ok('a country that issues none is refused', !vatNumberLooksValid('XX123456789', 'XX'));
// THE ONE THAT MATTERS: a German number on a French invoice.
ok('a number whose prefix is not the billing country is refused',
  !vatNumberLooksValid('DE123456789', 'FR'));
check('normalising strips punctuation', normaliseVatNumber(' de-123.456 789 '), 'DE123456789');

console.log('\ndomestic — the shop\'s home ground');
check('a Swedish private buyer pays 25%', decide({ country: 'Sverige' }).rate, 0.25);
check('and the regime says so', decide({ country: 'Sverige' }).regime, 'domestic');
// A Swedish company still pays Swedish VAT. Reverse charge is CROSS-BORDER.
check('a Swedish COMPANY with a VAT number still pays 25%',
  decide({ country: 'Sverige', buyerType: 'company', vatNumber: 'SE556677889901' }).rate, 0.25);
check('…and is domestic, not reverse charge',
  decide({ country: 'Sverige', buyerType: 'company', vatNumber: 'SE556677889901' }).regime, 'domestic');

console.log('\nAN ADDRESS WE DID NOT UNDERSTAND — the expensive guess');
const unknown = decide({ country: 'Atlantis' });
check('is charged the standard rate, not zero-rated as an export', unknown.rate, 0.25);
check('and is recorded as domestic', unknown.regime, 'domestic');
ok('with a reason that says why', /not recognised/i.test(unknown.reason), unknown.reason);
check('a missing country is the same', decide({}).rate, 0.25);

console.log('\nEU, private buyer');
check('a German consumer pays Swedish VAT', decide({ country: 'Tyskland' }).rate, 0.25);
check('and the regime is eu_b2c', decide({ country: 'Tyskland' }).regime, 'eu_b2c');

console.log('\nEU, business — the only path to 0% that involves a number');
const reverse = decide({ country: 'Tyskland', buyerType: 'company', vatNumber: 'DE123456789' });
check('rate is zero', reverse.rate, 0);
check('regime is eu_b2b_reverse', reverse.regime, 'eu_b2b_reverse');
ok('the invoice carries the legally required wording',
  /omvänd betalningsskyldighet/i.test(reverse.invoiceNote) && /2006\/112/.test(reverse.invoiceNote),
  reverse.invoiceNote);
ok('and it is flagged as resting on an unverified number', reverse.requiresVerification === true);

console.log('\n…and every way that path must NOT be taken');
const mustPay = [
  ['a company with NO VAT number', { country: 'Tyskland', buyerType: 'company' }],
  ['a company with an empty VAT number', { country: 'Tyskland', buyerType: 'company', vatNumber: '   ' }],
  ['a company with a malformed number', { country: 'Tyskland', buyerType: 'company', vatNumber: 'DE12' }],
  ['a company with another country\'s number', { country: 'Frankrike', buyerType: 'company', vatNumber: 'DE123456789' }],
  ['a VAT number but NOT declared a company', { country: 'Tyskland', vatNumber: 'DE123456789' }],
  ['buyerType spelled wrong', { country: 'Tyskland', buyerType: 'Company Ltd', vatNumber: 'DE123456789' }],
];
for (const [name, input] of mustPay) {
  const d = decide(input);
  ok(`${name} → pays 25%`, d.rate === 0.25 && d.regime !== 'eu_b2b_reverse', JSON.stringify(d));
}
ok('and the reason explains which it was, so a number can be chased',
  /no VAT number/i.test(decide({ country: 'Tyskland', buyerType: 'company' }).reason));

console.log('\noutside the EU — export');
for (const c of ['Norge', 'United Kingdom', 'USA', 'Schweiz']) {
  const d = decide({ country: c });
  ok(`${c.padEnd(16)} → 0%, export`, d.rate === 0 && d.regime === 'export', JSON.stringify(d));
}
ok('the export invoice says why the VAT is zero',
  /outside the EU/i.test(decide({ country: 'Norge' }).invoiceNote));
ok('an export needs no VAT number and no verification flag',
  decide({ country: 'Norge' }).requiresVerification === false);

console.log('\nthe shop\'s own rate is respected');
check('a 6% shop charges 6% domestically', decideVatRegime({ country: 'SE', standardRate: 0.06 }).rate, 0.06);
check('and 0% is still 0% for an export', decideVatRegime({ country: 'NO', standardRate: 0.06 }).rate, 0);
check('a nonsense rate falls back to 25%', decideVatRegime({ country: 'SE', standardRate: NaN }).rate, 0.25);

console.log('\na prototype key is not a country');
// COUNTRY_NAMES is a plain object: '__proto__' came back as Object.prototype —
// truthy, so decideVatRegime treated it as a non-EU country: export, 0% VAT.
check('"__proto__" is no country', toCountryCode('__proto__'), null);
check('"constructor" is no country', toCountryCode('constructor'), null);
ok('and is taxed as domestic, not exported at 0%', decideVatRegime({ country: '__proto__' }).rate === 0.25);

console.log(`\n${failed === 0 ? 'Nothing is zero-rated on a guess.' : `${failed} failing.`}`);
process.exit(failed === 0 ? 0 : 1);
