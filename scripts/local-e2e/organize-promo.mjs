#!/usr/bin/env node
// Present imported supplier products as PROMOTIONAL PRODUCTS, sorted by what
// they are — in the LOCAL test shop.
//
//   Promotional products            (one top-level category, no supplier name)
//     ├ Bags & backpacks
//     ├ Pens & writing
//     ├ Kitchen & drinkware
//     └ …                           (ten product types, sv/da/no names)
//
// The supplier's own tree cannot be used as it comes: EasyGifts mixes English
// and Swedish for the same branch ("Travel & recreation" / "Resor och fritid"),
// sends HTML entities (&amp;), and files whole ranges under BRANDS (WENGER,
// VICTORINOX, Pierre Cardin…). So every product is placed by its category path
// first and its name second, through one ordered list of rules below.
//
//   node scripts/local-e2e/organize-promo.mjs [supplier]
//
// Local only: writes to the Firestore EMULATOR (127.0.0.1:8085).
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085';
process.env.GCLOUD_PROJECT = 'demo-reklamx';
const supplier = process.argv[2] || 'easygifts';
export const PARENT = 'promotional-products';

// Ordered: the first rule with a pattern found in "path + name" wins. Regex
// literals, whole words where it matters (/\bpens?\b/), so "pendrive" is not a
// pen and "leather" is not food. More specific rules come first ("knives and
// KITCHEN accessories" is kitchen, not tools; "WENGER › Suitcases and bags" is
// bags, not travel).
const TYPES = [
  { id: 'promo-pens', en: 'Office & writing', sv: 'Kontor & skrivmaterial', da: 'Kontor & skriveredskaber', no: 'Kontor & skrivesaker',
    words: [/\bpens?\b/, /writing/, /ballpoint/, /notebook/, /pencil/, /pierre cardin › sets/, /\boffice/, /kontor/, /\bdesk/, /calculator/, /organi[sz]er/, /sticky/, /\bnotes?\b/, /\bruler/] },
  { id: 'promo-bags', en: 'Bags & backpacks', sv: 'Väskor & ryggsäckar', da: 'Tasker & rygsække', no: 'Vesker & ryggsekker',
    words: [/\bbags?\b/, /backpack/, /väsk/, /ryggsäck/, /suitcase/, /laptop and tablet/, /\btote/, /pouch/] },
  { id: 'promo-kitchen', en: 'Kitchen & drinkware', sv: 'Kök & dryck', da: 'Køkken & drikkevarer', no: 'Kjøkken & drikke',
    words: [/eating/, /drink/, /\beat\b/, /mat och dryck/, /kitchen/, /\bmugs?\b/, /bottle/, /\bcups?\b/, /thermo/, /lunch/] },
  { id: 'promo-electronics', en: 'Electronics', sv: 'Elektronik', da: 'Elektronik', no: 'Elektronikk',
    words: [/electronic/, /elektronik/, /\busb/, /pendrive/, /power ?bank/, /\bdiscs?\b/, /charger/, /speaker/, /earphone/, /headphone/, /\bcables?\b/] },
  { id: 'promo-tools', en: 'Tools, knives & torches', sv: 'Verktyg, knivar & ficklampor', da: 'Værktøj, knive & lommelygter', no: 'Verktøy, kniver & lommelykter',
    words: [/\btools?\b/, /knife/, /knives/, /swisscard/, /swisstool/, /flashlight/, /ficklamp/, /verktyg/, /\btorch/, /multitool/] },
  { id: 'promo-umbrellas', en: 'Umbrellas & rainwear', sv: 'Paraplyer & regnkläder', da: 'Paraplyer & regntøj', no: 'Paraplyer & regnklær',
    words: [/umbrella/, /raincoat/, /paraply/, /\bregn/, /poncho/] },
  { id: 'promo-travel', en: 'Travel & leisure', sv: 'Resor & fritid', da: 'Rejser & fritid', no: 'Reise & fritid',
    words: [/travel/, /recreation/, /resor/, /fritid/, /beach/, /\bsport/, /outdoor/, /blanket/, /picnic/] },
  { id: 'promo-seasonal', en: 'Christmas & seasonal', sv: 'Jul & säsong', da: 'Jul & sæson', no: 'Jul & sesong',
    words: [/xmas/, /christmas/, /\bjul\b/] },
  { id: 'promo-giveaways', en: 'Giveaways & small gifts', sv: 'Giveaways & småprodukter', da: 'Giveaways & småting', no: 'Giveaways & småting',
    words: [] },   // everything no rule above claims
];

const decode = (s) => String(s ?? '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
export function typeFor(path, name) {
  const text = `${(path ?? []).map(decode).join(' › ')} | ${decode(name)}`.toLowerCase();
  return TYPES.find((t) => t.words.some((w) => w.test(text))) ?? TYPES[TYPES.length - 1];
}

// Run, not imported (typeFor is importable for checking the rules).
if (String(process.argv[1] ?? '').replace(/\\/g, '/').endsWith('scripts/local-e2e/organize-promo.mjs')) {
  const { initializeApp } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const db = getFirestore(initializeApp({ projectId: 'demo-reklamx' }, 'organize'));

  const index = new Map((await db.collection('supplierIndex').where('supplier', '==', supplier).get()).docs
    .map((d) => d.data()).map((r) => [String(r.productKey), r]));
  const products = (await db.collection('products').get()).docs.filter((d) => d.id.startsWith(`prod-${supplier}-`));

  const counts = new Map();
  const placed = [];
  for (const d of products) {
    const p = d.data();
    const entry = index.get(String(p.supplierOfferId ?? ''));
    const type = typeFor(entry?.categoryPath, entry?.name ?? p.name);
    placed.push([d.ref, type.id]);
    counts.set(type.id, (counts.get(type.id) ?? 0) + 1);
  }

  const cats = db.collection('categories');
  const batch0 = db.batch();
  batch0.set(cats.doc(PARENT), {
    name: 'Promotional products', nameI18n: { sv: 'Profilprodukter', da: 'Profilprodukter', no: 'Profilprodukter' },
    description: '', parentId: '', image: '/placeholder-print.svg', isHidden: false, sortOrder: 70, productOrder: [],
  }, { merge: true });
  TYPES.filter((t) => counts.has(t.id)).forEach((t, i) => batch0.set(cats.doc(t.id), {
    name: t.en, nameI18n: { sv: t.sv, da: t.da, no: t.no }, description: '', parentId: PARENT,
    image: '/placeholder-print.svg', isHidden: false, sortOrder: (i + 1) * 10, productOrder: [],
  }, { merge: true }));
  batch0.delete(cats.doc(`promo-${supplier}`));   // the per-supplier category the first import made
  await batch0.commit();

  for (let i = 0; i < placed.length; i += 400) {
    const b = db.batch();
    for (const [ref, categoryId] of placed.slice(i, i + 400)) b.update(ref, { categoryId });
    await b.commit();
  }
  console.log(`✓ ${placed.length} ${supplier} products under "Promotional products":`);
  for (const t of TYPES) if (counts.has(t.id)) console.log(`   ${String(counts.get(t.id)).padStart(4)}  ${t.en} / ${t.sv}`);
  process.exit(0);
}
