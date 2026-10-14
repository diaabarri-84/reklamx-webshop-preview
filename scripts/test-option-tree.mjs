#!/usr/bin/env node
// The money test for sub-options — "an option inside the option".
//
// WHY IT EXISTS
// The single thing that must never happen with nested options is a surcharge
// from a branch the customer did not choose reaching the price. That failure is
// invisible to clicking through the shop: the option is not on screen, so
// nobody sees the number it added. It is also invisible to the browser
// regression suite, which asserts that a page rendered, not what it charged.
//
// So the arithmetic lives in src/lib/optionTree.ts as pure functions over plain
// data, and this asserts it directly. esbuild bundles the TypeScript to a temp
// file; nothing here needs a browser, Firebase or a network.
//
// Usage:  node scripts/test-option-tree.mjs
// Exit:   0 = every case passes, 1 = something charges the wrong amount

import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), 'reklamx-optiontree-'));
const outFile = join(outDir, 'optionTree.mjs');

await build({
  entryPoints: [join(ROOT, 'src', 'lib', 'optionTree.ts')],
  outfile: outFile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
});

const tree = await import(pathToFileURL(outFile).href);
rmSync(outDir, { recursive: true, force: true });

const {
  defaultSelection,
  selectOption,
  optionsSurchargeOf,
  visibleFieldEntries,
  flattenSelectionByFieldId,
  fieldPathKey,
  resolveSelectionFromIds,
  MAX_OPTION_DEPTH,
} = tree;

let failed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ✅ ${name}`);
  } else {
    failed += 1;
    console.error(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`);
  }
};

