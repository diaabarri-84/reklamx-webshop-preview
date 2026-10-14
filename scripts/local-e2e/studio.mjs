// Designer v2 — "make it exactly like Pixartprinting's Designer": the gallery and the
// studio, from the product page to the order, against the local emulator copy.
//
//   the owner: "Customers can design it online" (on by default; off is saved).
//   a customer, a round 50 mm sticker: "Open the designer" opens the GALLERY — the
//   shop's own designs built for this size, filters, colour variants, a preview —
//   then the STUDIO with the design chosen: its board is the product (round cut,
//   bleed, size in mm), words typed on the board (å ä ö), a font from the list.
//   Continue shows the print file back and holds it until ticked; attached, it is
//   uploaded WITH a picture of its page, and the basket line and the order carry
//   both. Edit reopens the design itself; a double tap attaches once; a replaced
//   file and its picture are deleted, never one a basket line uses.
//   the rules kept from round 16: chosen but not designed, the order waits; a new
//   size takes the design off; Back closes the designer; closing unsent work warns;
//   the design survives a reload (the gallery offers it back); an own-shape cut is
//   refused; sizes that are words never offer it; "send the files later" drops it.
//   new: A0 and a roll-up now open (a tiled PDF); an A3 poster becomes a 300 dpi
//   PDF with its TrimBox; a two-sided business card has Front and Back pages, and
//   its PDF, previews and pages reach the order; a phone does it all by touch.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch, loginAdmin, BASE, SHOTS, db, check, summary } from './lib.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'reklamx-studio-e2e-'));
writeFileSync(join(tmp, 'e.ts'), [
  `export { OPTION_CATALOGUE } from ${JSON.stringify(join(ROOT, 'src/components/Admin/optionCatalogue.ts'))};`,
  `export { designExportSize } from ${JSON.stringify(join(ROOT, 'src/lib/designSize.ts'))};`,
  `export { readPageBoxes, chooseArtworkBox } from ${JSON.stringify(join(ROOT, 'src/lib/pdfBoxes.ts'))};`,
].join('\n'));
await build({ entryPoints: [join(tmp, 'e.ts')], outfile: join(tmp, 'e.mjs'), bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const { OPTION_CATALOGUE, designExportSize, readPageBoxes, chooseArtworkBox } = await import(pathToFileURL(join(tmp, 'e.mjs')).href);
rmSync(tmp, { recursive: true, force: true });
const require = createRequire(join(ROOT, 'package.json'));
const pdfjs = await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);

const ID = 'prod-studio-e2e';
const CARD = 'prod-studio-card2';
const ROLL = 'prod-studio-rollup';
const OFF = 'prod-studio-off';
const WORDS = 'prod-studio-words';
// No "Artwork supply method" at all: what the owner's own products looked like when
// he ticked "Customers can design it online" and nothing happened (2026-10-07).
const TICK = 'prod-studio-tick';
// The property is there but switched OFF, every choice visible — what "Turn all off"
// leaves behind; ticking used to switch it on WITH the paid layout and studio services.
const TICK_OFF = 'prod-studio-tick-off';
// Ticked, then unticked in the same edit: nothing of the tick is left behind.
const TICK_UNDO = 'prod-studio-tick-undo';
const EMAIL = `studio-${Date.now()}@emulator.test`;
const BUCKET = 'http://127.0.0.1:9199/v0/b/demo-reklamx.appspot.com/o';
const src = (await db.collection('products').doc('prod-pmp-696').get()).data();
const catalogue = (id) => ({ ...OPTION_CATALOGUE.find((f) => f.id === id), enabled: true });
const sizes = {
  id: 'st_e2e_size', name: 'Size', group: 'default', enabled: true,
  options: [
    { id: 'ds50', label: '50 × 50 mm', value: '50x50', priceModifier: 0, isDefault: true, dimensions: '50 × 50 mm' },
    { id: 'ds85', label: '85 × 55 mm', value: '85x55', priceModifier: 0, dimensions: '85 × 55 mm' },
    { id: 'dsA3', label: 'Poster A3', value: 'a3', priceModifier: 0, dimensions: '297 × 420 mm' },
    { id: 'dsA0', label: 'Poster A0', value: 'a0', priceModifier: 0, dimensions: '841 × 1189 mm' },
  ],
};
const words = {
  id: 'st_e2e_words', name: 'Size', group: 'default', enabled: true,
  options: [
    { id: 'dw-std', label: 'Standard', value: 'std', priceModifier: 0, isDefault: true },
    { id: 'dw-big', label: 'Large', value: 'big', priceModifier: 0 },
  ],
};
const base = {
  ...src, isHidden: false, artworkEnabled: true, artworkRequired: false, relatedProductIds: [],
  customUploadRules: { ...(src.customUploadRules ?? {}), areaPriced: false },
};
for (const key of ['onlineDesign', 'pageOrder', 'quantityAfterFieldId']) delete base[key];
const cleanup = async () => {
  for (const id of [ID, CARD, ROLL, OFF, WORDS, TICK, TICK_OFF, TICK_UNDO]) await db.collection('products').doc(id).delete().catch(() => {});
  for (const d of (await db.collection('orders').where('customerEmail', '==', EMAIL.toLowerCase()).get()).docs) await d.ref.delete();
};
process.on('uncaughtException', async (err) => { console.error(err); await cleanup().catch(() => {}); process.exit(1); });
await db.collection('products').doc(ID).set({
  ...base, id: ID, name: 'Studio test stickers', nameI18n: null, slug: 'studio-test-stickers', sku: 'ST-E2E',
  // PDF only, for files a customer brings: the designer's own file must not be refused by it.
  customUploadRules: { ...base.customUploadRules, allowedFormats: ['pdf'] },
  printingFields: [sizes, { ...catalogue('product_shape'), display: 'cards' }, catalogue('artwork_supply_method'), catalogue('design_service')],
});
await db.collection('products').doc(CARD).set({
  ...base, id: CARD, name: 'Studio test business cards', nameI18n: null, slug: 'studio-test-cards', sku: null,
  printingFields: [catalogue('business_card_size'), { ...catalogue('printed_sides'), options: catalogue('printed_sides').options.map((o) => ({ ...o, isDefault: o.id === 'pc-sides-double' })) }, catalogue('artwork_supply_method')],
});
await db.collection('products').doc(ROLL).set({
  ...base, id: ROLL, name: 'Studio test roll-up', nameI18n: null, slug: 'studio-test-rollup', sku: null,
  printingFields: [catalogue('rollup_banner_size'), catalogue('artwork_supply_method')],
});
await db.collection('products').doc(OFF).set({
  ...base, id: OFF, name: 'Studio test cards (switched off)', nameI18n: null, slug: 'studio-test-cards-off', sku: null, onlineDesign: false,
  printingFields: [{ ...sizes, options: sizes.options.map((o) => ({ ...o, isDefault: o.id === 'ds85' })) }, catalogue('artwork_supply_method')],
});
await db.collection('products').doc(WORDS).set({
  ...base, id: WORDS, name: 'Studio test words', nameI18n: null, slug: 'studio-test-words', sku: null,
  printingFields: [words, catalogue('artwork_supply_method')],
});
await db.collection('products').doc(TICK).set({
  ...base, id: TICK, name: 'Studio test tick', nameI18n: null, slug: 'studio-test-tick', sku: null,
  printingFields: [{ ...sizes, options: sizes.options.map((o) => ({ ...o, isDefault: o.id === 'ds85' })) }],
});
await db.collection('products').doc(TICK_OFF).set({
  ...base, id: TICK_OFF, name: 'Studio test tick off', nameI18n: null, slug: 'studio-test-tick-off', sku: null,
  printingFields: [{ ...sizes, options: sizes.options.map((o) => ({ ...o, isDefault: o.id === 'ds85' })) }, { ...catalogue('artwork_supply_method'), enabled: false }],
});
await db.collection('products').doc(TICK_UNDO).set({
  ...base, id: TICK_UNDO, name: 'Studio test tick undo', nameI18n: null, slug: 'studio-test-tick-undo', sku: null,
  printingFields: [{ ...sizes, options: sizes.options.map((o) => ({ ...o, isDefault: o.id === 'ds85' })) }],
});

const pngSize = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });
const pngPhys = (buf) => (buf.subarray(37, 41).toString('latin1') === 'pHYs' ? { ppm: buf.readUInt32BE(41), unit: buf[49] } : null);
const storedFiles = async (re) => {
  const r = await fetch(`${BUCKET}?prefix=${encodeURIComponent('uploads/')}`, { headers: { Authorization: 'Bearer owner' } });
  return ((await r.json()).items ?? []).map((x) => x.name).filter((n) => re.test(n));
};
const designFiles = () => storedFiles(/online-design_/);
const previewFiles = () => storedFiles(/design-preview/);
const cartLines = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('reklamx_cart') || '[]'));
const picture = (p, w, h, colour) => p.evaluate(({ w, h, colour }) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, w, h);
  return c.toDataURL('image/png').split(',')[1];
}, { w, h, colour }).then((b64) => Buffer.from(b64, 'base64'));
/** Where an object of the studio's board is on the page (the engine is on window in a dev build). */
const objectBox = (p, test) => p.evaluate((src) => {
  const e = window.__rxStudio;
  const fn = new Function('o', `return (${src})(o)`);
  const o = e?.canvas?.getObjects().find((x) => fn(x));
  if (!o) return null;
  const r = e.screenRectOf(o);
  const host = document.querySelector('[data-rx-designer-board]').getBoundingClientRect();
  return { x: host.left + r.left, y: host.top + r.top, w: r.right - r.left, h: r.bottom - r.top };
}, test.toString());
const sideObjects = (p) => p.evaluate(() => JSON.parse(window.__rxStudio?.snapshotSide() ?? '{"objects":[]}').objects);

