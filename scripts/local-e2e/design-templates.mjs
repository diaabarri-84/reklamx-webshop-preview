// Round 16, item 5b — the owner's design templates, from the dashboard to the print file.
//
//   the owner: "Design templates" in the dashboard. A name before the work, a
//   size the designer can make, a round cut kept square, "Shows on" naming the
//   library's sizes; the designer in HIS mode, where each element gets what a
//   customer may do with it (change it, only its words, nothing). Saved: the
//   picture in Storage, then the document; saved again, the picture is reused
//   and the old small picture is deleted. A new size cannot be saved over a
//   design laid out at the old one.
//   a customer (designer v2): on a product in a SUB-category of the category it
//   was put on, at the size it fits, the GALLERY offers the template first,
//   before the shop's own designs; chosen, the STUDIO opens on it. The locked
//   text and picture cannot be picked up (a tap says so), the words-only text
//   takes new words typed on the board and does not move, the background is the
//   shop's. The print file has the picture and both texts; the basket line, the
//   order and the job sheet name the template.
//   not offered: at another size (an admin is told why; his own draft from it
//   is not offered back, and he is told why), in another category, while
//   hidden. A product whose category is written by NAME still finds it. The
//   shop's own designs switched off: only the templates, and a blank page where
//   none fits.
//   the list: a copy starts hidden and shares the files; dragging reorders;
//   deleting keeps the files another template still uses, and removes the rest.
//   hidden in another window while this one has it open: saving the design here
//   keeps it hidden (code review DSN-09).
import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch, loginAdmin, dragTo, BASE, SHOTS, db, check, summary } from './lib.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'reklamx-templates-e2e-'));
writeFileSync(join(tmp, 'e.ts'), `export { OPTION_CATALOGUE } from ${JSON.stringify(join(ROOT, 'src/components/Admin/optionCatalogue.ts'))};`);
await build({ entryPoints: [join(tmp, 'e.ts')], outfile: join(tmp, 'e.mjs'), bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const { OPTION_CATALOGUE } = await import(pathToFileURL(join(tmp, 'e.mjs')).href);
rmSync(tmp, { recursive: true, force: true });

const CAT = 'tplcat-e2e';
const SUB = 'tplcat-e2e-sub';
const OTHER = 'tplcat-e2e-other';
const SUB_NAME = 'Template test sub (e2e)';
const P1 = 'prod-tpl-e2e';
const P2 = 'prod-tpl-other';
const P3 = 'prod-tpl-byname';
const EMAIL = `templates-${Date.now()}@emulator.test`;
const NAME = 'Classic card';
// The 85 × 55 card's board is 91 × 61 mm with its bleed. "Headline and text"
// puts the headline's middle 24.6 mm down and the second line's 41.8 mm down
// (src/lib/designTemplates.ts: a 3 mm safe margin, bands at 18 % and 62 %).
const HEADLINE = [0.5, 24.62 / 61];
const SUBLINE = [0.5, 41.77 / 61];
// Between the two text boxes, inside the picture (centred, 49.5 × 33 mm).
const PICTURE = [0.3, 34.8 / 61];
const YELLOW = [253, 230, 138];

const signIn = await (await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@emulator.test', password: 'emulator-admin-1', returnSecureToken: true }),
})).json();
const asAdmin = { Authorization: `Bearer ${signIn.idToken}` };

const src = (await db.collection('products').doc('prod-pmp-696').get()).data();
const sizes = {
  id: 'tpl_e2e_size', name: 'Size', group: 'default', enabled: true,
  options: [
    { id: 'tpl85', label: '85 × 55 mm', value: '85x55', priceModifier: 0, isDefault: true, dimensions: '85 × 55 mm' },
    { id: 'tpl50', label: '50 × 50 mm', value: '50x50', priceModifier: 0, dimensions: '50 × 50 mm' },
  ],
};
const base = {
  ...src, isHidden: false, artworkEnabled: true, artworkRequired: false, relatedProductIds: [], sku: null, nameI18n: null,
  customUploadRules: { ...(src.customUploadRules ?? {}), areaPriced: false },
  printingFields: [sizes, { ...OPTION_CATALOGUE.find((f) => f.id === 'artwork_supply_method'), enabled: true }],
};
for (const key of ['onlineDesign', 'pageOrder', 'quantityAfterFieldId']) delete base[key];

const settingsRef = db.collection('settings').doc('siteConfig');
const cleanup = async () => {
  for (const id of [P1, P2, P3]) await db.collection('products').doc(id).delete().catch(() => {});
  for (const id of [CAT, SUB, OTHER]) await db.collection('categories').doc(id).delete().catch(() => {});
  for (const d of (await db.collection('designTemplates').get()).docs) await d.ref.delete();
  for (const d of (await db.collection('orders').where('customerEmail', '==', EMAIL.toLowerCase()).get()).docs) await d.ref.delete();
  // His order and hidden designs too: a run that arranged them must not hand the
  // next run an order from templates that no longer exist.
  await settingsRef.set({ designerBasicLayouts: true, designTemplateOrder: null, designTemplateHidden: null }, { merge: true });
  await fetch(`${BASE}/api/admin/design-templates/invalidate`, { method: 'POST', headers: asAdmin }).catch(() => {});
  await fetch(`${BASE}/api/admin/cache/invalidate`, { method: 'POST', headers: asAdmin }).catch(() => {});
};
process.on('uncaughtException', async (err) => { console.error(err); await cleanup().catch(() => {}); process.exit(1); });
// Whatever an earlier, interrupted run left.
await cleanup();

