#!/usr/bin/env node
// File imported EasyGifts products under THEIR OWN product types — in the LOCAL
// test shop — instead of one "Promotional products" category.
//
// The supplier says, per product, what it is: `categories` in offer.json, e.g.
// "Väskor, påsar och ryggsäckar › Ryggsäckar". That is the essential category,
// so it is used as it comes, in its own Swedish and English words:
//   * nine supplier types become main categories (a few merged, so the menu
//     stays short: writing + office; umbrellas under travel; food and drink
//     into the shop's mugs category, renamed "Kitchen & drinkware");
//   * the supplier's sub-type becomes the product's sub-category;
//   * products the supplier filed only under a brand are placed by their name
//     (the rules in organize-promo.mjs);
//   * the supplier's own best sellers (attributes.bestseller) go first in every
//     category — and are flagged supplierBestseller on the product.
// The old "Promotional products" categories are removed.
//
//   node scripts/local-e2e/categorize-supplier.mjs [feedDir]
//
// feedDir may hold offer-se.json, offer-en.json, categories-se.json and
// categories-en.json already downloaded; otherwise they are fetched (~25 MB).
// Local only: writes to the Firestore EMULATOR (127.0.0.1:8085).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085';
process.env.GCLOUD_PROJECT = 'demo-reklamx';
const FEED = process.argv[2];
const SUPPLIER = 'easygifts';

