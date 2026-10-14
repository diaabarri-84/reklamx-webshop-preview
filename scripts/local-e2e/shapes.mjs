// Round 16, item 4 — "customise the shape of the design: round, oval, custom …;
// he controls everything".
//
//   the owner: on one product, shows the Shape question as picture cards,
//   hides Star, hides the pre-selected answer of a question INSIDE Round (the
//   default moves with it), sets an outline and puts it back to "Automatic";
//   it saves.
//   a customer: fifteen drawn shapes, no Star; Round clips the preview to a
//   circle with a dashed cut line, every outline lies inside the frame, a round
//   cut on a rectangular size says so, the custom contour says what to put in
//   the file.
//   the order: the job sheet says "Cut: Round (circle)" beside the item.
//   the cut note shows under the shape question even on a product without the
//   upload box.
//   a basket filled before Star was hidden: refused BY NAME, in Swedish, in the
//   basket drawer and at the checkout — not silently stripped of its shape.
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch, loginAdmin, BASE, SHOTS, db, check, summary } from './lib.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'reklamx-shapes-e2e-'));
await build({ entryPoints: [join(ROOT, 'src/components/Admin/optionCatalogue.ts')], outfile: join(tmp, 'c.mjs'), bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const { OPTION_CATALOGUE } = await import(pathToFileURL(join(tmp, 'c.mjs')).href);
rmSync(tmp, { recursive: true, force: true });

const ID = 'prod-shape-e2e';
const NOART = 'prod-shape-noart';
const NAME = 'Shape test stickers';
const EMAIL = `shape-${Date.now()}@emulator.test`;
const src = (await db.collection('products').doc('prod-pmp-696').get()).data();
const shapeField = OPTION_CATALOGUE.find((f) => f.id === 'product_shape');
const sizeField = {
  id: 'shape_e2e_size', name: 'Size', group: 'default', enabled: true,
  options: [
    { id: 'se50', label: '50 × 50 mm', value: '50x50', priceModifier: 0, isDefault: true, dimensions: '50 × 50 mm' },
    { id: 'se80', label: '80 × 50 mm', value: '80x50', priceModifier: 0.2, dimensions: '80 × 50 mm' },
  ],
};
// A question INSIDE Round, its first answer pre-selected — the case where a hide
// and the default's move used to be two writes and only the second survived.
const roundSizes = { id: 'round_diameter', name: 'Diameter', group: 'default', enabled: true, options: [
  { id: 'rd-30', label: '30 mm', value: '30', priceModifier: 0, isDefault: true },
  { id: 'rd-50', label: '50 mm', value: '50', priceModifier: 0 },
] };
const shapeWithNested = { ...shapeField, enabled: true, options: shapeField.options.map((o) => (o.id === 'cs-shape-round' ? { ...o, subFields: [roundSizes] } : o)) };
const cleanup = async () => {
  await db.collection('products').doc(ID).delete().catch(() => {});
  await db.collection('products').doc(NOART).delete().catch(() => {});
  for (const d of (await db.collection('orders').where('customerEmail', '==', EMAIL.toLowerCase()).get()).docs) await d.ref.delete();
};
process.on('uncaughtException', async (err) => { console.error(err); await cleanup().catch(() => {}); process.exit(1); });
await db.collection('products').doc(ID).set({
  ...src, id: ID, name: NAME, nameI18n: { sv: 'Formklistermärken test' }, slug: 'shape-test-stickers', sku: 'SHAPE-E2E', isHidden: false,
  artworkEnabled: true, artworkRequired: false, printingFields: [sizeField, shapeWithNested],
});
await db.collection('products').doc(NOART).set({
  ...src, id: NOART, name: 'Shape test no upload', nameI18n: null, slug: 'shape-test-no-upload', sku: null, isHidden: false,
  artworkEnabled: false, artworkRequired: false, printingFields: [sizeField, { ...shapeField, enabled: true, display: 'cards' }],
});

const { browser, page, errors } = await launch();

// ---- the owner ----
await loginAdmin(page);
await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {});
await page.getByRole('button', { name: 'Products Admin' }).click();
await page.getByText(NAME, { exact: true }).first().waitFor({ timeout: 20000 });
await page.locator(`xpath=//*[normalize-space()=${JSON.stringify(NAME)}]/ancestor::div[.//button[normalize-space()='Edit']][1]//button[normalize-space()='Edit']`).first().click();
await page.getByRole('button', { name: 'Save Product' }).waitFor({ timeout: 15000 });
await page.locator(`xpath=//span[normalize-space()='Shape']/ancestor::button[@aria-expanded][1]`).first().click();
check('the catalogue\'s own Shape question starts ticked as the cut shape', await page.locator('input[data-field-cut-shape="product_shape"]').isChecked());
await page.locator('select[data-field-display="product_shape"]').selectOption('cards');
await page.locator('input[data-option-hidden="cs-shape-star"]').check();
await page.locator('input[data-option-hidden="rd-30"]').check();
const autoLabel = await page.locator('select[data-option-outline="cs-shape-round"] option[value=""]').innerText();
check('the editor says what "Automatic" means for Round', /Circle/.test(autoLabel), autoLabel);
// Heart, then back to Automatic: that writes `outline: undefined`, which
// Firestore refuses — the save must strip it, not fail.
await page.locator('select[data-option-outline="cs-shape-round"]').selectOption('heart');
await page.locator('select[data-option-outline="cs-shape-round"]').selectOption('');
await page.screenshot({ path: `${SHOTS}/98-shape-editor.png` });
await page.getByRole('button', { name: 'Save Product' }).click();
let savedShape = null;
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(250);
  savedShape = ((await db.collection('products').doc(ID).get()).data()?.printingFields ?? []).find((f) => f.id === 'product_shape');
  if (savedShape?.display === 'cards') break;
}
const savedRound = savedShape?.options.find((o) => o.id === 'cs-shape-round');
check('saved: picture cards, Star hidden on THIS product — and the outline put back to "Automatic" (undefined) was stripped, not refused',
  savedShape?.display === 'cards' && savedShape?.options.find((o) => o.id === 'cs-shape-star')?.hidden === true &&
  savedShape?.options.find((o) => o.id === 'cs-shape-star')?.hiddenOnProduct === true && savedRound && !('outline' in savedRound),
  JSON.stringify({ display: savedShape?.display, star: savedShape?.options.find((o) => o.id === 'cs-shape-star'), roundOutline: savedRound?.outline }));
