#!/usr/bin/env node
// Suggested products (src/lib/suggestions.ts) — what is shown under a product —
// and the price on their cards (src/lib/cardPrice.ts, shared with the shop grid).
//
// WHY IT EXISTS
// The owner picks the suggestions and drags them into order; the shop fills up
// from the product's category when he picked fewer. Showing a product he hid,
// the product itself, one product twice, every product of a category the same
// four, or a card advertising an offer its page then does not give, would each
// be visible to every customer on every product page.
//
// Usage:  node scripts/test-suggestions.mjs

import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'reklamx-suggestions-'));
const entry = join(dir, 'entry.ts');
writeFileSync(entry, [
  `export * from ${JSON.stringify(join(ROOT, 'src/lib/suggestions.ts'))};`,
  `export * from ${JSON.stringify(join(ROOT, 'src/lib/cardPrice.ts'))};`,
  `export { calcConfiguredItemPrice } from ${JSON.stringify(join(ROOT, 'src/lib/pricing.ts'))};`,
].join('\n'));
const out = join(dir, 's.mjs');
await build({ entryPoints: [entry], outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const s = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });

let failed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ✅ ${name}`);
  else { failed += 1; console.error(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`); }
};

const categories = [
  { id: 'c-stickers', name: 'Stickers', productOrder: ['p-s3', 'p-s1'] },
  { id: 'c-round', name: 'Round stickers', parentId: 'c-stickers' },
  { id: 'c-oval', name: 'Oval stickers', parentId: 'c-stickers' },
  { id: 'c-signs', name: 'Signs' },
];
// The visible catalogue, by name, as the server holds it. 'p-hidden' is not in
// it: hidden or deleted.
const catalogue = [
  { id: 'p-r1', name: 'A round', categoryId: 'c-round' },
  { id: 'p-r2', name: 'B round', categoryId: 'Round stickers' }, // filed by NAME, as older products are
  { id: 'p-o1', name: 'C oval', categoryId: 'c-oval' },
  { id: 'p-s1', name: 'D sticker', categoryId: 'c-stickers' },
  { id: 'p-s2', name: 'E sticker', categoryId: 'Stickers' },
  { id: 'p-s3', name: 'F sticker', categoryId: 'c-stickers' },
  { id: 'p-sign', name: 'G sign', categoryId: 'c-signs' },
  { id: 'p-none', name: 'H loose' },
  { id: 'p-leg1', name: 'I legacy', categoryId: 'Old range' }, // a category that no longer exists
  { id: 'p-leg2', name: 'J legacy', categoryId: 'Old range' },
  { id: 'p-r3', name: 'K round', categoryId: 'c-round' },
  { id: 'p-r4', name: 'L round', categoryId: 'c-round' },
];
const ids = (list) => list.map((p) => p.id);
const pick = (exclude, categoryId, { picks = [], fill = true, cats = categories, cat = catalogue } = {}) =>
  ids(s.pickSuggestions(cat, cats, { picks, categoryId, exclude, fill }));

console.log('\n== his picks ==\n');
check('in his order; a hidden or deleted pick, the product itself and a repeat are skipped',
  pick('p-r1', 'c-round', { picks: ['p-sign', 'p-hidden', 'p-r1', 'p-sign', 'p-o1'], fill: false }), ['p-sign', 'p-o1']);
check('"only my picks": nothing added', pick('p-r2', 'Round stickers', { picks: ['p-sign'], fill: false }), ['p-sign']);
check('then filled from the category', pick('p-r2', 'Round stickers', { picks: ['p-sign'] }), ['p-sign', 'p-r3', 'p-r4', 'p-r1']);

console.log('\n== filled from the category ==\n');
check('the products AFTER this one on its category\'s page, round to the start, then the parent category\'s in HIS order',
  pick('p-r2', 'Round stickers'), ['p-r3', 'p-r4', 'p-r1', 'p-o1']);
check('…so its neighbour suggests different things, not the category\'s first four for everyone', pick('p-r3', 'c-round'), ['p-r4', 'p-r1', 'p-r2', 'p-s3']);
check('a main category: his two first on its page, the products after this one, its sub-categories\' included',
  pick('p-s1', 'c-stickers'), ['p-r1', 'p-r2', 'p-o1', 'p-s2']);
check('a category that no longer exists still groups the products filed under it', pick('p-leg1', 'Old range'), ['p-leg2']);
check('no category and no picks: nothing (not "the whole shop")', pick('p-none', ''), []);
check('a product too new for the server\'s copy still gets its category, from the top', pick('p-new', 'c-signs'), ['p-sign']);
const cyclic = [{ id: 'c-a', name: 'A', parentId: 'c-b' }, { id: 'c-b', name: 'B', parentId: 'c-a' }];
check('a parent loop in the categories does not hang', pick('x1', 'c-a', { cats: cyclic, cat: [{ id: 'x1', categoryId: 'c-a' }, { id: 'x2', categoryId: 'c-b' }] }), ['x2']);

