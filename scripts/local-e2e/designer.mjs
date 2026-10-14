// Round 16, item 5 — "Design online": a customer designs the product on the
// product page, and the print file goes with the order.
//
//   the owner: "Customers can design it online", on by default; it says when a
//   product cannot offer it, and unticked it is saved off.
//   a customer: a round 50 mm sticker. The designer opens on the product's own
//   cut line; a layout, his own words (å ä ö), the four self-hosted fonts.
//   "Use this design" shows the print file back (trim + 3 mm bleed, 300 DPI) and
//   holds it until he ticks that he has checked it; attached, it is uploaded and
//   the order line carries it.
//   the rules: chosen but not designed, the order waits; a change of size takes
//   the design off (and never deletes a file a basket line uses); a replaced,
//   unused file IS deleted; Back closes the designer, not the product; closing
//   unsent work says so; the design survives a reload, on the device.
//   the limits: A0 and an own shape are refused up front, with the reason; a
//   product whose sizes are words never offers it; the design service's own
//   "Design it online" stays hidden; the PDF-only rule for uploads does not
//   refuse the designer's own file.
//   the file: A3 is under the 16 MP cap, at 150 DPI or more, with SHARP text
//   (drawn at full size, not upscaled from a cache); a tiny photo is flagged.
//   a phone: the same journey at 390 × 844 with touch — and then black only
//   (1/0) chosen instead of full colour: the design is taken off, and he is told
//   the print changed (code review DSN-03); so too for a back page added, 4/0 →
//   4/4, which is not a change of size (code review 2026-10-11, H).
//   signing out: the half-typed checkout goes, and the tab reloads on the home
//   page, so no design is left in memory for the next person (2026-10-11, M).
//   the upload check: a file made with the 3 mm bleed the dropzone asks for is
//   accepted now (it was refused).
import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch, loginAdmin, BASE, SHOTS, db, check, summary } from './lib.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'reklamx-designer-e2e-'));
writeFileSync(join(tmp, 'e.ts'), [
  `export { OPTION_CATALOGUE } from ${JSON.stringify(join(ROOT, 'src/components/Admin/optionCatalogue.ts'))};`,
  `export { designExportSize } from ${JSON.stringify(join(ROOT, 'src/lib/designSize.ts'))};`,
].join('\n'));
await build({ entryPoints: [join(tmp, 'e.ts')], outfile: join(tmp, 'e.mjs'), bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const { OPTION_CATALOGUE, designExportSize } = await import(pathToFileURL(join(tmp, 'e.mjs')).href);
rmSync(tmp, { recursive: true, force: true });

const ID = 'prod-design-e2e';
const OFF = 'prod-design-off';
const WORDS = 'prod-design-words';
const EMAIL = `design-${Date.now()}@emulator.test`;
const BUCKET = 'http://127.0.0.1:9199/v0/b/demo-reklamx.appspot.com/o';
const src = (await db.collection('products').doc('prod-pmp-696').get()).data();
const catalogue = (id) => ({ ...OPTION_CATALOGUE.find((f) => f.id === id), enabled: true });
const sizes = {
  id: 'dsg_e2e_size', name: 'Size', group: 'default', enabled: true,
  options: [
    { id: 'ds50', label: '50 × 50 mm', value: '50x50', priceModifier: 0, isDefault: true, dimensions: '50 × 50 mm' },
    { id: 'ds85', label: '85 × 55 mm', value: '85x55', priceModifier: 0, dimensions: '85 × 55 mm' },
    { id: 'dsA3', label: 'Poster A3', value: 'a3', priceModifier: 0, dimensions: '297 × 420 mm' },
    { id: 'dsA0', label: 'Poster A0', value: 'a0', priceModifier: 0, dimensions: '841 × 1189 mm' },
  ],
};
const words = {
  id: 'dsg_e2e_words', name: 'Size', group: 'default', enabled: true,
  options: [
    { id: 'dw-std', label: 'Standard', value: 'std', priceModifier: 0, isDefault: true },
    { id: 'dw-big', label: 'Large', value: 'big', priceModifier: 0 },
  ],
};
// Not area-priced: the size calculator would give even the "words" product a size.
const base = {
  ...src, isHidden: false, artworkEnabled: true, artworkRequired: false, relatedProductIds: [],
  customUploadRules: { ...(src.customUploadRules ?? {}), areaPriced: false },
};
for (const key of ['onlineDesign', 'pageOrder', 'quantityAfterFieldId']) delete base[key];
const cleanup = async () => {
  for (const id of [ID, OFF, WORDS]) await db.collection('products').doc(id).delete().catch(() => {});
  for (const d of (await db.collection('orders').where('customerEmail', '==', EMAIL.toLowerCase()).get()).docs) await d.ref.delete();
};
process.on('uncaughtException', async (err) => { console.error(err); await cleanup().catch(() => {}); process.exit(1); });
await db.collection('products').doc(ID).set({
  ...base, id: ID, name: 'Design test stickers', nameI18n: null, slug: 'design-test-stickers', sku: 'DSG-E2E',
  // PDF only, for files a customer brings: the designer's PNG must not be refused by it.
  customUploadRules: { ...base.customUploadRules, allowedFormats: ['pdf'] },
  // The colour configuration as cards (4/0 by default — the same pages and ink as
  // no such question), so the phone can change the ink after its design.
  printingFields: [sizes, { ...catalogue('product_shape'), display: 'cards' }, { ...catalogue('colour_configuration'), display: 'cards' },
    catalogue('artwork_supply_method'), catalogue('design_service')],
});
await db.collection('products').doc(OFF).set({
  ...base, id: OFF, name: 'Design test cards (switched off)', nameI18n: null, slug: 'design-test-cards-off', sku: null, onlineDesign: false,
  customUploadRules: { ...base.customUploadRules, allowedFormats: ['pdf', 'png', 'jpg'] },
  printingFields: [{ ...sizes, options: sizes.options.map((o) => ({ ...o, isDefault: o.id === 'ds85' })) }, catalogue('artwork_supply_method')],
});
await db.collection('products').doc(WORDS).set({
  ...base, id: WORDS, name: 'Design test words', nameI18n: null, slug: 'design-test-words', sku: null,
  printingFields: [words, catalogue('artwork_supply_method')],
});

const pngSize = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });
// The pHYs chunk right after IHDR: pixels per metre, unit (1 = metre).
const pngPhys = (buf) => (buf.subarray(37, 41).toString('latin1') === 'pHYs' ? { ppm: buf.readUInt32BE(41), unit: buf[49] } : null);
// The JFIF header's density: units (1 = dots per inch) and the X density.
const jpegDensity = (buf) => (buf.subarray(6, 10).toString('latin1') === 'JFIF' ? { units: buf[13], dpi: buf.readUInt16BE(14) } : null);
const jpegSize = (buf) => {
  for (let i = 2; i + 9 < buf.length;) {
    if (buf[i] !== 0xff) { i += 1; continue; }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xc3) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
};
// The bucket as the emulator's owner sees it (rules do not apply to "owner").
const designFiles = async () => {
  const r = await fetch(`${BUCKET}?prefix=${encodeURIComponent('uploads/')}`, { headers: { Authorization: 'Bearer owner' } });
  return ((await r.json()).items ?? []).map((x) => x.name).filter((n) => /online-design_/.test(n));
};
const cartLines = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('reklamx_cart') || '[]'));
/** Black text on white, scanned along rows: the steepest step between two neighbours, and how many dark pixels were crossed. */
const edges = (p, b64, mime, rows) => p.evaluate(async ({ b64, mime, rows }) => {
  const bmp = await createImageBitmap(await (await fetch(`data:${mime};base64,${b64}`)).blob());
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  let best = 0;
  let dark = 0;
  for (const fy of rows) {
    const { data } = ctx.getImageData(0, Math.round(fy * bmp.height), bmp.width, 1);
    for (let x = 1; x < bmp.width; x += 1) {
      best = Math.max(best, Math.abs(data[(x - 1) * 4] - data[x * 4]));
      if (data[x * 4] < 60) dark += 1;
    }
  }
  const corner = ctx.getImageData(2, 2, 1, 1).data;
  c.width = 0;
  return { best, dark, corner: [corner[0], corner[1], corner[2]] };
}, { b64, mime, rows });
const picture = (p, w, h, colour) => p.evaluate(({ w, h, colour }) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, w, h);
  return c.toDataURL('image/png').split(',')[1];
}, { w, h, colour }).then((b64) => Buffer.from(b64, 'base64'));

