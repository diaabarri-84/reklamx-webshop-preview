#!/usr/bin/env node
// The artwork upload box — src/lib/artwork.ts.
//
// WHY IT EXISTS. The rule lived twice, once in the storefront configurator and
// once in the product editor, and both said `artworkEnabled !== false`. The
// owner's client then opened an acrylic display stand — a finished good — and
// found a "drop your print file here" box on it, because not one of the 109
// products in the catalogue had the field set and "not set" meant SHOWN.
//
// The default is now OFF, which makes the absent value load-bearing: the tests
// that matter here are the ones about a product that says nothing at all.
//
//   node scripts/test-artwork.mjs

import { build } from 'esbuild';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), 'reklamx-artwork-'));
const out = join(outDir, 'artwork.mjs');
await build({
  entryPoints: [join(ROOT, 'src', 'lib', 'artwork.ts')],
  outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
});
const { artworkBoxShown, artworkFileRequired, artworkExpected, artworkSourceOf } = await import(pathToFileURL(out).href);
rmSync(outDir, { recursive: true, force: true });

let failed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) console.log(`  ✅ ${name}`);
  else { failed += 1; console.error(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`); }
};

console.log('\nthe box is off unless the owner ticked it');
// THE ONE THAT MATTERS: all 109 live products look exactly like this.
check('a product that says nothing is OFF', artworkBoxShown({}), false);
check('and so are null and undefined', [artworkBoxShown(null), artworkBoxShown(undefined)], [false, false]);
check('an explicit true is ON', artworkBoxShown({ artworkEnabled: true }), true);
check('an explicit false is OFF', artworkBoxShown({ artworkEnabled: false }), false);
// A bad import, a form that posted a string, a value out of a spreadsheet: none
// of these is a tick, and `!== false` would have let every one of them through.
check('a truthy non-true value is NOT a tick',
  [artworkBoxShown({ artworkEnabled: 'true' }), artworkBoxShown({ artworkEnabled: 1 }), artworkBoxShown({ artworkEnabled: {} })],
  [false, false, false]);

console.log('\na file is mandatory only where a file can actually be attached');
check('box on, required, and the method wants a file',
  artworkFileRequired({ artworkEnabled: true, artworkRequired: true }, true), true);
// THE TRAP: required without the box is an unbuyable product with no visible reason.
check('required but the box is OFF → not required',
  artworkFileRequired({ artworkEnabled: false, artworkRequired: true }, true), false);
check('required, but the shopper chose to send it later → not now',
  artworkFileRequired({ artworkEnabled: true, artworkRequired: true }, false), false);
check('box on, not required',
  artworkFileRequired({ artworkEnabled: true }, true), false);
check('an empty product is never required',
  [artworkFileRequired({}, true), artworkFileRequired(null, true)], [false, false]);

console.log('\nwaiting for a file we ASKED for — not merely "no file here"');
// THE DEFECT THIS EXISTS TO STOP. With the box off on all 109 products, no line
// can ever carry a file, so a pending flag built from "no file" alone stamped
// EVERY paid order "waiting for artwork" — and the confirmation email then told
// the customer "We still need your print file" for an acrylic display stand.
const pending = (isCustomUpload, product, hasFile) => artworkExpected(isCustomUpload, product) && !hasFile;
check('box off, no file → nothing is pending', pending(false, {}, false), false);
check('box on, no file → pending', pending(false, { artworkEnabled: true }, false), true);
check('box on, file attached → not pending', pending(false, { artworkEnabled: true }, true), false);
// A custom upload has NO product document — the customer's file IS the product.
check('a custom upload with no product is ALWAYS expected', artworkExpected(true, null), true);
check('and is pending until the file arrives', [pending(true, null, false), pending(true, null, true)], [true, false]);
check('an explicit false never expects a file', artworkExpected(false, { artworkEnabled: false }), false);

console.log('\na reprint or the shop\'s studio is not "waiting for his file" (round 16)');
const box = { artworkEnabled: true };
const method = (id, value) => ({ fieldId: 'artwork_supply_method', id, value });
const service = (id, value) => ({ fieldId: 'design_service', id, value });
check('reprint and the full design service are the SHOP\'s artwork',
  [artworkSourceOf([method('af-supply-reprint', 'reprint_previous')]), artworkSourceOf([method('af-supply-designer', 'design_service')])],
  ['reprint', 'studio']);
check('the design-service question\'s studio packages too, by id (the page) or optionId (the server)',
  [artworkSourceOf([service('sv-dsgn-basic', 'designer_basic')]), artworkSourceOf([{ fieldId: 'design_service', optionId: 'sv-dsgn-campaign', value: '' }])],
  ['studio', 'studio']);
check('a library copy with a NEW id still counts, by its value — inside the artwork questions',
  [artworkSourceOf([method('copy-1', 'reprint_previous')]), artworkSourceOf([service('copy-2', 'designer_premium')])],
  ['reprint', 'studio']);
// THE TRAP a prefix rule fell into: a T-shirt quality tier's value is designer_220.
check('…and ONLY there: a T-shirt tier valued designer_220 is not a design service',
  [artworkSourceOf([{ fieldId: 'garment_quality_tier', id: 'ct-tier-designer', value: 'designer_220' }]),
    artworkSourceOf([{ fieldId: 'garment_quality_tier', id: 'x', value: 'design_service' }])],
  [null, null]);
check('these still want HIS file: upload now, send later, design online, "touch up my file", "upload — no design"',
  [artworkSourceOf([method('af-supply-pdf', 'print_ready_pdf')]), artworkSourceOf([method('af-supply-later', 'artwork_later')]),
    artworkSourceOf([method('af-supply-template', 'online_template')]), artworkSourceOf([service('sv-dsgn-fix', 'designer_touch_up')]),
    artworkSourceOf([service('sv-dsgn-upload', 'upload')])],
  [null, null, null, null, null]);
check('studio beats reprint when a line carries both', artworkSourceOf([method('af-supply-reprint', 'reprint_previous'), service('sv-dsgn-basic', '')]), 'studio');
const pendingWith = (options, hasFile) => artworkExpected(false, box, options) && !hasFile;
check('box on, no file: a reprint and a studio line are NOT pending; "send later" still is',
  [pendingWith([method('af-supply-reprint', 'reprint_previous')], false), pendingWith([service('sv-dsgn-standard', 'designer_standard')], false),
    pendingWith([method('af-supply-later', 'artwork_later')], false), pendingWith([], false)],
  [false, false, true, true]);
check('a custom upload is still always expected, whatever is chosen', artworkExpected(true, null, [method('af-supply-reprint', 'reprint_previous')]), true);
// The touch-up works on HIS file. With the box off (the default) nothing asked for
// it — no upload box after the order, no e-mail, no hold — for 395 kr paid.
check('box OFF: a touch-up still expects his file (by id, or by value inside the question); nothing else does',
  [artworkExpected(false, {}, [service('sv-dsgn-fix', 'designer_touch_up')]), artworkExpected(false, {}, [service('copy-9', 'designer_touch_up')]),
    artworkExpected(false, {}, [{ fieldId: 'garment_quality_tier', id: 'x', value: 'designer_touch_up' }]), artworkExpected(false, {}, [])],
  [true, true, false, false]);
check('…unless the shop makes the artwork anyway (the full design service on the same line)',
  artworkExpected(false, {}, [service('sv-dsgn-fix', 'designer_touch_up'), method('af-supply-designer', 'design_service')]), false);
// Designer v2, design later: "Design online" may be paid for before it is designed,
// and the line then waits for the design — on a product whose box is off as well.
check('box OFF: "Design online" expects his design (by id, page or server); only in the artwork question',
  [artworkExpected(false, {}, [method('af-supply-template', 'online_template')]),
    artworkExpected(false, {}, [{ fieldId: 'artwork_supply_method', optionId: 'af-supply-template', value: '' }]),
    artworkExpected(false, {}, [{ fieldId: 'garment_quality_tier', id: 'af-supply-template', value: '' }])],
  [true, true, false]);

console.log('\nthe server can actually SEE the field it now decides on');
// A REST read with a field mask: a field left out of the list comes back
// undefined, every product reads as switched off, and the bug above returns
// silently — no error, no log. The mask is the load-bearing part of the fix.
{
  const serverSrc = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const m = serverSrc.match(/const PRODUCT_PRICING_FIELDS = \[([\s\S]*?)\];/);
  check('PRODUCT_PRICING_FIELDS exists', Boolean(m), true);
  check("and it lists 'artworkEnabled'", Boolean(m && m[1].includes("'artworkEnabled'")), true);
}

console.log('\nthe two answers can never contradict each other');
for (const enabled of [undefined, true, false]) {
  for (const required of [undefined, true, false]) {
    const p = { ...(enabled === undefined ? {} : { artworkEnabled: enabled }), ...(required === undefined ? {} : { artworkRequired: required }) };
    if (artworkFileRequired(p, true) && !artworkBoxShown(p)) {
      failed += 1;
      console.error(`  ❌ ${JSON.stringify(p)} demands a file with no box to attach it to`);
    }
  }
}
console.log('  ✅ no combination demands a file without offering one');

// THE E-MAIL THE PRODUCT PAGE PROMISES (round 16 review). A reprint or studio line
// owes no file, so it has no upload box and was left out of the "we still need
// your file" block — and the confirmation then said nothing at all, while the
// product page told the customer to reply to it with his logo.
console.log('\nthe confirmation asks for what the shop needs');
{
  const emailDir = mkdtempSync(join(tmpdir(), 'reklamx-artwork-mail-'));
  await build({
    entryPoints: [join(ROOT, 'src', 'lib', 'email.ts')],
    outfile: join(emailDir, 'email.mjs'), bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  });
  const { customerConfirmation } = await import(pathToFileURL(join(emailDir, 'email.mjs')).href);
  rmSync(emailDir, { recursive: true, force: true });
  const mail = (items) => customerConfirmation({ id: 'T1', currency: 'SEK', items }, 'ReklamX', 'https://shop.example/order/T1?t=x').html;
  const studio = mail([{ productName: 'Roll-up', quantity: 1, price: 900, artworkSource: 'studio' }]);
  const reprint = mail([{ productName: 'Visitkort', quantity: 500, price: 300, artworkSource: 'reprint' }]);
  const plain = mail([{ productName: 'Pennor', quantity: 100, price: 400 }]);
  check('a studio line: asked to reply with logo and texts, the product named',
    [/Our designer makes your artwork/.test(studio), /Reply to this email with your logo, the text you want/.test(studio), /Roll-up/.test(studio), /We still need your print file/.test(studio)], [true, true, true, false]);
  check('a reprint line: asked which earlier order, by its number, when there is more than one',
    [/A reprint of an earlier order/.test(reprint), /the number of the order you want reprinted/.test(reprint)], [true, true]);
  check('an ordinary line: neither', /data-rx-shop-artwork-ask/.test(plain), false);
  // Designer v2, design later: a line bought as "Design online" before it was designed.
  const later = mail([
    { productName: 'Visitkort', quantity: 100, price: 300, artworkPending: true, designLater: { trimMm: { wMm: 85, hMm: 55 } } },
    { productName: 'Roll-up', quantity: 1, price: 900, artworkPending: true },
  ]);
  const laterOnly = mail([{ productName: 'Visitkort', quantity: 100, price: 300, artworkPending: true, designLater: { trimMm: { wMm: 85, hMm: 55 } } }]);
  check('a line to be designed online: asked to CREATE the design on the order page — and a file line beside it still asked for its file',
    [/Your design is still to be made/.test(later), /You chose to design online for: Visitkort/.test(later), /without attaching artwork for: Roll-up\./.test(later),
      /We still need your print file/.test(laterOnly)], [true, true, true, false]);
}

console.log(`\n${failed === 0 ? 'The upload box appears where it was asked for, and nowhere else.' : `${failed} failing.`}`);
process.exit(failed === 0 ? 0 : 1);
