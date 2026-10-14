// Design later — designer v2; the owner's decision of 2026-10-07: "yes, and he
// designs it from the order page". Against the local emulator copy.
//
//   the product page: "Design online" chosen, the gallery's "Add to basket without
//   the design" puts the line in with no file, waiting for the design, carrying what
//   the designer needs (the size, the cut, the pages).
//   the basket: "Create your design" opens the same gallery and studio on the line;
//   the design attached there makes the line read as if designed on the product page;
//   a save cancelled while it uploads leaves the line to be designed, and the way to
//   checkout open (code review DSN-12).
//   the checkout: a line still to be designed says so, and can be paid for as it is;
//   the basket kept after the order (until it is paid) says its design belongs on the
//   order page (code review DSN-13).
//   the order: the server works out its own marker from what it priced; the order
//   waits for the design (and the e-mail asks for a design, not a print file).
//   the order page (a guest, by the link): "Create your design" → the gallery → the
//   studio → the design goes to the order with its page pictures, bleed and
//   resolution — and nothing a tampered request adds (a foreign picture, a made-up
//   template) reaches it. The line is then done, and the order stops waiting. A second
//   tab that sends its own design after that is told the line already has one — not
//   "your design is saved" (code review DSN-13). An order refunded behind the open
//   page: told it is not paid, and the design's file is kept (code review
//   2026-10-11, J).
import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch, BASE, SHOTS, db, check, summary } from './lib.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'reklamx-later-e2e-'));
writeFileSync(join(tmp, 'e.ts'), [
  `export { OPTION_CATALOGUE } from ${JSON.stringify(join(ROOT, 'src/components/Admin/optionCatalogue.ts'))};`,
  `export { customerConfirmation } from ${JSON.stringify(join(ROOT, 'src/lib/email.ts'))};`,
].join('\n'));
await build({
  entryPoints: [join(tmp, 'e.ts')], outfile: join(tmp, 'e.mjs'), bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
  // The e-mail module brings nodemailer, which require()s Node's own modules.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
const { OPTION_CATALOGUE, customerConfirmation } = await import(pathToFileURL(join(tmp, 'e.mjs')).href);
rmSync(tmp, { recursive: true, force: true });

const CARD = 'prod-later-cards';
const STICK = 'prod-later-stickers';
const EMAIL = `later-${Date.now()}@emulator.test`;
const OURS = 'https://firebasestorage.googleapis.com/v0/b/';
const EMU = 'http://127.0.0.1:9199/v0/b/';
const src = (await db.collection('products').doc('prod-pmp-696').get()).data();
const catalogue = (id) => ({ ...OPTION_CATALOGUE.find((f) => f.id === id), enabled: true });
const base = {
  ...src, isHidden: false, artworkEnabled: true, artworkRequired: false, relatedProductIds: [],
  customUploadRules: { ...(src.customUploadRules ?? {}), areaPriced: false },
};
for (const key of ['onlineDesign', 'pageOrder', 'quantityAfterFieldId']) delete base[key];
const cleanup = async () => {
  for (const id of [CARD, STICK]) await db.collection('products').doc(id).delete().catch(() => {});
  for (const d of (await db.collection('orders').where('customerEmail', '==', EMAIL.toLowerCase()).get()).docs) await d.ref.delete();
};
process.on('uncaughtException', async (err) => { console.error(err); await cleanup().catch(() => {}); process.exit(1); });
await db.collection('products').doc(CARD).set({
  ...base, id: CARD, name: 'Later test business cards', nameI18n: null, slug: 'later-test-cards', sku: null, categoryId: 'cat-later',
  printSpec: { safeMm: 4 },
  printingFields: [catalogue('business_card_size'), { ...catalogue('printed_sides'), options: catalogue('printed_sides').options.map((o) => ({ ...o, isDefault: o.id === 'pc-sides-double' })) }, catalogue('artwork_supply_method')],
});
await db.collection('products').doc(STICK).set({
  ...base, id: STICK, name: 'Later test stickers', nameI18n: null, slug: 'later-test-stickers', sku: null,
  printingFields: [
    { id: 'lt_size', name: 'Size', group: 'default', enabled: true, options: [{ id: 'ls50', label: '50 × 50 mm', value: '50x50', priceModifier: 0, isDefault: true, dimensions: '50 × 50 mm' }] },
    { ...catalogue('product_shape'), display: 'cards' },
    catalogue('artwork_supply_method'),
  ],
});

const cartLines = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('reklamx_cart') || '[]'));
const sideObjects = (p) => p.evaluate(() => JSON.parse(window.__rxStudio?.snapshotSide() ?? '{"objects":[]}').objects);
const openProduct = async (p, slug) => {
  await p.goto(`${BASE}/products/${slug}`, { waitUntil: 'domcontentloaded' });
  await p.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {});
  await p.locator('[data-rx-block="artwork"]').waitFor({ timeout: 20000 });
};
const designCard = (p) => p.locator('[data-rx-block="artwork"] button', { hasText: 'Design online from a ready-made template' });
const addToCart = (p) => p.getByRole('button', { name: /Add to cart/i }).first();
const studioReady = (p) => p.locator('[data-rx-st-rail]:not([disabled])').first().waitFor({ timeout: 30000 });
/** Through the check to "Attach the design". */
const attach = async (p) => {
  await p.locator('[data-rx-designer-use]').click();
  await p.locator('[data-rx-proof-tick]').check({ timeout: 60000 });
  await p.locator('[data-rx-proof-attach]').click();
  await p.locator('[data-rx-studio]').waitFor({ state: 'detached', timeout: 15000 });
};