const { browser, page, errors } = await launch();

// ---- the owner ----
await loginAdmin(page);
await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {});
await page.getByRole('button', { name: 'Products Admin' }).click();
const openEditor = async (name) => {
  await page.getByText(name, { exact: true }).first().waitFor({ timeout: 20000 });
  await page.locator(`xpath=//*[normalize-space()=${JSON.stringify(name)}]/ancestor::div[.//button[normalize-space()='Edit']][1]//button[normalize-space()='Edit']`).first().click();
  await page.getByRole('button', { name: 'Save Product' }).waitFor({ timeout: 15000 });
};
await openEditor('Design test words');
const setting = page.locator('[data-rx-online-design-setting]');
await setting.scrollIntoViewIfNeeded();
check('the editor: "Customers can design it online", ticked by default', await setting.locator('input[type="checkbox"]').isChecked());
check('…and it says when the product cannot offer it anyway: sizes that are only words',
  (await page.locator('[data-rx-online-design-note="no-size"]').count()) === 1);
await setting.locator('input[type="checkbox"]').uncheck();
await page.getByRole('button', { name: 'Save Product' }).click();
let savedOff = null;
for (let i = 0; i < 40 && savedOff !== false; i++) {
  await page.waitForTimeout(250);
  savedOff = (await db.collection('products').doc(WORDS).get()).data()?.onlineDesign;
}
check('unticked and saved: the product records it off', savedOff === false, String(savedOff));