const { browser, page, errors } = await launch();

// ---- the owner ----
await loginAdmin(page);
await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {});
await page.getByRole('button', { name: 'Products Admin' }).click();
await page.getByText('Studio test words', { exact: true }).first().waitFor({ timeout: 20000 });
await page.locator(`xpath=//*[normalize-space()='Studio test words']/ancestor::div[.//button[normalize-space()='Edit']][1]//button[normalize-space()='Edit']`).first().click();
await page.getByRole('button', { name: 'Save Product' }).waitFor({ timeout: 15000 });
const setting = page.locator('[data-rx-online-design-setting]');
await setting.scrollIntoViewIfNeeded();
check('the editor: "Customers can design it online", ticked by default', await setting.locator('input[type="checkbox"]').isChecked());
await setting.locator('input[type="checkbox"]').uncheck();
await page.getByRole('button', { name: 'Save Product' }).click();
let savedOff = null;
for (let i = 0; i < 40 && savedOff !== false; i++) {
  await page.waitForTimeout(250);
  savedOff = (await db.collection('products').doc(WORDS).get()).data()?.onlineDesign;
}
check('unticked and saved: the product records it off', savedOff === false, String(savedOff));

// His own case: a product with no "Artwork supply method". The tick shows the truth
// (off), and ticking it puts "Design online" on the product — no property hunting.
await page.getByRole('button', { name: /^Close|Cancel$/ }).first().click({ timeout: 3000 }).catch(() => {});
await page.keyboard.press('Escape').catch(() => {});
await page.getByText('Studio test tick', { exact: true }).first().waitFor({ timeout: 20000 });
await page.locator(`xpath=//*[normalize-space()='Studio test tick']/ancestor::div[.//button[normalize-space()='Edit']][1]//button[normalize-space()='Edit']`).first().click();
await page.getByRole('button', { name: 'Save Product' }).waitFor({ timeout: 15000 });
const tickSetting = page.locator('[data-rx-online-design-setting]');
await tickSetting.scrollIntoViewIfNeeded();
check('a product without the property: "Customers can design it online" shows UNticked, and says what ticking does',
  !(await tickSetting.locator('input[type="checkbox"]').isChecked()) && (await tickSetting.locator('[data-rx-online-design-note="off"]').count()) === 1);
await tickSetting.locator('input[type="checkbox"]').check();
check('…ticked: it stays ticked (the property is added for him)', await tickSetting.locator('input[type="checkbox"]').isChecked());
await page.getByRole('button', { name: 'Save Product' }).click();
let ticked = null;
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(250);
  const d = (await db.collection('products').doc(TICK).get()).data();
  const f = (d?.printingFields ?? []).find((x) => x.id === 'artwork_supply_method');
  if (f) { ticked = { on: d.onlineDesign, f }; break; }
}
const shown = (id) => ticked?.f.options.some((o) => o.id === id && o.hidden !== true);
check('saved: the product has "Artwork supply method" switched on, with "Design online" and "Upload a print-ready PDF" only',
  !!ticked && ticked.on === true && ticked.f.enabled === true && shown('af-supply-template') && shown('af-supply-pdf') && !shown('af-supply-images') && !shown('af-supply-designer'),
  JSON.stringify(ticked && { on: ticked.on, enabled: ticked.f.enabled, opts: ticked.f.options.map((o) => `${o.id}${o.hidden ? '(hidden)' : ''}`) }));

/** Open a product's editor from the list. */
const editProduct = async (name) => {
  await page.getByRole('button', { name: /^Close|Cancel$/ }).first().click({ timeout: 3000 }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  await page.getByText(name, { exact: true }).first().waitFor({ timeout: 20000 });
  await page.locator(`xpath=//*[normalize-space()='${name}']/ancestor::div[.//button[normalize-space()='Edit']][1]//button[normalize-space()='Edit']`).first().click();
  await page.getByRole('button', { name: 'Save Product' }).waitFor({ timeout: 15000 });
  const box = page.locator('[data-rx-online-design-setting]');
  await box.scrollIntoViewIfNeeded();
  return box;
};
const savedMethod = async (id, wantPresent = true) => {
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(250);
    const d = (await db.collection('products').doc(id).get()).data();
    const f = (d?.printingFields ?? []).find((x) => x.id === 'artwork_supply_method');
    // Saved: the save always writes onlineDesign, which these products start without.
    if (!!f === wantPresent && d && 'onlineDesign' in d) return { on: d.onlineDesign, f, d };
  }
  return null;
};

// A product whose property is there but switched off, every choice visible (what
// "Turn all off" leaves): set up like a new one — not with the paid services on.
const offBox = await editProduct('Studio test tick off');
check('a switched-off "Artwork supply method": the tick shows UNticked, and the designer\'s print values are not offered under it',
  !(await offBox.locator('input[type="checkbox"]').isChecked()) && (await page.locator('[data-rx-print-spec-editor]').count()) === 0);
await offBox.locator('input[type="checkbox"]').check();
check('…ticked: the print values appear with it', (await page.locator('[data-rx-print-spec-editor]').count()) === 1);
await page.getByRole('button', { name: 'Save Product' }).click();
const offSaved = await savedMethod(TICK_OFF);
const offShown = (id) => offSaved?.f.options.some((o) => o.id === id && o.hidden !== true);
check('saved: switched on with "Design online" and "Upload a print-ready PDF" ONLY — the paid layout (+150 kr) and design service (+595 kr) stay off',
  !!offSaved && offSaved.f.enabled === true && offShown('af-supply-template') && offShown('af-supply-pdf') &&
    !offShown('af-supply-images') && !offShown('af-supply-designer') && offSaved.f.options.filter((o) => o.hidden !== true).length === 2,
  JSON.stringify(offSaved && offSaved.f.options.map((o) => `${o.id}${o.hidden ? '(hidden)' : ''}`)));

// Ticked and unticked again before saving: the product goes back as it was.
const undoBox = await editProduct('Studio test tick undo');
await undoBox.locator('input[type="checkbox"]').check();
await undoBox.locator('input[type="checkbox"]').uncheck();
check('ticked then unticked: unticked, the "Tick it" note back, no print values', !(await undoBox.locator('input[type="checkbox"]').isChecked()) &&
  (await undoBox.locator('[data-rx-online-design-note="off"]').count()) === 1 && (await page.locator('[data-rx-print-spec-editor]').count()) === 0);
await page.getByRole('button', { name: 'Save Product' }).click();
const undoSaved = await (async () => {
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(250);
    const d = (await db.collection('products').doc(TICK_UNDO).get()).data();
    if (d && 'onlineDesign' in d) return d;
  }
  return null;
})();
check('…saved: NO "Artwork supply method" left behind (a one-choice "Upload a print-ready PDF" question would be new on his page)',
  !!undoSaved && !(undoSaved.printingFields ?? []).some((f) => f.id === 'artwork_supply_method'),
  JSON.stringify((undoSaved?.printingFields ?? []).map((f) => `${f.id}${f.enabled ? '' : '(off)'}`)));

// ---- a customer ----
const shop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
// The order below is placed BY THE TEST, signed in as the admin, for a guest page:
// that page has no ticket to ask its order's status with, and is refused (403).
// That refusal is the test's own; any other is not.
const refused = [];
shop.on('response', (r) => { if (r.status() === 403) refused.push(r.url()); });
const cp = await shop.newPage();
cp.on('pageerror', (e) => errors.push(String(e?.message ?? e)));
cp.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const openProduct = async (p, slug) => {
  await p.goto(`${BASE}/products/${slug}`, { waitUntil: 'domcontentloaded' });
  await p.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {});
  await p.locator('[data-rx-block="artwork"]').waitFor({ timeout: 20000 });
};
const designCard = (p) => p.locator('[data-rx-block="artwork"] button', { hasText: 'Design online from a ready-made template' });
const addToCart = (p) => p.getByRole('button', { name: /Add to cart/i }).first();
const studioReady = (p) => p.locator('[data-rx-st-rail]:not([disabled])').first().waitFor({ timeout: 30000 });

// The product he ticked: a customer sees "Design online", and it opens the designer.
await openProduct(cp, 'studio-test-tick');
check('the ticked product offers "Design online" to a customer', (await designCard(cp).count()) === 1);
await designCard(cp).click();
await cp.locator('[data-rx-designer-open]').click();
await cp.locator('[data-rx-gallery]').waitFor({ timeout: 20000 });
check('…and it opens the design gallery', (await cp.locator('[data-rx-gal-scratch]').count()) === 1);
await cp.goBack();
await cp.locator('[data-rx-gallery]').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});

await openProduct(cp, 'studio-test-stickers');
check('offered on the product, in the artwork step', (await designCard(cp).count()) === 1);
await cp.locator('[data-option-card="cs-shape-round"]').click();
await designCard(cp).click();
check('chosen but not designed: the order waits, and says what for',
  (await addToCart(cp).isDisabled()) && /Finish your design/.test(await cp.locator('[data-rx-artwork-missing]').innerText().catch(() => '')));

