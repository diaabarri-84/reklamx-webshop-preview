// Round 16, the last batch — what the customer chose decides what the shop
// expects from him and what it promises him.
//
//   a PDF/X with crop marks: an 85 × 55 card exported on a 105 × 75 page (trim +
//   bleed + marks) is ACCEPTED — measured by its own TrimBox — its preview draws
//   the trim and bleed, never the marks, and the line tells production to place
//   it by the TrimBox. (It was refused as "105 × 75 mm".)
//   a reprint and the studio's design are not "waiting for his file" — and say
//   so on the job sheet; "send the files later" still is.
//   a paid Next day: the product page dates it, the checkout counts it, and the
//   order is promised on it — the slowest line of a mixed basket deciding.
//   an EPS the browser gives no type: stored in Storage as PostScript (it was
//   refused by the bucket and embedded or turned away — code review WEB-04).
import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch, loginAdmin, BASE, SHOTS, db, check, summary } from './lib.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'reklamx-final-e2e-'));
writeFileSync(join(tmp, 'e.ts'), [
  `export { OPTION_CATALOGUE } from ${JSON.stringify(join(ROOT, 'src/components/Admin/optionCatalogue.ts'))};`,
  `export { promisedDay, dayToShow } from ${JSON.stringify(join(ROOT, 'src/lib/productionSpeed.ts'))};`,
].join('\n'));
await build({ entryPoints: [join(tmp, 'e.ts')], outfile: join(tmp, 'e.mjs'), bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const { OPTION_CATALOGUE, promisedDay, dayToShow } = await import(pathToFileURL(join(tmp, 'e.mjs')).href);
rmSync(tmp, { recursive: true, force: true });

const ID = 'prod-final-batch';
const EMAIL = `final-${Date.now()}@emulator.test`;
const EMAIL2 = `final2-${Date.now()}@emulator.test`;
const BUCKET = 'http://127.0.0.1:9199/v0/b/demo-reklamx.appspot.com/o';
const src = (await db.collection('products').doc('prod-pmp-696').get()).data();
const catalogue = (id) => ({ ...OPTION_CATALOGUE.find((f) => f.id === id), enabled: true });
const sizes = {
  id: 'fb_size', name: 'Size', group: 'default', enabled: true,
  options: [{ id: 'fb85', label: '85 × 55 mm', value: '85x55', priceModifier: 0, isDefault: true, dimensions: '85 × 55 mm' }],
};
const base = {
  ...src, isHidden: false, artworkEnabled: true, artworkRequired: false, relatedProductIds: [], sku: 'FB-1', nameI18n: null,
  customUploadRules: { ...(src.customUploadRules ?? {}), areaPriced: false, allowedFormats: ['pdf', 'png', 'jpg', 'eps'] },
};
for (const key of ['onlineDesign', 'pageOrder', 'quantityAfterFieldId']) delete base[key];
const cleanup = async () => {
  await db.collection('products').doc(ID).delete().catch(() => {});
  for (const email of [EMAIL, EMAIL2]) {
    for (const d of (await db.collection('orders').where('customerEmail', '==', email.toLowerCase()).get()).docs) await d.ref.delete();
  }
};
process.on('uncaughtException', async (err) => { console.error(err); await cleanup().catch(() => {}); process.exit(1); });
await db.collection('products').doc(ID).set({
  ...base, id: ID, name: 'Final batch cards', slug: 'final-batch-cards',
  printingFields: [sizes, catalogue('artwork_supply_method'), catalogue('design_service'), catalogue('production_delivery_speed')],
});
const signIn = await (await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@emulator.test', password: 'emulator-admin-1', returnSecureToken: true }),
})).json();
const asAdmin = { Authorization: `Bearer ${signIn.idToken}` };
await fetch(`${BASE}/api/admin/cache/invalidate`, { method: 'POST', headers: asAdmin });

