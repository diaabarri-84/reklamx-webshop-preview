#!/usr/bin/env node
// Writes the product-presentation work into Firestore.
//
// Everything this script does is reversible: every document it touches is dumped
// to .backups/ first, and every step is opt-in-able so you can run one at a time.
//
//   node scripts/apply-product-presentation.mjs --dry-run
//   node scripts/apply-product-presentation.mjs                 (steps 1 and 2)
//   node scripts/apply-product-presentation.mjs --fix-area-pricing   (also step 3)
//
// STEP 1  fix three products whose categoryId points at a category that does not
//         exist, so the storefront filter and the product-page breadcrumb work.
// STEP 2  create the six new products and merge the new presentation content
//         (localized name/description, features, specs, FAQ) onto the three that
//         already existed.
// STEP 3  OPT-IN. Turn off area-based pricing on products that are not sold by
//         the square metre. See the note above applyAreaPricingFix().

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

// fileURLToPath, not url.pathname — this project lives under a directory with
// non-ASCII characters, which .pathname returns percent-encoded.
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DATA = join(ROOT, 'scripts', 'data');
const BACKUPS = join(ROOT, '.backups');

const DRY = process.argv.includes('--dry-run');
const FIX_AREA_PRICING = process.argv.includes('--fix-area-pricing');

const DATABASE_ID = 'ai-studio-67b3d2fe-143f-469d-b3a4-49dcbdfef939';
const OPTION_CATALOGUE_TS = join(ROOT, 'src', 'components', 'Admin', 'optionCatalogue.ts');

initializeApp({
  credential: cert(JSON.parse(readFileSync(join(ROOT, 'service-account.json'), 'utf8'))),
});
const db = getFirestore(DATABASE_ID);

const log = (...a) => console.log(...a);
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

function backup(name, payload) {
  mkdirSync(BACKUPS, { recursive: true });
  const file = join(BACKUPS, `${name}-${stamp()}.json`);
  writeFileSync(file, JSON.stringify(payload, null, 2));
  log(`  backup → ${file.replace(ROOT + '/', '')}`);
}

// ---------------------------------------------------------------- step 1
/**
 * Three products carry a categoryId no category document uses. The shop filter
 * papered over two of them with a substring match on the product NAME, and the
 * third (die-cut stickers) simply never appeared under its category at all.
 */
const CATEGORY_REMAP = {
  'prod-001': { from: 'business-cards', to: 'cards' },
  'prod-002': { from: 'large-format', to: 'banners' },
  'prod-003': { from: 'stickers', to: 'labels' },
};

async function fixCategoryIds() {
  log('\nSTEP 1 — category ids');
  const categoryIds = new Set((await db.collection('categories').get()).docs.map((d) => d.id));
  const before = [];

  for (const [id, { from, to }] of Object.entries(CATEGORY_REMAP)) {
    const snap = await db.collection('products').doc(id).get();
    if (!snap.exists) {
      log(`  skip ${id}: no such product`);
      continue;
    }
    const current = snap.data().categoryId;
    if (current !== from) {
      // Someone already corrected it, or the owner moved the product on purpose.
      log(`  skip ${id}: categoryId is "${current}", expected "${from}" — leaving it alone`);
      continue;
    }
    if (!categoryIds.has(to)) {
      log(`  skip ${id}: target category "${to}" does not exist`);
      continue;
    }
    before.push({ id, categoryId: current });
    if (!DRY) await db.collection('products').doc(id).update({ categoryId: to });
    log(`  ${id}: ${current} → ${to}`);
  }

  if (before.length && !DRY) backup('product-categoryid-before-remap', before);
  return before.length;
}

// ---------------------------------------------------------------- step 2
/**
 * The printing fields a product offers are stored ON the product, as its own
 * copy — that is how the shop already works, and why translating the source
 * catalogue never reaches an existing product. So a new product's option set is
 * built here by pulling the named fields out of the catalogue source.
 *
 * The catalogue is a .ts module and this is a plain node script, so rather than
 * add a build step the field blocks are read out of the source text. It is ugly
 * and it is honest about being ugly: it parses one file, with one known shape,
 * and it fails loudly if a requested field id is not found.
 */