await cp.locator('[data-rx-designer-open]').click();
await cp.locator('[data-rx-gallery]').waitFor({ timeout: 20000 });
check('"Open the designer" opens the GALLERY first, on a history entry of its own', await cp.evaluate(() => history.state?.rxDesigner === true));
const cards = await cp.locator('[data-rx-gal-card]').count();
check(`the gallery offers the shop's own designs for this product (${cards}), with "Create now" first`, cards >= 4 && (await cp.locator('[data-rx-gal-scratch]').count()) === 1);
// Pixart's filter card: each question folded until opened.
for (const g of ['use', 'style', 'industry']) await cp.locator(`[data-rx-gal-group="${g}"]`).click();
check('…filtered by use, style and industry (Pixart\'s folded questions, tags inside)', (await cp.locator('[data-rx-gal-filter]').count()) >= 6);
await cp.locator('[data-rx-gal-filter="style-elegant"]').click();
const elegant = await cp.locator('[data-rx-gal-card]').count();
check('a filter narrows the designs', elegant > 0 && elegant < cards, `${cards} → ${elegant}`);
await cp.locator('[data-rx-gal-clear]').click();
await cp.locator('[data-rx-gal-card="starter-minimal"] [data-rx-gal-swatch="starter-minimal:teal"]').click();
await cp.locator('[data-rx-gal-card="starter-minimal"] button').first().click();
await cp.locator('[data-rx-gal-preview="starter-minimal"]').waitFor({ timeout: 10000 });
await cp.waitForTimeout(1500);
await cp.screenshot({ path: `${SHOTS}/150-studio-gallery-preview.png` });
await cp.locator('[data-rx-gal-choose]').click();
await cp.locator('[data-rx-studio]').waitFor({ timeout: 20000 });
await studioReady(cp);
await cp.waitForTimeout(600);
const board = cp.locator('[data-rx-designer-board]');
check('the studio opens with the design chosen — its board is the product: a round cut, 56 × 56 mm with the bleed',
  (await board.getAttribute('data-rx-cut')) === 'circle' && (await board.getAttribute('data-rx-board-mm')) === '56x56');
const objects0 = await sideObjects(cp);
check('…the "Minimal" design, in its teal colours, built for 50 mm (its words inside the round cut)',
  objects0.some((o) => o.type === 'Textbox' && /opening/i.test(o.text)) && objects0.some((o) => o.stroke === '#00a19a'), JSON.stringify(objects0.map((o) => [o.type, o.text ?? '', o.stroke ?? '']).slice(0, 6)));

// His own words, typed on the board.
const headline = await objectBox(cp, (o) => o.type === 'textbox' && /opening/i.test(o.text));
await cp.mouse.dblclick(headline.x + headline.w / 2, headline.y + headline.h / 2);
await cp.waitForTimeout(250);
await cp.keyboard.press('Control+A');
await cp.keyboard.type('Hej Reklamx åäö');
await cp.mouse.click(5 + (await board.boundingBox()).x, 5 + (await board.boundingBox()).y);
await cp.waitForTimeout(500);
check('words typed straight onto the board (å ä ö)', (await sideObjects(cp)).some((o) => o.text === 'Hej Reklamx åäö'));
const typed = await objectBox(cp, (o) => o.text === 'Hej Reklamx åäö');
await cp.mouse.click(typed.x + typed.w / 2, typed.y + typed.h / 2);
await cp.locator('[data-rx-st-toolbar="text"]').waitFor({ timeout: 5000 });
await cp.locator('[data-rx-st="font"]').click();
await cp.locator('[data-rx-st-font="RX Lobster"]').click();
await cp.waitForTimeout(800);
check('a typeface from the list of 35 (each name drawn in its own face)', (await sideObjects(cp)).some((o) => o.text === 'Hej Reklamx åäö' && o.fontFamily === 'RX Lobster'));
check('a change can be undone', !(await cp.locator('[data-rx-st="undo"]').isDisabled()));
await cp.screenshot({ path: `${SHOTS}/151-studio-round.png` });

// Pixart's layout, measured on Pixart's own: the board 126 px under the header, centred
// left of its 261 px pages column — and a point on screen maps back to the same point of
// the board (a picture dropped there lands under the mouse).
const place = await cp.evaluate(() => {
  const e = window.__rxStudio;
  const b = e.boardOnScreen();
  const host = document.querySelector('[data-rx-designer-board]');
  const units = b.width / e.canvas.viewportTransform[0];
  return { b, w: host.clientWidth, units, p0: e.boardPointAt(b.left, b.top), p1: e.boardPointAt(b.left + b.width, b.top + b.height) };
});
check('the board where Pixart puts it: 126 px under the header, centred left of the pages column',
  Math.abs(place.b.top - 126) < 1.5 && Math.abs(place.b.left + place.b.width / 2 - (place.w - 261) / 2) < 1.5, JSON.stringify(place.b));
const tol = place.units * 0.002;
check('…and a point on screen is the same point of the board (drops, pinches)',
  Math.abs(place.p0.x) < tol && Math.abs(place.p0.y) < tol && Math.abs(place.p1.x - place.units) < tol, JSON.stringify(place));
// Settings, the zoom list and the preview, as Pixart's.
await cp.locator('[data-rx-st="settings"]').click();
await cp.locator('[data-rx-st="rulers"]').click();
const rulersOff = await cp.evaluate(() => window.__rxStudio.rulers === false);
await cp.locator('[data-rx-st="rulers"]').click();
const rulersOn = await cp.evaluate(() => window.__rxStudio.rulers === true);
await cp.locator('[data-rx-st="keys"]').click();
const keyRows = await cp.locator('[data-rx-st-keys] dt').count();
await cp.locator('[data-rx-st="settings-close"]').click();
check('Settings: the ruler switches off and back on, and the keyboard shortcuts are listed', rulersOff && rulersOn && keyRows >= 7, `${rulersOff} ${rulersOn} ${keyRows}`);
await cp.locator('[data-rx-st="zoom"]').click();
await cp.locator('[data-rx-st-zoom-level="200"]').click();
const z200 = await cp.locator('[data-rx-st-zoom]').innerText();
await cp.locator('[data-rx-st="zoom"]').click();
await cp.locator('[data-rx-st-zoom-list] [data-rx-st="zoom-fit"]').click();
const zFit = await cp.locator('[data-rx-st-zoom]').innerText();
check('the zoom list: 200 % from it, then "fit" back to 100 %', /200\s*%/.test(z200) && /100\s*%/.test(zFit), `${z200} → ${zFit}`);
await cp.locator('[data-rx-st="3d"]').click();
const win3d = cp.locator('[data-rx-st-3d="window"]');
await win3d.waitFor({ timeout: 5000 });
const wb = await win3d.boundingBox();
const vp = cp.viewportSize();
check('Preview: a window at the bottom right (Pixart\'s), the studio still there around it',
  wb.width < 450 && wb.x + wb.width > vp.width - 60 && wb.y + wb.height > vp.height - 30 && (await cp.locator('[data-rx-st-rail="designs"]').isVisible()), JSON.stringify(wb));
await cp.locator('[data-rx-st-3d-close]').click();
await win3d.waitFor({ state: 'detached', timeout: 5000 });

// The keyboard (code review DSN-20): the board takes the focus, Tab chooses its objects
// one by one and says which, the arrow keys move the one chosen, Escape lets it go —
// and past the last object Tab leaves the board.
// A click on an empty corner of the board: nothing chosen, and the board has the focus.
const board0 = await cp.locator('[data-rx-designer-board]').boundingBox();
const board0At = await cp.evaluate(() => window.__rxStudio.boardOnScreen());
await cp.mouse.click(board0.x + board0At.left + 3, board0.y + board0At.top + 3);
await cp.keyboard.press('Tab');
const kb1 = await cp.evaluate(() => ({
  chosen: !!window.__rxStudio.selected,
  said: document.querySelector('[data-rx-st-announce]')?.textContent ?? '',
  onBoard: !!document.activeElement?.hasAttribute('data-rx-designer-board'),
}));
check('the keyboard: Tab on the board chooses its first object and says which ("Chosen: … (1 of n)")',
  kb1.chosen && kb1.onBoard && /^Chosen: .+ \(1 of \d+\)$/.test(kb1.said), JSON.stringify(kb1));
const kbCount = Number(/of (\d+)\)/.exec(kb1.said)?.[1] ?? 0);
// The design's frame is held still (Pixart's "unlockable"); the next is its first words.
await cp.keyboard.press('Tab');
const kbBefore = await cp.evaluate(() => ({ left: window.__rxStudio.selected?.left, text: window.__rxStudio.selected?.text ?? null }));
await cp.keyboard.press('ArrowRight');
await cp.waitForTimeout(500);
const kbAfter = await cp.evaluate(() => window.__rxStudio.selected?.left);
check('…the next Tab chooses its words, and → moves them 1 mm',
  typeof kbBefore.text === 'string' && Math.abs(kbAfter - kbBefore.left - 10) < 0.01, JSON.stringify({ kbBefore, kbAfter }));