await db.collection('categories').doc(CAT).set({ name: 'Template test cards (e2e)', description: '', sortOrder: 990 });
await db.collection('categories').doc(SUB).set({ name: SUB_NAME, description: '', sortOrder: 10, parentId: CAT });
await db.collection('categories').doc(OTHER).set({ name: 'Template test other (e2e)', description: '', sortOrder: 991 });
await db.collection('products').doc(P1).set({ ...base, id: P1, name: 'Template test cards', slug: 'template-test-cards', categoryId: SUB });
await db.collection('products').doc(P2).set({ ...base, id: P2, name: 'Template test other', slug: 'template-test-other', categoryId: OTHER });
await db.collection('products').doc(P3).set({ ...base, id: P3, name: 'Template test by name', slug: 'template-test-by-name', categoryId: SUB_NAME });
// What the dashboard does after a change: the shop's copies are dropped, and
// the categories read again (the templates endpoint walks that copy, never Firestore).
await fetch(`${BASE}/api/admin/cache/invalidate`, { method: 'POST', headers: asAdmin });
await fetch(`${BASE}/api/categories`);

const picture = (p, w, h, colour) => p.evaluate(({ w, h, colour }) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, w, h);
  return c.toDataURL('image/png').split(',')[1];
}, { w, h, colour }).then((b64) => Buffer.from(b64, 'base64'));
/** Colours at points, and dark pixels along rows, of an image file. */
const probe = (p, buf, mime, points, rows) => p.evaluate(async ({ b64, mime, points, rows }) => {
  const bmp = await createImageBitmap(await (await fetch(`data:${mime};base64,${b64}`)).blob());
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  const at = points.map(([fx, fy]) => Array.from(ctx.getImageData(Math.round(fx * bmp.width), Math.round(fy * bmp.height), 1, 1).data.slice(0, 3)));
  const dark = rows.map((fy) => {
    const { data } = ctx.getImageData(0, Math.round(fy * bmp.height), bmp.width, 1);
    let n = 0;
    for (let x = 0; x < bmp.width; x += 1) if (data[x * 4] < 80 && data[x * 4 + 1] < 80 && data[x * 4 + 2] < 80) n += 1;
    return n;
  });
  c.width = 0;
  return { at, dark };
}, { b64: buf.toString('base64'), mime, points, rows });
const near = (rgb, want, tol = 14) => rgb.every((v, i) => Math.abs(v - want[i]) <= tol);
/** Dark pixels inside each rectangle [x0, y0, x1, y1] (fractions of the file). */
const darkIn = (p, buf, mime, rects) => p.evaluate(async ({ b64, mime, rects }) => {
  const bmp = await createImageBitmap(await (await fetch(`data:${mime};base64,${b64}`)).blob());
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  const out = rects.map(([x0, y0, x1, y1]) => {
    const X = Math.round(x0 * bmp.width);
    const Y = Math.round(y0 * bmp.height);
    const w = Math.max(1, Math.round((x1 - x0) * bmp.width));
    const h = Math.max(1, Math.round((y1 - y0) * bmp.height));
    const { data } = ctx.getImageData(X, Y, w, h);
    let n = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] < 80 && data[i + 1] < 80 && data[i + 2] < 80) n += 1;
    return n;
  });
  c.width = 0;
  return out;
}, { b64: buf.toString('base64'), mime, rects });
const tap = async (p, [fx, fy]) => {
  const b = await p.locator('[data-rx-designer-board]').boundingBox();
  await p.mouse.click(b.x + b.width * fx, b.y + b.height * fy);
  await p.waitForTimeout(250);
};
const poll = async (read, ok, tries = 60) => {
  let v;
  for (let i = 0; i < tries; i++) {
    v = await read();
    if (ok(v)) return v;
    await new Promise((r) => setTimeout(r, 250));
  }
  return v;
};
const templates = async () => (await db.collection('designTemplates').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
const status = async (url) => (await fetch(url)).status;
const BUCKET = 'http://127.0.0.1:9199/v0/b/demo-reklamx.appspot.com/o';
// Is the file still in the bucket — as the emulator's owner sees it (no rules for
// "owner"). Not its address's status: the emulator answers a deleted file's
// address with 403, the same as a refused one.
const stored = async (path) => (await fetch(`${BUCKET}/${encodeURIComponent(path)}`, { headers: { Authorization: 'Bearer owner' } })).status === 200;

const { browser, context, page, errors } = await launch();
page.on('dialog', (d) => void d.accept());
// The order's file address is real Storage's (see the checkout below); the job
// sheet would fetch it from Google. Answered from the emulator instead: nothing
// leaves this machine.
await context.route('https://firebasestorage.googleapis.com/**', async (route) => {
  const r = await fetch(route.request().url().replace('https://firebasestorage.googleapis.com/', 'http://127.0.0.1:9199/'));
  await route.fulfill({ status: r.status, contentType: r.headers.get('content-type') ?? undefined, body: Buffer.from(await r.arrayBuffer()) });
});

// ---- the owner ----
await loginAdmin(page);
const openTab = async () => {
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {});
  await page.getByRole('button', { name: 'Design templates', exact: true }).click();
  await page.locator('[data-rx-design-templates]').waitFor({ timeout: 20000 });
};
await openTab();
check('the dashboard has a "Design templates" screen, empty to begin with', /No templates yet/.test(await page.locator('[data-rx-design-templates]').innerText()));
check('…and the basic layouts are offered too, by default', await page.locator('[data-rx-basic-layouts-setting] input').isChecked());