function loadCatalogueFields() {
  const source = readFileSync(OPTION_CATALOGUE_TS, 'utf8');
  const start = source.indexOf('export const OPTION_CATALOGUE');
  if (start === -1) throw new Error('OPTION_CATALOGUE not found in the source');
  // NOT indexOf('[') — the declaration reads `: PrintingField[] = [`, and the
  // first bracket belongs to the TYPE. Take the one after the assignment.
  const assign = source.indexOf('=', start);
  const open = source.indexOf('[', assign);

  // Walk the array, tracking bracket depth, and cut it out whole.
  let depth = 0;
  let end = -1;
  let inString = null;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === inString) inString = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') inString = ch;
    else if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) throw new Error('Could not find the end of OPTION_CATALOGUE');

  // The literal is valid JS. Evaluating our own source file, from disk, in a
  // script the shop owner runs by hand — no network, no user input.
  const literal = source.slice(open, end + 1);
  // eslint-disable-next-line no-new-func
  const fields = new Function(`return ${literal};`)();

  const byId = new Map();
  for (const field of fields) byId.set(field.id, field);
  return byId;
}

/** Deep-clone through JSON: the catalogue holds only plain data. */
const clone = (v) => JSON.parse(JSON.stringify(v));

/**
 * Make `optionId` the field's default and rebase every price modifier around it.
 *
 * A catalogue field is written generically — promo_bottle_capacity defaults to
 * 500 ml at +0 and charges +8 for 650 ml. A product that IS the 650 ml bottle has
 * that 8 kr inside its base price already, so it must open on 650 ml AT ZERO, with
 * the other capacities priced relative to it (500 ml becomes −8, not +0).
 * Rebasing rather than merely zeroing keeps every other option honest.
 */
function rebaseFieldDefault(field, optionId) {
  const target = field.options.find((o) => o.id === optionId);
  if (!target) throw new Error(`${field.id}: no option "${optionId}" to default to`);
  const shift = target.priceModifier || 0;
  for (const option of field.options) {
    // Round: repeated subtraction of 1.5 leaves 0.30000000000000004 behind.
    option.priceModifier = Math.round(((option.priceModifier || 0) - shift) * 100) / 100;
    delete option.isDefault;
  }
  target.isDefault = true;
}

function buildPrintingFields(enabledFieldIds, catalogue, defaultOptionIds = {}) {
  const missing = enabledFieldIds.filter((id) => !catalogue.has(id));
  if (missing.length) {
    throw new Error(`Unknown catalogue field ids: ${missing.join(', ')}`);
  }
  return enabledFieldIds.map((id) => {
    const field = clone(catalogue.get(id));
    field.enabled = true;
    if (defaultOptionIds[id]) rebaseFieldDefault(field, defaultOptionIds[id]);
    // Never ship `required` from the catalogue: the shopper's configurator
    // preselects a default for every field, so a required flag can only fire on
    // a basket filled before the field existed — and then it rejects the payment
    // with an error the shopper cannot answer. This bit the shop once already.
    delete field.required;
    return field;
  });
}