// An InDesign "PDF/X with marks and bleed" export of an 85 × 55 mm card, written
// by hand: a 105 × 75 mm page, 3 mm of bleed, 10 mm of slug for the marks.
const MM = 72 / 25.4;
const pt = (mm) => Math.round(mm * MM * 100) / 100;
const box = (x0, y0, x1, y1) => `[${pt(x0)} ${pt(y0)} ${pt(x1)} ${pt(y1)}]`;
function cropMarkedCard({ media = [0, 0, 105, 75], bleed = [7, 7, 98, 68], trim = [10, 10, 95, 65] } = {}) {
  // A filled card and a crop mark in the slug, so a preview that drew the marks would show them.
  const content = `0.2 0.4 0.8 rg ${pt(bleed[0])} ${pt(bleed[1])} ${pt(bleed[2] - bleed[0])} ${pt(bleed[3] - bleed[1])} re f 0 0 0 RG 0.5 w ${pt(1)} ${pt(10)} m ${pt(6)} ${pt(10)} l S`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox ${box(...media)} /BleedBox ${box(...bleed)} /TrimBox ${box(...trim)} /Contents 4 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let out = '%PDF-1.6\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const { browser, context, page, errors } = await launch();
// The order's file address is real Storage's (see the checkout); answered from the emulator.
await context.route('https://firebasestorage.googleapis.com/**', async (route) => {
  const r = await fetch(route.request().url().replace('https://firebasestorage.googleapis.com/', 'http://127.0.0.1:9199/'));
  await route.fulfill({ status: r.status, contentType: r.headers.get('content-type') ?? undefined, body: Buffer.from(await r.arrayBuffer()) });
});
await loginAdmin(page);

const shop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const cp = await shop.newPage();
cp.on('pageerror', (e) => errors.push(String(e?.message ?? e)));
cp.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
// Every address refused with 403, so the console's bare "status of 403" can be told apart.
const refused = [];
shop.on('response', (r) => { if (r.status() === 403) refused.push(r.url()); });
context.on('response', (r) => { if (r.status() === 403) refused.push(r.url()); });
const cartLines = () => cp.evaluate(() => JSON.parse(localStorage.getItem('reklamx_cart') || '[]'));
const addToCart = () => cp.getByRole('button', { name: /Add to cart/i }).first();
const method = (text) => cp.locator('[data-rx-block="artwork"] button', { hasText: text });
const addLine = async () => {
  const before = (await cartLines()).length;
  await addToCart().click();
  for (let i = 0; i < 40 && (await cartLines()).length === before; i++) await cp.waitForTimeout(150);
  return (await cartLines())[before];
};

await cp.goto(`${BASE}/products/final-batch-cards`, { waitUntil: 'domcontentloaded' });
await cp.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {});
await cp.locator('[data-rx-block="artwork"]').waitFor({ timeout: 20000 });

// ---- the paid speed, on the product page ----
const promise = (await db.collection('settings').doc('siteConfig').get()).data()?.deliveryPromise ?? {};
const transit = Number.isFinite(Number(promise.shippingDaysZone)) ? Number(promise.shippingDaysZone) : 2;
const skip = promise.skipWeekends !== false;
// Counted as the shop counts: working days on the SWEDISH calendar, shown as that day.
const dayText = (n) => {
  const s = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(dayToShow(promisedDay(new Date(), n, skip)));
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const speedText = async (id) => cp.locator(`[data-rx-speed="${id}"]`).innerText().catch(() => '');
check(`the product page dates each speed as the order will be promised: Next day ${dayText(1 + transit)}, Standard ${dayText(5 + transit)} (production + ${transit} transit, working days)`,
  (await speedText('sv-speed-nextday')).includes(dayText(1 + transit)) && (await speedText('sv-speed-standard')).includes(dayText(5 + transit)),
  `${await speedText('sv-speed-nextday')} | ${await speedText('sv-speed-standard')}`);
await cp.locator('[data-rx-speed="sv-speed-nextday"]').click();

// ---- a PDF/X with crop marks ----
const dropzone = cp.locator('[data-rx-block="artwork"] input[type="file"]');
// A file called .pdf that is not one: read, refused or not — and no pdf.js worker
// left behind by the failed reading (the resolution check kept it).
const workersBefore = cp.workers().length;
await dropzone.setInputFiles({ name: 'not-really.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 9 0 R >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1') });
await cp.locator('[data-rx-block="artwork"]').getByText(/not-really\.pdf|not a valid PDF|could not|kunde inte/i).first().waitFor({ timeout: 15000 }).catch(() => {});
let brokenWorkers = [];
for (let i = 0; i < 24; i++) {
  await cp.waitForTimeout(250);
  brokenWorkers = cp.workers().map((w) => w.url()).filter((u) => /pdf\.worker/.test(u));
  if (brokenWorkers.length === 0 && i >= 4) break;
}
check('a broken "PDF" picked: no pdf.js worker left running after it was read', brokenWorkers.length === 0, JSON.stringify({ before: workersBefore, after: brokenWorkers }));
// A document made 91 × 61 — the card WITH its bleed — then exported with marks
// and another bleed: its TrimBox is the size with bleed. Placed by that box, the
// bleed would print as product; it is refused, and told how to fix it.
await dropzone.setInputFiles({
  name: 'card-bleed-inside.pdf', mimeType: 'application/pdf',
  buffer: cropMarkedCard({ media: [0, 0, 117, 87], bleed: [10, 10, 107, 77], trim: [13, 13, 104, 74] }),
});
const bleedInside = cp.locator('[data-rx-block="artwork"] .text-red-600');
await bleedInside.waitFor({ timeout: 20000 }).catch(() => {});
const bleedInsideText = await bleedInside.innerText().catch(() => '');
check('a TrimBox the size WITH bleed (91 × 61 on an 85 × 55 card) is refused, and the refusal says why and how to fix it',
  /trim size \(TrimBox\) is 91 × 61 mm — that is the size WITH bleed/.test(bleedInsideText) && /Export it without crop marks and without bleed/.test(bleedInsideText) && /make the document 85 × 55 mm/.test(bleedInsideText),
  bleedInsideText);