await page.getByRole('button', { name: 'New template' }).click();
const form = page.locator('[data-rx-template-form]');
await form.waitFor({ timeout: 10000 });
await form.locator('[data-rx-template-open-designer]').click();
check('no designer before the template has a name', /Give the template a name first/.test(await form.getByRole('alert').innerText().catch(() => '')));
await form.locator('#tpl-name').fill(NAME);
await form.locator('#tpl-w').fill('900');
await form.locator('#tpl-h').fill('1300');
check('a size the online designer cannot make is said at once', /Too large for the online designer/.test(await form.innerText()));
await form.locator('#tpl-cut').selectOption('circle');
await form.locator('#tpl-w').fill('60');
check('a round cut is cut in a square: the height follows the width and cannot be typed',
  (await form.locator('#tpl-h').inputValue()) === '60' && (await form.locator('#tpl-h').isDisabled()));
await form.locator('#tpl-cut').selectOption('');
await form.locator('#tpl-w').fill('85');
await form.locator('#tpl-h').fill('55');
const showsOn = await form.locator('[data-rx-shows-on]').innerText();
check('"Shows on" names the library\'s sizes it fits — 85 × 55 mm among them, and not 55 × 85 mm', /85 × 55 mm/.test(showsOn) && !/55 × 85 mm/.test(showsOn), showsOn.slice(0, 240));
await form.locator('label', { hasText: 'Some categories' }).click();
await form.locator(`[data-rx-scope-category="${CAT}"]`).check();
check('the category list shows the sub-category under its parent', /└ Template test sub \(e2e\)/.test(await form.innerText()));
await form.locator('label', { hasText: 'Customers may change the background colour' }).locator('input').uncheck();
await page.screenshot({ path: `${SHOTS}/119-template-form.png` });

await form.locator('[data-rx-template-open-designer]').click();
await page.locator('[data-rx-designer]').waitFor({ timeout: 20000 });
await page.locator('[data-rx-layouts]').waitFor({ timeout: 20000 });
check('the owner\'s designer starts on the basic layouts, with no "ready-made designs" of its own',
  (await page.locator('[data-rx-layout]').count()) === 4 && (await page.locator('[data-rx-shop-templates]').count()) === 0);
await page.locator('[data-rx-layout="headline"]').click();
await page.locator('[data-rx-designer-panel]').waitFor({ timeout: 10000 });
const otext = page.locator('[data-rx-designer-text]');
await tap(page, HEADLINE);
check('he selects the headline, and is asked what a customer may do with it', (await otext.inputValue().catch(() => '')) === 'Your headline' && (await page.locator('[data-rx-lock-control]').count()) === 1);
await otext.fill('ReklamX AB');
await page.locator('[data-rx-lock="locked"]').check();
await tap(page, SUBLINE);
check('the second line: "Only the words" is offered for a text', (await otext.inputValue().catch(() => '')) === 'Add your text here' && (await page.locator('[data-rx-lock="words"]').count()) === 1);
await otext.fill('Your name here');
await page.locator('[data-rx-lock="words"]').check();
await page.locator('[data-rx-photo-input]').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: await picture(page, 600, 400, `rgb(${YELLOW.join(',')})`) });
// Placed, and selected: the panel now speaks of a picture.
await page.locator('[data-rx-photo-quality]').waitFor({ timeout: 10000 });
check('a picture: "Locked" or free, never "Only the words"', (await page.locator('[data-rx-lock="words"]').count()) === 0);
await page.locator('[data-rx-lock="locked"]').check();
for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Backward' }).click();
await page.screenshot({ path: `${SHOTS}/120-template-owner.png` });
await page.locator('[data-rx-template-save]').click();
await page.locator('[data-rx-designer]').waitFor({ state: 'detached', timeout: 60000 });

let [tpl] = await poll(templates, (l) => l.length === 1);
const locks = (json) => JSON.parse(json ?? '{"objects":[]}').objects.map((o) => o.rxLock ?? 'free').sort().join(',');
const firstImages = Object.values(tpl?.images ?? {});
check('saved: the document holds the design, the cut, the scope and the background lock',
  tpl?.name === NAME && tpl.trimMm?.wMm === 85 && tpl.trimMm?.hMm === 55 && tpl.outline === null && tpl.hidden === false &&
  JSON.stringify(tpl.scope) === JSON.stringify({ kind: 'categories', ids: [CAT] }) && tpl.lockBackground === true,
  JSON.stringify({ ...tpl, json: undefined }).slice(0, 400));