// ---------------------------------------------------------------------------
// The fixture: HelloPrint's own sticker product, which is what the owner sent.
// "Type" decides which further questions exist — a roll is asked about winding,
// individual stickers are asked about a cut shape. They are never both true.
// ---------------------------------------------------------------------------
const product = [
  {
    id: 'sticker_type',
    name: 'Type',
    group: 'product_builder',
    enabled: true,
    options: [
      {
        id: 'opt_individual',
        label: 'Individual',
        value: 'individual',
        priceModifier: 0,
        isDefault: true,
        subFields: [
          {
            id: 'cut_shape',
            name: 'Shape',
            group: 'product_builder',
            enabled: true,
            options: [
              { id: 'shape_round', label: 'Round', value: 'round', priceModifier: 0, isDefault: true },
              { id: 'shape_star', label: 'Star', value: 'star', priceModifier: 40 },
            ],
          },
        ],
      },
      {
        id: 'opt_roll',
        label: 'Printed on a roll',
        value: 'roll',
        priceModifier: 15,
        subFields: [
          {
            id: 'winding',
            name: 'Winding direction',
            group: 'product_builder',
            enabled: true,
            options: [
              { id: 'wind_out', label: 'Outwards', value: 'out', priceModifier: 0, isDefault: true },
              { id: 'wind_in', label: 'Inwards', value: 'in', priceModifier: 25 },
            ],
          },
          {
            id: 'core_size',
            name: 'Core size',
            group: 'product_builder',
            enabled: true,
            options: [
              { id: 'core_25', label: '25 mm', value: '25', priceModifier: 0, isDefault: true },
              { id: 'core_76', label: '76 mm', value: '76', priceModifier: 60 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'paper',
    name: 'Material',
    group: 'product_builder',
    enabled: true,
    options: [
      { id: 'paper_matt', label: 'Matt', value: 'matt', priceModifier: 0, isDefault: true },
      { id: 'paper_gloss', label: 'Gloss', value: 'gloss', priceModifier: 10 },
    ],
  },
];

const CUSTOM_LABEL = 'Custom size…';
const opt = (fieldId, optionId) =>
  product
    .flatMap((f) => (f.id === fieldId ? f.options : []))
    .find((o) => o.id === optionId);
const subOpt = (parentOptionId, subFieldId, optionId) =>
  product
    .flatMap((f) => f.options)
    .find((o) => o.id === parentOptionId)
    .subFields.find((f) => f.id === subFieldId)
    .options.find((o) => o.id === optionId);

console.log('\nSub-options — what the customer is charged\n');

// 1. Opening state seeds the default branch's own questions too.
let selection = defaultSelection(product, CUSTOM_LABEL);
check('opening selection keys', Object.keys(selection).sort(), [
  'paper',
  'sticker_type',
  'sticker_type>opt_individual>cut_shape',
]);
check('opening surcharge is zero', optionsSurchargeOf(selection), 0);

// 2. A choice inside an option is charged.
selection = selectOption(selection, 'sticker_type>opt_individual>cut_shape', subOpt('opt_individual', 'cut_shape', 'shape_star'), CUSTOM_LABEL);
check('star shape adds its surcharge', optionsSurchargeOf(selection), 40);

// 3. THE ONE THAT MATTERS. Switching the parent must take the whole old branch
//    with it — the 40 kr star cannot survive into a product that is now a roll.
selection = selectOption(selection, 'sticker_type', opt('sticker_type', 'opt_roll'), CUSTOM_LABEL);
check('leaving a branch drops its answers', Object.keys(selection).sort(), [
  'paper',
  'sticker_type',
  'sticker_type>opt_roll>core_size',
  'sticker_type>opt_roll>winding',
]);
check('the abandoned branch stops being charged', optionsSurchargeOf(selection), 15);

// 4. The new branch's own answers are charged.
selection = selectOption(selection, 'sticker_type>opt_roll>core_size', subOpt('opt_roll', 'core_size', 'core_76'), CUSTOM_LABEL);
check('roll + 76 mm core', optionsSurchargeOf(selection), 75);
selection = selectOption(selection, 'sticker_type>opt_roll>winding', subOpt('opt_roll', 'winding', 'wind_in'), CUSTOM_LABEL);
check('roll + core + inward winding', optionsSurchargeOf(selection), 100);

// 5. Going back and forth must not accumulate anything.
selection = selectOption(selection, 'sticker_type', opt('sticker_type', 'opt_individual'), CUSTOM_LABEL);
check('back to individual charges nothing extra', optionsSurchargeOf(selection), 0);
selection = selectOption(selection, 'sticker_type', opt('sticker_type', 'opt_roll'), CUSTOM_LABEL);
check('and forward again is just the roll', optionsSurchargeOf(selection), 15);

// 6. Only the live branch is on screen.
const visible = visibleFieldEntries(product, selection).map((e) => e.pathKey);
check('the unchosen branch is not rendered', visible.sort(), [
  'paper',
  'sticker_type',
  'sticker_type>opt_roll>core_size',
  'sticker_type>opt_roll>winding',
]);

// 7. The cart map is flat and keyed by field id, the way every reader expects.
check('cart map keys', Object.keys(flattenSelectionByFieldId(selection)).sort(), [
  'core_size',
  'paper',
  'sticker_type',
  'winding',
]);

// 8. A product with no sub-options behaves exactly as it always did — the paths
//    of top-level fields are their plain field ids, so nothing migrates.
const flat = [product[1]];
check('a flat product keys by field id', Object.keys(defaultSelection(flat, CUSTOM_LABEL)), ['paper']);
check('path of a top-level field is its id', fieldPathKey(['paper']), 'paper');

// 9. The depth cap is real.
const deep = [
  {
    id: 'l0', name: 'L0', group: 'product_builder', enabled: true,
    options: [{
      id: 'l0a', label: 'L0a', value: 'a', priceModifier: 0, isDefault: true,
      subFields: [{
        id: 'l1', name: 'L1', group: 'product_builder', enabled: true,
        options: [{
          id: 'l1a', label: 'L1a', value: 'a', priceModifier: 0, isDefault: true,
          subFields: [{
            id: 'l2', name: 'L2', group: 'product_builder', enabled: true,
            options: [{
              id: 'l2a', label: 'L2a', value: 'a', priceModifier: 0, isDefault: true,
              subFields: [{
                id: 'l3', name: 'Too deep', group: 'product_builder', enabled: true,
                options: [{ id: 'l3a', label: 'never', value: 'n', priceModifier: 9999, isDefault: true }],
              }],
            }],
          }],
        }],
      }],
    }],
  },
];
const deepSelection = defaultSelection(deep, CUSTOM_LABEL);
check(`nesting stops at ${MAX_OPTION_DEPTH} levels`, Object.keys(deepSelection).length, 3);
check('a field below the cap is never priced', optionsSurchargeOf(deepSelection), 0);

// 10. A sub-field the owner switched off is not offered and not charged.
const disabled = JSON.parse(JSON.stringify(product));
disabled[0].options[0].subFields[0].enabled = false;
check(
  'a disabled sub-field is not selected',
  Object.keys(defaultSelection(disabled, CUSTOM_LABEL)).sort(),
  ['paper', 'sticker_type'],
);

// ---------------------------------------------------------------------------
// THE SERVER'S ANSWER MUST BE THE BROWSER'S ANSWER.
//
// The browser holds a selection; what reaches the server is a flat list of ids.
// If those two ever disagree, a customer is shown one price and charged another.
// Every state above is replayed through the server's resolver and the two
// surcharges compared.
// ---------------------------------------------------------------------------
console.log('\nThe server re-prices the same basket\n');

const idsOf = (sel) => Object.values(sel).map((o) => o.id);

const states = [
  ['default (individual, round)', defaultSelection(product, CUSTOM_LABEL)],
];
let s1 = defaultSelection(product, CUSTOM_LABEL);
s1 = selectOption(s1, 'sticker_type>opt_individual>cut_shape', subOpt('opt_individual', 'cut_shape', 'shape_star'), CUSTOM_LABEL);
states.push(['individual + star', s1]);
let s2 = selectOption(s1, 'sticker_type', opt('sticker_type', 'opt_roll'), CUSTOM_LABEL);
states.push(['switched to roll', s2]);
s2 = selectOption(s2, 'sticker_type>opt_roll>core_size', subOpt('opt_roll', 'core_size', 'core_76'), CUSTOM_LABEL);
s2 = selectOption(s2, 'sticker_type>opt_roll>winding', subOpt('opt_roll', 'winding', 'wind_in'), CUSTOM_LABEL);
states.push(['roll + 76 mm + inward', s2]);
let s3 = selectOption(s2, 'paper', product[1].options[1], CUSTOM_LABEL);
states.push(['…and gloss paper', s3]);

for (const [name, sel] of states) {
  const browser = optionsSurchargeOf(sel);
  const server = resolveSelectionFromIds(product, idsOf(sel)).surcharge;
  check(`${name} — browser ${browser} = server ${server}`, server, browser);
}

// The attack this is really guarding: hand-craft a request that names an option
// from a branch that was never entered. The server must ignore it.
const smuggled = resolveSelectionFromIds(product, [
  'opt_individual',        // the customer really is buying individual stickers
  'shape_round',
  'core_76',               // …but posts a 60 kr option from the ROLL branch
  'wind_in',               // …and another 25 kr one
]);
check('a smuggled option from an unchosen branch is not charged', smuggled.surcharge, 0);
check('and does not reach the order', smuggled.matched.map((m) => m.optionId).sort(), [
  'opt_individual',
  'shape_round',
]);

// A required question inside a branch nobody entered is not a question that was
// skipped — it is one that was never asked. (The 2026-08-18 `required: true`
// trap took checkout down for every basket saved before it.)
const requiredInside = JSON.parse(JSON.stringify(product));
requiredInside[0].options[1].subFields[0].required = true;   // required, inside "roll"
check(
  'a required field in an unchosen branch does not block the basket',
  resolveSelectionFromIds(requiredInside, ['opt_individual', 'shape_round', 'paper_matt']).unansweredRequired,
  [],
);
check(
  'but it is enforced once that branch IS chosen',
  resolveSelectionFromIds(requiredInside, ['opt_roll', 'paper_matt']).unansweredRequired.map((r) => r.fieldId),
  ['winding'],
);

// ---- round 16, item 4: shapes and hidden options ----
const shapeFields = [
  { id: 'product_shape', name: 'Shape', enabled: true, options: [
    { id: 'cs-shape-round', label: 'Round (circle)', value: 'round', priceModifier: 0.45 },
    { id: 'cs-shape-star', label: 'Star', value: 'star', priceModifier: 0.85, hidden: true,
      subFields: [{ id: 'star_size', name: 'Star size', enabled: true, options: [{ id: 'star_big', label: 'Big', value: 'big', priceModifier: 5 }] }] },
    { id: 'cs-shape-neg', label: 'Discount shape', value: 'x', priceModifier: -0.3 },
  ] },
];
const roundPick = resolveSelectionFromIds(shapeFields, ['cs-shape-round']);
check('a chosen shape carries its outline to the order', roundPick.matched.map((m) => [m.optionId, m.outline]), [['cs-shape-round', 'circle']]);
const starPick = resolveSelectionFromIds(shapeFields, ['cs-shape-star', 'star_big']);
check('a HIDDEN option is reported by name — not priced, not recorded, its nested size neither',
  [starPick.hiddenChosen, starPick.surcharge, starPick.matched.length],
  [[{ fieldId: 'product_shape', fieldName: 'Shape', optionId: 'cs-shape-star', optionLabel: 'Star', optionLabelI18n: null }], 0, 0]);
const stacked = resolveSelectionFromIds(shapeFields, ['cs-shape-round', 'cs-shape-neg']);
check('one answer per question: a second id of the same question is not priced (no stacked discounts)',
  [stacked.matched.map((m) => m.optionId), stacked.surcharge], [['cs-shape-round'], 0.45]);

// Review of round 16, item 4: "required" means required of what the page shows.
const allHidden = [
  { id: 'colour', name: 'Colour', enabled: true, required: true, options: [
    { id: 'c-red', label: 'Red', value: 'red', priceModifier: 0, hidden: true },
    { id: 'c-blue', label: 'Blue', value: 'blue', priceModifier: 0, hidden: true },
  ] },
  { id: 'roll', name: 'Roll', enabled: true, options: [
    { id: 'r1', label: 'On a roll', value: 'roll', priceModifier: 0, subFields: [
      { id: 'core', name: 'Core', enabled: true, required: true, options: [{ id: 'core76', label: '76', value: '76', priceModifier: 0, hidden: true }] },
    ] },
  ] },
];
check('a REQUIRED question with every option hidden is not on the page, so it is not demanded (it made the product impossible to buy) — nested too',
  resolveSelectionFromIds(allHidden, ['r1']).unansweredRequired, []);
check('…but a required question with something left to choose still is',
  resolveSelectionFromIds([{ ...allHidden[0], options: [...allHidden[0].options, { id: 'c-green', label: 'Green', value: 'green', priceModifier: 0 }] }], []).unansweredRequired.map((r) => r.fieldId),
  ['colour']);
const notYet = resolveSelectionFromIds([{ id: 'design', name: 'Design', enabled: true, options: [
  { id: 'ds-online', label: 'Design it online', value: 'online_template', priceModifier: 0 },
  { id: 'ds-pdf', label: 'Upload a PDF', value: 'pdf', priceModifier: 0 },
] }], ['ds-online']);
check('an option not offered yet ("design it online") is refused by name like a hidden one, not priced',
  [notYet.hiddenChosen.map((h) => h.optionId), notYet.matched.length], [['ds-online'], 0]);

console.log(failed === 0 ? '\n  All sub-option pricing cases pass\n' : `\n  ${failed} case(s) FAILED\n`);
process.exit(failed ? 1 : 0);