await dropzone.setInputFiles({ name: 'card-with-marks.pdf', mimeType: 'application/pdf', buffer: cropMarkedCard() });
await cp.locator('[data-rx-block="artwork"]').getByText('card-with-marks.pdf').waitFor({ timeout: 20000 }).catch(() => {});
const refusal = await cp.locator('[data-rx-block="artwork"] .text-red-600').innerText().catch(() => '');
check('an 85 × 55 card exported WITH crop marks (a 105 × 75 page) is accepted — measured by its TrimBox',
  (await cp.locator('[data-rx-block="artwork"]').getByText('card-with-marks.pdf').count()) >= 1 && !refusal, refusal);
const canvas = cp.locator('[data-rx-block="artwork"] canvas').first();
await canvas.waitFor({ timeout: 15000 }).catch(() => {});
const drawn = await canvas.evaluate((c) => ({ w: c.width, h: c.height })).catch(() => null);
check('its preview draws the trim and its bleed (91 × 61), never the page with the marks (105 × 75)',
  !!drawn && Math.abs(drawn.w / drawn.h - 91 / 61) < 0.02, JSON.stringify(drawn));
// pdf.js starts a worker for every document it opens, and only destroying the
// document ends it: the preview and the resolution check kept theirs, one per file
// picked, for as long as the tab was open.
let pdfWorkers = [];
for (let i = 0; i < 20; i++) {
  pdfWorkers = cp.workers().map((w) => w.url()).filter((u) => /pdf\.worker/.test(u));
  if (pdfWorkers.length === 0) break;
  await cp.waitForTimeout(250);
}
check('two PDFs picked, both read and drawn: no pdf.js worker left running in the tab', pdfWorkers.length === 0, JSON.stringify(cp.workers().map((w) => w.url())));
await cp.screenshot({ path: `${SHOTS}/130-crop-marks.png` });
await cp.locator('[data-rx-designer-step], [data-rx-block="artwork"]').getByText(/Ready for print|Uploaded|✓/).first().waitFor({ timeout: 20000 }).catch(() => {});
for (let i = 0; i < 40 && (await addToCart().isDisabled()); i++) await cp.waitForTimeout(250);
const pdfLine = await addLine();
check('the basket line tells production to place it by its TrimBox, with its 3 mm bleed and the page size',
  pdfLine?.fileSpecs?.placeBy === 'trimbox' && pdfLine?.fileSpecs?.bleedMm === 3 &&
  Math.round(pdfLine?.fileSpecs?.pageWidthMm) === 105 && Math.round(pdfLine?.fileSpecs?.pageHeightMm) === 75,
  JSON.stringify(pdfLine?.fileSpecs ?? null).slice(0, 260));

// ---- an EPS with no type ----
// Chrome and Safari report "" for .eps, .ai and .psd: it was stored as
// octet-stream, the bucket refused it, and the page embedded or turned it away.
await dropzone.setInputFiles({
  name: 'logo.eps', mimeType: '',
  buffer: Buffer.from('%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 241 156\n0 0 1 setrgbcolor 0 0 241 156 rectfill\nshowpage\n%%EOF\n', 'latin1'),
});
await cp.locator('[data-rx-block="artwork"]').getByText('logo.eps').first().waitFor({ timeout: 20000 }).catch(() => {});
for (let i = 0; i < 40 && (await addToCart().isDisabled()); i++) await cp.waitForTimeout(250);
const epsLine = await addLine();
const epsMeta = epsLine?.fileSpecs?.storagePath
  ? await (await fetch(`${BUCKET}/${encodeURIComponent(epsLine.fileSpecs.storagePath)}`, { headers: { Authorization: 'Bearer owner' } })).json().catch(() => null)
  : null;