check('…each element with its lock: the headline and the picture locked, the second line its words only',
  locks(tpl?.json) === 'locked,locked,words', locks(tpl?.json));
check('…its picture stored in Storage, in his templates folder, and readable at its address',
  firstImages.length === 1 && /^uploads\/[^/]+\/design-templates\//.test(firstImages[0].path) && (await status(firstImages[0].url)) === 200,
  JSON.stringify(firstImages));
const thumb1 = tpl?.thumbnailUrl ? Buffer.from(await (await fetch(tpl.thumbnailUrl)).arrayBuffer()) : Buffer.alloc(0);
check('…a small picture of it for the lists (a PNG), and how sharp its picture prints (about 300 DPI)',
  thumb1.subarray(1, 4).toString() === 'PNG' && tpl.lowestPictureDpi > 250 && tpl.lowestPictureDpi < 350, String(tpl?.lowestPictureDpi));
check('the form stays open on the saved template, now with "Save settings"', (await form.locator('[data-rx-template-save-settings]').count()) === 1);

// A new size over the design laid out at the old one: refused.
await form.locator('#tpl-w').fill('90');
await form.locator('[data-rx-template-save-settings]').click();
check('a new size cannot be saved over the old layout: open the designer to fit it',
  /You changed the size or the cut/.test(await form.getByRole('alert').innerText().catch(() => '')));
await form.locator('#tpl-w').fill('85');

// Opened again: it comes back as saved, and a second save reuses the picture.
await form.locator('[data-rx-template-open-designer]').click();
await page.locator('[data-rx-designer-panel]').waitFor({ timeout: 20000 });
check('opened again, it is the saved design — no layout chooser', (await page.locator('[data-rx-layouts]').count()) === 0);
await tap(page, HEADLINE);
check('…its headline still says "ReklamX AB", still locked', (await otext.inputValue().catch(() => '')) === 'ReklamX AB' && (await page.locator('[data-rx-lock="locked"]').isChecked()));
// Hidden from another window while this one has it open: the design saved here wrote
// the whole document from this form, and put it back on show.
await db.collection('designTemplates').doc(tpl.id).update({ hidden: true });
await page.locator('[data-rx-template-save]').click();
await page.locator('[data-rx-designer]').waitFor({ state: 'detached', timeout: 60000 });
const tplAgain = (await poll(templates, (l) => l[0]?.thumbnailUrl && l[0].thumbnailUrl !== tpl.thumbnailUrl))[0];
check('saved again: the picture is reused, not uploaded twice', JSON.stringify(Object.values(tplAgain?.images ?? {})) === JSON.stringify(firstImages));
check('…and the old small picture is deleted from Storage', (await poll(() => stored(tpl.thumbnailPath), (v) => v === false, 20)) === false);
check('…hidden in another window meanwhile, it STAYS hidden — and keeps where it is offered', tplAgain?.hidden === true &&
  JSON.stringify(tplAgain?.scope) === JSON.stringify({ kind: 'categories', ids: [CAT] }), JSON.stringify({ hidden: tplAgain?.hidden, scope: tplAgain?.scope }));
// Shown again for the customer below — and the shop told, as the dashboard would.
await db.collection('designTemplates').doc(tpl.id).update({ hidden: false });
await fetch(`${BASE}/api/admin/design-templates/invalidate`, { method: 'POST', headers: asAdmin });
tpl = { ...tplAgain, hidden: false };
await form.getByRole('button', { name: 'Close', exact: true }).click();
const row = page.locator(`[data-rx-template-row="${tpl.id}"]`);
await page.screenshot({ path: `${SHOTS}/125-templates-list.png` });
check('the list shows it with its picture, size, cut and where it is offered',
  /85 × 55 mm · Rectangle \(plain\) · 1 category \(with its sub-categories\)/.test(await row.innerText()) && (await row.locator('img').count()) === 1,
  await row.innerText());