await cp.keyboard.press('Escape');
const kbLetGo = await cp.evaluate(() => !window.__rxStudio.selected && document.querySelectorAll('[data-rx-studio]').length === 1);
check('…Escape lets it go, and the studio stays open', kbLetGo);
await cp.keyboard.press('Shift+Tab');
const kbLast = await cp.locator('[data-rx-st-announce]').textContent();
check('…Shift+Tab from nothing chosen takes the topmost object', kbLast.includes(`(${kbCount} of ${kbCount})`), kbLast);
await cp.keyboard.press('Tab');
const kbOut = await cp.evaluate(() => ({ onBoard: !!document.activeElement?.hasAttribute('data-rx-designer-board'), chosen: !!window.__rxStudio.selected }));
check('…past the last object Tab leaves the board, the object still chosen', !kbOut.onBoard && kbOut.chosen, JSON.stringify(kbOut));
await cp.keyboard.press('Escape').catch(() => {});

const e50 = designExportSize({ wMm: 50, hMm: 50 });
await cp.locator('[data-rx-designer-use]').click();
await cp.locator('[data-rx-proof]').waitFor({ timeout: 30000 });
const fileLine = await cp.locator('[data-rx-proof-file]').innerText();
check(`Continue shows the print file back: ${e50.widthPx} × ${e50.heightPx} px at 300 DPI, with 3 mm bleed`,
  fileLine.includes(`${e50.widthPx} × ${e50.heightPx} px at 300 DPI`) && /3 mm bleed/.test(fileLine), fileLine);
const attachButton = cp.locator('[data-rx-proof-attach]');
check('…and holds it until he ticks that he has checked it', await attachButton.isDisabled());
await cp.screenshot({ path: `${SHOTS}/152-studio-proof.png` });
await cp.locator('[data-rx-proof-tick]').check();
await attachButton.click();
await cp.locator('[data-rx-studio]').waitFor({ state: 'detached', timeout: 10000 });
check('attached: the studio closes, and its history entry goes with it', await cp.evaluate(() => !history.state?.rxDesigner));
const NAME50 = 'online-design_50x50mm_300dpi_bleed3mm.png';
await cp.locator('[data-rx-designer-file]').waitFor({ timeout: 10000 });
check('the artwork step names the design — on a PDF-only product: the uploads rule did not refuse it', (await cp.locator('[data-rx-designer-file]').innerText()) === NAME50);
await cp.locator('[data-rx-designer-step]').getByText('Ready for print').waitFor({ timeout: 30000 });
check('uploaded, and the order can go', !(await addToCart(cp).isDisabled()));

// "Edit your design": straight back to it, no gallery; a second attach replaces the first file.
const beforeFiles = await designFiles();
const beforePreviews = await previewFiles();
await cp.locator('[data-rx-designer-step]').getByRole('button', { name: 'Edit your design' }).click();
await cp.locator('[data-rx-studio]').waitFor({ timeout: 20000 });
await studioReady(cp);
check('"Edit your design" reopens the design itself — no gallery', (await cp.locator('[data-rx-gallery]').count()) === 0 && (await sideObjects(cp)).some((o) => o.text === 'Hej Reklamx åäö'));
await cp.locator('[data-rx-designer-use]').click();
await cp.locator('[data-rx-proof-tick]').check({ timeout: 30000 });
await attachButton.dblclick();
await cp.locator('[data-rx-designer-step]').getByText('Ready for print').waitFor({ timeout: 30000 });
await cp.waitForTimeout(1000);
check('a double tap on "Attach the design" attaches once and stays on the product',
  new URL(cp.url()).pathname === '/products/studio-test-stickers' && (await cp.evaluate(() => !history.state?.rxDesigner)), cp.url());
const afterFiles = await designFiles();
const afterPreviews = await previewFiles();
check('the replaced, unused file AND its page picture are deleted: one of each, not two',
  afterFiles.length === beforeFiles.length && afterPreviews.length === beforePreviews.length && afterFiles.some((n) => !beforeFiles.includes(n)),
  `files ${beforeFiles.length} → ${afterFiles.length}, previews ${beforePreviews.length} → ${afterPreviews.length}`);

await addToCart(cp).click();
await cp.waitForTimeout(800);
const line1 = (await cartLines(cp))[0];
check('the basket line carries the design: its name, its stored file, ONE page and that page\'s picture',
  line1?.fileSpecs?.fileName === NAME50 && /^http:\/\/127\.0\.0\.1:9199\//.test(line1?.fileSpecs?.fileUrl ?? '') &&
  line1?.fileSpecs?.pages === 1 && JSON.stringify(line1?.fileSpecs?.sides) === '["front"]' &&
  line1?.fileSpecs?.previews?.length === 1 && line1.fileSpecs.previews[0].side === 'front' && /^http:\/\/127\.0\.0\.1:9199\//.test(line1.fileSpecs.previews[0].url),
  JSON.stringify(line1?.fileSpecs ?? null).slice(0, 400));
const file1 = Buffer.from(await (await fetch(line1.fileSpecs.fileUrl)).arrayBuffer());
check(`the stored file is the print file: a PNG of ${e50.widthPx} × ${e50.heightPx} px that says 300 DPI inside`,
  file1.subarray(1, 4).toString() === 'PNG' && JSON.stringify(pngSize(file1)) === JSON.stringify({ w: e50.widthPx, h: e50.heightPx }) &&
  JSON.stringify(pngPhys(file1)) === JSON.stringify({ ppm: 11811, unit: 1 }), JSON.stringify([pngSize(file1), pngPhys(file1)]));
const preview1 = Buffer.from(await (await fetch(line1.fileSpecs.previews[0].url)).arrayBuffer());
check('…and its page picture is small (the trim, about 480 px): what production and the basket show', preview1.subarray(1, 4).toString() === 'PNG' && pngSize(preview1).w <= 800, JSON.stringify(pngSize(preview1)));

// A new size after the design is in the basket.
await cp.locator('[data-option-card="ds85"]').click();
await cp.locator('[data-rx-designer-notice]').waitFor({ timeout: 5000 }).catch(() => {});
check('a new size: the design no longer fits, so it is taken off and he is told',
  /changed the size or the shape/.test(await cp.locator('[data-rx-designer-notice]').innerText().catch(() => '')) && (await addToCart(cp).isDisabled()));
check('…and the file and picture the basket line uses are NOT deleted',
  (await fetch(line1.fileSpecs.fileUrl)).status === 200 && (await fetch(line1.fileSpecs.previews[0].url)).status === 200);
await cp.locator('[data-rx-designer-open]').click();
await cp.locator('[data-rx-gallery]').waitFor({ timeout: 20000 });
check('reopened: the gallery offers his own design back, first', (await cp.locator('[data-rx-gal-continue]').count()) === 1);
await cp.locator('[data-rx-gal-continue]').click();
await studioReady(cp);
await cp.waitForTimeout(500);
check('…refitted to 91 × 61 mm', (await board.getAttribute('data-rx-board-mm')) === '91x61' && (await sideObjects(cp)).some((o) => o.text === 'Hej Reklamx åäö'));
// Pixart's "Texts": a text on the page at once.
await cp.locator('[data-rx-st-rail="text"]').click();
await cp.waitForTimeout(300);
await cp.getByRole('button', { name: 'Close the designer' }).click();
check('closing with unsent work says it is not attached yet, and stays open', (await cp.locator('[data-rx-close-warning]').count()) === 1 && (await cp.locator('[data-rx-studio]').count()) === 1);
await cp.locator('[data-rx-close-warning]').getByRole('button', { name: 'Close', exact: true }).click();
await cp.locator('[data-rx-studio]').waitFor({ state: 'detached', timeout: 10000 });
await cp.locator('[data-rx-designer-open]').click();
await cp.locator('[data-rx-gallery]').waitFor({ timeout: 20000 });
await cp.goBack();
await cp.locator('[data-rx-gallery]').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
check('the Back button closes the designer and stays on the product',
  (await cp.locator('[data-rx-gallery], [data-rx-studio]').count()) === 0 && new URL(cp.url()).pathname === '/products/studio-test-stickers', cp.url());

// The limits, said before he starts — and the ones designer v2 lifted.
await cp.locator('[data-option-card="dsA0"]').click();
check('A0: no longer "too large" — the studio makes a tiled PDF of any size up to 5 m', !(await cp.locator('[data-rx-designer-open]').isDisabled()) && (await cp.locator('[data-rx-designer-blocked]').count()) === 0);
await cp.locator('[data-option-card="ds50"]').click();
await cp.locator('[data-option-card="cs-shape-custom"]').click();
check('an own shape: its cut line has to be in his own file — said, and the designer does not open',
  /cut line drawn in your own file/.test(await cp.locator('[data-rx-designer-blocked]').innerText().catch(() => '')) && (await cp.locator('[data-rx-designer-open]').isDisabled()));

// An A3 poster from a blank page: empty refused, a picture checked, a 300 dpi PDF.
await cp.locator('[data-option-card="cs-shape-rect"]').click();
await cp.locator('[data-option-card="dsA3"]').click();
await cp.locator('[data-rx-designer-open]').click();
await cp.locator('[data-rx-gal-scratch]').click();
// His design from before is kept on the device: a blank page asks before it replaces
// it — it used to be saved over it, without a word, at the first change (DSN-05).
await cp.locator('[data-rx-gal-confirm]').waitFor({ timeout: 10000 }).catch(() => {});
check('with his own design kept, "Create now" asks first: "This replaces your design saved …"',
  /This replaces your design saved/.test(await cp.locator('[data-rx-gal-confirm]').innerText().catch(() => '')));
await cp.locator('[data-rx-gal-confirm-cancel]').click();
check('…Cancel: still the gallery, his own design still offered',
  (await cp.locator('[data-rx-gal-confirm]').count()) === 0 && (await cp.locator('[data-rx-studio]').count()) === 0 && (await cp.locator('[data-rx-gal-continue]').count()) === 1);