check('an EPS the browser gives no type is uploaded to Storage — stored as PostScript, neither embedded nor refused',
  /^http:\/\/127\.0\.0\.1:9199\//.test(epsLine?.fileSpecs?.fileUrl ?? '') && !String(epsLine?.fileSpecs?.fileUrl ?? '').startsWith('data:') &&
  epsMeta?.contentType === 'application/postscript',
  JSON.stringify({ url: String(epsLine?.fileSpecs?.fileUrl ?? '').slice(0, 80), type: epsMeta?.contentType ?? null }));

// ---- the shop's own artwork ----
await method('Reprint').click();
await cp.waitForTimeout(300);
const noteOf = async () => ({
  kind: await cp.locator('[data-rx-artwork-note]').getAttribute('data-rx-artwork-note').catch(() => null),
  text: await cp.locator('[data-rx-artwork-note]').innerText().catch(() => ''),
});
const reprintNote = await noteOf();
check('a reprint is told what to send instead of a file — and no e-mail is promised that would not come',
  reprintNote.kind === 'reprint' && /earlier order/.test(reprintNote.text) && /Reply to your order confirmation with the number of the order you want reprinted/.test(reprintNote.text) && !/We will email you/.test(reprintNote.text),
  JSON.stringify(reprintNote));
const reprintLine = await addLine();
check('a REPRINT line is not waiting for his file: the shop reuses the previous artwork',
  reprintLine?.artworkPending === false && reprintLine?.artworkSource === 'reprint' && !reprintLine?.fileSpecs,
  JSON.stringify({ pending: reprintLine?.artworkPending, source: reprintLine?.artworkSource, file: !!reprintLine?.fileSpecs }));
await method('Full design service').click();
await cp.waitForTimeout(300);
const studioNote = await noteOf();
check('the studio\'s design: asked to reply to the confirmation with logo and texts',
  studioNote.kind === 'studio' && /our designer makes the artwork/.test(studioNote.text) && /logo, the text you want/.test(studioNote.text),
  JSON.stringify(studioNote));
const studioLine = await addLine();
check('nor is the STUDIO\'s design', studioLine?.artworkPending === false && studioLine?.artworkSource === 'studio',
  JSON.stringify({ pending: studioLine?.artworkPending, source: studioLine?.artworkSource }));
// The slowest line decides the parcel: this one at Standard, five days.
await cp.locator('[data-rx-speed="sv-speed-standard"]').click();
await method('send the files later').click();
await cp.waitForTimeout(300);
const laterLine = await addLine();
check('"send the files later" still IS waiting for his file', laterLine?.artworkPending === true && !laterLine?.artworkSource,
  JSON.stringify({ pending: laterLine?.artworkPending, source: laterLine?.artworkSource ?? null }));

// ---- the checkout and the order ----
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
await cp.waitForTimeout(1500);
const standardOption = await cp.locator('[data-ship-option="standard"]').innerText().catch(() => '');
check(`the checkout counts the basket's speeds: the slowest line (Standard, 5) + ${transit} transit = ≈ ${5 + transit} working days`,
  standardOption.includes(`≈ ${5 + transit} working days`), standardOption.replace(/\s+/g, ' ').slice(0, 200));
// The PDF proof at the checkout: it opens and draws the file — and, closed, leaves
// no pdf.js worker behind (it kept one per file opened, for the life of the tab).
await cp.getByRole('button', { name: 'Preview PDF Layout' }).first().click();
const proofCanvas = cp.locator('canvas').last();
let proofDrawn = null;
for (let i = 0; i < 60 && !(proofDrawn?.w > 0); i++) {
  await cp.waitForTimeout(250);
  proofDrawn = await proofCanvas.evaluate((c) => ({ w: c.width, h: c.height })).catch(() => null);
}
await cp.getByRole('button', { name: 'Close modal' }).click();
let proofWorkers = [];
for (let i = 0; i < 20; i++) {
  proofWorkers = cp.workers().map((w) => w.url()).filter((u) => /pdf\.worker/.test(u));
  if (proofWorkers.length === 0) break;
  await cp.waitForTimeout(250);
}
check('the checkout\'s "Preview PDF Layout": the file is drawn — and once closed, no pdf.js worker is left running',
  !!proofDrawn && proofDrawn.w > 0 && proofWorkers.length === 0, JSON.stringify({ proofDrawn, workers: proofWorkers }));