// ---- a customer (designer v2: the gallery, then the studio) ----
const designCard = (p) => p.locator('[data-rx-block="artwork"] button', { hasText: 'Design online from a ready-made template' });
const openProduct = async (p, slug, sizeCard) => {
  await p.goto(`${BASE}/products/${slug}`, { waitUntil: 'domcontentloaded' });
  await p.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {});
  await p.locator('[data-rx-block="artwork"]').waitFor({ timeout: 20000 });
  if (sizeCard) await p.locator(`[data-option-card="${sizeCard}"]`).click();
  await designCard(p).click();
  await p.locator('[data-rx-designer-open]').click();
  await p.locator('[data-rx-gallery], [data-rx-studio]').first().waitFor({ timeout: 20000 });
  // Until the list has arrived the gallery says it is loading.
  await poll(() => p.getByText('Loading the ready-made designs…').count(), (n) => n === 0, 40);
  await p.waitForTimeout(300);
};
const customers = [];
// Every address refused (403, 503), so the console's bare "status of 403" can be
// told apart — and the ones this test refuses ON PURPOSE.
const refused = [];
const simulated = new Set();
const noteRefusal = (r) => { if (r.status() === 403 || r.status() === 503) refused.push(r.url()); };
context.on('response', noteRefusal);
const freshCustomer = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(String(e?.message ?? e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  ctx.on('response', noteRefusal);
  customers.push(ctx);
  return p;
};
const offeredIn = (p) => p.locator('[data-rx-gallery] [data-rx-shop-template]').evaluateAll((els) => els.map((e) => e.getAttribute('data-rx-shop-template')));
const startersIn = (p) => p.locator('[data-rx-gallery] [data-rx-gal-card^="starter-"]').count();
const studioReady = (p) => p.locator('[data-rx-st-rail]:not([disabled])').first().waitFor({ timeout: 30000 });
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
const clickAt = (p, b) => p.mouse.click(b.x + b.w / 2, b.y + b.h / 2);
const sideObjects = (p) => p.evaluate(() => JSON.parse(window.__rxStudio?.snapshotSide() ?? '{"objects":[]}').objects);
const nothingChosen = (p) => p.evaluate(() => !window.__rxStudio?.selected);
const noticeText = (p) => p.locator('[data-rx-st-notice]').innerText().catch(() => '');
const isHeadline = (o) => o.type === 'textbox' && o.rxLock === 'locked';
const isSubline = (o) => o.type === 'textbox' && o.rxLock === 'words';
const isPicture = (o) => o.type === 'image';

const cp = await freshCustomer();
await openProduct(cp, 'template-test-cards');
await cp.locator(`[data-rx-shop-template="${tpl.id}"]`).waitFor({ timeout: 15000 }).catch(() => {});
const tBox = await cp.locator(`[data-rx-shop-template="${tpl.id}"]`).boundingBox().catch(() => null);
const sBox = await cp.locator('[data-rx-gal-card^="starter-"]').first().boundingBox().catch(() => null);
check('a product in a SUB-category of the template\'s category: offered in the gallery, first, before the shop\'s own designs',
  !!tBox && !!sBox && (tBox.y < sBox.y - 1 || (Math.abs(tBox.y - sBox.y) <= 1 && tBox.x < sBox.x)), JSON.stringify({ tBox, sBox }));
check('…by its name, with its small picture', /Classic card/.test(await cp.locator(`[data-rx-shop-template="${tpl.id}"]`).innerText()) &&
  (await cp.locator(`[data-rx-shop-template="${tpl.id}"] img`).count()) === 1);
check('a customer is not shown the admin\'s list of templates left out', (await cp.locator('[data-rx-template-misses]').count()) === 0);
await cp.screenshot({ path: `${SHOTS}/121-template-chooser.png` });
await cp.locator(`[data-rx-shop-template="${tpl.id}"] button`).first().click();
await cp.locator('[data-rx-gal-choose]').click();
await studioReady(cp);
await cp.waitForTimeout(600);
await cp.locator('[data-rx-st-rail="backgrounds"]').click();
check('the background is the shop\'s: the Backgrounds panel says so — no colours, no patterns', (await cp.locator('[data-rx-st-bg-locked]').count()) === 1 && (await cp.locator('[data-rx-st-pattern]').count()) === 0);
// Another design chosen instead, then Undo: the template must come back WITH its
// rules — and the device must keep its picture through both saves.
await cp.locator('[data-rx-st-rail="designs"]').click();
await cp.locator('[data-rx-st-starter="starter-minimal"]').click();
await cp.waitForTimeout(1000);
await cp.locator('[data-rx-st-rail="backgrounds"]').click();
const ownLocked = await cp.locator('[data-rx-st-bg-locked]').count();
await cp.locator('[data-rx-st="undo"]').click();
await cp.waitForTimeout(1000);
check('another design instead, then Undo: the template is back WITH its rules (the background the shop\'s again)',
  ownLocked === 0 && (await cp.locator('[data-rx-st-bg-locked]').count()) === 1, `own design: ${ownLocked}, after undo: ${await cp.locator('[data-rx-st-bg-locked]').count()}`);
await cp.locator('[data-rx-st-rail="backgrounds"]').click();
await clickAt(cp, await objectBox(cp, isHeadline));
check('the locked headline cannot be picked up — and a tap says why', (await nothingChosen(cp)) && /fixed by the shop/.test(await noticeText(cp)));
await clickAt(cp, await objectBox(cp, isPicture));
check('nor can the locked picture: nothing is chosen', (await nothingChosen(cp)) && (await cp.locator('[data-rx-photo-quality]').count()) === 0);
await clickAt(cp, await objectBox(cp, isSubline));
await cp.waitForTimeout(300);
check('the words-only line: chosen, with its words — and nothing else: no font, no size, no copy, no delete, no lock',
  !(await nothingChosen(cp)) && (await cp.locator('[data-rx-words-only]').count()) === 1 &&
  (await cp.locator('[data-rx-st="font"]').count()) === 0 && (await cp.locator('[data-rx-designer-pt]').count()) === 0 &&
  (await cp.locator('[data-rx-st="delete"]').count()) === 0 && (await cp.locator('[data-rx-st="bar-duplicate"]').count()) === 0 &&
  (await cp.locator('[data-rx-st="bar-lock"]').count()) === 0 && (await cp.locator('[data-rx-lock-control]').count()) === 0);
const typeInto = async (box, words) => {
  await cp.mouse.dblclick(box.x + box.w / 2, box.y + box.h / 2);
  await cp.waitForTimeout(250);
  await cp.keyboard.press('Control+A');
  await cp.keyboard.type(words);
  const board = await cp.locator('[data-rx-designer-board]').boundingBox();
  await cp.mouse.click(board.x + 6, board.y + 6);
  await cp.waitForTimeout(500);
};
const subBefore = await objectBox(cp, isSubline);
await typeInto(subBefore, 'Sara Lind');
check('…its words typed on the board', (await sideObjects(cp)).some((o) => o.text === 'Sara Lind' && o.rxLock === 'words'));
{
  const b = await objectBox(cp, isSubline);
  await cp.mouse.move(b.x + b.w / 2, b.y + b.h / 2);
  await cp.mouse.down();
  await cp.mouse.move(b.x + b.w / 2, b.y + b.h / 2 + 80, { steps: 12 });
  await cp.mouse.up();
  await cp.waitForTimeout(300);
  const a = await objectBox(cp, isSubline);
  check('dragged, it does not move: still where the shop put it, with his words', Math.abs(a.y - b.y) < 1 && Math.abs(a.x - b.x) < 1, JSON.stringify({ b, a }));
}
// Far more words than the line was drawn for: shrunk into the shop's box, never let out of it.
const LONG = 'Sara Lindqvist-Andersson, Försäljningschef på ReklamX Sverige AB';
await typeInto(await objectBox(cp, isSubline), LONG);
await cp.screenshot({ path: `${SHOTS}/122-template-customer.png` });

await cp.locator('[data-rx-designer-use]').click();
await cp.locator('[data-rx-proof-tick]').check({ timeout: 60000 });
await cp.locator('[data-rx-proof-attach]').click();
await cp.locator('[data-rx-designer-step]').getByText('Ready for print').waitFor({ timeout: 60000 });
await cp.getByRole('button', { name: /Add to cart/i }).first().click();
await cp.waitForTimeout(800);
const line = (await cp.evaluate(() => JSON.parse(localStorage.getItem('reklamx_cart') || '[]')))[0];
check('the basket line names the template the design came from, by its id', line?.fileSpecs?.template === NAME && line?.fileSpecs?.templateId === tpl.id,
  JSON.stringify(line?.fileSpecs ?? null).slice(0, 240));
const file = Buffer.from(await (await fetch(line.fileSpecs.fileUrl)).arrayBuffer());
const mime = file.subarray(1, 4).toString() === 'PNG' ? 'image/png' : 'image/jpeg';
const seen = await probe(cp, file, mime, [PICTURE], [HEADLINE[1]]);
// The words' box: 6–85 mm across, 38.3–45.2 mm down the 91 × 61 mm file.
const [inBox, leftOf, rightOf, above, below] = await darkIn(cp, file, mime, [
  [6 / 91, 38.4 / 61, 85 / 91, 45.1 / 61], [0, 38.4 / 61, 5.4 / 91, 45.1 / 61], [85.6 / 91, 38.4 / 61, 1, 45.1 / 61],
  [0, 36.4 / 61, 1, 37.8 / 61], [0, 45.8 / 61, 1, 47.2 / 61]]);
check('the print file has the shop\'s picture, its locked headline and the customer\'s words',
  near(seen.at[0], YELLOW) && seen.dark[0] > 20 && inBox > 40, JSON.stringify({ seen, inBox }));
check('…his long words shrunk INTO the line\'s box: nothing beside it, above it or below it (it used to grow over the cut line)',
  leftOf === 0 && rightOf === 0 && above === 0 && below === 0, JSON.stringify({ leftOf, rightOf, above, below }));
// What production reads is the shop's name for it, never words from the browser.
await cp.evaluate(() => {
  const cart = JSON.parse(localStorage.getItem('reklamx_cart') || '[]');
  if (cart[0]?.fileSpecs) cart[0].fileSpecs.template = 'FREE PRINT, NO CHARGE';
  localStorage.setItem('reklamx_cart', JSON.stringify(cart));
});

// ---- the order, and its job sheet ----
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
await cp.route('**/api/checkout/pay', async (route) => {
  // As in studio.mjs: the emulator's Storage host put back to real Storage's,
  // the one difference from production (isOurStorageUrl, server.ts).
  const body = route.request().postData().replaceAll('http://127.0.0.1:9199/v0/b/', 'https://firebasestorage.googleapis.com/v0/b/');
  const r = await fetch(`${BASE}/api/checkout/order`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...asAdmin }, body });
  await route.fulfill({ status: r.status, contentType: 'application/json', body: await r.text() });
});
await cp.waitForTimeout(1200);
await cp.getByRole('button', { name: /^Pay/ }).last().click();
const order = await poll(async () => {
  const d = (await db.collection('orders').where('customerEmail', '==', EMAIL.toLowerCase()).get()).docs[0];
  return d ? { id: d.id, ...d.data() } : null;
}, (o) => !!o);
check('the order names the template from the shop\'s own copy — not the words the basket was given', order?.items?.[0]?.fileSpecs?.template === NAME &&
  order?.items?.[0]?.fileSpecs?.templateId === tpl.id, JSON.stringify(order?.items?.[0]?.fileSpecs ?? null).slice(0, 240));