await cp.locator('[data-rx-gal-scratch]').click();
await cp.locator('[data-rx-gal-confirm-replace]').click();
await studioReady(cp);
await cp.locator('[data-rx-designer-use]').click();
check('an empty design is not made into a "print file": he is told to add something first',
  /Your design is empty/.test(await cp.locator('[data-rx-st-notice]').innerText().catch(() => '')) && (await cp.locator('[data-rx-proof]').count()) === 0);
await cp.locator('[data-rx-st-rail="text"]').click();
await cp.locator('[data-rx-st-rail="uploads"]').click();
await cp.locator('[data-rx-photo-input]').setInputFiles({ name: 'photo.heic', mimeType: 'image/heic', buffer: Buffer.from('not an image') });
check('a HEIC (or any other) picture: told plainly which pictures it takes', /JPG, PNG or WebP/.test(await cp.locator('[data-rx-st-notice]').innerText().catch(() => '')));
// A see-through WebP, colour-edited: its clear parts stay clear. Made a JPEG, they
// came out BLACK (code review DSN-19).
const clearWebp = Buffer.from((await cp.evaluate(() => {
  const c = document.createElement('canvas');
  c.width = 120;
  c.height = 120;
  const x = c.getContext('2d');
  x.fillStyle = '#e30613';
  x.beginPath();
  x.arc(60, 60, 40, 0, Math.PI * 2);
  x.fill();
  return c.toDataURL('image/webp');
})).split(',')[1], 'base64');
await cp.locator('[data-rx-photo-input]').setInputFiles({ name: 'logo.webp', mimeType: 'image/webp', buffer: clearWebp });
await cp.locator('[data-rx-st-toolbar="image"]').waitFor({ timeout: 10000 });
// The Uploads panel lies over the left half of the picture's tools on this screen:
// closed as a customer would (its rail button again) before Adjust and Crop.
const closeUploads = async () => {
  await cp.locator('[data-rx-st-rail="uploads"]').click();
  await cp.locator('[data-rx-designer-panel]').first().waitFor({ state: 'detached', timeout: 5000 });
};
await closeUploads();
await cp.locator('[data-rx-st="adjust"]').click();
await cp.locator('[data-rx-st-slider="hue"]').focus();
for (let i = 0; i < 30; i++) await cp.keyboard.press('ArrowRight');
await cp.locator('[data-rx-st-adjust-apply]').click();
await cp.waitForTimeout(800);
const edited = await cp.evaluate(async () => {
  const e = window.__rxStudio;
  const o = e?.selected;
  const p = o && e.images.get(o.rxImageId);
  if (!p) return null;
  const bmp = await createImageBitmap(p.blob);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const x = c.getContext('2d');
  x.drawImage(bmp, 0, 0);
  return { type: p.blob.type, cornerAlpha: x.getImageData(1, 1, 1, 1).data[3], edited: !!o.rxOrigId };
});
check('a see-through WebP, colour-edited, stays see-through: a PNG with its corner clear, not a black square',
  edited?.edited === true && edited.type === 'image/png' && edited.cornerAlpha === 0, JSON.stringify(edited));
await cp.locator('[data-rx-st="delete"]').click();
await cp.locator('[data-rx-st-rail="uploads"]').click();
await cp.locator('[data-rx-photo-input]').setInputFiles({ name: 'tiny.png', mimeType: 'image/png', buffer: await picture(cp, 160, 120, '#fde68a') });
await cp.locator('[data-rx-photo-quality]').waitFor({ timeout: 10000 });
await closeUploads();
// The crop frame moves with the arrow keys too, Shift ten times as far (code review DSN-20).
await cp.locator('[data-rx-st="crop"]').click();
await cp.locator('[data-rx-st-cropper]').waitFor({ timeout: 5000 });
await cp.locator('[data-rx-st-chip="crop-square"]').click();
const cropLeft = () => cp.locator('[data-rx-st-crop-rect]').evaluate((el) => parseFloat(el.style.left));
const crop0 = await cropLeft();
await cp.keyboard.press('ArrowRight');
const crop1 = await cropLeft();
await cp.keyboard.press('Shift+ArrowLeft');
const crop2 = await cropLeft();
check('the crop frame moves with the arrow keys, Shift ten times as far', crop1 > crop0 && crop0 - crop2 > (crop1 - crop0) * 5, JSON.stringify([crop0, crop1, crop2]));
await cp.locator('[data-rx-st-cropper]').getByRole('button', { name: 'Cancel' }).last().click();
await cp.locator('[data-rx-st-cropper]').waitFor({ state: 'detached', timeout: 5000 });
check('a 160-pixel photo across a poster: "too small for this size", with its DPI', (await cp.locator('[data-rx-photo-quality]').getAttribute('data-rx-photo-quality')) === 'poor');
// Its size typed in mm: W × H in the toolbar, the picture's proportions kept (code review DSN-20).
await cp.locator('[data-rx-st-size="w"]').fill('100');
await cp.locator('[data-rx-st-size="w"]').press('Enter');
await cp.waitForTimeout(300);
const typedSize = await cp.evaluate(() => window.__rxStudio.sizeMmOf(window.__rxStudio.selected));
check('a picture\'s size typed in mm: 100 wide makes it 75 high, its proportions kept — and the box shows it',
  Math.abs(typedSize.w - 100) < 0.05 && Math.abs(typedSize.h - 75) < 0.05 && (await cp.locator('[data-rx-st-size="h"]').inputValue()) === '75', JSON.stringify(typedSize));
// The size box, second pass #4. Escape is "never mind": it applied the number typed.
const sizeW = cp.locator('[data-rx-st-size="w"]');
const chosenSize = () => cp.evaluate(() => {
  const e = window.__rxStudio;
  return e.selected ? e.sizeMmOf(e.selected) : null;
});
await sizeW.fill('123');
await sizeW.press('Escape');
const afterEscape = { size: await chosenSize(), open: (await cp.locator('[data-rx-studio]').count()) === 1, shown: await sizeW.inputValue() };
check('the size box: Escape puts back the size it showed and changes nothing — the studio open, the picture still chosen',
  afterEscape.open && Math.abs((afterEscape.size?.w ?? 0) - 100) < 0.05 && afterEscape.shown === '100', JSON.stringify(afterEscape));
// Held at the largest size, the box shows the size the picture HAS, not the number typed.
await sizeW.fill('99999');
await sizeW.press('Enter');
const held = await chosenSize();
const heldShown = [await sizeW.inputValue(), await cp.locator('[data-rx-st-size="h"]').inputValue()];
check('…a width past the largest is held there, and both fields show the size it has, not the number typed',
  held.w < 1000 && JSON.stringify(heldShown) === JSON.stringify([String(Math.round(held.w * 10) / 10), String(Math.round(held.h * 10) / 10)]),
  JSON.stringify({ held, heldShown }));
await sizeW.fill('100');
await sizeW.press('Enter');
// The board holds only this photo from here on: the text "an empty design" put there
// above would otherwise be one more object in every count and every Tab below.
await cp.evaluate(() => {
  const e = window.__rxStudio;
  for (const o of e.canvas.getObjects()) if (o !== e.selected && o.type !== 'image') e.canvas.remove(o);
  e.canvas.requestRenderAll();
});
// A width typed for one picture, another chosen before it is applied: it lands on neither.
await cp.locator('[data-rx-st="bar-duplicate"]').click();
await cp.waitForFunction(() => window.__rxStudio.canvas.getObjects().length === 2, null, { timeout: 5000 });
await sizeW.fill('55');
await cp.evaluate(() => window.__rxStudio.chooseNext(-1));
await cp.waitForTimeout(300);
const twoWidths = await cp.evaluate(() => window.__rxStudio.canvas.getObjects().map((o) => Math.round(window.__rxStudio.sizeMmOf(o).w * 10) / 10));
check('…a width typed for a copy, the original chosen before it is applied: neither becomes 55 wide, and the box shows the one chosen',
  JSON.stringify(twoWidths) === '[100,100]' && (await sizeW.inputValue()) === '100', JSON.stringify(twoWidths));
await cp.evaluate(() => window.__rxStudio.chooseNext(1));
await cp.locator('[data-rx-st="delete"]').click();
// A line has no height of its own: only its length is offered (it could not be sized at all).
await cp.locator('[data-rx-st-rail="elements"]').click();
await cp.locator('[data-rx-st-search="elements"]').fill('line');
await cp.locator('[data-rx-st-element="shape-line"]').click();
if (await cp.locator('[data-rx-designer-panel]').count()) {
  await cp.locator('[data-rx-st-rail="elements"]').click();
  await cp.locator('[data-rx-designer-panel]').first().waitFor({ state: 'detached', timeout: 5000 });
}
await cp.locator('[data-rx-st-sizebox="length"]').waitFor({ timeout: 5000 });
const lineBox = { h: await cp.locator('[data-rx-st-size="h"]').count(), chain: await cp.locator('[data-rx-st="size-ratio"]').count() };
await sizeW.fill('30');
await sizeW.press('Enter');
const line = await chosenSize();
check('a line: its size box offers its length only, no height and no chain — typed 30, it is 30 mm long and still has no height',
  lineBox.h === 0 && lineBox.chain === 0 && Math.abs((line?.w ?? 0) - 30) < 0.05 && line?.h === 0 && (await sizeW.inputValue()) === '30', JSON.stringify({ lineBox, line }));