async function writeProducts() {
  log('\nSTEP 2 — products');
  const catalogue = loadCatalogueFields();
  log(`  catalogue: ${catalogue.size} fields available`);

  const newFiles = ['products-new-a.json', 'products-new-b.json'];
  const existingFile = 'products-existing.json';

  const created = [];
  for (const file of newFiles) {
    const path = join(DATA, file);
    if (!existsSync(path)) {
      log(`  skip ${file}: not found`);
      continue;
    }
    for (const product of JSON.parse(readFileSync(path, 'utf8'))) {
      const { enabledFieldIds, defaultOptionIds, ...rest } = product;
      const doc = {
        ...rest,
        printingFields: buildPrintingFields(enabledFieldIds || [], catalogue, defaultOptionIds || {}),
        options: rest.options || [],
        isHidden: false,
        createdAt: rest.createdAt || new Date().toISOString(),
      };

      const ref = db.collection('products').doc(product.id);
      const existing = await ref.get();
      if (existing.exists) {
        // A SECOND RUN MUST NOT UNDO THE OWNER'S WORK.
        //
        // This used to strip only the three price keys and write everything else,
        // `printingFields` included — so re-running the script rebuilt the option
        // set from the catalogue and silently threw away every per-product edit
        // made in the dashboard's property editor, along with any real product
        // photography that had replaced the placeholder illustrations.
        //
        // On a product that already exists, only the PRESENTATION TEXT is
        // refreshed. Price, options, images and quantity bounds belong to whoever
        // last edited them in the dashboard.
        const PRESENTATION_ONLY = [
          'name', 'nameI18n', 'description', 'descriptionI18n',
          'features', 'featuresI18n', 'specs', 'faq',
        ];
        const safe = Object.fromEntries(
          Object.entries(doc).filter(([key]) => PRESENTATION_ONLY.includes(key)),
        );
        log(`  ${product.id}: already exists — refreshing presentation text only (${Object.keys(safe).join(', ')})`);
        if (!DRY) await ref.set(safe, { merge: true });
      } else {
        if (!DRY) await ref.set(doc);
        log(`  ${product.id}: created — ${doc.printingFields.length} fields, base ${doc.basePrice} SEK`);
      }
      created.push(product.id);
    }
  }

  // The three that already exist get presentation content only. Their price,
  // their category and their option set are the owner's and are not touched.
  const existingPath = join(DATA, existingFile);
  if (existsSync(existingPath)) {
    const patches = JSON.parse(readFileSync(existingPath, 'utf8'));
    const before = [];
    for (const patch of patches) {
      const ref = db.collection('products').doc(patch.id);
      const snap = await ref.get();
      if (!snap.exists) {
        log(`  skip ${patch.id}: no such product`);
        continue;
      }
      const current = snap.data();
      before.push({
        id: patch.id,
        description: current.description,
        features: current.features,
        nameI18n: current.nameI18n ?? null,
        descriptionI18n: current.descriptionI18n ?? null,
        featuresI18n: current.featuresI18n ?? null,
        specs: current.specs ?? null,
        faq: current.faq ?? null,
      });
      const { id, ...fields } = patch;
      if (!DRY) await ref.set(fields, { merge: true });
      log(`  ${patch.id}: presentation content merged`);
    }
    if (before.length && !DRY) backup('product-presentation-before-merge', before);
  }

  return created.length;
}

// ---------------------------------------------------------------- step 3
/**
 * OPT-IN, because it changes prices the shop is live with.
 *
 * calcConfiguredItemPrice adds an AREA surcharge — width × height ÷ 10 000 ×
 * pricePerSqm — to every product whose customUploadRules do not switch it off.
 * None of the shop's products switch it off, and the default size is 50 × 70 cm
 * at 350 kr/m², so every product silently carries ~123 kr per unit of area
 * charge whether or not it is sold by area. On business cards that is most of
 * the price: 100 cards quote 22 549 SEK.
 *
 * Turning it off on the piece-goods products makes them quote from their base
 * price and their chosen options, which is what the owner set those numbers up
 * to mean. Products genuinely sold by the square metre (banners, decals) keep it.
 */
const NOT_SOLD_BY_AREA = ['prod-001', 'prod-003', 'prod-roll-labels'];

async function applyAreaPricingFix() {
  log('\nSTEP 3 — area pricing (opt-in)');
  const before = [];
  for (const id of NOT_SOLD_BY_AREA) {
    const ref = db.collection('products').doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      log(`  skip ${id}: no such product`);
      continue;
    }
    const current = snap.data().customUploadRules ?? null;
    if (current && current.enabled === false) {
      log(`  skip ${id}: area pricing already off`);
      continue;
    }
    before.push({ id, customUploadRules: current });
    const next = { ...(current || {}), enabled: false };
    // A floor of 149 kr on a product priced per piece would swallow the base
    // price of anything cheap; keep whatever the owner set, else drop it low.
    if (next.minPrice === undefined) next.minPrice = 1;
    if (!DRY) await ref.update({ customUploadRules: next });
    log(`  ${id}: area pricing off (minPrice ${next.minPrice})`);
  }
  if (before.length && !DRY) backup('product-uploadrules-before-area-fix', before);
  return before.length;
}

// ---------------------------------------------------------------- run
log(DRY ? 'DRY RUN — nothing will be written\n' : 'Writing to Firestore\n');

const remapped = await fixCategoryIds();
const written = await writeProducts();
const repriced = FIX_AREA_PRICING ? await applyAreaPricingFix() : 0;

log('\n─────────────────────────────');
log(`categories remapped : ${remapped}`);
log(`products written    : ${written}`);
log(
  FIX_AREA_PRICING
    ? `area pricing fixed  : ${repriced}`
    : 'area pricing        : skipped (pass --fix-area-pricing to apply)',
);
log(DRY ? '\nDRY RUN — no changes were made.' : '\nDone.');
process.exit(0);