const { browser, context, page: cp, errors } = await launch();
// The order below is placed BY THE TEST, signed in as the admin, for a guest page:
// that page has no ticket to ask its order's status with, and is refused (403).
// That refusal is the test's own; any other is not.
const refused = [];
context.on('response', (r) => { if (r.status() === 403) refused.push(r.url()); });
// The order page's one 409 ('unpaid'), asked for on purpose below.
let unpaidAsked = false;

// ---- the product page: "Add to basket without the design" ----
await openProduct(cp, 'later-test-cards');
await designCard(cp).click();
check('"Design online" chosen, not designed: add to cart is held', await addToCart(cp).isDisabled());
await cp.locator('[data-rx-designer-open]').click();
await cp.locator('[data-rx-gallery]').waitFor({ timeout: 20000 });
check('the gallery offers "Add to basket without the design"', (await cp.locator('[data-rx-gal-without]').count()) === 1);
await cp.screenshot({ path: `${SHOTS}/170-later-gallery.png` });
await cp.locator('[data-rx-gal-without]').click();
await cp.locator('[data-rx-gallery]').waitFor({ state: 'detached', timeout: 10000 });
await cp.waitForTimeout(800);
const cardLine = (await cartLines(cp))[0];
check('…the line goes in with no file, waiting for the design',
  !!cardLine && !cardLine.fileName && !cardLine.fileSpecs && cardLine.artworkPending === true, JSON.stringify(cardLine ?? null).slice(0, 300));
check('…carrying what the designer needs: 85 × 55 mm, front and back, a business card, his print values, the category',
  JSON.stringify(cardLine?.designLater?.trimMm) === '{"wMm":85,"hMm":55}' && JSON.stringify(cardLine?.designLater?.sides) === '["front","back"]' &&
  cardLine?.designLater?.kind === 'card' && cardLine?.designLater?.printSpec?.safeMm === 4 && cardLine?.designLater?.categoryId === 'cat-later' &&
  cardLine?.printWidthCm === 8.5 && cardLine?.printHeightCm === 5.5,
  JSON.stringify(cardLine?.designLater ?? null));
check('…he is told so where he is, with where to design it',
  /Added to your basket\. Design it from the basket/.test(await cp.locator('[data-rx-designer-notice]').innerText().catch(() => '')));
check('…and he stays on the product, the designer\'s history entry gone',
  new URL(cp.url()).pathname === '/products/later-test-cards' && (await cp.evaluate(() => !history.state?.rxDesigner)), cp.url());