await cp.locator('[data-rx-st="delete"]').click();
await cp.evaluate(() => window.__rxStudio.chooseNext(1));
await cp.locator('[data-rx-st-toolbar="image"]').waitFor({ timeout: 5000 });
// A camera photo on a computer keeps 5016 × 3344 pixels, cut by its area (DSN-06). A phone
// keeps the 4096 cut it had, for its memory (second pass, a watch; checked on the phone below).
await cp.locator('[data-rx-st-rail="uploads"]').click();
await cp.locator('[data-rx-photo-input]').setInputFiles({ name: 'camera.png', mimeType: 'image/png', buffer: await picture(cp, 6000, 4000, '#9ca3af') });
await cp.waitForFunction(() => window.__rxStudio.canvas.getObjects().length === 2, null, { timeout: 30000 });
const cameraOnComputer = await cp.evaluate(() => {
  const o = window.__rxStudio.selected;
  return o ? [o.width, o.height] : null;
});
check('a 24 MP camera photo on a computer keeps 5016 × 3344 pixels, cut by its area', JSON.stringify(cameraOnComputer) === '[5016,3344]', JSON.stringify(cameraOnComputer));
await closeUploads();
await cp.locator('[data-rx-st="delete"]').click();
await cp.evaluate(() => window.__rxStudio.chooseNext(1));
await cp.locator('[data-rx-st-toolbar="image"]').waitFor({ timeout: 5000 });
// "Fit on the page" fits the photo inside the TRIM, never out into the bleed: fitted to
// the whole board, a print-ready picture was enlarged and cut (code review, second
// pass #1). It then ends at the cut line, which the check before attaching says, naming
// "Fill the page"; Fill runs it into the bleed, and the warning is gone.
await cp.locator('[data-rx-st="fit"]').click();
await cp.locator('[data-rx-st-fit="page"]').click();
await cp.waitForTimeout(300);
const fitted = await cp.evaluate(() => {
  const e = window.__rxStudio;
  const r = e.selected.getBoundingRect();
  return { x0: Math.round(r.left), x1: Math.round(r.left + r.width), trim: e.trim };
});
check('"Fit on the page": a wide photo reaches the trim\'s edges, left and right — not out into the bleed',
  Math.abs(fitted.x0 - fitted.trim.x) <= 1 && Math.abs(fitted.x1 - (fitted.trim.x + fitted.trim.w)) <= 1, JSON.stringify(fitted));
await cp.locator('[data-rx-designer-use]').click();
await cp.locator('[data-rx-proof]').waitFor({ timeout: 120000 });
const atCutWarning = cp.locator('[data-rx-proof-warning="edge-at-cut"]');
check('…so it ends at the cut line: the check before attaching says so, and to use Fit → Fill the page',
  (await atCutWarning.count()) === 1 && /Fit → Fill the page/.test(await atCutWarning.innerText()), await atCutWarning.innerText().catch(() => ''));
// Under the check the board is out of the Tab order: Tab reached a board nobody could see (second pass #6).
const boardTab = cp.locator('[data-rx-designer-board]');
const tabUnderProof = await boardTab.getAttribute('tabindex');
await cp.locator('[data-rx-proof-back]').click();
await cp.locator('[data-rx-proof]').waitFor({ state: 'detached', timeout: 10000 });
check('…and under the check the board is out of the Tab order; back at the board, in it again',
  tabUnderProof === '-1' && (await boardTab.getAttribute('tabindex')) === '0', `${tabUnderProof} → ${await boardTab.getAttribute('tabindex')}`);
// Chosen again as a customer would: a tap on the middle of the board, where the photo is.
await cp.locator('[data-rx-designer-board]').click();
await cp.locator('[data-rx-st-toolbar="image"]').waitFor({ timeout: 5000 });
await cp.locator('[data-rx-st="fit"]').click();
await cp.locator('[data-rx-st-fit="fill"]').click();
await cp.locator('[data-rx-designer-use]').click();
await cp.locator('[data-rx-proof]').waitFor({ timeout: 120000 });
check('the check before attaching says the photo will print blurred', (await cp.locator('[data-rx-proof-warning="photo-poor"]').count()) === 1);
check('…and, filled into the bleed, nothing ends at the cut line any more', (await cp.locator('[data-rx-proof-warning="edge-at-cut"]').count()) === 0);
check('…and that the A3 file is a PDF at 300 DPI (over 16 MP, more than one picture can hold on a phone)', /PDF, 1 page, 300 DPI, 3 mm bleed/.test(await cp.locator('[data-rx-proof-file]').innerText()), await cp.locator('[data-rx-proof-file]').innerText());
await cp.locator('[data-rx-proof-tick]').check();
await attachButton.click();
await cp.locator('[data-rx-designer-step]').getByText('Ready for print').waitFor({ timeout: 120000 });
const NAMEA3 = 'online-design_297x420mm_300dpi_bleed3mm.pdf';
check('attached as a PDF', (await cp.locator('[data-rx-designer-file]').innerText()) === NAMEA3, await cp.locator('[data-rx-designer-file]').innerText());
await addToCart(cp).click();
await cp.waitForTimeout(800);
const lineA3 = (await cartLines(cp)).find((l) => l?.fileSpecs?.fileName === NAMEA3);
const pdfA3 = new Uint8Array(await (await fetch(lineA3.fileSpecs.fileUrl)).arrayBuffer());
const docA3 = await pdfjs.getDocument({ data: pdfA3.slice(), isEvalSupported: false }).promise;
const pA3 = await docA3.getPage(1);
const boxA3 = chooseArtworkBox({ view: pA3.view, ...(await readPageBoxes(pdfA3, pA3.ref, pA3.view)), userUnit: 1, rotate: 0 });
check('the stored PDF is one page whose TrimBox is the poster, 297 × 420 mm — production places it by that box',
  docA3.numPages === 1 && boxA3?.source === 'trimbox' && Math.abs(boxA3.widthMm - 297) < 0.3 && Math.abs(boxA3.heightMm - 420) < 0.3,
  JSON.stringify(boxA3 && [boxA3.source, boxA3.widthMm, boxA3.heightMm]));

// A design attached, then "send the files later": the line goes WITHOUT it.
await cp.locator('[data-rx-block="artwork"] button', { hasText: 'send the files later' }).click();
await cp.waitForTimeout(300);
const linesBefore = (await cartLines(cp)).length;
await addToCart(cp).click();
await cp.waitForTimeout(800);
const laterLine = (await cartLines(cp))[linesBefore];
check('a design attached, then "send the files later": the line goes WITHOUT the design, waiting for his file',
  !!laterLine && !laterLine.fileSpecs && !laterLine.fileName && laterLine.artworkPending === true);

// ---- a two-sided business card ----
await openProduct(cp, 'studio-test-cards');
await designCard(cp).click();
await cp.locator('[data-rx-designer-open]').click();
await cp.locator('[data-rx-gallery]').waitFor({ timeout: 20000 });
check('a business card: the gallery offers the card designs', (await cp.locator('[data-rx-gal-card="starter-band"]').count()) === 1 && (await cp.locator('[data-rx-gal-card="starter-headline"]').count()) === 0);
await cp.locator('[data-rx-gal-card="starter-band"] button').first().click();
await cp.locator('[data-rx-gal-preview="starter-band"] figure').nth(1).waitFor({ timeout: 10000 });
check('…its preview shows the front AND the back', (await cp.locator('[data-rx-gal-preview="starter-band"] figure').count()) === 2);
await cp.locator('[data-rx-gal-choose]').click();
await studioReady(cp);
check('double-sided: the studio has a Front and a Back page', (await cp.locator('[data-rx-st-page]').count()) === 2);
await cp.locator('[data-rx-st-page="back"]').click();
await cp.waitForTimeout(800);
check('the back of the design is there to change', (await board.getAttribute('data-rx-side')) === 'back' && (await sideObjects(cp)).some((o) => o.type === 'Textbox'));
// The QR code is one of Pixart's Tools.
await cp.locator('[data-rx-st-rail="tools"]').click();
await cp.locator('[data-rx-st-tool="qr"]').click();
await cp.fill('[data-rx-st-qr-field="url"]', 'shop.reklamx.se');
await cp.locator('[data-rx-st-qr-save]').click();
await cp.waitForTimeout(400);
check('a QR code on the back', (await sideObjects(cp)).some((o) => o.type === 'RxQr' && o.rxQr?.text === 'https://shop.reklamx.se'));
// The pattern background is the Backgrounds panel's, never picked up on the board — also
// once loaded again: after an undo or another page it could be grabbed (second pass, watch).
await cp.locator('[data-rx-st-rail="backgrounds"]').click();
await cp.locator('[data-rx-st-bg-tab="pattern"]').click();
await cp.locator('[data-rx-st-pattern]').first().click();
await cp.locator('[data-rx-st-pattern]').nth(1).click();
await cp.locator('[data-rx-st="undo"]').click();
await cp.waitForTimeout(600);
const patternState = () => cp.evaluate(() => {
  const p = window.__rxStudio.pattern;
  return p ? { selectable: p.selectable, evented: p.evented } : null;
});
const patternAfterUndo = await patternState();
await cp.locator('[data-rx-st-page="front"]').click();
await cp.waitForTimeout(600);
await cp.locator('[data-rx-st-page="back"]').click();
await cp.waitForTimeout(800);
const patternAfterPages = await patternState();
check('the pattern background is never picked up on the board: after an undo, and after another page, as when first laid',
  patternAfterUndo?.selectable === false && patternAfterUndo.evented === false && patternAfterPages?.selectable === false && patternAfterPages.evented === false,
  JSON.stringify({ patternAfterUndo, patternAfterPages }));