console.log('\n== his setting, and what is stored ==\n');
check('never saved → his picks then the category; "off" and "only my picks" as set; anything else → the default',
  [s.suggestionModeOf(undefined), s.suggestionModeOf('off'), s.suggestionModeOf('picks'), s.suggestionModeOf('everything')], ['fill', 'off', 'picks', 'fill']);
check('picks: strings only, each once, never itself, at most four',
  [s.cleanPickIds(['a', ' b ', '', 3, null, 'a', 'self'], 'self'), s.cleanPickIds(['a', 'b', 'c', 'd', 'e']), s.cleanPickIds('a,b')],
  [['a', 'b'], ['a', 'b', 'c', 'd'], []]);

console.log('\n== the price on the card ==\n');
check('a genuine offer: −25 %, from 300, 400 struck through', s.cardPrices({ basePrice: 400, salePrice: 300, minQuantity: 1, customUploadRules: { minPrice: 0 } }),
  { onSale: true, offPercent: 25, price: 300, listPrice: 400 });
check('an offer the 149 kr minimum price lifts straight back: NOT advertised (the page would charge 149)',
  s.cardPrices({ basePrice: 149, salePrice: 120, minQuantity: 1, customUploadRules: { minPrice: 149 } }), { onSale: false, offPercent: 0, price: 149, listPrice: null });
check('…the same offer with no floor set on the product is real', s.cardPrices({ basePrice: 149, salePrice: 120, minQuantity: 1, customUploadRules: { minPrice: 0 } }).onSale, true);
check('no offer: the list price', s.cardPrices({ basePrice: 400, salePrice: null, minQuantity: 10 }), { onSale: false, offPercent: 0, price: 400, listPrice: null });
// A price stored as TEXT: "149" + 0 + 0 was "14900" inside the pricing, and the
// card and the product page disagreed about the offer.
check('a price stored as text ("149") prices as 149 — the floor still lifts the offer, as on the product page',
  s.cardPrices({ basePrice: '149', salePrice: 120, minQuantity: 1, customUploadRules: { minPrice: 149 } }), { onSale: false, offPercent: 0, price: 149, listPrice: null });
check('…and with no floor its real offer shows', s.cardPrices({ basePrice: '149', salePrice: '120', minQuantity: 1, customUploadRules: { minPrice: 0 } }), { onSale: true, offPercent: 19, price: 120, listPrice: 149 });

// ADM-14 — the card never says less than the page charges. Seven live products are
// priced 64–137 kr under the 149 kr minimum unit price: the page sold them at 149
// while the grid showed 64.
check('priced under the minimum: the card shows the minimum the page charges (149), not its own 64',
  s.cardPrices({ basePrice: 64, salePrice: null, minQuantity: 1, customUploadRules: { minPrice: 149 } }), { onSale: false, offPercent: 0, price: 149, listPrice: null });
check('…a product with no minimum stored has the shop\'s 149, on the card as on the page',
  s.cardPrices({ basePrice: 64, salePrice: null, minQuantity: 1 }).price, 149);
check('…the minimum switched off (0): its own price', s.cardPrices({ basePrice: 64, salePrice: null, minQuantity: 1, customUploadRules: { minPrice: 0 } }).price, 64);
check('…the owner\'s own minimum, as he set it', s.cardPrices({ basePrice: 64, salePrice: null, minQuantity: 1, customUploadRules: { minPrice: 99 } }).price, 99);
check('…a minimum stored as TEXT ("149") is still a number on the card', s.cardPrices({ basePrice: 64, salePrice: null, minQuantity: 1, customUploadRules: { minPrice: '149' } }).price, 149);
{
  // Area-priced: the card shows the price before the size is chosen, so the default
  // size's surcharge must not decide whether the minimum shows (20 kr said 149, 64 said 64).
  const area = (basePrice) => s.cardPrices({ basePrice, salePrice: null, minQuantity: 1, customUploadRules: { minPrice: 149, areaPriced: true, pricePerSqm: 350 } }).price;
  check('area-priced: under the minimum shows the minimum, whatever the default size adds; over it, its own price',
    [area(20), area(64), area(200)], [149, 149, 200]);
}
// The percentage is the one between the two figures the card SHOWS (code review
// 2026-10-11, REVIEW-3 #4 / N): from the product's bare prices, 400 → 100 said
// "−75 %" beside a 149 it charged — 62.75 % off 400.
check('an offer the minimum lifts but does not erase: at the 149 it charges, 400 struck through, −63 % between the two (not −75 %)',
  s.cardPrices({ basePrice: 400, salePrice: 100, minQuantity: 1, customUploadRules: { minPrice: 149 } }), { onSale: true, offPercent: 63, price: 149, listPrice: 400 });
