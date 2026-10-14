// Round 16, item 9 — "Browse a supplier": "ترتيب عرض المنتجات — البحث لايعمل"
// (the order products are shown in; the search does not work).
//
//   the order: by category by default, then his choice — name in Swedish order
//   (å, ä, ö after z), price either way, stock — remembered on his browser.
//   the search: every word in any order; without å/ä/ö; a plural as its
//   singular; a product number without its hyphen; a category word; "&amp;"
//   shown as "&". What narrows the list is said and can be removed; products the
//   supplier sends without a price are counted, can be shown, and cannot be
//   ticked; an empty result says why.
//
// Synthetic rows for the supplier "easygifts", written into the EMULATOR only.
import { launch, loginAdmin, BASE, SHOTS, db, check, summary } from './lib.mjs';

const SUPPLIER = 'easygifts';
const row = (productKey, name, nameSv, categoryPath, sourcePrice = 12.5, stock = 100) => ({
  supplier: SUPPLIER, productKey, name, nameSv, categoryPath, sourcePrice, sourceCurrency: 'EUR',
  image: null, variantCount: 1, stock, gone: false, indexedAt: '2026-10-06T10:00:00.000Z',
});
const ROWS = [
  row('A5-1', 'Notebook A5 with pen', 'Anteckningsbok A5 med penna', ['Office &amp; writing', 'Notebooks'], 3.2, 400),
  row('A5-2', 'Notebook A5 kraft', 'Anteckningsbok A5 kraft', ['Office &amp; writing', 'Notebooks'], 2.1, 50),
  row('BAG-9', 'Recycled cotton bag', 'Återvunnen bomullspåse', ['Bags'], 1.9, 900),
  row('LH-ZM04', 'Thermo mug 500 ml', 'Termosmugg 500 ml', ['Eating &amp; drinking'], 6.4, 20),
  row('PEN-2', 'Ballpoint pen', 'Kulspetspenna', ['Writing instruments &amp; sets'], 0.4, 5000),
  row('ZEB-1', 'Zebra lanyard', 'Zebra nyckelband', ['Textiles'], 0.9, 10),
  row('ORN-1', 'Eagle keyring', 'Örn nyckelring', ['Keyrings'], 1.1, 60),
  row('AGG-1', 'Egg cup', 'Äggkopp', ['Eating &amp; drinking'], 2.2, 70),
  row('COS-1', 'Cosmetic bag', 'Kosmetikväska', ['Bags'], null, 0),
  row('COS-2', 'Cosmetic mirror', 'Kosmetikspegel', ['Bags'], null, 0),
  row('NOCAT', 'Mystery item', 'Mysteriesak', [], 5, 1),
];
const docId = (r) => `${SUPPLIER}__${r.productKey}`;
const cleanup = async () => {
  for (const r of ROWS) await db.collection('supplierIndex').doc(docId(r)).delete().catch(() => {});
};
process.on('uncaughtException', async (err) => { console.error(err); await cleanup().catch(() => {}); process.exit(1); });
// Whatever this supplier had in the emulator is put aside for the run.
const existing = (await db.collection('supplierIndex').where('supplier', '==', SUPPLIER).get()).docs;
const putAside = existing.map((d) => ({ id: d.id, data: d.data() }));
for (const d of existing) await d.ref.delete();
for (const r of ROWS) await db.collection('supplierIndex').doc(docId(r)).set(r);

const signIn = await (await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@emulator.test', password: 'emulator-admin-1', returnSecureToken: true }),
})).json();
// The shop's copy of this supplier is dropped, as a rebuild does — asked for
// explicitly: a dashboard save no longer drops it (2026-10-09).
await fetch(`${BASE}/api/admin/cache/invalidate?suppliers=1`, { method: 'POST', headers: { Authorization: `Bearer ${signIn.idToken}` } });

const { browser, page, errors } = await launch();
await loginAdmin(page);
await page.evaluate(() => { try { localStorage.removeItem('rx.supplierPicker.sort'); } catch { /* nothing */ } });
const openPicker = async () => {
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {});
  await page.getByRole('button', { name: 'Browse a supplier', exact: true }).first().click();
  await page.locator('[data-rx-supplier-search]').waitFor({ timeout: 20000 });
  await page.locator('[data-rx-supplier-row]').first().waitFor({ timeout: 20000 }).catch(() => {});
};
const shown = () => page.locator('[data-rx-supplier-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-rx-supplier-row')));
const settle = async () => {
  await page.waitForTimeout(700);
  await page.locator('[data-rx-supplier-results], [data-rx-supplier-empty]').first().waitFor({ timeout: 15000 }).catch(() => {});
};
const search = async (q) => {
  await page.locator('[data-rx-supplier-search]').fill(q);
  await settle();
};