async function feed(file, lang) {
  const local = FEED && join(FEED, `${file}-${lang}.json`);
  if (local && existsSync(local)) return JSON.parse(readFileSync(local, 'utf8'));
  console.log(`  fetching ${lang}/${file}.json …`);
  return (await fetch(`https://easygifts.com.pl/data/webapi2/${lang}/json/${file}.json`)).json();
}
const flat = (x) => (Array.isArray(x) ? x : Object.values(x)).flat(2);
const decode = (s) => String(s ?? '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
const slug = (s) => decode(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Supplier type id → the shop's main category. The pictures: Pexels photos, except
// tools, electronics and travel, which show one of their own products (the owner's
// choice, 2026-10-14: Tool set ESSEX, Phone Stand FREDERICTON, Lunch box VIGO).
const MAIN = {
  officeWriting: { id: 'office-writing', en: 'Office & writing', sv: 'Kontor & skrivmaterial', da: 'Kontor & skriveredskaber', no: 'Kontor & skrivesaker', image: 'https://images.pexels.com/photos/8119804/pexels-photo-8119804.jpeg?auto=compress&cs=tinysrgb&w=800' },
  bags: { id: 'bags', en: 'Bags & backpacks', sv: 'Väskor & ryggsäckar', da: 'Tasker & rygsække', no: 'Vesker & ryggsekker', image: 'https://images.pexels.com/photos/1214212/pexels-photo-1214212.jpeg?auto=compress&cs=tinysrgb&w=800' },
  tools: { id: 'tools', en: 'Tools & torches', sv: 'Verktyg & ficklampor', da: 'Værktøj & lommelygter', no: 'Verktøy & lommelykter', image: 'https://www.easygifts.com.pl/data/shopproducts/19751/wielofunkcyjny-zestaw-narzedzi-essex-084903-2.jpg' },
  giveaways: { id: 'giveaways', en: 'Giveaways', sv: 'Giveaways & småprodukter', da: 'Giveaways', no: 'Giveaways', image: 'https://images.pexels.com/photos/8761297/pexels-photo-8761297.jpeg?auto=compress&cs=tinysrgb&w=800', hiddenOnHome: true },
  electronics: { id: 'electronics', en: 'Electronics', sv: 'Elektronik', da: 'Elektronik', no: 'Elektronikk', image: 'https://www.easygifts.com.pl/data/shopproducts/23235/stojak-na-biurko-fredericton-237713-2.jpg' },
  travel: { id: 'travel-leisure', en: 'Travel & leisure', sv: 'Resor & fritid', da: 'Rejser & fritid', no: 'Reise & fritid', image: 'https://www.easygifts.com.pl/data/shopproducts/24100/lunchbox-vigo-265903.jpg' },
  kitchen: { id: 'cups', en: 'Kitchen & drinkware', sv: 'Kök & dryck', da: 'Køkken & drikkevarer', no: 'Kjøkken & drikke', image: 'https://images.pexels.com/photos/31785816/pexels-photo-31785816.jpeg?auto=compress&cs=tinysrgb&w=800', hiddenOnHome: true },
};
const BY_SUPPLIER_TYPE = { 2: 'officeWriting', 3: 'officeWriting', 8: 'bags', 10: 'tools', 905: 'giveaways', 913: 'electronics', 928: 'travel', 947: 'kitchen', 951: 'travel' };
// organize-promo.mjs's name rules → the same mains, for products with no type.
const BY_NAME_RULE = { 'promo-pens': 'officeWriting', 'promo-bags': 'bags', 'promo-kitchen': 'kitchen', 'promo-electronics': 'electronics', 'promo-tools': 'tools', 'promo-umbrellas': 'travel', 'promo-travel': 'travel', 'promo-seasonal': 'giveaways', 'promo-giveaways': 'giveaways' };

const { typeFor } = await import(new URL('./organize-promo.mjs', import.meta.url).href);
console.log('▸ reading the supplier feed');
const [offerSe, offerEn, catsSe, catsEn] = await Promise.all([feed('offer', 'se'), feed('offer', 'en'), feed('categories', 'se'), feed('categories', 'en')]);
const enName = new Map(); // supplier (sub)category id → English name
for (const c of flat(catsEn)) { enName.set(String(c.id), decode(c.name)); for (const s of c.subcategories ?? []) enName.set(String(s.id), decode(s.name)); }
const typeIds = new Set(flat(catsSe).filter((c) => (c.subcategories ?? []).length).map((c) => String(c.id)));
const enRowName = new Map(flat(offerEn).map((r) => [String(r.baseinfo?.code_short ?? ''), r.baseinfo?.name]));

// One placement per product (the rows are colours of it).
const placement = new Map();
for (const r of flat(offerSe)) {
  const key = String(r.baseinfo?.code_short ?? '').trim();
  if (!key || placement.has(key)) continue;
  const best = r.attributes?.bestseller === '1';
  const prim = (r.categories ?? []).find((c) => typeIds.has(String(c.id)));
  if (prim && BY_SUPPLIER_TYPE[prim.id]) {
    const sub = prim.subcategory;
    placement.set(key, { main: BY_SUPPLIER_TYPE[prim.id], sub: sub ? { id: String(sub.id), sv: decode(sub.name), en: enName.get(String(sub.id)) || decode(sub.name) } : null, best });
  } else {
    const path = (r.categories ?? []).map((c) => [c.name, c.subcategory?.name].filter(Boolean).join(' › '));
    placement.set(key, { main: BY_NAME_RULE[typeFor(path, enRowName.get(key) ?? r.baseinfo?.name).id], sub: null, best });
  }
}

const { initializeApp } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const db = getFirestore(initializeApp({ projectId: 'demo-reklamx' }, 'categorize'));
const products = (await db.collection('products').get()).docs.filter((d) => d.id.startsWith(`prod-${SUPPLIER}-`));

const assign = new Map(); // product id → category id
const members = new Map(); // category id → [{id, best}]
const subs = new Map(); // sub category id → doc
let unplaced = 0, bestCount = 0;
for (const d of products) {
  const p = placement.get(String(d.data().supplierOfferId ?? ''));
  if (!p?.main) { unplaced++; continue; }
  const main = MAIN[p.main];
  let catId = main.id;
  if (p.sub) {
    catId = `${main.id}--${slug(p.sub.en || p.sub.sv) || p.sub.id}`;
    if (!subs.has(catId)) subs.set(catId, { name: p.sub.en, nameI18n: { sv: p.sub.sv, da: null, no: null }, parentId: main.id });
  }
  assign.set(d.id, { catId, best: p.best });
  if (p.best) bestCount++;
  for (const c of new Set([catId, main.id])) (members.get(c) ?? members.set(c, []).get(c)).push({ id: d.id, best: p.best });
}

const cats = db.collection('categories');
// Main categories keep any existing order; new ones go after the shop's own.
const existing = new Map((await cats.get()).docs.map((d) => [d.id, d.data()]));
let nextSort = Math.max(0, ...[...existing.values()].filter((c) => !c.parentId).map((c) => Number(c.sortOrder) || 0)) + 10;
const orderOf = (id) => (members.get(id) ?? []).sort((a, b) => Number(b.best) - Number(a.best)).map((m) => m.id);
let batch = db.batch(); let ops = 0;
const flush = async () => { if (ops) { await batch.commit(); batch = db.batch(); ops = 0; } };
const put = async (ref, data, merge = true) => { batch.set(ref, data, { merge }); if (++ops >= 400) await flush(); };

for (const m of Object.values(MAIN)) {
  const prev = existing.get(m.id);
  await put(cats.doc(m.id), {
    name: m.en, nameI18n: { sv: m.sv, da: m.da, no: m.no }, parentId: '', isHidden: false,
    hiddenOnHome: prev?.hiddenOnHome ?? m.hiddenOnHome === true,
    // The owner's own picture wins; the placeholder does not.
    image: prev?.image && !prev.image.endsWith('/placeholder-print.svg') ? prev.image : m.image, description: prev?.description ?? '',
    sortOrder: prev?.sortOrder ?? (nextSort += 10), productOrder: orderOf(m.id),
  });
}
let s = 0;
for (const [id, c] of [...subs].sort((a, b) => a[1].name.localeCompare(b[1].name))) {
  await put(cats.doc(id), { ...c, image: '/placeholder-print.svg', description: '', isHidden: false, sortOrder: (s += 10), productOrder: orderOf(id) }, false);
}
for (const [pid, a] of assign) await put(db.collection('products').doc(pid), { categoryId: a.catId, supplierBestseller: a.best });
// The old single bucket and its type split go.
for (const [id, c] of existing) if (id === 'promotional-products' || c.parentId === 'promotional-products' || id === `promo-${SUPPLIER}`) { batch.delete(cats.doc(id)); if (++ops >= 400) await flush(); }
await flush();

console.log(`✓ ${assign.size} products filed under their own types (${bestCount} supplier best sellers first)${unplaced ? `, ${unplaced} not in the feed` : ''}`);
for (const m of Object.values(MAIN)) {
  const n = (members.get(m.id) ?? []).length; const k = [...subs.values()].filter((c) => c.parentId === m.id).length;
  console.log(`   ${String(n).padStart(4)}  ${m.sv} / ${m.en}${k ? ` — ${k} sub-categories` : ''}`);
}
process.exit(0);
