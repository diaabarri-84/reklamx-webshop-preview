#!/usr/bin/env node
// A TEST CATALOGUE for local test mode — no backup of the real shop needed.
//
// start.sh / start-windows.mjs seed the Firebase emulators from a backup folder
// holding products.json, categories.json and settings.json. This writes such a
// folder from scratch (scripts/local-e2e/test-data/), so the whole shop can be
// clicked through — designer, checkout, dashboard — without a copy of the
// client's data:
//
//   * the six products scripts/data/products-new-*.json defines for the real
//     shop (T-shirt, bottle, pen, pavement sign, window decals, wall calendar),
//     expanded exactly as scripts/apply-product-presentation.mjs expands them;
//   * eight more covering what those six do not: a beach FLAG and business cards,
//     stickers, posters and a roll-up with the online designer; a PVC banner
//     priced by area with its own size; flyers; labels on a roll.
//
// Every option comes from the shop's own catalogue (src/components/Admin/
// optionCatalogue.ts), so the configurator, prices and designer behave as they
// do for a product the owner builds in the dashboard.
//
//   node scripts/local-e2e/make-test-data.mjs
import { build } from 'esbuild';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const OUT = join(ROOT, 'scripts/local-e2e/test-data');

const tmp = mkdtempSync(join(tmpdir(), 'reklamx-testdata-'));
await build({ entryPoints: [join(ROOT, 'src/components/Admin/optionCatalogue.ts')], outfile: join(tmp, 'c.mjs'), bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const { OPTION_CATALOGUE } = await import(pathToFileURL(join(tmp, 'c.mjs')).href);
rmSync(tmp, { recursive: true, force: true });
const catalogue = new Map(OPTION_CATALOGUE.map((f) => [f.id, f]));

// ── The same expansion scripts/apply-product-presentation.mjs uses ──
const clone = (v) => JSON.parse(JSON.stringify(v));
function rebaseFieldDefault(field, optionId) {
  const target = field.options.find((o) => o.id === optionId);
  if (!target) throw new Error(`${field.id}: no option "${optionId}" to default to`);
  const shift = target.priceModifier || 0;
  for (const option of field.options) {
    option.priceModifier = Math.round(((option.priceModifier || 0) - shift) * 100) / 100;
    delete option.isDefault;
  }
  target.isDefault = true;
}
function buildPrintingFields(ids, defaults = {}, display = {}) {
  const missing = ids.filter((id) => !catalogue.has(id));
  if (missing.length) throw new Error(`Unknown catalogue field ids: ${missing.join(', ')}`);
  return ids.map((id) => {
    const field = clone(catalogue.get(id));
    field.enabled = true;
    if (defaults[id]) rebaseFieldDefault(field, defaults[id]);
    if (display[id]) field.display = display[id];
    delete field.required;
    return field;
  });
}

const NOW = '2026-10-13T00:00:00.000Z';
const ART = (name) => [`/product-art/${name}-1.svg`, `/product-art/${name}-2.svg`, `/product-art/${name}-3.svg`];
const PLACEHOLDER = ['/placeholder-print.svg'];
const tiers = (...pairs) => pairs.map(([minQuantity, discountPercentage]) => ({ minQuantity, discountPercentage }));
const UPLOAD = { enabled: false, allowedFormats: ['pdf', 'ai', 'eps', 'svg', 'jpg', 'jpeg', 'png', 'tiff'], maxFileSizeMb: 100 };
// What every product shares: the artwork step on (the designer lives there), shown, dated.
const common = { options: [], isWeb2Print: true, isHidden: false, artworkEnabled: true, artworkRequired: false, createdAt: NOW, updatedAt: NOW };

// ── 1. The six products the real shop was given (scripts/data) ──
const products = {};
for (const file of ['products-new-a.json', 'products-new-b.json']) {
  for (const p of JSON.parse(readFileSync(join(ROOT, 'scripts/data', file), 'utf8'))) {
    const { enabledFieldIds, defaultOptionIds, ...rest } = p;
    products[p.id] = { ...common, ...rest, printingFields: buildPrintingFields(enabledFieldIds ?? [], defaultOptionIds ?? {}) };
  }
}

// ── 2. Products for what those six do not cover ──
const extra = [
  {
    id: 'test-beach-flag', slug: 'test-beach-flag', categoryId: 'flags', name: 'Beach flag (test)',
    nameI18n: { sv: 'Beachflagga (test)', da: 'Beachflag (test)', no: 'Beachflagg (test)' },
    description: 'Test product: a printed beach flag with pole and base. Design it online or upload your own file.',
    basePrice: 595, minQuantity: 1, maxQuantity: 50, images: PLACEHOLDER, onlineDesign: true,
    pricingRules: { baseSetupFee: 0, priceCalculationType: 'tiered_volume', volumeDiscounts: tiers([5, 5], [10, 10], [25, 15]) },
    fields: ['flag_size', 'flag_shape', 'flag_printed_sides', 'flag_base', 'flag_pole_set', 'artwork_supply_method', 'design_service', 'production_delivery_speed'],
    display: { flag_shape: 'cards' },
  },
  {
    id: 'test-business-cards', slug: 'test-business-cards', categoryId: 'cards', name: 'Business cards (test)',
    nameI18n: { sv: 'Visitkort (test)', da: 'Visitkort (test)', no: 'Visittkort (test)' },
    description: 'Test product: classic business cards on premium paper, single or double sided.',
    basePrice: 2.5, minQuantity: 100, maxQuantity: 10000, images: PLACEHOLDER, onlineDesign: true,
    pricingRules: { baseSetupFee: 99, priceCalculationType: 'tiered_volume', volumeDiscounts: tiers([250, 10], [500, 20], [1000, 30]) },
    fields: ['business_card_size', 'paper_material_family', 'paper_weight_gsm', 'printed_sides', 'surface_finish', 'corner_style', 'artwork_supply_method', 'design_service', 'production_delivery_speed'],
  },
  {
    id: 'test-stickers', slug: 'test-stickers', categoryId: 'labels', name: 'Stickers in any shape (test)',
    nameI18n: { sv: 'Klistermärken i valfri form (test)', da: 'Klistermærker i alle former (test)', no: 'Klistremerker i alle former (test)' },
    description: 'Test product: stickers cut to a round, square, oval or custom shape.',
    basePrice: 1.9, minQuantity: 50, maxQuantity: 20000, images: ART('stickers'), onlineDesign: true,
    pricingRules: { baseSetupFee: 79, priceCalculationType: 'tiered_volume', volumeDiscounts: tiers([250, 10], [1000, 25], [5000, 40]) },
    fields: ['sticker_label_size', 'product_shape', 'sticker_material', 'sticker_finish', 'sticker_cut_type', 'artwork_supply_method', 'design_service'],
    display: { product_shape: 'cards' },
  },
  {
    id: 'test-posters', slug: 'test-posters', categoryId: 'cards', name: 'Posters (test)',
    nameI18n: { sv: 'Affischer (test)', da: 'Plakater (test)', no: 'Plakater (test)' },
    description: 'Test product: posters from A4 to A0 on matte or gloss paper.',
    basePrice: 89, minQuantity: 1, maxQuantity: 500, images: PLACEHOLDER, onlineDesign: true,
    pricingRules: { baseSetupFee: 0, priceCalculationType: 'tiered_volume', volumeDiscounts: tiers([10, 10], [50, 20]) },
    fields: ['poster_size', 'paper_weight_gsm', 'surface_finish', 'artwork_supply_method', 'design_service', 'production_delivery_speed'],
  },
  {
    id: 'test-rollup', slug: 'test-rollup', categoryId: 'exhibition', name: 'Roll-up banner (test)',
    nameI18n: { sv: 'Roll-up (test)', da: 'Roll-up (test)', no: 'Roll-up (test)' },
    description: 'Test product: a roll-up banner with cassette and carry bag.',
    basePrice: 890, minQuantity: 1, maxQuantity: 50, images: PLACEHOLDER, onlineDesign: true,
    pricingRules: { baseSetupFee: 0, priceCalculationType: 'tiered_volume', volumeDiscounts: tiers([3, 5], [10, 10]) },
    fields: ['rollup_banner_size', 'roller_banner_cassette', 'display_carry_bag', 'artwork_supply_method', 'design_service', 'production_delivery_speed'],
  },
  {
    id: 'test-pvc-banner', slug: 'test-pvc-banner', categoryId: 'exhibition', name: 'PVC banner, any size (test)',
    nameI18n: { sv: 'PVC-banderoll, valfri storlek (test)', da: 'PVC-banner, valgfri størrelse (test)', no: 'PVC-banner, valgfri størrelse (test)' },
    description: 'Test product: a PVC banner priced by area — type your own width and height.',
    basePrice: 189, minQuantity: 1, maxQuantity: 100, images: PLACEHOLDER, onlineDesign: true,
    customUploadRules: { ...UPLOAD, enabled: true, areaPriced: true, pricePerSqm: 189, minPrice: 299, maxWidthCm: 500, maxHeightCm: 300 },
    pricingRules: { baseSetupFee: 0, priceCalculationType: 'per_sqm', volumeDiscounts: tiers([5, 5], [10, 10]) },
    fields: ['large_format_size', 'banner_material', 'banner_hemming', 'banner_eyelets', 'artwork_supply_method', 'design_service'],
  },
  {
    id: 'test-flyers', slug: 'test-flyers', categoryId: 'cards', name: 'Flyers (test)',
    nameI18n: { sv: 'Flygblad (test)', da: 'Flyers (test)', no: 'Flygeblad (test)' },
    description: 'Test product: flyers in standard paper formats, single or double sided.',
    basePrice: 0.9, minQuantity: 100, maxQuantity: 50000, images: PLACEHOLDER, onlineDesign: true,
    pricingRules: { baseSetupFee: 149, priceCalculationType: 'tiered_volume', volumeDiscounts: tiers([500, 15], [1000, 25], [5000, 40]) },
    fields: ['standard_paper_format', 'paper_weight_gsm', 'printed_sides', 'surface_finish', 'artwork_supply_method', 'design_service', 'production_delivery_speed'],
  },
  {
    id: 'test-roll-labels', slug: 'test-roll-labels', categoryId: 'labels', name: 'Labels on a roll (test)',
    nameI18n: { sv: 'Etiketter på rulle (test)', da: 'Etiketter på rulle (test)', no: 'Etiketter på rull (test)' },
    description: 'Test product: labels on a roll for hand or machine application. Upload your own file.',
    basePrice: 0.6, minQuantity: 500, maxQuantity: 100000, images: ['/product-art/sticker-type-roll.svg'], onlineDesign: false,
    pricingRules: { baseSetupFee: 199, priceCalculationType: 'tiered_volume', volumeDiscounts: tiers([1000, 10], [5000, 25], [10000, 35]) },
    fields: ['sticker_label_size', 'label_roll_material', 'labels_per_roll', 'label_roll_core', 'label_roll_winding', 'artwork_supply_method'],
  },
];
for (const { fields, display, ...p } of extra) {
  products[p.id] = {
    ...common, customUploadRules: UPLOAD, features: [], specs: [], faq: [], ...p,
    printingFields: buildPrintingFields(fields, {}, display ?? {}),
  };
}

// ── Categories: every categoryId a product uses, top level, in a fixed order ──
const CATEGORY_NAMES = {
  flags: ['Flags', 'Flaggor'], cards: ['Print & cards', 'Trycksaker'], labels: ['Stickers & labels', 'Klistermärken & etiketter'],
  exhibition: ['Banners & displays', 'Banderoller & mässmaterial'], textiles: ['Textiles', 'Textil'], cups: ['Mugs & bottles', 'Muggar & flaskor'],
};
// A photo per category (Pexels, chosen 2026-10-14 to match the name — see
// scripts/pick-pexels-images.mjs). The shop serves them from Pexels' own CDN.
const CATEGORY_IMAGES = {
  textiles: 'https://images.pexels.com/photos/8146450/pexels-photo-8146450.jpeg?auto=compress&cs=tinysrgb&w=800',
  cards: 'https://images.pexels.com/photos/5706020/pexels-photo-5706020.jpeg?auto=compress&cs=tinysrgb&w=800',
  cups: 'https://images.pexels.com/photos/31785816/pexels-photo-31785816.jpeg?auto=compress&cs=tinysrgb&w=800',
  labels: 'https://images.pexels.com/photos/30101191/pexels-photo-30101191.jpeg?auto=compress&cs=tinysrgb&w=800',
  exhibition: 'https://images.pexels.com/photos/12705461/pexels-photo-12705461.jpeg?auto=compress&cs=tinysrgb&w=800',
  flags: 'https://images.pexels.com/photos/35444199/pexels-photo-35444199.jpeg?auto=compress&cs=tinysrgb&w=800',
};
// Hidden on the front page and in the menu (the owner's choice, 2026-10-13): the
// test shop starts the way he left it.
const HIDDEN_CATEGORIES = new Set(['exhibition', 'flags']);
// In the shop, but not in the home page's category grid (the owner, 2026-10-14).
const HIDDEN_ON_HOME = new Set(['cups']);
const used = [...new Set(Object.values(products).map((p) => p.categoryId))];
const unknown = used.filter((c) => !CATEGORY_NAMES[c]);
if (unknown.length) throw new Error(`Name these categories in CATEGORY_NAMES: ${unknown.join(', ')}`);
const categories = Object.fromEntries(used.map((id, i) => [id, {
  name: CATEGORY_NAMES[id][0], nameI18n: { sv: CATEGORY_NAMES[id][1], da: null, no: null },
  description: '', parentId: '', image: CATEGORY_IMAGES[id] ?? '/placeholder-print.svg', isHidden: HIDDEN_CATEGORIES.has(id), hiddenOnHome: HIDDEN_ON_HOME.has(id), sortOrder: (i + 1) * 10,
  productOrder: Object.values(products).filter((p) => p.categoryId === id).map((p) => p.id),
}]));

// Settings: none — the server and the dashboard fall back to their defaults,
// exactly as on a fresh shop. The owner's dashboard writes them on first save.
const settings = {};

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'products.json'), JSON.stringify(products, null, 2));
writeFileSync(join(OUT, 'categories.json'), JSON.stringify(categories, null, 2));
writeFileSync(join(OUT, 'settings.json'), JSON.stringify(settings, null, 2));
console.log(`test catalogue → ${OUT}`);
console.log(`  ${Object.keys(products).length} products: ${Object.values(products).map((p) => p.name).join(', ')}`);
console.log(`  ${Object.keys(categories).length} categories: ${Object.keys(categories).join(', ')}`);