// ---- a customer ----
const shop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
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

await openProduct(cp, 'design-test-stickers');
check('offered on the product, in the artwork step', (await designCard(cp).count()) === 1);
check('…without a second "Recommended" badge beside the PDF\'s', (await cp.locator('[data-rx-block="artwork"]').getByText('Recommended', { exact: true }).count()) === 1);
check('the design service\'s own "Design it online" (nothing behind it) is still not offered', (await cp.locator('[data-option-card="sv-dsgn-online"]').count()) === 0);
await cp.locator('[data-option-card="cs-shape-round"]').click();
await designCard(cp).click();
check('chosen but not designed: the order waits, and says what for',
  (await addToCart(cp).isDisabled()) && /Finish your design/.test(await cp.locator('[data-rx-artwork-missing]').innerText().catch(() => '')));

await cp.locator('[data-rx-designer-open]').click();
await cp.locator('[data-rx-designer]').waitFor({ timeout: 20000 });
await cp.locator('[data-rx-layouts]').waitFor({ timeout: 20000 });
check('the designer opens over the product, on a history entry of its own', await cp.evaluate(() => history.state?.rxDesigner === true));
check('its board is the product: a circular cut line, the bleed and the safe band marked',
  (await cp.locator('[data-rx-guide="cut"][data-rx-cut="circle"]').count()) === 1 &&
  (await cp.locator('[data-rx-guide="bleed"]').count()) === 1 && (await cp.locator('[data-rx-guide="safe"]').count()) === 1);
await cp.locator('[data-rx-layout="headline"]').click();
await cp.locator('[data-rx-designer-panel]').waitFor({ timeout: 10000 });
const board = await cp.locator('[data-rx-designer-board]').boundingBox();
check('the board has the product\'s proportions with its bleed (56 × 56 mm)', Math.abs(board.width / board.height - 1) < 0.02, `${board.width}×${board.height}`);
// The headline sits at 24.5 mm of the 56 mm board.
await cp.mouse.click(board.x + board.width * 0.5, board.y + board.height * (24.5 / 56));
const text = cp.locator('[data-rx-designer-text]');
await text.waitFor({ timeout: 5000 }).catch(() => {});
check('tapping the headline selects it: its words in the text box under the board', (await text.inputValue().catch(() => '')) === 'Your headline');
check('the four self-hosted fonts all loaded', (await cp.locator('[data-rx-designer-font] option').count()) === 4);
await text.fill('Hej Reklamx åäö');
await cp.locator('[data-rx-designer-font]').selectOption('RX Playfair Display');
await cp.waitForTimeout(600);
check('a change can be undone', !(await cp.locator('[data-rx-tool="undo"]').isDisabled()));
await cp.screenshot({ path: `${SHOTS}/110-designer-round.png` });

const e50 = designExportSize({ wMm: 50, hMm: 50 });
await cp.locator('[data-rx-designer-use]').click();
await cp.locator('[data-rx-proof]').waitFor({ timeout: 30000 });
const fileLine = await cp.locator('[data-rx-proof-file]').innerText();
check(`"Use this design" shows the print file back: ${e50.widthPx} × ${e50.heightPx} px at 300 DPI, with 3 mm bleed`,
  fileLine.includes(`${e50.widthPx} × ${e50.heightPx} px at 300 DPI`) && /3 mm bleed/.test(fileLine), fileLine);
