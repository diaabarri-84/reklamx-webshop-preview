// Round 16, item 3, after the client's screenshot of his mesh banner — "the
// order of the properties: I can't control all of them".
//
// He could drag the properties and the quantity table; the size calculator, the
// artwork box and the delivery time stayed nailed below them, so width × height
// could never come before the material. Every row of the page drags now.
//
//   the owner: the three blocks are rows in "Order on the product page"; the
//   size calculator dragged to the top, the delivery time above the quantity
//   table, the artwork box moved up with its arrow; saved.
//   a customer: the page in exactly that order.
//   the artwork box switched off, the properties rearranged, switched back on:
//   it returns where he left it.
//   a product he never arranged: the layout every product always had.
import { launch, loginAdmin, BASE, SHOTS, db, check, summary } from './lib.mjs';

const ID = 'prod-pageorder-e2e';
const PLAIN = 'prod-pageorder-plain';
const HIDDEN = 'prod-pageorder-hidden';
const NAME = 'Page order banner';
const src = (await db.collection('products').doc('prod-pmp-696').get()).data();
const catalogue = await (async () => {
  const { build } = await import('esbuild');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { fileURLToPath, pathToFileURL } = await import('node:url');
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const tmp = mkdtempSync(join(tmpdir(), 'reklamx-pageorder-'));
  await build({ entryPoints: [join(root, 'src/components/Admin/optionCatalogue.ts')], outfile: join(tmp, 'c.mjs'), bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
  const mod = await import(pathToFileURL(join(tmp, 'c.mjs')).href);
  rmSync(tmp, { recursive: true, force: true });
  return mod.OPTION_CATALOGUE;
})();
const fromCatalogue = (id) => ({ ...catalogue.find((f) => f.id === id), enabled: true });
const fields = [
  { id: 'po_material', name: 'Material', group: 'default', enabled: true, options: [
    { id: 'po-m1', label: 'Mesh 270 g', value: 'mesh270', priceModifier: 0, isDefault: true },
    { id: 'po-m2', label: 'PVC 510 g', value: 'pvc510', priceModifier: 0.5 },
  ] },
  { id: 'po_finish', name: 'Finish', group: 'default', enabled: true, options: [
    { id: 'po-f1', label: 'Hemmed', value: 'hemmed', priceModifier: 0, isDefault: true },
    { id: 'po-f2', label: 'Eyelets', value: 'eyelets', priceModifier: 0.3 },
  ] },
  fromCatalogue('production_delivery_speed'),
  fromCatalogue('artwork_supply_method'),
];
const seed = (id, name, slug, printingFields = fields) => db.collection('products').doc(id).set({
  ...src, id, name, slug, sku: null, isHidden: false, artworkEnabled: true, artworkRequired: false,
  customUploadRules: { ...(src.customUploadRules ?? {}), areaPriced: true, pricePerSqm: 350 },
  printingFields, quantityAfterFieldId: null, pageOrder: null,
});
const hideAll = (field) => ({ ...field, options: field.options.map((o) => ({ ...o, hidden: true })) });
const cleanup = async () => {
  for (const id of [ID, PLAIN, HIDDEN]) await db.collection('products').doc(id).delete().catch(() => {});
};
process.on('uncaughtException', async (err) => { console.error(err); await cleanup().catch(() => {}); process.exit(1); });
process.on('unhandledRejection', async (err) => { console.error(err); await cleanup().catch(() => {}); process.exit(1); });
await seed(ID, NAME, 'page-order-banner');
await seed(PLAIN, 'Page order plain', 'page-order-plain');
// Finish with every option hidden, and every delivery speed hidden: the page
// draws neither, so the list he drags must not offer them either.
await seed(HIDDEN, 'Page order hidden', 'page-order-hidden', [fields[0], hideAll(fields[1]), hideAll(fields[2]), fields[3]]);

const { browser, page, errors } = await launch();
await loginAdmin(page);
await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {});
await page.getByRole('button', { name: 'Products Admin' }).click();
await page.getByText(NAME, { exact: true }).first().waitFor({ timeout: 20000 });
const openEditor = async (name = NAME) => {
  await page.locator(`xpath=//*[normalize-space()=${JSON.stringify(name)}]/ancestor::div[.//button[normalize-space()='Edit']][1]//button[normalize-space()='Edit']`).first().click();
  await page.getByRole('button', { name: 'Save Product' }).waitFor({ timeout: 15000 });
};
const rows = () => page.locator('[data-page-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-page-row')));
// The dialog closes with its ✕ (Escape does nothing there).
const closeEditor = async () => {
  await page.locator('xpath=//h3[normalize-space()="Edit Product Specification"]/ancestor::div[contains(@class,"justify-between")][1]//button').first().click();
  await page.getByRole('heading', { name: 'Edit Product Specification' }).waitFor({ state: 'detached', timeout: 10000 });
};
const grip = (label) => page.locator(`[aria-label=${JSON.stringify(label)}]`);
// The button reads "Saving…" the moment it is pressed, so its going away says
// nothing; the dialog closes only after the write has landed.
const save = async () => {
  await page.getByRole('button', { name: 'Save Product' }).click();
  await page.getByRole('heading', { name: 'Edit Product Specification' }).waitFor({ state: 'detached', timeout: 15000 });
};
// A row dragged while it sits at the edge of the dialog's scrolling body makes
// the body scroll under the pointer mid-drag; drag with the list in the middle.
const centreList = () => page.locator('[data-page-row]').first().evaluate((el) => el.parentElement?.closest('div')?.scrollIntoView({ block: 'center' }));
const drag = async (from, to) => {
  await centreList();
  await page.waitForTimeout(150);
  const a = await grip(from).boundingBox();
  const b = await grip(to).boundingBox();
  if (!a || !b) throw new Error('drag: grip not visible');
  const sx = a.x + a.width / 2, sy = a.y + a.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx, sy - 6, { steps: 3 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - 12, { steps: 18 });
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(250);
};
const stored = async () => (await db.collection('products').doc(ID).get()).data();

