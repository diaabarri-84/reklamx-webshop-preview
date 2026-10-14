#!/usr/bin/env node
// The print size a customer chose — src/lib/printSize.ts.
//
// WHY IT EXISTS. `resolveDimensionsString` derived a size from an option's
// LABEL and then hard-coded the unit: `${w} × ${h} mm`, whatever the label said.
// An option written "Rollup 85x200 cm" therefore resolved to "85 × 200 mm", and
// everything downstream believed it — the card printed 85 × 200 mm, the dropzone
// told the customer his file had to be 85 × 200 mm, and the correct 850 × 2000 mm
// artwork for a roll-up was refused. On the owner's own best-selling product.
//
// The arithmetic was inside a React component and so had no test at all. It is
// in src/lib now, for the same reason the option-tree pricing is.
//
//   node scripts/test-print-size.mjs

import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), 'reklamx-printsize-'));
const out = join(outDir, 'printSize.mjs');
await build({
  entryPoints: [join(ROOT, 'src', 'lib', 'printSize.ts')],
  outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
});
const { optionDimensions, parseDimensionsMm, formatSizeForShopper, measuredLengthMismatch, measuredLengthText } =
  await import(pathToFileURL(out).href);
// The Drive order sheet prints the same sentence (PAY-05).
const sheetOut = join(outDir, 'orderSheet.mjs');
await build({
  entryPoints: [join(ROOT, 'src', 'lib', 'orderSheet.ts')],
  outfile: sheetOut, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
});
const { orderSheetText } = await import(pathToFileURL(sheetOut).href);
rmSync(outDir, { recursive: true, force: true });

let failed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) console.log(`  ✅ ${name}`);
  else { failed += 1; console.error(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`); }
};
const opt = (label, dimensions) => ({ id: 'o', label, value: label, priceModifier: 0, ...(dimensions ? { dimensions } : {}) });

console.log('\nthe unit written on the label is the label\'s');
// THE ONE THAT MATTERS — the client's own product.
check('"Rollup 85x200 cm" is 850 × 2000 mm', parseDimensionsMm(opt('Rollup 85x200 cm')), { wMm: 850, hMm: 2000 });
check('and its line reads in cm', optionDimensions(opt('Rollup 85x200 cm')), '85 × 200 cm');
check('no space before the unit', parseDimensionsMm(opt('Banner 100x200cm')), { wMm: 1000, hMm: 2000 });
check('× instead of x', parseDimensionsMm(opt('Skylt 40×60 cm')), { wMm: 400, hMm: 600 });
check('mm stays mm', parseDimensionsMm(opt('Visitkort 85x55 mm')), { wMm: 85, hMm: 55 });
check('metres become mm', parseDimensionsMm(opt('Vepa 1,5 x 2 m')), { wMm: 1500, hMm: 2000 });
check('a decimal comma in cm', parseDimensionsMm(opt('Affisch 21 x 29,7 cm')), { wMm: 210, hMm: 297 });
check('capitals', parseDimensionsMm(opt('ROLLUP 85X200 CM')), { wMm: 850, hMm: 2000 });

console.log('\nnothing else changed — the old behaviour is preserved exactly');
check('an unlabelled pair is still mm', parseDimensionsMm(opt('Folder 148x210')), { wMm: 148, hMm: 210 });
check('and still reads as mm', optionDimensions(opt('Folder 148x210')), '148 × 210 mm');
check('A-series wins over the label', parseDimensionsMm(opt('Poster A3')), { wMm: 297, hMm: 420 });
check('the stored dimensions field wins over everything', parseDimensionsMm(opt('Rollup 85x200 cm', '1000 × 2000 mm')), { wMm: 1000, hMm: 2000 });
check('a label with no size at all', parseDimensionsMm(opt('Matte lamination')), null);
check('one number is not a size', parseDimensionsMm(opt('500 g')), null);

console.log('\nthe m of "mm" is never read as metres');
check('"210 × 297 mm" is not 210 metres', parseDimensionsMm(opt('x', '210 × 297 mm')), { wMm: 210, hMm: 297 });
check('"85 × 55 MM" either', parseDimensionsMm(opt('x', '85 × 55 MM')), { wMm: 85, hMm: 55 });

console.log('\nthe size said the way a customer would say it');
check('a roll-up is cm, not 850 mm', formatSizeForShopper(850, 2000), '85 × 200 cm');
check('a business card stays mm', formatSizeForShopper(85, 55), '85 × 55 mm');
check('exactly 100 mm crosses over', formatSizeForShopper(100, 50), '10 × 5 cm');
check('a half centimetre keeps its comma', formatSizeForShopper(105, 2000), '10,5 × 200 cm');

console.log('\nPAY-05 — a custom upload whose file is not the length that was paid for');
// As createOrder stores one: the priced size on the line, the typed length and the
// length read off the file in fileSpecs.
const upload = (paidCm, measuredCm) => ({
  productId: null, productName: 'Custom upload', quantity: 1, widthCm: 28, heightCm: paidCm,
  fileSpecs: { fileName: 'banner.pdf', widthCm: 28, heightCm: paidCm, ...(measuredCm != null ? { calculatedHeightCm: measuredCm } : {}) },
});
check('a 3 m file sold as 50 cm is said', measuredLengthMismatch(upload(50, 300)), { paidCm: 50, measuredCm: 300 });
check('…in the words the work order and the sheet print', measuredLengthText(measuredLengthMismatch(upload(50, 300))),
  'Paid 50 cm — the file measures 300 cm');
check('a file SHORTER than what was paid for is said too', measuredLengthMismatch(upload(200, 150)), { paidCm: 200, measuredCm: 150 });
check('within 10% it is the same job: nothing', [measuredLengthMismatch(upload(100, 109.9)), measuredLengthMismatch(upload(100, 90))], [null, null]);
check('just past 10%, it is said', measuredLengthMismatch(upload(100, 110.5)), { paidCm: 100, measuredCm: 110.5 });
check('no measured length (it could not be read, or an older order): nothing', measuredLengthMismatch(upload(50, null)), null);
check('a configured product (no measurement at all): nothing',
  measuredLengthMismatch({ widthCm: 85, heightCm: 200, fileSpecs: { widthCm: 85, heightCm: 200 } }), null);
check('the PRICED length is the paid one, before the length the page sent',
  measuredLengthMismatch({ heightCm: 60, fileSpecs: { heightCm: 50, calculatedHeightCm: 300 } }), { paidCm: 60, measuredCm: 300 });
check('…and the page\'s length when the line has no priced size', measuredLengthMismatch({ fileSpecs: { heightCm: 50, calculatedHeightCm: 300 } }),
  { paidCm: 50, measuredCm: 300 });
check('a measurement is tidied to one decimal', measuredLengthMismatch(upload(50, 299.66)), { paidCm: 50, measuredCm: 299.7 });
check('nonsense is no measurement', [measuredLengthMismatch(upload(50, 'abc')), measuredLengthMismatch(upload(50, -3)), measuredLengthMismatch(null)],
  [null, null, null]);
const sheet = (item) => orderSheetText({ id: '202600301', currency: 'SEK', items: [item] });
check('the Drive order sheet prints it under the size',
  /Size:\s+28 × 50 cm\n\s+Length:\s+Paid 50 cm — the file measures 300 cm\n/.test(sheet(upload(50, 300))), true);
check('…and nothing when the file is the length that was paid for', /Length:/.test(sheet(upload(50, 52))), false);

console.log(failed === 0 ? '\n✅ every print-size case holds\n' : `\n❌ ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
