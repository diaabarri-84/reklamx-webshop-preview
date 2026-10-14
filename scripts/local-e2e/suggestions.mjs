// Round 16, item 10 — "suggested products under the product; the client controls
// them".
//
//   the owner: picks three products for Sugg A (Enter in the search picks, it
//   does not save the dialog), drags the third to the top, saves.
//   a customer: his three in his order, then the product after Sugg A in its
//   category; "only my picks" → his three; "off" → no row.
//   Sugg B, picked nothing: the products after it in the category, round to the
//   start — never itself, not the category's first four.
//   a picked product hidden: gone from the row once the shop's copy refreshes.
//   a suggestion clicked: that product, with its own category in the breadcrumb.
import { launch, loginAdmin, dragTo, BASE, SHOTS, db, check, summary } from './lib.mjs';

const src = (await db.collection('products').doc('prod-pmp-696').get()).data();
const CAT = 'cat-sugg-e2e';
const OTHER = 'cat-sugg-other-e2e';
const P = (k) => `sugg-${k}`;
const settingsRef = db.collection('settings').doc('siteConfig');
const originalMode = (await settingsRef.get()).data()?.productSuggestions;

const product = (k, name, categoryId) => ({
  ...src, id: P(k), name, nameI18n: null, slug: P(k), sku: `SUGG-${k.toUpperCase()}`, categoryId, isHidden: false,
  salePrice: null, relatedProductIds: null, pageOrder: null,
});
const cleanup = async () => {
  for (const k of ['a', 'b', 'c', 'd', 'e', 'x']) await db.collection('products').doc(P(k)).delete().catch(() => {});
  for (const c of [CAT, OTHER]) await db.collection('categories').doc(c).delete().catch(() => {});
  const { FieldValue } = await import('firebase-admin/firestore').catch(() => ({ FieldValue: null }));
  if (originalMode === undefined && FieldValue) await settingsRef.set({ productSuggestions: FieldValue.delete() }, { merge: true }).catch(() => {});
  else await settingsRef.set({ productSuggestions: originalMode ?? 'fill' }, { merge: true }).catch(() => {});
};
process.on('uncaughtException', async (err) => { console.error(err); await cleanup().catch(() => {}); process.exit(1); });
process.on('unhandledRejection', async (err) => { console.error(err); await cleanup().catch(() => {}); process.exit(1); });

await db.collection('categories').doc(CAT).set({ id: CAT, name: 'Suggestion test', isHidden: false });
await db.collection('categories').doc(OTHER).set({ id: OTHER, name: 'Sugg other', isHidden: false });
for (const k of ['a', 'b', 'c', 'd', 'e']) await db.collection('products').doc(P(k)).set(product(k, `Sugg ${k.toUpperCase()}`, CAT));
// Its address is its own name, not its id — so a link by id is redirected.
await db.collection('products').doc(P('x')).set({ ...product('x', 'Sugg X', OTHER), slug: 'sugg-x-other' });
await settingsRef.set({ productSuggestions: 'fill' }, { merge: true });

// The row is answered from the copy the shop grid keeps — it never reads the
// database itself — so the copy is refreshed the way the shop refreshes it.
const signIn = await (await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@emulator.test', password: 'emulator-admin-1', returnSecureToken: true }),
})).json();
const refreshShopCopy = async () => {
  await fetch(`${BASE}/api/admin/cache/invalidate`, { method: 'POST', headers: { Authorization: `Bearer ${signIn.idToken}` } });
  await fetch(`${BASE}/api/catalogue?limit=1`);
  await fetch(`${BASE}/api/categories`);
};
await refreshShopCopy();

const { browser, page, errors } = await launch();

// ---- the owner ----
await loginAdmin(page);
await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {});
await page.getByRole('button', { name: 'Products Admin' }).click();
await page.getByText('Sugg A', { exact: true }).first().waitFor({ timeout: 20000 });
await page.locator(`xpath=//*[normalize-space()="Sugg A"]/ancestor::div[.//button[normalize-space()='Edit']][1]//button[normalize-space()='Edit']`).first().click();
await page.getByRole('button', { name: 'Save Product' }).waitFor({ timeout: 15000 });
const search = page.locator('[data-related-search]');
await search.scrollIntoViewIfNeeded();
const rows = () => page.locator('[data-related-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-related-row')));