const attachButton = cp.getByRole('button', { name: 'Attach the design' });
check('…and holds it until he ticks that he has checked it', await attachButton.isDisabled());
await cp.screenshot({ path: `${SHOTS}/111-designer-proof.png` });
await cp.locator('[data-rx-proof-tick]').check();
await attachButton.click();
await cp.locator('[data-rx-designer]').waitFor({ state: 'detached', timeout: 10000 });
check('attached: the designer closes, and its history entry goes with it', await cp.evaluate(() => !history.state?.rxDesigner));
const NAME50 = 'online-design_50x50mm_300dpi_bleed3mm.png';
await cp.locator('[data-rx-designer-file]').waitFor({ timeout: 10000 });
check('the artwork step shows the design by name — on a PDF-only product: the uploads rule did not refuse it',
  (await cp.locator('[data-rx-designer-file]').innerText()) === NAME50);
await cp.locator('[data-rx-designer-step]').getByText('Ready for print').waitFor({ timeout: 30000 });
check('uploaded, and the order can go', !(await addToCart(cp).isDisabled()));
check('the preview frame shows the design, clipped to the circle', (await cp.locator('[data-rx-designer-step] [data-rx-cut-clip="circle"] img').count()) === 1);

// A second "Use this design" before the basket: the first file is never read again — it is deleted.
const before = await designFiles();
await cp.locator('[data-rx-designer-step]').getByRole('button', { name: 'Edit your design' }).click();
await cp.locator('[data-rx-designer-panel]').waitFor({ timeout: 20000 });
check('"Edit your design" reopens it where he left it — no layout chooser', (await cp.locator('[data-rx-layouts]').count()) === 0);
await cp.locator('[data-rx-designer-use]').click();
await cp.locator('[data-rx-proof-tick]').check({ timeout: 30000 });
// A double tap: it went back TWICE and left the product page.
await attachButton.dblclick();
await cp.locator('[data-rx-designer-step]').getByText('Ready for print').waitFor({ timeout: 30000 });
await cp.waitForTimeout(800);
check('a double tap on "Attach the design" attaches once and stays on the product',
  new URL(cp.url()).pathname === '/products/design-test-stickers' && (await cp.evaluate(() => !history.state?.rxDesigner)), cp.url());
const after = await designFiles();
check('the replaced, unused file is deleted from storage: one design file, not two',
  after.length === before.length && after.some((n) => !before.includes(n)), `${before.length} → ${after.length}`);

await addToCart(cp).click();
await cp.waitForTimeout(800);
const line1 = (await cartLines(cp))[0];
check('the basket line carries the design: its name and its stored file',
  line1?.fileSpecs?.fileName === NAME50 && /^http:\/\/127\.0\.0\.1:9199\//.test(line1?.fileSpecs?.fileUrl ?? '') && /^uploads\/[^/]+\/artwork\//.test(line1?.fileSpecs?.storagePath ?? ''),
  JSON.stringify(line1?.fileSpecs ?? null).slice(0, 200));
const file1 = Buffer.from(await (await fetch(line1.fileSpecs.fileUrl)).arrayBuffer());
check(`the stored file is the print file: a PNG of ${e50.widthPx} × ${e50.heightPx} px`,
  file1.subarray(1, 4).toString() === 'PNG' && JSON.stringify(pngSize(file1)) === JSON.stringify({ w: e50.widthPx, h: e50.heightPx }), JSON.stringify(pngSize(file1)));
check('…and it says its own resolution inside (pHYs: 11811 px per metre = 300 DPI), so no program reads it at 72 ppi',
  JSON.stringify(pngPhys(file1)) === JSON.stringify({ ppm: 11811, unit: 1 }), JSON.stringify(pngPhys(file1)));
const ink50 = await edges(cp, file1.toString('base64'), 'image/png', [0.38, 0.4, 0.42, 0.44, 0.46, 0.48]);
check('…with the words on it, and white in the corner (the background runs into the bleed)', ink50.dark > 0 && ink50.corner.every((v) => v > 245), JSON.stringify(ink50));

// A change of size after the design is in the basket.
await cp.locator('[data-option-card="ds85"]').click();
await cp.locator('[data-rx-designer-notice]').waitFor({ timeout: 5000 }).catch(() => {});
check('a new size: the design no longer fits, so it is taken off and he is told',
  /changed the size or the shape/.test(await cp.locator('[data-rx-designer-notice]').innerText().catch(() => '')) && (await addToCart(cp).isDisabled()));