const savedSizes = savedRound?.subFields?.[0]?.options ?? [];
check('the pre-selected answer of the question inside Round, hidden: hidden AND the default moved to the next one (it used to keep only one of the two)',
  savedSizes.find((o) => o.id === 'rd-30')?.hidden === true && savedSizes.find((o) => o.id === 'rd-30')?.isDefault !== true && savedSizes.find((o) => o.id === 'rd-50')?.isDefault === true,
  JSON.stringify(savedSizes.map((o) => [o.id, o.hidden, o.isDefault])));

// ---- a customer ----
const shop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const cp = await shop.newPage();
cp.on('pageerror', (e) => errors.push(String(e?.message ?? e)));
await cp.goto(`${BASE}/products/shape-test-stickers`, { waitUntil: 'domcontentloaded' });
await cp.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {});
await cp.locator('[data-option-card="cs-shape-round"]').waitFor({ timeout: 20000 });
const tiles = await cp.locator('[data-rx-outline-tile]').count();
check('fifteen shapes, each drawn — Star hidden', tiles === 15 && (await cp.locator('[data-option-card="cs-shape-star"]').count()) === 0, `${tiles} tiles`);
// Drawn in its square card an oval was a circle and a rectangle a square.
const aspect = async (id) => cp.locator(`[data-option-card="${id}"] [data-rx-outline-tile] path`).evaluate((p) => { const b = p.getBBox(); return b.width / b.height; });
const ratios = Object.fromEntries(await Promise.all(['cs-shape-round', 'cs-shape-square', 'cs-shape-oval', 'cs-shape-straight-oval', 'cs-shape-rect'].map(async (id) => [id.slice(9), Math.round((await aspect(id)) * 100) / 100])));
check('Oval, Capsule and Rectangle are drawn wider than tall; Round and Square are not',
  ratios.round === 1 && ratios.square === 1 && ratios.oval > 1.3 && ratios['straight-oval'] > 1.3 && ratios.rect > 1.3, JSON.stringify(ratios));