await search.fill('Sugg X');
await search.press('Enter');
await page.waitForTimeout(400);
check('Enter in the search picks the first match — and does NOT save and close the dialog',
  (await page.getByRole('heading', { name: 'Edit Product Specification' }).count()) === 1 && JSON.stringify(await rows()) === JSON.stringify([P('x')]), JSON.stringify(await rows()));
await search.fill('Sugg');
const offered = await page.locator('[data-related-add]').evaluateAll((els) => els.map((e) => e.getAttribute('data-related-add')));
check('the search offers neither this product nor one already picked', !offered.includes(P('a')) && !offered.includes(P('x')) && offered.includes(P('b')), JSON.stringify(offered));
await search.fill('Sugg E');
await page.locator(`[data-related-add="${P('e')}"]`).click();
await search.fill('Sugg C');
await page.locator(`[data-related-add="${P('c')}"]`).click();
check('three picked, in the order picked', JSON.stringify(await rows()) === JSON.stringify([P('x'), P('e'), P('c')]), JSON.stringify(await rows()));
await page.locator('[data-related-row]').first().evaluate((el) => el.scrollIntoView({ block: 'center' }));
await dragTo(page, page.locator('[aria-label="Drag \\"Sugg C\\""]'), page.locator('[aria-label="Drag \\"Sugg X\\""]'), { offsetY: -12 });
check('Sugg C dragged to the top', JSON.stringify(await rows()) === JSON.stringify([P('c'), P('x'), P('e')]), JSON.stringify(await rows()));
await page.screenshot({ path: `${SHOTS}/103-suggestions-editor.png` });
await page.getByRole('button', { name: 'Save Product' }).click();
await page.getByRole('heading', { name: 'Edit Product Specification' }).waitFor({ state: 'detached', timeout: 15000 });
const stored = (await db.collection('products').doc(P('a')).get()).data()?.relatedProductIds;
check('stored: his three, in his order', JSON.stringify(stored) === JSON.stringify([P('c'), P('x'), P('e')]), JSON.stringify(stored));

// ---- a customer ----
await refreshShopCopy();
const shop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const cp = await shop.newPage();
cp.on('pageerror', (e) => errors.push(String(e?.message ?? e)));
const suggestions = async (slug, { expectNone = false } = {}) => {
  await cp.goto(`${BASE}/products/${slug}`, { waitUntil: 'domcontentloaded' });
  await cp.getByRole('button', { name: 'Got it' }).click({ timeout: 3000 }).catch(() => {});
  await cp.locator('h1').first().waitFor({ timeout: 20000 });
  if (expectNone) await cp.waitForTimeout(2500);
  else await cp.locator('[data-rx-suggestions]').waitFor({ timeout: 15000 }).catch(() => {});
  return cp.locator('[data-rx-suggestion]').evaluateAll((els) => els.map((e) => e.getAttribute('data-rx-suggestion')));
};
const a = await suggestions(P('a'));
check('under Sugg A: his three in his order, then the product after Sugg A in its category',
  JSON.stringify(a) === JSON.stringify([P('c'), P('x'), P('e'), P('b')]), JSON.stringify(a));
check('…under the heading "You might also like"', (await cp.getByRole('heading', { name: 'You might also like' }).count()) === 1);
await cp.locator('[data-rx-suggestions]').scrollIntoViewIfNeeded();
await cp.screenshot({ path: `${SHOTS}/104-suggestions-shop.png` });

// "Only my picks", chosen where he would choose it.
await page.getByRole('button', { name: 'UI Customizer' }).first().click();
await page.getByRole('button', { name: 'Page Sections' }).click();
await page.locator('input[name="productSuggestions"][value="picks"]').check();
await page.getByRole('button', { name: 'Save & Apply' }).click();
let mode = null;
for (let i = 0; i < 40 && mode !== 'picks'; i++) { await page.waitForTimeout(250); mode = (await settingsRef.get()).data()?.productSuggestions; }
check('UI Customizer → Page Sections: "Only my picks" saved', mode === 'picks', String(mode));
const picksOnly = await suggestions(P('a'));
check('"only my picks": his three, nothing added', JSON.stringify(picksOnly) === JSON.stringify([P('c'), P('x'), P('e')]), JSON.stringify(picksOnly));
await settingsRef.set({ productSuggestions: 'off' }, { merge: true });
// Written here behind the dashboard's back, so signalled as its Save does — the
// shop's settings reach a visitor from the server's copy (2026-10-08).
await refreshShopCopy();
const none = await suggestions(P('a'), { expectNone: true });
check('"off": no row at all', none.length === 0 && (await cp.locator('[data-rx-suggestions]').count()) === 0, JSON.stringify(none));
await settingsRef.set({ productSuggestions: 'fill' }, { merge: true });
await refreshShopCopy();