await page.getByRole('button', { name: 'Orders', exact: true }).first().click();
await page.locator(`[data-order-row="${order?.id}"]`).click({ timeout: 20000 });
await page.getByRole('dialog', { name: new RegExp(`Order ${order?.id}`) }).getByRole('button', { name: /Job sheet/ }).click();
const sheetTemplate = page.locator('.rx-print-sheet [data-rx-file-template]');
await sheetTemplate.waitFor({ timeout: 10000 }).catch(() => {});
check('the job sheet says which template it was made from', /Template: Classic card/.test(await sheetTemplate.innerText().catch(() => '')));
await page.keyboard.press('Escape');

// ---- where it is not offered ----
const ap = await context.newPage();
await openProduct(ap, 'template-test-cards', 'tpl50');
check('50 × 50 mm, other proportions: not offered — and the admin is told why',
  (await offeredIn(ap)).length === 0 &&
  /“Classic card” — made for other proportions \(made for 85 × 55 mm\)/.test(await ap.locator('[data-rx-template-misses]').innerText().catch(() => '')),
  await ap.locator('[data-rx-template-misses]').innerText().catch(() => '(none)'));
await ap.screenshot({ path: `${SHOTS}/123-template-misses.png` });
await ap.close();

// After a reload, from the device: WITH the shop's picture, which the design
// chosen and undone above had dropped from it.
await cp.goto(`${BASE}/products/template-test-cards`, { waitUntil: 'domcontentloaded' });
await cp.locator('[data-rx-block="artwork"]').waitFor({ timeout: 20000 });
await designCard(cp).click();
await cp.locator('[data-rx-designer-open]').click();
await cp.locator('[data-rx-gal-continue]').waitFor({ timeout: 20000 }).catch(() => {});
await cp.locator('[data-rx-gal-continue]').click();
await studioReady(cp);
await cp.locator('[data-rx-restored]').waitFor({ timeout: 20000 }).catch(() => {});
const lostNote = await noticeText(cp);
const pic = await objectBox(cp, isPicture);
if (pic) await clickAt(cp, pic);
check('after a reload the device gives his design back with the shop\'s picture — nothing lost, still the shop\'s',
  (await cp.locator('[data-rx-restored]').count()) === 1 && !!pic && !/could not be opened/.test(lostNote) && /fixed by the shop/.test(await noticeText(cp)), lostNote);