await openProduct(cp, 'later-test-stickers');
await cp.locator('[data-option-card="cs-shape-round"]').click();
await designCard(cp).click();
await cp.locator('[data-rx-designer-open]').click();
await cp.locator('[data-rx-gallery]').waitFor({ timeout: 20000 });
await cp.locator('[data-rx-gal-without]').click();
await cp.locator('[data-rx-gallery]').waitFor({ state: 'detached', timeout: 10000 });
await cp.waitForTimeout(800);
const stickLine = (await cartLines(cp))[1];
check('a round 50 mm sticker the same way: its cut travels too (circle, one side)',
  JSON.stringify(stickLine?.designLater?.trimMm) === '{"wMm":50,"hMm":50}' && stickLine?.designLater?.outline === 'circle' &&
  JSON.stringify(stickLine?.designLater?.sides) === '["front"]' && stickLine?.printWidthCm === 5,
  JSON.stringify(stickLine?.designLater ?? null));

// ---- the basket: "Create your design" ----
await cp.getByTitle('Shopping cart').first().click();
const drawer = cp.getByRole('dialog', { name: 'Shopping Cart' });
await drawer.waitFor({ timeout: 10000 });
check('the basket: both lines say they are to be designed online, with "Create your design"',
  (await drawer.locator('[data-rx-cart-design-later]').count()) === 2 && (await drawer.locator('[data-rx-design-later-open]').count()) === 2);
await cp.screenshot({ path: `${SHOTS}/171-later-basket.png` });
await drawer.locator('[data-rx-design-later-open]').first().click();
await cp.locator('[data-rx-gallery]').waitFor({ timeout: 20000 });
check('…it opens the same gallery, for the line: the card designs at 85 × 55 mm',
  (await cp.locator('[data-rx-gal-card="starter-band"]').count()) === 1 && (await cp.locator('[data-rx-gal-without]').count()) === 0);
await cp.locator('[data-rx-gal-card="starter-band"] button').first().click();
await cp.locator('[data-rx-gal-choose]').click();
await studioReady(cp);
const board = cp.locator('[data-rx-designer-board]');
check('…and the studio: the card with its bleed, Front and Back pages',
  (await board.getAttribute('data-rx-board-mm')) === '91x61' && (await cp.locator('[data-rx-st-page]').count()) === 2);
await attach(cp);
await drawer.locator('[data-rx-cart-thumb="design"]').first().waitFor({ timeout: 60000 });
const designedLine = (await cartLines(cp))[0];
check('designed in the basket: the line now reads as if designed on the product page — a 2-page PDF, both pages\' pictures, no longer waiting',
  designedLine?.fileSpecs?.pages === 2 && JSON.stringify(designedLine.fileSpecs.sides) === '["front","back"]' &&
  designedLine.fileSpecs.previews?.length === 2 && /_2pages\.pdf$/.test(designedLine.fileName ?? '') &&
  designedLine.artworkPending === false && !designedLine.designLater && designedLine.fileSpecs.bleedMm === 3 && designedLine.fileSpecs.dpi >= 300,
  JSON.stringify(designedLine ?? null).slice(0, 500));
check('…its basket line shows the design, and only the sticker is still to be designed',
  (await drawer.locator('[data-rx-cart-design-later]').count()) === 1);
await cp.screenshot({ path: `${SHOTS}/172-later-basket-designed.png` });

// The sticker designed too — and "Cancel" pressed while it uploads. Storage retries a
// stalled upload for ten minutes, and Checkout waited all that time with nothing to press.
let holdUploads = true;
await cp.route('http://127.0.0.1:9199/v0/b/**', async (route) => {
  if (holdUploads && route.request().method() === 'POST') await new Promise((r) => setTimeout(r, 6000));
  await route.continue().catch(() => {});
});
await drawer.locator('[data-rx-design-later-open]').first().click();
await cp.locator('[data-rx-gallery]').waitFor({ timeout: 20000 });
await cp.locator('[data-rx-gal-scratch]').click();
await studioReady(cp);
await cp.locator('[data-rx-st-rail="text"]').click();
await cp.waitForTimeout(400);
await attach(cp);
const cancelSave = drawer.locator('[data-rx-design-later-cancel]');
await cancelSave.waitFor({ timeout: 15000 }).catch(() => {});
const sawSaving = /Saving your design/.test(await drawer.locator('[data-rx-cart-design-later]').innerText().catch(() => ''));
const heldCheckout = await drawer.getByRole('button', { name: /Complete order/ }).first().isDisabled().catch(() => false);
await cancelSave.click().catch(() => {});
holdUploads = false;
await cancelSave.waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
await cp.unroute('http://127.0.0.1:9199/v0/b/**');
const stickAfter = (await cartLines(cp)).find((l) => l?.productId === STICK);
check('the sticker\'s design cancelled while it uploads ("Saving…", checkout held): the save stops, and the line is still to be designed',
  sawSaving && heldCheckout && (await cancelSave.count()) === 0 && !!stickAfter?.designLater && !stickAfter?.fileSpecs && !stickAfter?.fileName &&
  /Create your design/.test(await drawer.locator('[data-rx-design-later-open]').first().innerText().catch(() => '')),
  JSON.stringify({ sawSaving, heldCheckout, later: !!stickAfter?.designLater, file: !!stickAfter?.fileSpecs }));