check('…and the file the basket line uses is NOT deleted', (await fetch(line1.fileSpecs.fileUrl)).status === 200);
await cp.locator('[data-rx-designer-open]').click();
await cp.locator('[data-rx-designer-panel]').waitFor({ timeout: 20000 });
const board85 = await cp.locator('[data-rx-designer-board]').boundingBox();
check('reopened: the draft comes back refitted to 91 × 61 mm', Math.abs(board85.width / board85.height - 91 / 61) < 0.03, `${board85.width}×${board85.height}`);
await cp.locator('[data-rx-tool="text"]').click();
await cp.getByRole('button', { name: 'Close the designer' }).click();
check('closing with unsent work says it is not attached yet, and stays open', (await cp.locator('[data-rx-close-warning]').count()) === 1 && (await cp.locator('[data-rx-designer]').count()) === 1);
await cp.locator('[data-rx-close-warning]').getByRole('button', { name: 'Close', exact: true }).click();
await cp.locator('[data-rx-designer]').waitFor({ state: 'detached', timeout: 10000 });
await cp.locator('[data-rx-designer-open]').click();
await cp.locator('[data-rx-designer-panel]').waitFor({ timeout: 20000 });
await cp.goBack();
await cp.locator('[data-rx-designer]').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
check('the Back button closes the designer and stays on the product',
  (await cp.locator('[data-rx-designer]').count()) === 0 && new URL(cp.url()).pathname === '/products/design-test-stickers', cp.url());

// The limits, said before he starts.
await cp.locator('[data-option-card="dsA0"]').click();
check('A0: too large to design online — said up front, and the designer does not open',
  /too large to design online/.test(await cp.locator('[data-rx-designer-blocked]').innerText().catch(() => '')) && (await cp.locator('[data-rx-designer-open]').isDisabled()));
await cp.locator('[data-option-card="ds50"]').click();
await cp.locator('[data-option-card="cs-shape-custom"]').click();
check('an own shape: its cut line has to be in his own file — said, and the designer does not open',
  /cut line drawn in your own file/.test(await cp.locator('[data-rx-designer-blocked]').innerText().catch(() => '')) && (await cp.locator('[data-rx-designer-open]').isDisabled()));

// The file at a poster's size: under the cap, sharp.
await cp.locator('[data-option-card="cs-shape-rect"]').click();
await cp.locator('[data-option-card="dsA3"]').click();
await cp.locator('[data-rx-designer-open]').click();
await cp.locator('[data-rx-designer-panel]').waitFor({ timeout: 20000 });
await cp.locator('[data-rx-tool="layouts"]').click();
await cp.locator('[data-rx-layout="blank"]').click();
await cp.locator('[data-rx-designer-use]').click();
check('an empty design is not made into a "print file": he is told to add something first',
  /Your design is empty/.test(await cp.locator('[data-rx-designer-panel] [role="alert"]').innerText().catch(() => '')) && (await cp.locator('[data-rx-proof]').count()) === 0);
await cp.locator('[data-rx-tool="layouts"]').click();
await cp.locator('[data-rx-layout="headline"]').click();
// A picture far too small for a poster, and one the browser cannot open.
await cp.locator('[data-rx-photo-input]').setInputFiles({ name: 'photo.heic', mimeType: 'image/heic', buffer: Buffer.from('not an image') });
check('a HEIC (or any other) picture: told plainly which pictures it takes', /JPG, PNG or WebP/.test(await cp.locator('[data-rx-designer-panel] [role="alert"]').innerText().catch(() => '')));
await cp.locator('[data-rx-photo-input]').setInputFiles({ name: 'tiny.png', mimeType: 'image/png', buffer: await picture(cp, 160, 120, '#fde68a') });
await cp.locator('[data-rx-photo-quality]').waitFor({ timeout: 10000 });
check('a 160-pixel photo across a poster: "too small for this size", with its DPI', (await cp.locator('[data-rx-photo-quality]').getAttribute('data-rx-photo-quality')) === 'poor');
await cp.getByRole('button', { name: 'Fill the background' }).click();
const eA3 = designExportSize({ wMm: 297, hMm: 420 });
await cp.locator('[data-rx-designer-use]').click();
await cp.locator('[data-rx-proof]').waitFor({ timeout: 60000 });
check('the check before attaching says the photo will print blurred', (await cp.locator('[data-rx-proof-warning="photo-poor"]').count()) === 1);
await cp.locator('[data-rx-proof-tick]').check();
await attachButton.click();
await cp.locator('[data-rx-designer-step]').getByText('Ready for print').waitFor({ timeout: 60000 });
const NAMEA3 = `online-design_297x420mm_${eA3.dpi}dpi_bleed3mm.jpg`;
check('with a photo in it, the file is a JPEG (a 16 MP PNG of a photo is over the bucket\'s 50 MB)', (await cp.locator('[data-rx-designer-file]').innerText()) === NAMEA3, await cp.locator('[data-rx-designer-file]').innerText());
await addToCart(cp).click();
await cp.waitForTimeout(800);
const lineA3 = (await cartLines(cp)).find((l) => l?.fileSpecs?.fileName === NAMEA3);
const fileA3 = Buffer.from(await (await fetch(lineA3.fileSpecs.fileUrl)).arrayBuffer());
const dimsA3 = jpegSize(fileA3);
check(`…and its own resolution inside (JFIF: ${eA3.dpi} dots per inch)`, JSON.stringify(jpegDensity(fileA3)) === JSON.stringify({ units: 1, dpi: eA3.dpi }), JSON.stringify(jpegDensity(fileA3)));
check(`A3: ${eA3.widthPx} × ${eA3.heightPx} px at ${eA3.dpi} DPI — under the 16 MP every phone can hold, over the 150 DPI floor`,
  JSON.stringify(dimsA3) === JSON.stringify({ h: eA3.heightPx, w: eA3.widthPx }) && dimsA3.w * dimsA3.h <= 16e6 && eA3.dpi >= 150, JSON.stringify(dimsA3));