await cp.locator('[data-rx-st-pattern-remove]').click();
await cp.locator('[data-rx-st-rail="backgrounds"]').click();
await cp.screenshot({ path: `${SHOTS}/153-studio-card-back.png` });
await cp.locator('[data-rx-designer-use]').click();
await cp.locator('[data-rx-proof]').waitFor({ timeout: 60000 });
check('the check shows both pages, and a 2-page PDF at 300 DPI',
  (await cp.locator('[data-rx-proof-page]').count()) === 2 && /PDF, 2 pages, 300 DPI/.test(await cp.locator('[data-rx-proof-file]').innerText()));
check('…and no warning about the QR code: black on white, 0.3 mm a square or more (code review DSN-14)',
  (await cp.locator('[data-rx-proof-warning="qr"]').count()) === 0);
await cp.screenshot({ path: `${SHOTS}/154-studio-card-proof.png` });
await cp.locator('[data-rx-proof-tick]').check();
await attachButton.click();
await cp.locator('[data-rx-designer-step]').getByText('Ready for print').waitFor({ timeout: 60000 });
await addToCart(cp).click();
await cp.waitForTimeout(800);
const cardLine = (await cartLines(cp)).find((l) => /_2pages\.pdf$/.test(l?.fileSpecs?.fileName ?? ''));
check('the basket line: a 2-page PDF, front and back, with a picture of each page',
  cardLine?.fileSpecs?.pages === 2 && JSON.stringify(cardLine.fileSpecs.sides) === '["front","back"]' &&
  JSON.stringify(cardLine.fileSpecs.previews?.map((p) => p.side)) === '["front","back"]',
  JSON.stringify(cardLine?.fileSpecs ?? null).slice(0, 400));

// ---- a roll-up: opens now, keeps words out of the foot, a 150 dpi PDF ----
await openProduct(cp, 'studio-test-rollup');
await designCard(cp).click();
check('a roll-up 85 × 200 cm: the designer opens (it was refused as too large)', !(await cp.locator('[data-rx-designer-open]').isDisabled()));
await cp.locator('[data-rx-designer-open]').click();
await cp.locator('[data-rx-gallery]').waitFor({ timeout: 20000 });
await cp.locator('[data-rx-gal-card="starter-offer"] button').first().click();
await cp.locator('[data-rx-gal-choose]').click();
await studioReady(cp);
await cp.waitForTimeout(800);
const rollWords = (await sideObjects(cp)).filter((o) => o.type === 'Textbox');
check('the roll-up design keeps every word above the 100 mm foot that disappears into the cassette',
  rollWords.length > 0 && rollWords.every((o) => o.top < (2000 + 3 - 100) * 10), JSON.stringify(rollWords.map((o) => Math.round(o.top))));
await cp.screenshot({ path: `${SHOTS}/155-studio-rollup.png` });
await cp.locator('[data-rx-designer-use]').click();
await cp.locator('[data-rx-proof]').waitFor({ timeout: 120000 });
check('its print file: a PDF at the roll-up standard, 150 DPI', /PDF, 1 page, 150 DPI/.test(await cp.locator('[data-rx-proof-file]').innerText()), await cp.locator('[data-rx-proof-file]').innerText());
await cp.locator('[data-rx-proof-back]').click();
await cp.getByRole('button', { name: 'Close the designer' }).click();
await cp.locator('[data-rx-close-warning]').getByRole('button', { name: 'Close', exact: true }).click().catch(() => {});