// ---- the owner ----
await openEditor();
await page.locator('[data-page-row]').first().scrollIntoViewIfNeeded();
const initial = await rows();
check('the size calculator, the artwork box and the delivery time are rows of the list, where the page has always put them',
  JSON.stringify(initial) === JSON.stringify(['po_material', 'po_finish', '__size__', '__artwork__', '__quantity__', '__delivery__']), JSON.stringify(initial));

await drag('Drag the size calculator', 'Drag "Material"');
const afterSize = await rows();
check('the size calculator dragged to the top', afterSize[0] === '__size__', JSON.stringify(afterSize));
await drag('Drag the delivery time', 'Drag the quantity table');
const afterDelivery = await rows();
check('the delivery time dragged above the quantity table', afterDelivery.indexOf('__delivery__') === afterDelivery.indexOf('__quantity__') - 1, JSON.stringify(afterDelivery));
await page.getByRole('button', { name: 'Move Artwork upload box up' }).click();
const arranged = await rows();
check('the artwork box moved up one place with its arrow',
  JSON.stringify(arranged) === JSON.stringify(['__size__', 'po_material', '__artwork__', 'po_finish', '__delivery__', '__quantity__']), JSON.stringify(arranged));
// The quantity table under the size calculator and above every property: for
// what read quantityAfterFieldId before pageOrder, that is "at the top" — a
// block above it must not be taken for the property it follows.
await drag('Drag the quantity table', 'Drag "Material"');
const WANT = ['__size__', '__quantity__', 'po_material', '__artwork__', 'po_finish', '__delivery__'];
check('the quantity table dragged up under the size calculator', JSON.stringify(await rows()) === JSON.stringify(WANT), JSON.stringify(await rows()));
await page.screenshot({ path: `${SHOTS}/101-page-order-dialog.png` });
await save();
let saved = await stored();
check('stored: every row in his order', JSON.stringify(saved.pageOrder) === JSON.stringify(WANT), JSON.stringify(saved.pageOrder));
check('stored: the quantity setting says "at the top" — the size calculator above it is a block, not a property',
  saved.quantityAfterFieldId === '__quantity_first__', String(saved.quantityAfterFieldId));

// ---- a customer ----
const shop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const cp = await shop.newPage();
cp.on('pageerror', (e) => errors.push(String(e?.message ?? e)));
const shopOrder = async (slug) => {
  await cp.goto(`${BASE}/products/${slug}`, { waitUntil: 'domcontentloaded' });
  await cp.getByRole('button', { name: 'Got it' }).click({ timeout: 3000 }).catch(() => {});
  await cp.locator('[data-rx-block="quantity"]').waitFor({ timeout: 20000 });
  return cp.locator('[data-rx-field], [data-rx-block]').evaluateAll((els) => els.map((e) => e.getAttribute('data-rx-field') ?? `#${e.getAttribute('data-rx-block')}`));
};
const onPage = await shopOrder('page-order-banner');
check('the shop follows: width × height first, then the quantity table, the artwork box between the properties, the delivery time last',
  JSON.stringify(onPage) === JSON.stringify(['#size', '#quantity', 'po_material', '#artwork', 'po_finish', '#delivery']), JSON.stringify(onPage));
