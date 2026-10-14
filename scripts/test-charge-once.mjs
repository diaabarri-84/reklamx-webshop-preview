#!/usr/bin/env node
// The money test for one-off options — a die, a proof, a designer's fee.
//
// WHY IT EXISTS
// Every option used to be added to the UNIT price, so the quantity multiplied
// it: 100 stickers with "New cutting die (one-off tooling) +850 kr" were quoted
// 85 000 kr extra. Options charged once per line are now kept out of the unit
// price and added after the quantity. Four things must hold, and none of them is
// visible from clicking the shop once:
//
//   1. the split — per-piece options in the unit price, one-off ones in the line;
//   2. the browser's sum and the server's re-pricing agree, branch rules included;
//   3. calcConfiguredItemPrice adds a one-off charge once, outside the volume
//      discount and the minimum-price floor, and never lets it go negative;
//   4. the catalogue and src/lib/chargeOnce.ts name the same one-off options —
//      the list is what fixes the products already in the shop.
//
// Usage:  node scripts/test-charge-once.mjs
// Exit:   0 = every case passes, 1 = a price is wrong

import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), 'reklamx-chargeonce-'));
const entry = join(outDir, 'entry.ts');
writeFileSync(
  entry,
  [
    `export * from ${JSON.stringify(join(ROOT, 'src/lib/chargeOnce.ts'))};`,
    `export * from ${JSON.stringify(join(ROOT, 'src/lib/optionTree.ts'))};`,
    `export { calcConfiguredItemPrice } from ${JSON.stringify(join(ROOT, 'src/lib/pricing.ts'))};`,
    `export { buildQuantityLadder } from ${JSON.stringify(join(ROOT, 'src/lib/quantityLadder.ts'))};`,
    `export { withoutUnavailableOptions, isOptionAvailable } from ${JSON.stringify(join(ROOT, 'src/lib/optionAvailability.ts'))};`,
    `export { OPTION_CATALOGUE as OPTION_CATALOGUE_FIELDS } from ${JSON.stringify(join(ROOT, 'src/components/Admin/optionCatalogue.ts'))};`,
  ].join('\n'),
);
const outFile = join(outDir, 'bundle.mjs');
await build({ entryPoints: [entry], outfile: outFile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const lib = await import(pathToFileURL(outFile).href);
rmSync(outDir, { recursive: true, force: true });

const {
  DEFAULT_ONCE_OPTION_IDS, isChargedOnce,
  optionsSurchargeOf, onceChargesOf, resolveSelectionFromIds, selectOption, defaultSelection,
  calcConfiguredItemPrice, buildQuantityLadder,
  withoutUnavailableOptions, isOptionAvailable,
  OPTION_CATALOGUE_FIELDS,
} = lib;

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

// ---------------------------------------------------------------------------
console.log('\n== isChargedOnce: the owner decides, the catalogue is the default ==\n');
check('a catalogue one-off id with no flag is one-off', isChargedOnce({ id: 'cs-tool-new-die' }), true);
check('the same id the owner switched OFF is per piece', isChargedOnce({ id: 'cs-tool-new-die', chargeOnce: false }), false);
check('an unknown id the owner switched ON is one-off', isChargedOnce({ id: 'custom-xyz', chargeOnce: true }), true);
check('an unknown id with no flag is per piece', isChargedOnce({ id: 'custom-xyz' }), false);
check('the digital plotter stays per piece (it really is per cut)', isChargedOnce({ id: 'cs-tool-digital' }), false);
check('the mounting kit stays per piece (one per sign)', isChargedOnce({ id: 'sv-inst-kit' }), false);
check('no option is not one-off', isChargedOnce(undefined), false);
check('a DISCOUNT is never one-off, even when flagged', isChargedOnce({ id: 'custom-x', chargeOnce: true, priceModifier: -200 }), false);
check('…nor a catalogue one-off id given a negative price', isChargedOnce({ id: 'cs-tool-new-die', priceModifier: -5 }), false);

// ---------------------------------------------------------------------------
console.log('\n== The split, in the browser and on the server ==\n');
const fields = [
  {
    id: 'paper', name: 'Paper', group: 'default', enabled: true,
    options: [
      { id: 'p-std', label: 'Standard', value: 'std', priceModifier: 0, isDefault: true },
      { id: 'p-thick', label: 'Thick', value: 'thick', priceModifier: 2 },
    ],
  },
  {
    id: 'die_cut_tooling', name: 'Cutting die', group: 'default', enabled: true,
    options: [
      { id: 'cs-tool-standard', label: 'Standard die', value: 'standard_die', priceModifier: 0, isDefault: true },
      { id: 'cs-tool-digital', label: 'Digital plotter', value: 'digital_plotter', priceModifier: 0.9 },
      { id: 'cs-tool-new-die', label: 'New die', value: 'new_die', priceModifier: 850 },
    ],
  },
  {
    id: 'proof', name: 'Proof', group: 'default', enabled: true,
    options: [
      { id: 'pr-none', label: 'None', value: 'none', priceModifier: 0, isDefault: true },
      // A brand-new option the owner marked one-off himself.
      {
        id: 'custom-proof', label: 'Hard proof', value: 'hard', priceModifier: 300, chargeOnce: true,
        // A one-off option behind a branch: only charged while it is chosen.
        subFields: [{
          id: 'proof_courier', name: 'Courier', group: 'default', enabled: true,
          options: [
            { id: 'pc-post', label: 'Post', value: 'post', priceModifier: 0, isDefault: true },
            { id: 'sv-dm-courier', label: 'Courier', value: 'courier', priceModifier: 1450 },
          ],
        }],
      },
    ],
  },
];

let sel = defaultSelection(fields, 'Custom');
check('opening selection: nothing extra', [optionsSurchargeOf(sel), onceChargesOf(sel)], [0, 0]);
sel = selectOption(sel, 'paper', fields[0].options[1], 'Custom');
sel = selectOption(sel, 'die_cut_tooling', fields[1].options[2], 'Custom');
check('thick paper is per piece, the new die is one-off', [optionsSurchargeOf(sel), onceChargesOf(sel)], [2, 850]);
sel = selectOption(sel, 'proof', fields[2].options[1], 'Custom');
sel = selectOption(sel, 'proof>custom-proof>proof_courier', fields[2].options[1].subFields[0].options[1], 'Custom');
check('owner-marked proof + courier inside it are one-off', [optionsSurchargeOf(sel), onceChargesOf(sel)], [2, 850 + 300 + 1450]);

const ids = Object.values(sel).map((o) => o.id);
const server = resolveSelectionFromIds(fields, ids);
check('the server agrees on the per-piece sum', server.surcharge, optionsSurchargeOf(sel));
check('the server agrees on the one-off sum', server.onceCharges, onceChargesOf(sel));
check(
  'the server marks which matched options are one-off',
  server.matched.filter((m) => m.chargeOnce).map((m) => m.optionId).sort(),
  ['cs-tool-new-die', 'custom-proof', 'sv-dm-courier'],
);
const smuggled = resolveSelectionFromIds(fields, ['p-std', 'cs-tool-standard', 'pr-none', 'sv-dm-courier']);
check('a one-off option smuggled from an unchosen branch is not charged', smuggled.onceCharges, 0);

// ---------------------------------------------------------------------------
console.log('\n== calcConfiguredItemPrice: once is once ==\n');
const base = { basePrice: 10, minPrice: 0, uploadRules: { minPrice: 0 }, pricingRules: { baseSetupFee: 49, volumeDiscounts: [{ minQuantity: 100, discountPercentage: 30 }] } };
const at = (quantity, extra = {}) => calcConfiguredItemPrice({ ...base, optionsSurcharge: 2, onceCharges: 850, quantity, ...extra });
check('1 piece: 12 + setup 49 + die 850', at(1).totalPrice, 12 + 49 + 850);
check('100 pieces: the die is NOT multiplied, NOT discounted', at(100).totalPrice, Math.round(12 * 0.7) * 100 + 49 + 850);
check('the unit price never contains the die', at(100).unitPrice, Math.round(12 * 0.7));
check('the one-off total is reported', at(100).onceCharges, 850);
const floored = calcConfiguredItemPrice({ basePrice: 10, quantity: 1, onceCharges: 850, uploadRules: { minPrice: 149 }, pricingRules: { baseSetupFee: 0 } });
check('the minimum-price floor lifts the unit, the die rides on top', floored.totalPrice, 149 + 850);
check('a negative one-off sum cannot pull a line down', at(1, { onceCharges: -5000 }).totalPrice, 12 + 49);
check('a non-number one-off sum is zero', at(1, { onceCharges: 'abc' }).totalPrice, 12 + 49);
check('no one-off charges: the line is what it always was', at(3, { onceCharges: undefined }).totalPrice, 12 * 3 + 49);
const sale = calcConfiguredItemPrice({ basePrice: 100, salePrice: 80, quantity: 2, onceCharges: 300, uploadRules: { minPrice: 0 }, pricingRules: { baseSetupFee: 0 } });
check('an offer: the "was" total carries the same one-off charge', [sale.totalPrice, sale.listTotalPrice, sale.isOnSale], [160 + 300, 200 + 300, true]);

const ladder = buildQuantityLadder({ ...base, optionsSurcharge: 0, onceCharges: 1000 }, [1, 100]);
check('the quantity ladder spreads a one-off charge over the run', ladder.map((r) => r.total), [10 + 49 + 1000, 700 + 49 + 1000]);

// ---------------------------------------------------------------------------
console.log('\n== The catalogue and the default list name the same options ==\n');
const catalogueOnce = new Set();
const catalogueIds = new Set();
const walk = (list) => {
  for (const f of list ?? []) {
    for (const o of f.options ?? []) {
      catalogueIds.add(o.id);
      if (o.chargeOnce === true) catalogueOnce.add(o.id);
      walk(o.subFields);
    }
  }
};
walk(OPTION_CATALOGUE_FIELDS);
const LEGACY = new Set(['dd-2', 'dd-3', 'aa-2', 'nof-3']); // PrintingFieldsAdmin's built-in fields
check('every catalogue option marked one-off is in the default list',
  [...catalogueOnce].filter((id) => !DEFAULT_ONCE_OPTION_IDS.has(id)), []);
check('every id in the default list exists (catalogue or the old built-in fields)',
  [...DEFAULT_ONCE_OPTION_IDS].filter((id) => !catalogueIds.has(id) && !LEGACY.has(id)), []);
check('every catalogue id in the default list is marked in the catalogue too',
  [...DEFAULT_ONCE_OPTION_IDS].filter((id) => catalogueIds.has(id) && !catalogueOnce.has(id)), []);

// ---------------------------------------------------------------------------
console.log('\n== "Design it online" is offered only where it works ==\n');
const withOnline = [
  { id: 'design_service', name: 'Design', group: 'default', enabled: true, options: [
    { id: 'sv-dsgn-upload', label: 'Upload', value: 'upload_own', priceModifier: 0, isDefault: true },
    { id: 'sv-dsgn-online', label: 'Online', value: 'online_template', priceModifier: 0 },
  ] },
  { id: 'only_online', name: 'Only', group: 'default', enabled: true, options: [
    { id: 'x', label: 'Online', value: 'online_template', priceModifier: 0 },
  ] },
];
const shown = withoutUnavailableOptions(withOnline);
check('the design service\'s online option is gone, the upload one stays', shown.map((f) => f.options.map((o) => o.id)), [['sv-dsgn-upload']]);
check('isOptionAvailable says no to it by value, under any id but the artwork step\'s', isOptionAvailable({ id: 'sv-dsgn-online', value: 'online_template' }), false);
// Round 16, item 5: the artwork step's "Design online" has the designer behind it.
check('…and yes to the artwork step\'s af-supply-template: the online designer', isOptionAvailable({ id: 'af-supply-template', value: 'online_template' }), true);
check('an untouched field is returned as the same object', withoutUnavailableOptions([fields[0]])[0] === fields[0], true);

console.log(failed ? `\n❌ ${failed} check(s) failed\n` : '\n✅ all one-off charge checks passed\n');
process.exit(failed ? 1 : 0);