// The headline band of an A3 headline layout: 19 %–58 % down the board.
const sharp = await edges(cp, fileA3.toString('base64'), 'image/jpeg', Array.from({ length: 40 }, (_, i) => 0.2 + i * 0.0095));
check('its text is SHARP at full size: black meets the background in one step, not a blur upscaled from a small render',
  sharp.dark > 0 && sharp.best >= 180, JSON.stringify(sharp));

// A design attached, then "send the files later": the line must NOT carry the
// design (it did: the order looked supplied, nobody asked for the real file,
// and production would print the abandoned draft).
await cp.locator('[data-rx-block="artwork"] button', { hasText: 'send the files later' }).click();
await cp.waitForTimeout(300);
const linesBefore = (await cartLines(cp)).length;
await addToCart(cp).click();
await cp.waitForTimeout(800);
const laterLine = (await cartLines(cp))[linesBefore];
check('a design attached, then "send the files later" chosen: the line goes WITHOUT the design, waiting for his file',
  !!laterLine && !laterLine.fileSpecs && !laterLine.fileName && laterLine.artworkPending === true, JSON.stringify({ fileSpecs: laterLine?.fileSpecs ?? null, pending: laterLine?.artworkPending }));
await designCard(cp).click();
check('…and back on "Design online", the design is still there', (await cp.locator('[data-rx-designer-file]').innerText().catch(() => '')) === NAMEA3);