check('…and the way to checkout is open again', !(await drawer.getByRole('button', { name: /Complete order/ }).first().isDisabled().catch(() => true)));
await drawer.getByRole('button', { name: 'Close' }).first().click().catch(() => {});
await cp.keyboard.press('Escape');

// ---- the checkout, and the order ----
await cp.goto(`${BASE}/checkout`, { waitUntil: 'domcontentloaded' });
await cp.locator('#co-firstname').waitFor({ timeout: 15000 });
check('checkout: the designed card offers "View your design", the sticker "Create your design"',
  (await cp.locator('[data-rx-checkout-design]').count()) === 1 && (await cp.locator('[data-rx-checkout-design-later]').count()) === 1);
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
  // The emulator's Storage host put back to real Storage's (isOurStorageUrl, server.ts).
  const body = route.request().postData().replaceAll(EMU, OURS);
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
const [oCard, oStick] = order?.items ?? [];
check('the order: the card has its design; the sticker waits for one, and so does the order',
  !!oCard?.fileSpecs?.fileUrl && oCard.artworkPending === false && !oCard.designLater &&
  oStick?.artworkPending === true && !oStick.fileSpecs && order.artworkPending === true,
  JSON.stringify((order?.items ?? []).map((it) => ({ file: it?.fileSpecs?.fileName ?? null, pending: it?.artworkPending, later: !!it?.designLater }))));
check('…the sticker\'s marker is the SERVER\'s, from what it priced: 50 × 50 mm, round, one side',
  JSON.stringify(oStick?.designLater?.trimMm) === '{"wMm":50,"hMm":50}' && oStick?.designLater?.outline === 'circle' && JSON.stringify(oStick?.designLater?.sides) === '["front"]',
  JSON.stringify(oStick?.designLater ?? null));
// The basket is kept until the order is paid, and its sticker still offers the
// designer: a design made there would stay in the basket, not reach the order.
await cp.waitForURL(/\/order\//, { timeout: 15000 }).catch(() => {});
await cp.getByTitle('Shopping cart').first().click();
const drawerAfter = cp.getByRole('dialog', { name: 'Shopping Cart' });
await drawerAfter.waitFor({ timeout: 10000 }).catch(() => {});
check('the basket after the order is placed (not yet paid): the line still to be designed says its design belongs on the order page',
  /create its design on your order page/.test(await drawerAfter.locator('[data-rx-cart-design-ordered]').innerText().catch(() => '')),
  await drawerAfter.locator('[data-rx-cart-design-later]').innerText().catch(() => ''));
await cp.keyboard.press('Escape');
const mail = customerConfirmation({ ...order, id: order.id }, 'ReklamX', `${BASE}/order/${order.id}?t=x`).html;
check('the confirmation e-mail asks him to CREATE the design on his order page — not to send a print file',
  /Your design is still to be made/.test(mail) && /Later test stickers/.test(mail) && !/We still need your print file/.test(mail));

// ---- the order page, as a guest by the link ----
await db.collection('orders').doc(order.id).update({ paymentStatus: 'paid' });
const status = await (await fetch(`${BASE}/api/orders/${order.id}/status?t=${order.publicToken}`)).json();
check('the order page is told what the designer needs for the waiting line, and nothing for the designed one',
  status.items?.[1]?.designLater?.trimMm?.wMm === 50 && status.items?.[1]?.productId === STICK && status.items?.[0]?.designLater === null,
  JSON.stringify(status.items?.map((i) => [i.productId, i.designLater?.trimMm ?? null])));
const guest = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const gp = await guest.newPage();
gp.on('pageerror', (e) => errors.push(String(e?.message ?? e)));
gp.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
let posted = null;
await gp.route('**/api/orders/*/artwork', async (route) => {
  // As at the checkout, the emulator's Storage host put back to real Storage's — and
  // a tampered request: a picture from elsewhere, and a template the shop never had.
  const body = JSON.parse(route.request().postData().replaceAll(EMU, OURS));
  body.previews = [...(body.previews ?? []), { side: 'front', url: 'https://evil.example/x.png' }];
  body.templateId = 'made-up-template';
  posted = body;
  const headers = { 'Content-Type': 'application/json' };
  const auth = route.request().headers().authorization;
  if (auth) headers.Authorization = auth;
  const r = await fetch(route.request().url(), { method: 'POST', headers, body: JSON.stringify(body) });
  await route.fulfill({ status: r.status, contentType: 'application/json', body: await r.text() });
});
await gp.goto(`${BASE}/order/${order.id}?t=${order.publicToken}`, { waitUntil: 'domcontentloaded' });
await gp.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {});
await gp.locator('[data-rx-order-design-later]').waitFor({ timeout: 20000 });
check('the order page says the design is still to be made, with "Create your design"',
  /Your design is still to be made/.test(await gp.locator('body').innerText()) && (await gp.locator('[data-rx-design-later-open]').count()) === 1);