// ---- the order ----
await cp.goto(`${BASE}/checkout`, { waitUntil: 'domcontentloaded' });
await cp.locator('#co-firstname').waitFor({ timeout: 15000 });
const viewDesign = cp.locator('[data-rx-checkout-design]');
check('checkout: each designed line offers "View your design" (its page pictures, not the print file)', (await viewDesign.count()) === 3, String(await viewDesign.count()));
await viewDesign.nth(2).click();
await cp.locator('[data-rx-design-pages-modal]').waitFor({ timeout: 10000 });
check('…the business card shows its front AND its back', (await cp.locator('[data-rx-design-pages-modal] figure').count()) === 2);
await cp.screenshot({ path: `${SHOTS}/157-studio-checkout-pages.png` });
await cp.keyboard.press('Escape');
await cp.fill('#co-firstname', 'Sara');
await cp.fill('#co-lastname', 'Lind');
await cp.fill('#co-address1', 'Storgatan 1');
await cp.fill('#co-postcode', '111 22');
await cp.fill('#co-city', 'Stockholm');
await cp.fill('#co-email', EMAIL);
await cp.fill('#co-phone', '070-123 45 67');
await cp.locator('[data-ship-option="standard"]').waitFor({ timeout: 15000 });
await cp.locator('label:has(a[href*="terms"]) input[type="checkbox"], label:has(a[href*="privacy"]) input[type="checkbox"]').last().check();
const signIn = await (await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@emulator.test', password: 'emulator-admin-1', returnSecureToken: true }),
})).json();
await cp.route('**/api/checkout/pay', async (route) => {
  // As in designer.mjs: the emulator's Storage host put back to real Storage's — for
  // the print files AND their page pictures (isOurStorageUrl, server.ts).
  const body = route.request().postData().replaceAll('http://127.0.0.1:9199/v0/b/', 'https://firebasestorage.googleapis.com/v0/b/');
  const r = await fetch(`${BASE}/api/checkout/order`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signIn.idToken}` }, body });
  await route.fulfill({ status: r.status, contentType: 'application/json', body: await r.text() });
});
await cp.waitForTimeout(1200);
await cp.getByRole('button', { name: /^Pay/ }).last().click();
let order = null;
for (let i = 0; i < 40 && !order; i++) {
  await cp.waitForTimeout(250);
  const d = (await db.collection('orders').where('customerEmail', '==', EMAIL.toLowerCase()).get()).docs[0];
  order = d ? { id: d.id, ...d.data() } : null;
}
const designed = (order?.items ?? []).filter((it) => /^online-design_/.test(it?.fileSpecs?.fileName ?? ''));
check('the order: the three designed lines carry their print files, and none waits for artwork',
  designed.length === 3 && designed.every((it) => it.fileSpecs.fileUrl && it.artworkPending !== true),
  JSON.stringify((order?.items ?? []).map((it) => ({ file: it?.fileSpecs?.fileName, pending: it?.artworkPending }))));
const card2 = designed.find((it) => it.fileSpecs.pages === 2);
check('…the business card keeps its 2 pages, its sides and a picture of each page — all at the shop\'s own storage',
  !!card2 && JSON.stringify(card2.fileSpecs.sides) === '["front","back"]' && card2.fileSpecs.previews?.length === 2 &&
  card2.fileSpecs.previews.every((p) => p.url.startsWith('https://firebasestorage.googleapis.com/v0/b/')),
  JSON.stringify(card2?.fileSpecs ?? null).slice(0, 400));
check('…and each tells production its bleed and resolution', designed.every((it) => it.fileSpecs.bleedMm === 3 && it.fileSpecs.dpi >= 150));

// ---- production: the job sheet shows the pages' pictures, never the print file ----
await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Orders', exact: true }).first().click();
await page.locator(`[data-order-row="${order?.id}"]`).click({ timeout: 20000 });
await page.getByRole('dialog', { name: new RegExp(`Order ${order?.id}`) }).getByRole('button', { name: /Job sheet/ }).click();
await page.locator('.rx-print-sheet').waitFor({ timeout: 10000 });
const sheetThumbs = await page.locator('.rx-print-sheet [data-rx-sheet-preview]').evaluateAll((els) => els.map((e) => e.getAttribute('src') ?? ''));
check('the job sheet draws each designed line from its small page picture — never loads the print file',
  sheetThumbs.length === 3 && sheetThumbs.every((src) => /design-preview/.test(decodeURIComponent(src)) && !/online-design_/.test(decodeURIComponent(src))), JSON.stringify(sheetThumbs.map((x) => decodeURIComponent(x).split('/').pop())));
check('…and says which page is which on the two-sided card: "Page 1 Front / Page 2 Back"',
  /Page 1 Front \/ Page 2 Back/.test(await page.locator('.rx-print-sheet [data-rx-file-pages]').innerText().catch(() => '')));
await page.screenshot({ path: `${SHOTS}/158-studio-job-sheet.png` });
// Its "Large Preview" of a PDF design (the business card): the page pictures zoom like
// a picture file's, and say they are previews, not the print file (code review DSN-20).
await page.locator('.rx-print-sheet').getByRole('button', { name: 'Large Preview' }).nth(2).click();
const staffView = page.locator('[data-rx-design-attachment]');
await staffView.waitFor({ timeout: 10000 });
const zoomBefore = await staffView.locator('[data-rx-design-zoom]').getAttribute('data-rx-design-zoom');
for (let i = 0; i < 3; i++) await staffView.locator('button[title="Zoom In"]').click();
await page.waitForTimeout(500); // the zoom's 200 ms step
const zoomAfter = await staffView.locator('[data-rx-design-zoom]').getAttribute('data-rx-design-zoom');
check('…its large preview of a PDF design: both page pictures zoom, and are said to be previews, not the print file',
  (await staffView.locator('[data-rx-design-pages] figure').count()) === 2 && zoomBefore === '100' && zoomAfter === '190' &&
    /not the print file/.test(await staffView.locator('[data-rx-design-pages-note]').innerText().catch(() => '')),
  `${zoomBefore} → ${zoomAfter}`);
// Zoomed in, the stage scrolls to every edge of the pages: scaled about their middle,
// their top and left overflowed where no scrollbar reached (code review, second pass #7).
const reach = await staffView.locator('[data-rx-design-stage]').evaluate((stage) => {
  const inner = () => {
    const r = stage.getBoundingClientRect();
    const left = r.left + stage.clientLeft;
    const top = r.top + stage.clientTop;
    return { left, top, right: left + stage.clientWidth, bottom: top + stage.clientHeight };
  };
  const pics = [...stage.querySelectorAll('[data-rx-design-pages] img')];
  stage.scrollTo(0, 0);
  const s0 = inner();
  const first = pics[0].getBoundingClientRect();
  const atStart = { left: Math.round(first.left - s0.left), top: Math.round(first.top - s0.top) };
  stage.scrollTo(stage.scrollWidth, stage.scrollHeight);
  const s1 = inner();
  const last = pics[pics.length - 1].getBoundingClientRect();
  const atEnd = { right: Math.round(s1.right - last.right), bottom: Math.round(s1.bottom - last.bottom) };
  return { atStart, atEnd, scrolls: stage.scrollWidth > stage.clientWidth || stage.scrollHeight > stage.clientHeight };
});
check('…zoomed to 190 %, the preview scrolls to every edge of the pages — the top and the left too',
  reach.scrolls && reach.atStart.left >= 0 && reach.atStart.top >= 0 && reach.atEnd.right >= 0 && reach.atEnd.bottom >= 0, JSON.stringify(reach));
await staffView.getByRole('button', { name: 'Close' }).click();
await page.keyboard.press('Escape');

// ---- after a reload: his design is still on the device ----
await openProduct(cp, 'studio-test-stickers');
await cp.locator('[data-option-card="cs-shape-rect"]').click();
await designCard(cp).click();
await cp.locator('[data-rx-designer-open]').click();
await cp.locator('[data-rx-gallery]').waitFor({ timeout: 20000 });
await cp.locator('[data-rx-gal-continue]').waitFor({ timeout: 10000 }).catch(() => {});
check('after a reload, the gallery offers his design back from the device', (await cp.locator('[data-rx-gal-continue]').count()) === 1);
await cp.goBack();

// ---- products that do not offer it ----
await openProduct(cp, 'studio-test-cards-off');
check('switched off by the owner: not offered', (await designCard(cp).count()) === 0);
await openProduct(cp, 'studio-test-words');
check('sizes that are only words: never offered', (await designCard(cp).count()) === 0);

// ---- a phone ----
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const pp = await phone.newPage();
pp.on('pageerror', (e) => errors.push(String(e?.message ?? e)));
await openProduct(pp, 'studio-test-stickers');
await pp.locator('[data-option-card="ds50"]').tap();
await pp.locator('[data-option-card="cs-shape-round"]').tap();
await designCard(pp).tap();
await pp.locator('[data-rx-designer-open]').tap();
await pp.locator('[data-rx-gallery]').waitFor({ timeout: 20000 });
await pp.locator('[data-rx-gal-scratch]').tap();
await studioReady(pp);
const dialog = await pp.locator('[data-rx-studio]').boundingBox();
check('on a phone: the studio fills the screen — nothing to scroll sideways', dialog.width <= 391 && dialog.height <= 845, JSON.stringify(dialog));
// Pixart's phone: "+" opens the tools; "Texts" puts a text on the page.
await pp.locator('[data-rx-st-add-menu]').tap();
await pp.locator('[data-rx-st-rail="text"]').tap();
await pp.waitForTimeout(500);
const ph = await objectBox(pp, (o) => o.type === 'textbox');
await pp.touchscreen.tap(ph.x + ph.w / 2, ph.y + ph.h / 2);
await pp.locator('[data-rx-st-textsheet]').waitFor({ timeout: 5000 }).catch(() => {});
check('a tap on the chosen words opens a sheet above the keyboard to type in', (await pp.locator('[data-rx-st-textsheet]').count()) === 1);
await pp.locator('[data-rx-designer-text]').fill('Från mobilen');
await pp.locator('[data-rx-st-textsheet] button').tap();
await pp.waitForTimeout(500);
check('…and the words are on the board', (await sideObjects(pp)).some((o) => o.text === 'Från mobilen'));
// The same camera photo on a phone keeps the 4096 cut it had: cut by its area, every
// full-size copy cost half as much memory again (second pass, a watch on DSN-06).
// The phone's "+" shows only while nothing is chosen (the words above still are).
await pp.evaluate(() => { const e = window.__rxStudio; e.canvas.discardActiveObject(); e.canvas.requestRenderAll(); });
await pp.locator('[data-rx-st-add-menu]').tap();
await pp.locator('[data-rx-st-rail="uploads"]').tap();
await pp.locator('[data-rx-photo-input]').setInputFiles({ name: 'camera.png', mimeType: 'image/png', buffer: await picture(pp, 6000, 4000, '#9ca3af') });
await pp.waitForFunction(() => window.__rxStudio.canvas.getObjects().some((o) => o.type === 'image'), null, { timeout: 30000 });
const cameraOnPhone = await pp.evaluate(() => {
  const o = window.__rxStudio.canvas.getObjects().find((x) => x.type === 'image');
  return o ? [o.width, o.height] : null;
});
check('…the same 24 MP photo on a phone: 4096 × 2730 pixels, its long side cut to 4096 as it was', JSON.stringify(cameraOnPhone) === '[4096,2730]', JSON.stringify(cameraOnPhone));
await pp.evaluate(() => {
  const e = window.__rxStudio;
  e.remove(e.canvas.getObjects().find((x) => x.type === 'image'));
});
if (await pp.locator('[data-rx-designer-panel]').count()) await pp.getByRole('button', { name: 'Close the panel' }).tap();
await pp.screenshot({ path: `${SHOTS}/156-studio-phone.png` });
await pp.locator('[data-rx-designer-use]').tap();
await pp.locator('[data-rx-proof-tick]').check({ timeout: 30000 });
await pp.locator('[data-rx-proof-attach]').tap();
await pp.locator('[data-rx-designer-step]').getByText('Ready for print').waitFor({ timeout: 30000 }).catch(() => {});
check('…and the design is attached from the phone', (await pp.locator('[data-rx-designer-file]').innerText().catch(() => '')) === NAME50);

// ---- signing out: the designs kept on this device go with the person (code review DSN-04) ----
// A context of its own: its sign-out must not reach the admin's page above.
const shared = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const sp = await shared.newPage();
await loginAdmin(sp);
await sp.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
const designerDb = (fn) => sp.evaluate(async (src) => {
  const idb = await new Promise((resolve, reject) => {
    const req = indexedDB.open('reklamx-designer', 2);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('drafts')) req.result.createObjectStore('drafts', { keyPath: 'key' });
      if (!req.result.objectStoreNames.contains('pictures')) req.result.createObjectStore('pictures');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  try {
    return await new Function('idb', `return (${src})(idb)`)(idb);
  } finally {
    idb.close();
  }
}, fn.toString());
await designerDb(async (idb) => {
  const tx = idb.transaction(['drafts', 'pictures'], 'readwrite');
  for (const key of ['studio:prod-left-behind', 'prod-round16', 'template:tpl-owner']) {
    tx.objectStore('drafts').put({ key, json: '{}', imageIds: ['img-a'], trimMm: { wMm: 50, hMm: 50 }, savedAt: Date.now() });
    tx.objectStore('pictures').put(new Blob(['x']), `${key}/img-a`);
  }
  await new Promise((resolve) => { tx.oncomplete = resolve; });
});
await sp.locator('[data-rx-account-menu]').click();
// Signing out now starts the shop afresh on the home page (no design left in memory
// either), so the device is read after that reload, not during it.
await Promise.all([
  sp.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
  sp.getByRole('button', { name: 'Sign Out' }).click(),
]);
await sp.locator('[data-rx-account-menu]').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
await sp.waitForTimeout(500);
const leftBehind = await designerDb(async (idb) => {
  const tx = idb.transaction(['drafts', 'pictures'], 'readonly');
  const keys = (store) => new Promise((resolve) => {
    const q = tx.objectStore(store).getAllKeys();
    q.onsuccess = () => resolve(q.result.map(String).sort());
  });
  return { drafts: await keys('drafts'), pictures: await keys('pictures') };
});
check('signing out takes the customer designs kept on this device with it — the owner\'s template drafts stay',
  JSON.stringify(leftBehind) === JSON.stringify({ drafts: ['template:tpl-owner'], pictures: ['template:tpl-owner/img-a'] }), JSON.stringify(leftBehind));
await shared.close();

await cleanup();
const testsOwn = (u) => /\/api\/orders\/[^/?]+\/status\?t=$/.test(u);
const real = errors.filter((e) => !/status of 404/.test(e) && !(/status of 403/.test(e) && refused.length > 0 && refused.every(testsOwn)));
check('…and nothing else was refused', refused.every(testsOwn), refused.filter((u) => !testsOwn(u)).slice(0, 3).join(' | '));
check('no page errors', real.length === 0, real.slice(0, 4).join(' | '));
await browser.close();
process.exit(summary() ? 1 : 0);