check('200 offered at 100, minimum 149: 149 against 200 is 25.5 % — the badge says −26 %, never −50 %',
  s.cardPrices({ basePrice: 200, salePrice: 100, minQuantity: 1, customUploadRules: { minPrice: 149 } }), { onSale: true, offPercent: 26, price: 149, listPrice: 200 });
check('160 offered at 100, minimum 149: 149 against 160 — −7 %, not −38 %',
  s.cardPrices({ basePrice: 160, salePrice: 100, minQuantity: 1, customUploadRules: { minPrice: 149 } }), { onSale: true, offPercent: 7, price: 149, listPrice: 160 });
check('…the same three with no minimum: the bare prices, as before',
  [400, 200, 160].map((basePrice) => s.cardPrices({ basePrice, salePrice: 100, minQuantity: 1, customUploadRules: { minPrice: 0 } }).offPercent), [75, 50, 38]);
check('the rule itself, which the product page\'s badge reads too: 200/100 at 149 → 26; at 0 → 50; prices as text; no offer → 0',
  [s.offerPercentShown(200, 100, 149), s.offerPercentShown(200, 100, 0), s.offerPercentShown('200', '100', 149), s.offerPercentShown(160, 100, 149),
    s.offerPercentShown(149, 120, 149), s.offerPercentShown(100, 150, 0), s.offerPercentShown(100, null, 0), s.offerPercentShown(100, 0, 0), s.offerPercentShown(0, 50, 0)],
  [26, 50, 26, 7, 0, 0, 0, 0, 0]);
check('the minimum it reads: the product\'s, else the shop\'s 149; 0 is none; text is a number',
  [s.unitPriceFloor(undefined), s.unitPriceFloor({}), s.unitPriceFloor({ minPrice: null }), s.unitPriceFloor({ minPrice: 0 }), s.unitPriceFloor({ minPrice: '99' })],
  [149, 149, 149, 0, 99]);
{
  // An area-priced product under its minimum can be on offer at the page's default
  // size (the area adds to both) while the card, which shows no size, has the same
  // 149 twice: no "−0 %" badge over a struck-through price under the one shown.
  const area = s.cardPrices({ basePrice: 100, salePrice: 50, minQuantity: 1, customUploadRules: { minPrice: 149, areaPriced: true, pricePerSqm: 350 } });
  check('area-priced, both prices under the minimum: the card shows 149 and no offer', area, { onSale: false, offPercent: 0, price: 149, listPrice: null });
}
{
  // The page's unit price at the quantity it opens on, with no setup fee — the card
  // must never be under it, whatever the prices, minimum, offer and quantity tiers.
  const tiers = { baseSetupFee: 0, volumeDiscounts: [{ minQuantity: 50, discountPercentage: 10 }] };
  const under = [];
  // …and the badge is the card's own two figures: what it struck through against
  // what it charges — never a reduction the shopper cannot see on the card.
  const badgeOff = [];
  for (const basePrice of [0, 20, 64, 137, 149, 150, 400, '64'])
    for (const salePrice of [null, 50, 120, 300])
      for (const minPrice of [undefined, 0, 99, 149, 900])
        for (const minQuantity of [1, 100]) {
          const product = { basePrice, salePrice, minQuantity, customUploadRules: minPrice === undefined ? undefined : { minPrice }, pricingRules: tiers };
          const page = s.calcConfiguredItemPrice({ basePrice, salePrice, quantity: minQuantity, uploadRules: product.customUploadRules, pricingRules: tiers });
          const card = s.cardPrices(product);
          if (card.price < page.unitPrice) under.push({ basePrice, salePrice, minPrice, minQuantity, card: card.price, page: page.unitPrice });
          const shownOff = card.onSale ? Math.round(((card.listPrice - card.price) * 100) / card.listPrice) : 0;
          if (card.offPercent !== shownOff || (card.onSale && !(card.offPercent > 0)))
            badgeOff.push({ basePrice, salePrice, minPrice, minQuantity, badge: card.offPercent, shown: shownOff });
        }
  check('no card under the page\'s unit price — 320 combinations of price, offer, minimum and quantity', under.slice(0, 3), []);
  check('…and in all 320, the badge is the reduction between the two figures the card shows', badgeOff.slice(0, 3), []);
}

console.log(failed ? `\n❌ ${failed} check(s) failed\n` : '\n✅ all suggestion checks passed\n');
process.exit(failed ? 1 : 0);