await gp.locator('[data-rx-order-design-later-file]').click();
check('…and, if his designer made a file after all, "I have a print file instead" offers the upload box',
  (await gp.getByRole('button', { name: 'Choose file' }).count()) === 1);
await gp.screenshot({ path: `${SHOTS}/173-later-order-page.png` });
// A second tab on the same order page, open before the design arrives (below).
const gp2 = await guest.newPage();
gp2.on('pageerror', (e) => errors.push(String(e?.message ?? e)));
await gp2.goto(`${BASE}/order/${order.id}?t=${order.publicToken}`, { waitUntil: 'domcontentloaded' });
await gp2.locator('[data-rx-order-design-later]').waitFor({ timeout: 20000 }).catch(() => {});
await gp.locator('[data-rx-design-later-open]').click();
await gp.locator('[data-rx-gallery]').waitFor({ timeout: 20000 });
check('…it opens the gallery on the order page, on a history entry of its own', await gp.evaluate(() => history.state?.rxDesigner === true));
await gp.locator('[data-rx-gal-scratch]').click();
await studioReady(gp);
check('…the studio: the round 50 mm sticker (56 mm with the bleed)',
  (await gp.locator('[data-rx-designer-board]').getAttribute('data-rx-cut')) === 'circle' && (await gp.locator('[data-rx-designer-board]').getAttribute('data-rx-board-mm')) === '56x56');
await gp.locator('[data-rx-st-rail="text"]').click();
await gp.waitForTimeout(400);
check('…where he designs it', (await sideObjects(gp)).some((o) => o.type === 'Textbox'));
// Refunded behind the page's back — it saw "paid" and asks no more, so the designer
// stays: the server answers 409 'unpaid'. It read "could not be saved, try again"
// and his files were deleted (code review 2026-10-11, J). Now it says why, and keeps
// them; paid again, his design comes back from the gallery and goes through.
await db.collection('orders').doc(order.id).update({ paymentStatus: 'refunded' });
unpaidAsked = true;
await attach(gp);
const unpaidNote = gp.locator('[data-rx-design-later-error]');
await unpaidNote.waitFor({ timeout: 60000 }).catch(() => {});
const unpaidSays = await unpaidNote.innerText().catch(() => '');
const keptFile = posted?.fileUrl ? String(posted.fileUrl).replace(OURS, EMU) : null;
const keptStatus = keptFile ? await fetch(keptFile).then((r) => r.status).catch(() => 0) : 0;
check('an order no longer paid: he is told it is not paid and a design cannot be added (to ask us if that is wrong) — and the design\'s file is KEPT',
  /not paid, so a design cannot be added/.test(unpaidSays) && !/could not be saved/.test(unpaidSays) && keptStatus === 200 &&
    (await db.collection('orders').doc(order.id).get()).data()?.items?.[1]?.artworkPending === true,
  `${unpaidSays || 'no message'} · file ${keptStatus}`);