await cp.goBack();

// His own design from the template, after a change of size: not offered back, and he is told why.
await cp.goto(`${BASE}/products/template-test-cards`, { waitUntil: 'domcontentloaded' });
await cp.locator('[data-rx-block="artwork"]').waitFor({ timeout: 20000 });
await cp.locator('[data-option-card="tpl50"]').click();
await designCard(cp).click();
await cp.locator('[data-rx-designer-open]').click();
await cp.locator('[data-rx-chooser-notice]').waitFor({ timeout: 20000 }).catch(() => {});
check('his design from the template, at a size it does not fit: not offered back, and told why — the shop\'s own designs to choose from',
  /made from a ready-made design for another size/.test(await cp.locator('[data-rx-chooser-notice]').innerText().catch(() => '')) &&
  (await cp.locator('[data-rx-gal-continue]').count()) === 0 && (await offeredIn(cp)).length === 0 && (await startersIn(cp)) > 0);

let p = await freshCustomer();
await openProduct(p, 'template-test-other');
check('a product in another category: not offered, the shop\'s own designs as before', (await offeredIn(p)).length === 0 && (await startersIn(p)) > 0);
p = await freshCustomer();
await openProduct(p, 'template-test-by-name');
check('a product whose category is written by its NAME: offered all the same', JSON.stringify(await offeredIn(p)) === JSON.stringify([tpl.id]));
p = await freshCustomer();
const listUrl = /\/api\/design-templates\?/;
await p.route(listUrl, (route) => {
  simulated.add(route.request().url());
  return route.fulfill({ status: 503, contentType: 'application/json', body: '{"templates":[],"unavailable":true}' });
});
await openProduct(p, 'template-test-cards');
check('the list could not be had: said so, with a way to ask again — and the shop\'s own designs to go on with, not "there are none"',
  (await p.locator('[data-rx-templates-failed]').count()) === 1 && (await p.locator('[data-rx-templates-retry]').count()) === 1 && (await startersIn(p)) > 0);
await p.unroute(listUrl);
await p.locator('[data-rx-templates-retry]').click();
await p.locator(`[data-rx-shop-template="${tpl.id}"]`).waitFor({ timeout: 15000 }).catch(() => {});
check('…asked again, the template is there', JSON.stringify(await offeredIn(p)) === JSON.stringify([tpl.id]));

