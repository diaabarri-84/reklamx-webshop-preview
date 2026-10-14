// Phase 3, the shop's own order: categories, and one category page's products.
// Plus a FINGER drag on a phone-sized screen.
import { launch, loginAdmin, BASE, SHOTS, db, check, summary, dragTo } from './lib.mjs';

const { browser, page, errors } = await launch();
await loginAdmin(page);
await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {});

// ---- categories ---------------------------------------------------------
await page.getByRole('button', { name: 'Categories' }).first().click();
await page.getByRole('button', { name: 'Arrange order' }).click();
const modal = page.locator('xpath=//h3[normalize-space()="Arrange the categories"]/ancestor::div[contains(@class,"rounded-3xl")][1]');
await modal.waitFor({ timeout: 10000 });
const catNames = async () => modal.locator('[aria-label^="Drag \\""]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label').slice(6, -1)));
const catsBefore = await catNames();
const catHandles = modal.locator('[aria-label^="Drag \\""]');
await dragTo(page, catHandles.nth(3), catHandles.nth(0), { offsetY: -12 });
const catsAfter = await catNames();
check('a category dragged to the top', catsAfter[0] === catsBefore[3], `${catsBefore} → ${catsAfter}`);
await page.waitForTimeout(400);
await page.screenshot({ path: `${SHOTS}/50-arrange-categories.png` });
await modal.getByRole('button', { name: 'Save the order' }).click();
await page.waitForTimeout(2500);

const cats = (await db.collection('categories').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
const storedOrder = [...cats].sort((a, b) => (a.sortOrder ?? 1e9) - (b.sortOrder ?? 1e9)).map((c) => c.name);
check('stored: sortOrder in the dragged order', JSON.stringify(storedOrder) === JSON.stringify(catsAfter), storedOrder.join(', '));
const api = await (await fetch(`${BASE}/api/categories`)).json();
check('/api/categories serves his order straight away', JSON.stringify(api.categories.map((c) => c.name)) === JSON.stringify(catsAfter), api.categories.map((c) => c.name).join(', '));
check('/api/categories does not leak productOrder', !JSON.stringify(api).includes('productOrder'));

// ---- one category page's products ----------------------------------------
const CAT = 'door-signs';
await page.getByRole('button', { name: 'Products Admin' }).click();
// The products screen's own category filter ("Categories · All"), not the
// sidebar's Categories tab.
await page.getByRole('button', { name: /^Categories\s*All/ }).first().click();
await page.getByRole('button', { name: /DOOR SIGNS/ }).first().click();
await page.keyboard.press('Escape').catch(() => {});
await page.getByRole('button', { name: 'Arrange this category' }).click();
const pmodal = page.locator('xpath=//h3[starts-with(normalize-space(),"Arrange “")]/ancestor::div[contains(@class,"rounded-3xl")][1]');
await pmodal.waitFor({ timeout: 10000 });
const prodNames = async () => pmodal.locator('[aria-label^="Drag \\""]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label').slice(6, -1)));
const prodsBefore = await prodNames();
const ph = pmodal.locator('[aria-label^="Drag \\""]');
await dragTo(page, ph.nth(4), ph.nth(0), { offsetY: -12 });
const prodsAfter = await prodNames();
check('a product dragged to the top of DOOR SIGNS', prodsAfter[0] === prodsBefore[4] && prodsAfter.length === prodsBefore.length, `${prodsBefore.slice(0, 5).join(' | ')}`);
await page.waitForTimeout(400);
await page.screenshot({ path: `${SHOTS}/51-arrange-products.png` });
await pmodal.getByRole('button', { name: 'Save the order' }).click();
await page.waitForTimeout(2500);