await db.collection('orders').doc(order.id).update({ paymentStatus: 'paid' });
posted = null;
await gp.locator('[data-rx-design-later-open]').click();
await gp.locator('[data-rx-gallery]').waitFor({ timeout: 20000 });
await gp.locator('[data-rx-gal-continue]').click();
await studioReady(gp);
await attach(gp);
await gp.locator('[data-rx-design-later-done]').waitFor({ timeout: 60000 });
const after = (await db.collection('orders').doc(order.id).get()).data();
const done = after.items[1];
check('the design is on the order: its file, one page and its picture — and the order stops waiting',
  done.artworkPending === false && after.artworkPending === false && done.fileSpecs?.fileUrl?.startsWith(OURS) &&
  done.fileSpecs.pages === 1 && JSON.stringify(done.fileSpecs.sides) === '["front"]' && done.fileSpecs.previews?.length === 1,
  JSON.stringify(done.fileSpecs ?? null).slice(0, 400));
check('…with its bleed and resolution for production', done.fileSpecs?.bleedMm === 3 && done.fileSpecs?.dpi >= 300, JSON.stringify([done.fileSpecs?.bleedMm, done.fileSpecs?.dpi]));
check('…and nothing the tampered request added: no foreign picture, no made-up template',
  !!posted && done.fileSpecs.previews.every((p) => p.url.startsWith(OURS)) && !done.fileSpecs.templateId && !done.fileSpecs.template,
  JSON.stringify([done.fileSpecs?.previews, done.fileSpecs?.templateId]));
// Both lines now show a design picture: the card designed in the basket, and this one.
check('the page says so, shows the design\'s picture, and no longer offers a file instead',
  /We have everything we need/.test(await gp.locator('body').innerText()) && (await gp.locator('[data-rx-status-design]').count()) === 2 &&
  (await gp.locator('[data-rx-order-design-later-file], [data-rx-order-design-later] input[type=file]').count()) === 0);
await gp.screenshot({ path: `${SHOTS}/174-later-order-designed.png` });
// The second tab sends a design of its own: the server answers that the line has its
// design (409 has-file) — and the box says THAT, not "Your design is saved."
await gp2.locator('[data-rx-design-later-open]').click();
await gp2.locator('[data-rx-gallery]').waitFor({ timeout: 20000 });
await gp2.locator('[data-rx-gal-scratch]').click();
// Both tabs share this browser's saved design for the product, so starting afresh
// asks first (DSN-05) — answered as the customer would.
await gp2.locator('[data-rx-gal-confirm-replace]').click({ timeout: 5000 }).catch(() => {});
await studioReady(gp2);
await gp2.locator('[data-rx-st-rail="text"]').click();
await gp2.waitForTimeout(400);
await attach(gp2);
await gp2.locator('[data-rx-design-later-done]').waitFor({ timeout: 60000 }).catch(() => {});
const secondSays = await gp2.locator('[data-rx-design-later-done]').innerText().catch(() => '');
check('a second tab sending its own design after the first arrived: told the item ALREADY has its design, not that this one was saved',
  /already has its design/.test(secondSays) && !/Your design is saved/.test(secondSays), secondSays);
await gp2.close();
const again = await fetch(`${BASE}/api/orders/${order.id}/artwork`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ t: order.publicToken, itemIndex: 1, fileUrl: done.fileSpecs.fileUrl, fileName: 'again.png' }),
});
check('a second design for the same line is refused: the job has its artwork', again.status === 409, String(again.status));

await cleanup();
const testsOwn = (u) => /\/api\/orders\/[^/?]+\/status\?t=$/.test(u);
const real = errors.filter((e) => !/status of 404/.test(e) && !(/status of 403/.test(e) && refused.length > 0 && refused.every(testsOwn)) &&
  !(unpaidAsked && /status of 409/.test(e)));
check('…and nothing else was refused', refused.every(testsOwn), refused.filter((u) => !testsOwn(u)).slice(0, 3).join(' | '));
check('no page errors', real.length === 0, real.slice(0, 4).join(' | '));
await browser.close();
process.exit(summary() ? 1 : 0);