await cp.locator('[data-option-card="cs-shape-round"]').click();
await cp.waitForTimeout(400);
const clip = await cp.locator('[data-rx-cut-clip="circle"]').evaluate((el) => getComputedStyle(el).clipPath).catch(() => '');
check('Round: the preview is clipped to a circle', /path\(/.test(clip), clip.slice(0, 60));
check('…with the cut line drawn over it', (await cp.locator('[data-rx-cut-outline="circle"]').count()) === 1);
await cp.screenshot({ path: `${SHOTS}/99-shape-round.png` });

// Every outline, drawn by the browser itself, lies inside the frame.
const outside = [];
for (const id of shapeField.options.map((o) => o.id).filter((id) => id !== 'cs-shape-star' && id !== 'cs-shape-rect')) {
  await cp.locator(`[data-option-card="${id}"]`).click();
  await cp.waitForTimeout(120);
  const box = await cp.locator('[data-rx-cut-outline] path').evaluate((p) => {
    const b = p.getBBox();
    const svg = p.ownerSVGElement;
    return { x: b.x, y: b.y, w: b.width, h: b.height, W: svg.width.baseVal.value, H: svg.height.baseVal.value };
  }).catch(() => null);
  if (!box || box.w < 5 || box.h < 5 || box.x < -1 || box.y < -1 || box.x + box.w > box.W + 1 || box.y + box.h > box.H + 1) outside.push(`${id} ${JSON.stringify(box)}`);
}
check('all fourteen other outlines lie inside the frame', outside.length === 0, outside.join(' | '));
await cp.locator('[data-option-card="cs-shape-custom"]').click();
check('the custom contour says what to put in the file, under the shape question', (await cp.locator('[data-rx-field="product_shape"] [data-rx-cut-note="ppCustomOutlineNote"]').count()) === 1);
await cp.locator('[data-option-card="cs-shape-round"]').click();
check('inside Round: the hidden 30 mm is not offered, the 50 mm is pre-selected',
  (await cp.locator('[data-option-card="rd-30"]').count()) === 0 && (await cp.locator('[data-option-card="rd-50"][aria-pressed="true"]').count()) === 1);
await cp.locator('[data-option-card="se80"]').click();
check('a round cut on 80 × 50 mm says it uses the largest square', (await cp.locator('[data-rx-cut-note="ppShapeNotSquare"]').count()) === 1);
await cp.locator('[data-option-card="se50"]').click();
// A product WITHOUT the upload box: the cut note is about the file all the
// same, and the preview it used to live in is not there.
const np = await shop.newPage();
await np.goto(`${BASE}/products/shape-test-no-upload`, { waitUntil: 'domcontentloaded' });
await np.locator('[data-option-card="cs-shape-custom"]').click({ timeout: 20000 });
check('no upload box on the product: the custom contour note shows all the same',
  (await np.locator('[data-rx-cut-note="ppCustomOutlineNote"]').count()) === 1 && (await np.locator('[data-rx-block="artwork"]').count()) === 0);
await np.close();

// ---- the order ----
await cp.getByRole('button', { name: /Add to cart/i }).first().click();
await cp.waitForTimeout(800);
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
let payBody = null;
await cp.route('**/api/checkout/pay', async (route) => {
  payBody = route.request().postDataJSON();
  const r = await fetch(`${BASE}/api/checkout/order`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signIn.idToken}` }, body: JSON.stringify(payBody),
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
check('the order line records its cut shape', JSON.stringify(order?.items?.[0]?.shapes) === JSON.stringify([{ outline: 'circle', label: 'Round (circle)' }]), JSON.stringify(order?.items?.[0]?.shapes));

await page.getByRole('button', { name: 'Orders', exact: true }).first().click();
await page.locator(`[data-order-row="${order?.id}"]`).click({ timeout: 20000 });
await page.getByRole('dialog', { name: new RegExp(`Order ${order?.id}`) }).getByRole('button', { name: /Job sheet/ }).click();
const cut = page.locator('.rx-print-sheet [data-rx-cut="circle"]');
await cut.waitFor({ timeout: 10000 }).catch(() => {});
check('the job sheet shows "Cut: Round (circle)" with its outline, beside the item', /Cut: Round \(circle\)/.test(await cut.innerText().catch(() => '')));
await page.screenshot({ path: `${SHOTS}/100-jobsheet-cut.png` });

// ---- a basket filled before Star was hidden ----
const stale = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const sp = await stale.newPage();
await sp.addInitScript(() => { try { localStorage.setItem('reklamx_language', 'sv'); } catch {} });
await sp.addInitScript(([id, name]) => {
  if (!sessionStorage.getItem('rx-stale-seeded')) {
    localStorage.setItem('reklamx_cart', JSON.stringify([{ id: `prod-${id}-1`, productId: id, productName: name, quantity: 10, unitPrice: 2, totalPrice: 20,
      selectedOptions: { shape_e2e_size: '50 × 50 mm', product_shape: 'Star' }, selectedOptionIds: ['se50', 'cs-shape-star'] }]));
    sessionStorage.setItem('rx-stale-seeded', '1');
  }
}, [ID, NAME]);
await sp.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await sp.getByRole('button', { name: /Got it|Jag förstår|OK/ }).first().click({ timeout: 3000 }).catch(() => {});
await sp.locator('button[title="Varukorg"]:visible').first().click({ timeout: 15000 });
const drawerSays = await sp.locator('[data-rx-cart-unavailable]').innerText({ timeout: 15000 }).catch(() => '');
check('the basket drawer says it straight away, in Swedish, with his Swedish names (”Stjärna”, Formklistermärken test)',
  /Stjärna/.test(drawerSays) && /Formklistermärken test/.test(drawerSays) && /erbjuds inte längre/.test(drawerSays), drawerSays);
await sp.goto(`${BASE}/checkout`, { waitUntil: 'domcontentloaded' });
const named = await sp.getByText(/Stjärna.{0,3} erbjuds inte längre för Formklistermärken test/).first().waitFor({ timeout: 15000 }).then(() => true, () => false);
check('…and the checkout: refused by name, in the shopper\'s language', named);
const direct = await fetch(`${BASE}/api/checkout/quote`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ items: [{ productId: ID, quantity: 10, kind: 'configured', optionIds: ['se50', 'cs-shape-star'] }] }) });
const directBody = await direct.json().catch(() => null);
check('…and by the server: 409 option_unavailable, naming Star', direct.status === 409 && directBody?.code === 'option_unavailable' && directBody?.detail?.optionLabel === 'Star', `${direct.status} ${directBody?.code}`);
await stale.close();

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
await cleanup();
process.exit(summary() ? 1 : 0);