// ---- the order ----
await cp.goto(`${BASE}/checkout`, { waitUntil: 'domcontentloaded' });
await cp.locator('#co-firstname').waitFor({ timeout: 15000 });
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
  // THE ONE DIFFERENCE FROM PRODUCTION. The server keeps a file on an order
  // only when its URL is https://firebasestorage.googleapis.com/v0/b/<our
  // bucket>/o/… (isOurStorageUrl, server.ts). Here the Storage EMULATOR handed
  // out http://127.0.0.1:9199/v0/b/<bucket>/o/… for the same object, so the
  // host alone is put back to what real Storage returns; the bucket and path
  // are the server's own.
  const body = route.request().postData().replaceAll('http://127.0.0.1:9199/v0/b/', 'https://firebasestorage.googleapis.com/v0/b/');
  const r = await fetch(`${BASE}/api/checkout/order`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signIn.idToken}` }, body,
  });
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
check('the order: both designed lines carry their print files, chosen as "Design online", and nothing is waiting for artwork',
  designed.length === 2 && designed.every((it) => it.fileSpecs.fileUrl && it.artworkPending !== true &&
    JSON.stringify(it.selectedOptions ?? it.options ?? {}).includes('Design online')),
  JSON.stringify((order?.items ?? []).map((it) => ({ file: it?.fileSpecs?.fileName, pending: it?.artworkPending }))));

check('…and each tells production its bleed and resolution (fileSpecs.bleedMm 3, dpi)',
  designed.length === 2 && designed.every((it) => it.fileSpecs.bleedMm === 3 && it.fileSpecs.dpi >= 150),
  JSON.stringify(designed.map((it) => ({ bleed: it.fileSpecs.bleedMm, dpi: it.fileSpecs.dpi }))));
const later = (order?.items ?? []).find((it) => !it.fileSpecs);
check('the "send later" line reached the order with no file, marked as awaited', !!later && later.artworkPending === true, JSON.stringify(later ? { pending: later.artworkPending } : null));

// ---- after a reload: the design is still on the device ----
await openProduct(cp, 'design-test-stickers');
await cp.locator('[data-option-card="cs-shape-rect"]').click();
await designCard(cp).click();
await cp.locator('[data-rx-designer-open]').click();
await cp.locator('[data-rx-restored]').waitFor({ timeout: 20000 }).catch(() => {});
check('after a reload, the design is offered back from the device', (await cp.locator('[data-rx-restored]').count()) === 1);
await cp.goBack();

// ---- products that do not offer it ----
await openProduct(cp, 'design-test-cards-off');
check('switched off by the owner: not offered', (await designCard(cp).count()) === 0);
// THE UPLOAD CHECK — 91 × 61 mm is 85 × 55 with the 3 mm bleed the dropzone asks for.
const dropzone = cp.locator('[data-rx-block="artwork"] input[type="file"]');
const hints = await cp.locator('[data-rx-block="artwork"]').innerText();
check('the empty dropzone names both sizes, and the pixels for the larger (538 × 361), so following both of its lines is never refused',
  /85 × 55 mm or 91 × 61 mm with 3 mm bleed/.test(hints) && /538 × 361/.test(hints), hints.replace(/\s+/g, ' ').slice(0, 200));
await dropzone.setInputFiles({ name: 'card-with-bleed.png', mimeType: 'image/png', buffer: await picture(cp, 1075, 721, '#ffffff') });
await cp.locator('[data-rx-block="artwork"]').getByText('card-with-bleed.png').waitFor({ timeout: 20000 }).catch(() => {});
check('a picture made WITH the 3 mm bleed the dropzone asks for is accepted (it was refused as the wrong proportions)',
  (await cp.locator('[data-rx-block="artwork"]').getByText('card-with-bleed.png').count()) === 1 &&
  (await cp.locator('[data-rx-block="artwork"] .text-red-600').count()) === 0);
check('…and its preview pushes the 3 mm outside the frame, where the cutter will take them', (await cp.locator('[data-rx-block="artwork"] [data-rx-preview-bleed="3"] img').count()) === 1);

await dropzone.setInputFiles({ name: 'square.png', mimeType: 'image/png', buffer: await picture(cp, 1200, 1200, '#ffffff') });
const refusal = await cp.locator('[data-rx-block="artwork"] .text-red-600').innerText({ timeout: 10000 }).catch(() => '');
check('a square picture for a business card is still refused — and the refusal names both sizes that would do',
  /85 × 55 mm or 91 × 61 mm with 3 mm bleed/.test(refusal), refusal);
await openProduct(cp, 'design-test-words');
check('sizes that are only words: never offered (the designer could not know the size)', (await designCard(cp).count()) === 0);

// ---- a phone ----
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const pp = await phone.newPage();
pp.on('pageerror', (e) => errors.push(String(e?.message ?? e)));
await openProduct(pp, 'design-test-stickers');
await pp.locator('[data-option-card="ds50"]').tap();
await pp.locator('[data-option-card="cs-shape-round"]').tap();
await designCard(pp).tap();
await pp.locator('[data-rx-designer-open]').tap();
await pp.locator('[data-rx-designer]').waitFor({ timeout: 20000 });
await pp.locator('[data-rx-layouts]').waitFor({ timeout: 20000 });
await pp.locator('[data-rx-layout="headline"]').tap();
await pp.locator('[data-rx-designer-panel]').waitFor({ timeout: 10000 });
const pb = await pp.locator('[data-rx-designer-board]').boundingBox();
const dialog = await pp.locator('[data-rx-designer]').boundingBox();
check('on a phone: the whole board fits the screen, and the dialog fills it — nothing to scroll sideways',
  pb.x >= 0 && pb.x + pb.width <= 390 && pb.width > 200 && dialog.height <= 844 + 1 && dialog.width <= 390 + 1, JSON.stringify({ pb, dialog }));
await pp.touchscreen.tap(pb.x + pb.width * 0.5, pb.y + pb.height * (24.5 / 56));
const ptext = pp.locator('[data-rx-designer-text]');
await ptext.waitFor({ timeout: 5000 }).catch(() => {});
check('a tap with a finger selects the headline', (await ptext.inputValue().catch(() => '')) === 'Your headline');
await ptext.fill('Från mobilen');
await pp.waitForTimeout(500);
await pp.screenshot({ path: `${SHOTS}/112-designer-phone.png` });
await pp.locator('[data-rx-designer-use]').tap();
await pp.locator('[data-rx-proof-tick]').check({ timeout: 30000 });
await pp.getByRole('button', { name: 'Attach the design' }).tap();
await pp.locator('[data-rx-designer-step]').getByText('Ready for print').waitFor({ timeout: 30000 }).catch(() => {});
check('…and the design is attached from the phone', (await pp.locator('[data-rx-designer-file]').innerText().catch(() => '')) === NAME50);
await pp.screenshot({ path: `${SHOTS}/113-designer-phone-attached.png` });
// The same size, cut and page — black only now. A design made in colour is not
// the artwork for it; it stayed on the line (code review DSN-03).
await pp.locator('[data-option-card="pc-cfg-1-0"]').tap();
await pp.locator('[data-rx-designer-notice]').waitFor({ timeout: 5000 }).catch(() => {});
check('black only (1/0) chosen after the design: it is taken off, and he is told the PRINT changed (not the size)',
  /changed how it is printed/.test(await pp.locator('[data-rx-designer-notice]').innerText().catch(() => '')) &&
  (await pp.locator('[data-rx-designer-file]').count()) === 0 && (await addToCart(pp).isDisabled()),
  await pp.locator('[data-rx-designer-notice]').innerText().catch(() => ''));
// Full colour again, the design put back from his draft — then a back page added
// (4/0 → 4/4): the same size and cut, so it is the PRINT that changed. It was told
// "you changed the size or the shape" (code review 2026-10-11, H).
await pp.locator('[data-option-card="pc-cfg-4-0"]').tap();
await pp.locator('[data-rx-designer-open]').tap();
await pp.locator('[data-rx-gal-continue]').waitFor({ timeout: 20000 }).catch(() => {});
if ((await pp.locator('[data-rx-gal-continue]').count()) > 0) await pp.locator('[data-rx-gal-continue]').tap();
await pp.locator('[data-rx-designer-panel]').first().waitFor({ timeout: 20000 });
await pp.locator('[data-rx-designer-use]').tap();
await pp.locator('[data-rx-proof-tick]').check({ timeout: 30000 });
await pp.getByRole('button', { name: 'Attach the design' }).tap();
await pp.locator('[data-rx-designer-step]').getByText('Ready for print').waitFor({ timeout: 30000 }).catch(() => {});
const reattached = (await pp.locator('[data-rx-designer-file]').count()) === 1;
await pp.locator('[data-option-card="pc-cfg-4-4"]').tap();
await pp.locator('[data-rx-designer-notice]').waitFor({ timeout: 5000 }).catch(() => {});
const sidesNotice = await pp.locator('[data-rx-designer-notice]').innerText().catch(() => '');
check('a back page added after the design (4/0 → 4/4): taken off, and he is told the PRINT changed — not "the size or the shape"',
  reattached && /changed how it is printed/.test(sidesNotice) && !/size or the shape/.test(sidesNotice) &&
    (await pp.locator('[data-rx-designer-file]').count()) === 0,
  `${reattached ? 're-attached' : 'NOT re-attached'} · ${sidesNotice}`);

// ---- signing out on a shared computer (code review 2026-10-11, M / designer #5) ----
// The designs kept on the device already went with the person (DSN-04); the half-typed
// checkout stayed for a day, and the open tab kept a design in memory for the next one.
{
  const shared = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const sp = await shared.newPage();
  sp.on('pageerror', (e) => errors.push(String(e?.message ?? e)));
  await loginAdmin(sp);
  await sp.goto(`${BASE}/products`, { waitUntil: 'domcontentloaded' });
  await sp.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {});
  await sp.evaluate(() => {
    window.rxLeftInMemory = 'a design';
    localStorage.setItem('reklamx_checkout_form', JSON.stringify({ firstName: 'Anna', phone: '070-123 45 67', savedAt: new Date().toISOString() }));
  });
  await sp.locator('[data-rx-account-menu]').click();
  await sp.getByRole('button', { name: 'Sign Out' }).click();
  // A full load of the home page — the address changes from /products only by it.
  await sp.waitForURL(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  const left = await sp.evaluate(() => ({
    memory: window.rxLeftInMemory ?? null,
    draft: localStorage.getItem('reklamx_checkout_form'),
    path: location.pathname,
  })).catch((err) => ({ error: String(err) }));
  check('signing out: the half-typed checkout goes too, and the tab starts afresh on the home page — nothing of his left in memory',
    left.memory === null && left.draft === null && left.path === '/', JSON.stringify(left));
  await shared.close();
}

await cleanup();
// The emulator answers a deleted file's preview request with 404; the browser logs it.
const real = errors.filter((e) => !/status of 404/.test(e));
check('no page errors', real.length === 0, real.slice(0, 4).join(' | '));
await browser.close();
process.exit(summary() ? 1 : 0);