await cp.screenshot({ path: `${SHOTS}/102-page-order-shop.png` });

// ---- the artwork box off, the properties rearranged, the box back on ----
await openEditor();
await page.getByText('Show the artwork upload block on this product').click();
const withoutArtwork = await rows();
check('artwork box off: its row leaves the list', !withoutArtwork.includes('__artwork__'), JSON.stringify(withoutArtwork));
await drag('Drag "Finish"', 'Drag "Material"');
await save();
saved = await stored();
const LATER = ['__size__', '__quantity__', 'po_finish', 'po_material', '__artwork__', '__delivery__'];
check('…and while it is off, its place is remembered (after Material)', JSON.stringify(saved.pageOrder) === JSON.stringify(LATER), JSON.stringify(saved.pageOrder));
check('…and the drag reordered the properties themselves too: Finish before Material in printingFields',
  saved.printingFields.map((f) => f.id).filter((id) => id.startsWith('po_')).join(',') === 'po_finish,po_material', saved.printingFields.map((f) => f.id).join(','));
const noArtwork = await shopOrder('page-order-banner');
check('the shop without the artwork box', JSON.stringify(noArtwork) === JSON.stringify(['#size', '#quantity', 'po_finish', 'po_material', '#delivery']), JSON.stringify(noArtwork));
await openEditor();
await page.getByText('Show the artwork upload block on this product').click();
check('switched back on: the artwork box returns under Material, where he left it', JSON.stringify(await rows()) === JSON.stringify(LATER), JSON.stringify(await rows()));
await save();
const back = await shopOrder('page-order-banner');
check('…on the shop too', JSON.stringify(back) === JSON.stringify(['#size', '#quantity', 'po_finish', 'po_material', '#artwork', '#delivery']), JSON.stringify(back));

// ---- reopened, and a product nobody arranged ----
await openEditor();
check('reopened: the dialog shows the stored order', JSON.stringify(await rows()) === JSON.stringify(LATER), JSON.stringify(await rows()));
await closeEditor();

// ---- the list IS the page: hidden options ----
await openEditor('Page order hidden');
const hiddenRows = await rows();
await closeEditor();
const hiddenPage = await shopOrder('page-order-hidden');
check('a property with every option hidden, and every delivery speed hidden: neither is a row of the list, nor of the page',
  JSON.stringify(hiddenRows) === JSON.stringify(['po_material', '__size__', '__artwork__', '__quantity__']) &&
  JSON.stringify(hiddenPage) === JSON.stringify(['po_material', '#size', '#artwork', '#quantity']),
  `${JSON.stringify(hiddenRows)} / ${JSON.stringify(hiddenPage)}`);
// ---- "replace everything with the library" on the page he arranged ----
// Through the server, as the library screen sends it: the properties take the
// library's order (Material before Finish), every block keeps its row.
const signIn = await (await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@emulator.test', password: 'emulator-admin-1', returnSecureToken: true }),
})).json();
const replaced = await fetch(`${BASE}/api/admin/products/bulk`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signIn.idToken}` },
  body: JSON.stringify({ ids: [ID], op: 'printingFields', fields, mode: 'replace-all' }),
});
saved = await stored();
check('replace-all: the properties in the library\'s order, the size calculator, quantity table, artwork box and delivery time where he put them',
  replaced.ok && JSON.stringify(saved.pageOrder) === JSON.stringify(['__size__', '__quantity__', 'po_material', 'po_finish', '__artwork__', '__delivery__']),
  `${replaced.status} ${JSON.stringify(saved.pageOrder)}`);
const afterReplace = await shopOrder('page-order-banner');
check('…and that is what the shop shows', JSON.stringify(afterReplace) === JSON.stringify(['#size', '#quantity', 'po_material', 'po_finish', '#artwork', '#delivery']), JSON.stringify(afterReplace));

const plain = await shopOrder('page-order-plain');
check('a product he never arranged: the layout it always had', JSON.stringify(plain) === JSON.stringify(['po_material', 'po_finish', '#size', '#artwork', '#quantity', '#delivery']), JSON.stringify(plain));

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
await cleanup();
process.exit(summary() ? 1 : 0);