const catDoc = (await db.collection('categories').doc(CAT).get()).data();
check('stored: ONE write, the productOrder on the category', Array.isArray(catDoc.productOrder) && catDoc.productOrder.length === prodsAfter.length);
const products = (await db.collection('products').where('categoryId', '==', CAT).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
const nameById = new Map(products.map((p) => [p.id, p.name]));
check('stored: in the dragged order', JSON.stringify(catDoc.productOrder.map((id) => nameById.get(id))) === JSON.stringify(prodsAfter));

// The shop: first page and "Show more" in his order, nothing repeated or lost.
const visibleIds = catDoc.productOrder.filter((id) => products.find((p) => p.id === id)?.isHidden !== true);
const q = `category=${encodeURIComponent('door-signs,DOOR SIGNS')}&order=${CAT}&limit=5`;
const p1 = await (await fetch(`${BASE}/api/catalogue?${q}`)).json();
const p2 = await (await fetch(`${BASE}/api/catalogue?${q}&cursor=${encodeURIComponent(p1.nextCursor)}`)).json();
const served = [...p1.products, ...p2.products].map((p) => p.id);
check('/api/catalogue: page 1 + page 2 follow his order', JSON.stringify(served) === JSON.stringify(visibleIds.slice(0, served.length)), served.join(','));
check('/api/catalogue: no product twice across pages', new Set(served).size === served.length);
const plain = await (await fetch(`${BASE}/api/catalogue?category=${encodeURIComponent('door-signs,DOOR SIGNS')}&limit=200`)).json();
check('without order= the old A–Ö order is unchanged', JSON.stringify(plain.products.map((p) => p.name)) === JSON.stringify([...plain.products.map((p) => p.name)].sort((a, b) => a.localeCompare(b))));

const shop = await page.context().newPage();
await shop.goto(`${BASE}/products?category=${CAT}`, { waitUntil: 'domcontentloaded' });
await shop.waitForTimeout(3000);
const firstCard = await shop.locator('main').innerText();
const firstName = nameById.get(visibleIds[0]);
check('the shop\'s DOOR SIGNS page starts with his first product', firstCard.indexOf(firstName) >= 0 && firstCard.indexOf(firstName) < firstCard.indexOf(nameById.get(visibleIds[1])), firstName);
await shop.screenshot({ path: `${SHOTS}/52-shop-category.png` });
await shop.close();

// ---- a FINGER on a phone ------------------------------------------------
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const mp = await phone.newPage();
await loginAdmin(mp);
await mp.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
await mp.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {});
// The admin sidebar may be collapsed on a phone; open Categories however it is reachable.
await mp.getByRole('button', { name: 'Categories' }).first().click().catch(async () => {
  await mp.locator('button[aria-label*="menu" i], button[title*="menu" i]').first().click();
  await mp.getByRole('button', { name: 'Categories' }).first().click();
});
await mp.getByRole('button', { name: 'Arrange order' }).click();
const mm = mp.locator('xpath=//h3[normalize-space()="Arrange the categories"]/ancestor::div[contains(@class,"rounded-3xl")][1]');
await mm.waitFor({ timeout: 10000 });
const mNames = async () => mm.locator('[aria-label^="Drag \\""]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label').slice(6, -1)));
const mBefore = await mNames();
const g = mm.locator('[aria-label^="Drag \\""]');
await g.nth(2).scrollIntoViewIfNeeded();
const a = await g.nth(2).boundingBox();
const b = await g.nth(0).boundingBox();
const cdp = await phone.newCDPSession(mp);
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
await touch('touchStart', a.x + a.width / 2, a.y + a.height / 2);
for (let i = 1; i <= 16; i++) {
  await touch('touchMove', a.x + a.width / 2, a.y + a.height / 2 + ((b.y - a.y - 10) * i) / 16);
  await mp.waitForTimeout(16);
}
await touch('touchEnd');
await mp.waitForTimeout(400);
const mAfter = await mNames();
check('a FINGER drag reorders on a 390 px phone', mAfter[0] === mBefore[2], `${mBefore} → ${mAfter}`);
await mp.screenshot({ path: `${SHOTS}/53-phone-drag.png` });
await phone.close();

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
process.exit(summary() ? 1 : 0);