await openTab();
await page.locator(`[data-rx-template-hide="${tpl.id}"]`).click();
await poll(templates, (l) => l[0]?.hidden === true);
p = await freshCustomer();
await openProduct(p, 'template-test-cards');
check('hidden: not offered', (await offeredIn(p)).length === 0 && (await startersIn(p)) > 0);
await page.locator(`[data-rx-template-hide="${tpl.id}"]`).click();
await poll(templates, (l) => l[0]?.hidden === false);

// ---- the shop's own designs switched off ----
await page.locator('[data-rx-basic-layouts-setting] input').uncheck();
await poll(async () => (await settingsRef.get()).data()?.designerBasicLayouts, (v) => v === false);
p = await freshCustomer();
await openProduct(p, 'template-test-cards');
check('the shop\'s own designs off: only his template is offered', JSON.stringify(await offeredIn(p)) === JSON.stringify([tpl.id]) && (await startersIn(p)) === 0);
await p.screenshot({ path: `${SHOTS}/124-template-only.png` });
p = await freshCustomer();
await openProduct(p, 'template-test-cards', 'tpl50');
await p.locator('[data-rx-studio]').waitFor({ timeout: 20000 }).catch(() => {});
check('…and where none fits, straight to a blank page — no empty choice',
  (await p.locator('[data-rx-gallery]').count()) === 0 && (await p.locator('[data-rx-studio]').count()) === 1);
await page.locator('[data-rx-basic-layouts-setting] input').check();
await poll(async () => (await settingsRef.get()).data()?.designerBasicLayouts, (v) => v === true);

// ---- the list: a copy, the order, deleting ----
await page.locator(`[data-rx-template-duplicate="${tpl.id}"]`).click();
const two = await poll(templates, (l) => l.length === 2);
const copy = two.find((x) => x.id !== tpl.id);
check('a copy starts HIDDEN (two of one design are never shown at once), sharing the files',
  copy?.name === `${NAME} (copy)` && copy.hidden === true && JSON.stringify(copy.images) === JSON.stringify(tpl.images) && copy.thumbnailPath === tpl.thumbnailPath &&
  copy.sortOrder > tpl.sortOrder, JSON.stringify({ name: copy?.name, hidden: copy?.hidden, so: [tpl.sortOrder, copy?.sortOrder] }));
await page.locator(`[data-rx-template-row="${copy.id}"]`).waitFor({ timeout: 10000 });
await dragTo(page, page.locator(`[aria-label="Drag \\"${NAME} (copy)\\""]`), page.locator(`[aria-label="Drag \\"${NAME}\\""]`), { offsetY: -12 });
// ONE write per drag: the order of every design, in the shop's settings (his templates'
// own sortOrder is no longer rewritten — both lists rank by this order).
const savedOrder = await poll(async () => (await settingsRef.get()).data()?.designTemplateOrder ?? [], (o) => {
  const a = o.indexOf(copy.id);
  const b = o.indexOf(tpl.id);
  return a >= 0 && b >= 0 && a < b;
});
check('dragged to the top: the new order is saved', savedOrder.indexOf(copy.id) >= 0 && savedOrder.indexOf(copy.id) < savedOrder.indexOf(tpl.id), JSON.stringify(savedOrder));
await openTab();
const rows = await page.locator('[data-rx-template-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-rx-template-row')));
check('…and kept after a reload', JSON.stringify(rows) === JSON.stringify([copy.id, tpl.id]), JSON.stringify(rows));

await page.locator(`[data-rx-template-delete="${copy.id}"]`).click();
await poll(templates, (l) => l.length === 1);
check('the copy deleted: the files the original still uses are kept',
  (await stored(firstImages[0].path)) && (await stored(tpl.thumbnailPath)));
await page.locator(`[data-rx-template-delete="${tpl.id}"]`).click();
await poll(templates, (l) => l.length === 0);
check('the last one deleted: its files go with it',
  (await poll(() => stored(firstImages[0].path), (v) => v === false, 20)) === false && (await poll(() => stored(tpl.thumbnailPath), (v) => v === false, 20)) === false);
p = await freshCustomer();
await openProduct(p, 'template-test-cards');
check('…and the shop no longer offers it', (await offeredIn(p)).length === 0);

for (const ctx of customers) await ctx.close().catch(() => {});
await cleanup();
// The emulator answers a deleted file's request with 404; the browser logs it.
// And the order above was placed BY THE TEST, signed in as the admin, for a guest
// page: that page has no ticket to ask its order's status with, and is refused.
// That 403 is the test's own; any other is not.
// The 503s are the ones this test answered itself, to see the page cope.
const testsOwn = (u) => /\/api\/orders\/[^/?]+\/status\?t=$/.test(u) || simulated.has(u);
const real = errors.filter((e) => !/status of 404/.test(e) && !(/status of (403|503)/.test(e) && refused.length > 0 && refused.every(testsOwn)));
check('…and nothing else was refused', refused.every(testsOwn), refused.filter((u) => !testsOwn(u)).slice(0, 3).join(' | '));
check('no page errors', real.length === 0, real.slice(0, 4).join(' | '));
await browser.close();
process.exit(summary() ? 1 : 0);