await cp.locator('label:has(a[href*="terms"]) input[type="checkbox"], label:has(a[href*="privacy"]) input[type="checkbox"]').last().check();
let payBody = null;
await cp.route('**/api/checkout/pay', async (route) => {
  // As in designer.mjs: the emulator's Storage host put back to real Storage's.
  payBody = JSON.parse(route.request().postData().replaceAll('http://127.0.0.1:9199/v0/b/', 'https://firebasestorage.googleapis.com/v0/b/'));
  const r = await fetch(`${BASE}/api/checkout/order`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...asAdmin }, body: JSON.stringify(payBody) });
  await route.fulfill({ status: r.status, contentType: 'application/json', body: await r.text() });
});
await cp.getByRole('button', { name: /^Pay/ }).last().click();
const findOrder = async (email) => {
  for (let i = 0; i < 40; i++) {
    const d = (await db.collection('orders').where('customerEmail', '==', email.toLowerCase()).get()).docs[0];
    if (d) return { id: d.id, ...d.data() };
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
};
const order = await findOrder(EMAIL);
const items = order?.items ?? [];
const due = (n) => promisedDay(new Date(), n, skip);
check(`the order is promised on its slowest line: Standard's 5 production days + ${transit} = ${due(5 + transit)}`,
  order?.productionDays === 5 && order?.dueDate === due(5 + transit) && order?.dueDateAuto === order?.dueDate,
  JSON.stringify({ productionDays: order?.productionDays, dueDate: order?.dueDate, auto: order?.dueDateAuto }));
check('the order line of the crop-marked PDF keeps its placement and page size',
  items.some((it) => it?.fileSpecs?.placeBy === 'trimbox' && Math.round(it?.fileSpecs?.pageWidthMm) === 105),
  JSON.stringify(items.map((it) => it?.fileSpecs?.placeBy ?? null)));
check('reprint and studio lines reach the order as the shop\'s artwork, not awaited; the "send later" line is awaited',
  items.some((it) => it.artworkSource === 'reprint' && it.artworkPending !== true) &&
  items.some((it) => it.artworkSource === 'studio' && it.artworkPending !== true) &&
  items.filter((it) => it.artworkPending === true).length === 1,
  JSON.stringify(items.map((it) => ({ source: it.artworkSource ?? null, pending: it.artworkPending }))));

// A Next-day line alone: one production day.
const nextOnly = { ...payBody, customer: { ...payBody.customer, email: EMAIL2 }, items: [payBody.items[0]] };
delete nextOnly.expectedGrossTotal;
const r2 = await fetch(`${BASE}/api/checkout/order`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...asAdmin }, body: JSON.stringify(nextOnly) });
const order2 = r2.ok ? await findOrder(EMAIL2) : null;
check(`a Next-day order alone is promised one production day + ${transit}: ${due(1 + transit)}`,
  order2?.productionDays === 1 && order2?.dueDate === due(1 + transit), JSON.stringify({ status: r2.status, productionDays: order2?.productionDays, dueDate: order2?.dueDate }));

// ---- the job sheet ----
await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {});
await page.getByRole('button', { name: 'Orders', exact: true }).first().click();
await page.locator(`[data-order-row="${order?.id}"]`).click({ timeout: 20000 });
await page.getByRole('dialog', { name: new RegExp(`Order ${order?.id}`) }).getByRole('button', { name: /Job sheet/ }).click();
const sheet = page.locator('.rx-print-sheet');
await sheet.waitFor({ timeout: 10000 }).catch(() => {});
const sheetText = await sheet.innerText().catch(() => '');
check('the job sheet says REPRINT and STUDIO DESIGN where it said "not supplied", and how to place the crop-marked file',
  /REPRINT — use the artwork from the customer/.test(sheetText) && /STUDIO DESIGN — our designer creates the artwork/.test(sheetText) &&
  /Crop marks — place by the file.s TrimBox \(the page with marks is 105 × 75 mm\)/.test(sheetText) &&
  (sheetText.match(/ARTWORK NOT SUPPLIED YET/g) ?? []).length === 1,
  sheetText.replace(/\s+/g, ' ').slice(0, 400));
await page.screenshot({ path: `${SHOTS}/131-jobsheet-final.png` });

await cleanup();
// The order was placed BY THE TEST as the admin, for a guest page: that page has
// no ticket to ask its order's status with, and is refused — the test's own 403.
const testsOwn = (u) => /\/api\/orders\/[^/?]+\/status\?t=$/.test(u);
const real = errors.filter((e) => !/status of 404/.test(e) && !(/status of 403/.test(e) && refused.length > 0 && refused.every(testsOwn)));
check('no page errors (and nothing else refused)', real.length === 0 && refused.every(testsOwn), [...real.slice(0, 4), ...refused.filter((u) => !testsOwn(u)).slice(0, 2)].join(' | '));
await browser.close();
process.exit(summary() ? 1 : 0);