await openPicker();
check('by CATEGORY by default — the products of one category together, the uncategorised last',
  // Bags · Eating & drinking (Termosmugg before Äggkopp) · Keyrings · Office & writing ("…kraft" before "…med penna") · Textiles · Writing… · none.
  await shown(), ['BAG-9', 'LH-ZM04', 'AGG-1', 'ORN-1', 'A5-2', 'A5-1', 'ZEB-1', 'PEN-2', 'NOCAT']);
const chipTexts = await page.locator('[data-rx-supplier-chip]').evaluateAll((els) => els.map((e) => e.textContent));
check('the chips show "&" — never "&amp;"', chipTexts.some((t) => /&amp;/.test(t)) === false && chipTexts.some((t) => /Office & writing/.test(t)), JSON.stringify(chipTexts));
await page.locator('[data-rx-supplier-sort]').selectOption('name');
await settle();
check('his choice — name A–Ö: the Swedish order, å, ä, ö after z', await shown(), ['A5-2', 'A5-1', 'PEN-2', 'NOCAT', 'LH-ZM04', 'ZEB-1', 'BAG-9', 'AGG-1', 'ORN-1']);
await page.locator('[data-rx-supplier-sort]').selectOption('price-desc');
await settle();
check('price, high first', (await shown()).slice(0, 2), ['LH-ZM04', 'NOCAT']);
await page.screenshot({ path: `${SHOTS}/140-supplier-order.png` });

await search('a5 anteckningsbok');
check('two words in any order (found 1 of 24 before)', (await shown()).sort(), ['A5-1', 'A5-2']);
await search('atervunnen');
check('no å needed: "atervunnen" finds Återvunnen bomullspåse', await shown(), ['BAG-9']);
await search('lhzm04');
check('a product number without its hyphen: "lhzm04" finds LH-ZM04', await shown(), ['LH-ZM04']);
await search('notebooks');
check('a plural finds the singular: "notebooks"', (await shown()).sort(), ['A5-1', 'A5-2']);
await search('office');
check('a category word: "office" finds what is filed under "Office & writing"', (await shown()).sort(), ['A5-1', 'A5-2']);

// What narrows the list is said — and removable.
await search('');
await page.locator(`[data-rx-supplier-chip="Bags"]`).click();
await settle();
await search('mug');
check('a chip still on and a search typed: nothing — and the empty screen says what narrows it, with both removable',
  (await shown()).length === 0 && /Nothing matches here/.test(await page.locator('[data-rx-supplier-empty]').innerText().catch(() => '')) &&
  (await page.getByRole('button', { name: /in “Bags” ✕/ }).count()) === 1);
await page.getByRole('button', { name: /in “Bags” ✕/ }).click();
await settle();
check('…the category removed, the same search finds the mug', await shown(), ['LH-ZM04']);

// Products the supplier sends without a price.
await search('cosmetic');
const emptyNote = await page.locator('[data-rx-supplier-empty]').innerText().catch(() => '');
check('a search that found only products WITHOUT a price says so (it looked like a search that found nothing)',
  (await shown()).length === 0 && (await page.getByRole('button', { name: /2 without a price from the supplier are hidden — show them/ }).count()) === 1, emptyNote);
await page.getByRole('button', { name: /2 without a price from the supplier are hidden — show them/ }).click();
await settle();
check('…shown when asked, marked, and they cannot be ticked',
  (await shown()).sort().join() === 'COS-1,COS-2' && (await page.locator('[data-rx-supplier-row="COS-1"]').isDisabled()) &&
  /No price from the supplier/.test(await page.locator('[data-rx-supplier-row="COS-1"]').innerText()));
await page.screenshot({ path: `${SHOTS}/141-supplier-search.png` });

// The order is his, on this browser.
await openPicker();
check('the order he chose is remembered after a reload', await page.locator('[data-rx-supplier-sort]').inputValue(), 'price-desc');

await cleanup();
for (const d of putAside) await db.collection('supplierIndex').doc(d.id).set(d.data);
await fetch(`${BASE}/api/admin/cache/invalidate?suppliers=1`, { method: 'POST', headers: { Authorization: `Bearer ${signIn.idToken}` } });
const real = errors.filter((e) => !/status of 404/.test(e));
check('no page errors', real.length === 0, real.slice(0, 4).join(' | '));
await browser.close();
process.exit(summary() ? 1 : 0);