const b = await suggestions(P('b'));
check('Sugg B, nothing picked: the products after it in the category, round to the start — never itself',
  JSON.stringify(b) === JSON.stringify([P('c'), P('d'), P('e'), P('a')]), JSON.stringify(b));

await db.collection('products').doc(P('e')).set({ isHidden: true }, { merge: true });
// What the dashboard does after a save — and NOTHING else: nobody opens the shop
// grid. (A review found the row kept suggesting a hidden product until someone
// happened to.)
await fetch(`${BASE}/api/admin/cache/invalidate`, { method: 'POST', headers: { Authorization: `Bearer ${signIn.idToken}` } });
const apiRow = async () => {
  const params = new URLSearchParams({ ids: [P('c'), P('x'), P('e')].join(','), category: CAT, exclude: P('a'), fill: '1' });
  const body = await (await fetch(`${BASE}/api/catalogue/suggestions?${params}`)).json();
  return body.products.map((p) => p.id);
};
const rightAfter = await apiRow();
check('right after the save, before any reload: Sugg E is NOT suggested — the row may be empty, never wrong',
  !rightAfter.includes(P('e')), JSON.stringify(rightAfter));
let recovered = [];
for (let i = 0; i < 60 && recovered.length === 0; i++) {
  recovered = await apiRow();
  if (recovered.length === 0) await new Promise((r) => setTimeout(r, 500));
}
check('…and seconds later, with nobody opening the shop grid, the row is back — without Sugg E',
  JSON.stringify(recovered) === JSON.stringify([P('c'), P('x'), P('b'), P('d')]), JSON.stringify(recovered));
const afterHide = await suggestions(P('a'));
check('Sugg E hidden: gone from the row, the next product in the category takes its place',
  JSON.stringify(afterHide) === JSON.stringify([P('c'), P('x'), P('b'), P('d')]), JSON.stringify(afterHide));

await cp.locator(`[data-rx-suggestion="${P('x')}"]`).click();
await cp.waitForURL((u) => u.pathname === '/products/sugg-x-other', { timeout: 15000 }).catch(() => {});
await cp.locator('h1', { hasText: 'Sugg X' }).waitFor({ timeout: 15000 }).catch(() => {});
// The category is fetched for the product on screen, after the page itself.
await cp.locator('nav[aria-label="Breadcrumb"]', { hasText: 'Sugg other' }).waitFor({ timeout: 10000 }).catch(() => {});
const crumb = await cp.locator('nav[aria-label="Breadcrumb"]').innerText().catch(() => '');
check('a suggestion clicked opens that product — with ITS category in the breadcrumb, not the one it was suggested from',
  /Sugg X/.test(await cp.locator('h1').first().innerText()) && /Sugg other/.test(crumb) && !/Suggestion test/.test(crumb), crumb.replace(/\s+/g, ' '));

// A link by id: redirected to the name — the category used to be fetched by
// the run the redirect cancelled, and never again.
await cp.goto(`${BASE}/products/${P('x')}`, { waitUntil: 'domcontentloaded' });
await cp.waitForURL((u) => u.pathname === '/products/sugg-x-other', { timeout: 15000 }).catch(() => {});
await cp.locator('nav[aria-label="Breadcrumb"]', { hasText: 'Sugg other' }).waitFor({ timeout: 10000 }).catch(() => {});
check('opened by its id (an old link): redirected to its name, and its category is in the breadcrumb',
  new URL(cp.url()).pathname === '/products/sugg-x-other' && /Sugg other/.test(await cp.locator('nav[aria-label="Breadcrumb"]').innerText().catch(() => '')),
  `${new URL(cp.url()).pathname}`);

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
await cleanup();
process.exit(summary() ? 1 : 0);
