// Client, 2026-10-07: "the product's picture must be visible and very big" — on
// the job sheet (its FILE cell said "PDF") and the packing slip (a document icon).
//
//   a PDF the customer sent: its first page is drawn, big (one line: 240 px);
//   two lines: the customer's picture file, and the product's own photo for a
//   line with no file (labelled, so nobody prints the product photo);
//   an order from before the photo was frozen on the line: the photo comes from
//   the catalogue the server keeps;
//   each still prints on ONE A4 page;
//   a file that cannot be drawn (an AI file, a PDF that will not open): the product's
//   photo stands in, LABELLED as the product photo and saying what was sent;
//   no pdf.js worker is left running once the sheets are closed.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, loginAdmin, BASE, SHOTS, db, check, summary } from './lib.mjs';

// ---- a real one-page PDF in the storage emulator, as a customer's upload ----
function onePagePdf() {
  const content = '0.85 0.15 0.2 rg 40 300 515 400 re f\nBT /F1 54 Tf 1 1 1 rg 70 480 Td (REKLAMX PDF) Tj ET\n';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
const signIn = await (await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@emulator.test', password: 'emulator-admin-1', returnSecureToken: true }),
})).json();
const path = `uploads/${signIn.localId}/artwork/e2e-sheet-${Date.now()}.pdf`;
const up = await (await fetch(`http://127.0.0.1:9199/v0/b/demo-reklamx.appspot.com/o?name=${encodeURIComponent(path)}`, {
  method: 'POST', headers: { 'Content-Type': 'application/pdf', Authorization: `Firebase ${signIn.idToken}` }, body: onePagePdf(),
})).json();
const PDF_URL = `http://127.0.0.1:9199/v0/b/demo-reklamx.appspot.com/o/${encodeURIComponent(path)}?alt=media&token=${up.downloadTokens}`;
check('a customer PDF is in storage, readable by its address', (await fetch(PDF_URL)).ok, JSON.stringify(up).slice(0, 160));

// ---- a product in the catalogue with a photo (for the order from before 2026-10) ----
const PRODUCT = 'prod-sheet-picture';
const PHOTO = `${BASE}/og-image.png`;
await db.collection('products').doc(PRODUCT).set({ id: PRODUCT, name: 'Sheet picture test product', slug: 'sheet-picture-test', isHidden: false, basePrice: 100, images: [PHOTO], categoryId: 'indoor' });
await fetch(`${BASE}/api/admin/cache/invalidate`, { method: 'POST', headers: { Authorization: `Bearer ${signIn.idToken}` } });

const base = {
  userId: 'guest', createdAt: new Date().toISOString(), status: 'in_print', paymentStatus: 'paid', paidAt: new Date().toISOString(),
  customerName: 'Anna Bild', customerEmail: 'anna.bild@firma.test', currency: 'SEK',
  customerDetails: { firstName: 'Anna', lastName: 'Bild', address1: 'Storgatan 1', postcode: '111 22', city: 'Stockholm', country: 'Sverige' },
  shippingMethod: 'standard', shippingMethodTitle: 'Standard delivery', shippingCost: 99, goodsNet: 1000, netTotal: 1099, vatAmount: 274.75, grossTotal: 1373.75,
};
const ONE_PDF = '202690901';
const TWO = '202690902';
const OLD = '202690903';
const MIXED = '202690904';
await db.collection('orders').doc(ONE_PDF).set({ ...base, id: ONE_PDF,
  items: [{ productId: 'p-roll', productName: 'Roll-up 85 × 200 cm', quantity: 1, unitPrice: 999, price: 999, options: { Size: '85 × 200 cm' },
    fileSpecs: { fileName: 'The House (Retractable Banners).pdf', fileUrl: PDF_URL, fileType: 'PDF', widthCm: 85, heightCm: 200 } }] });
await db.collection('orders').doc(TWO).set({ ...base, id: TWO, items: [
  { productId: 'p-mug', productName: 'Mug, white', quantity: 10, unitPrice: 50, price: 500, options: {}, productImage: PHOTO, artworkPending: true },
  { productId: 'p-card', productName: 'Business cards', quantity: 250, unitPrice: 2, price: 500, options: {},
    fileSpecs: { fileName: 'logo.png', fileUrl: PHOTO, fileType: 'PNG', widthCm: 8.5, heightCm: 5.5 } },
] });
await db.collection('orders').doc(OLD).set({ ...base, id: OLD, items: [
  { productId: PRODUCT, productName: 'Sheet picture test product', quantity: 1, unitPrice: 100, price: 100, options: {} },
] });
await db.collection('orders').doc(MIXED).set({ ...base, id: MIXED, items: [
  { productId: 'p-sticker', productName: 'Stickers', quantity: 100, unitPrice: 2, price: 200, options: {}, productImage: PHOTO,
    fileSpecs: { fileName: 'logo.ai', fileUrl: `${BASE}/no-such-file.ai`, fileType: 'AI' } },
  { productId: 'p-flyer', productName: 'Flyers', quantity: 500, unitPrice: 1, price: 500, options: {}, productImage: PHOTO,
    fileSpecs: { fileName: 'broken.pdf', fileUrl: `data:application/pdf;base64,${Buffer.from('this is not a pdf').toString('base64')}`, fileType: 'PDF' } },
  { productId: 'p-roll', productName: 'Roll-up', quantity: 1, unitPrice: 999, price: 999, options: {},
    fileSpecs: { fileName: 'The House.pdf', fileUrl: PDF_URL, fileType: 'PDF' } },
] });
const cleanup = async () => {
  for (const id of [ONE_PDF, TWO, OLD, MIXED]) await db.collection('orders').doc(id).delete().catch(() => {});
  await db.collection('products').doc(PRODUCT).delete().catch(() => {});
};
process.on('uncaughtException', async (err) => { console.error(err); await cleanup().catch(() => {}); process.exit(1); });

const { browser, page, errors } = await launch();
await loginAdmin(page);
await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {});
await page.getByRole('button', { name: 'Orders', exact: true }).first().click();

const PDF = { format: 'A4', preferCSSPageSize: true, printBackground: true, margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' } };
const pagesOf = (pdf) => (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
async function printNow(file) {
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  const pdf = await page.pdf(PDF);
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  writeFileSync(file, pdf);
  return pagesOf(pdf);
}
async function openOrder(id) {
  await page.keyboard.press('Escape').catch(() => {});
  await page.locator(`[data-order-row="${id}"]`).waitFor({ timeout: 20000 });
  await page.locator(`[data-order-row="${id}"]`).click();
  const panel = page.getByRole('dialog', { name: new RegExp(`Order ${id}`) });
  await panel.waitFor();
  return panel;
}
async function openDoc(panel, button) {
  await panel.getByRole('button', { name: button }).click();
  await page.locator('.rx-print-sheet').first().waitFor({ timeout: 10000 });
}
async function closeDoc() {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  if (await page.locator('.rx-print-sheet').count()) {
    await page.locator('button:has(svg.lucide-x)').last().click().catch(() => {});
    await page.waitForTimeout(200);
  }
}
/** Is the PDF's first page really drawn: a red pixel near the canvas's middle. */
const pdfDrawn = (sel) => page.evaluate((s) => {
  const c = document.querySelector(s);
  if (!c || !c.width) return null;
  const px = c.getContext('2d').getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
  return { w: c.width, h: c.height, rgb: [px[0], px[1], px[2]] };
}, sel);

// ---- one line, a PDF ----
let panel = await openOrder(ONE_PDF);
await openDoc(panel, /Job sheet/);
const sheetCell = page.locator('.rx-print-sheet [data-rx-sheet-picture]').first();
await page.locator('.rx-print-sheet [data-rx-line-picture-pdf]').first().waitFor({ state: 'visible', timeout: 20000 });
await page.waitForTimeout(300);
const drawn = await pdfDrawn('.rx-print-sheet [data-rx-line-picture-pdf]');
const width1 = await sheetCell.evaluate((el) => el.getBoundingClientRect().width);
check('job sheet, a PDF: its first page is drawn in the FILE cell, not the word "PDF"', !!drawn && drawn.rgb[0] > 150 && drawn.rgb[1] < 90, JSON.stringify(drawn));
check('…big: 240 px for a one-line job (was 56)', Math.round(width1) === 240 && (await sheetCell.getAttribute('data-rx-sheet-picture')) === 'pdf', String(width1));
await page.screenshot({ path: `${SHOTS}/150-sheet-pdf.png` });
check('…and the job sheet still prints on ONE A4 page', (await printNow(join(SHOTS, 'sheet-picture-job-1.pdf'))) === 1);
await closeDoc();
await openDoc(panel, 'Packing slip');
await page.locator('.rx-print-sheet [data-rx-line-picture-pdf]').first().waitFor({ state: 'visible', timeout: 20000 });
const slipCell = page.locator('.rx-print-sheet [data-rx-slip-picture]').first();
// Measured once the slip has finished opening (it scales in): the picture is there
// at once now, drawn already by the job sheet.
let slipWidth = 0;
for (let i = 0; i < 20 && slipWidth !== 200; i++) {
  await page.waitForTimeout(100);
  slipWidth = Math.round(await slipCell.evaluate((el) => el.getBoundingClientRect().width));
}
const slipKind = await slipCell.getAttribute('data-rx-slip-picture');
check('packing slip, the same PDF: drawn beside the item, 200 px — from the page the job sheet already drew (not fetched again)',
  slipWidth === 200 && slipKind === 'pdf' && (await page.locator('.rx-print-sheet img[data-rx-line-picture-pdf]').count()) === 1, `${slipWidth} px, ${slipKind}`);
await page.screenshot({ path: `${SHOTS}/151-slip-pdf.png` });
check('…and the slip prints on ONE A4 page', (await printNow(join(SHOTS, 'sheet-picture-slip-1.pdf'))) === 1);
await closeDoc();

// ---- two lines: the product's photo (no file yet), and a picture file ----
panel = await openOrder(TWO);
await openDoc(panel, /Job sheet/);
await page.waitForTimeout(800);
const kinds = await page.locator('.rx-print-sheet [data-rx-sheet-picture]').evaluateAll((els) => els.map((e) => e.getAttribute('data-rx-sheet-picture')));
const label = await page.locator('.rx-print-sheet [data-rx-sheet-picture="product"]').innerText().catch(() => '');
check('job sheet, two lines: the product\'s photo for the line with no file — labelled as such — and the customer\'s picture file',
  JSON.stringify(kinds) === '["product","file"]' && /Product photo/i.test(label) && /NO FILE/.test(label), `${JSON.stringify(kinds)} · ${label}`);
check('…170 px each for two lines', Math.round(await page.locator('.rx-print-sheet [data-rx-sheet-picture]').first().evaluate((el) => el.getBoundingClientRect().width)) === 170);
await page.screenshot({ path: `${SHOTS}/152-sheet-two.png` });
check('…ONE A4 page', (await printNow(join(SHOTS, 'sheet-picture-job-2.pdf'))) === 1);
await closeDoc();

// ---- an order from before 2026-10: the photo from the catalogue ----
panel = await openOrder(OLD);
await openDoc(panel, 'Packing slip');
await page.locator('.rx-print-sheet [data-rx-slip-picture="product"]').waitFor({ timeout: 15000 });
check('an older order (no photo on the line): the product\'s photo comes from the catalogue', (await page.locator('.rx-print-sheet [data-rx-slip-picture="product"] img').getAttribute('src')) === PHOTO);
await closeDoc();

// ---- files that cannot be drawn: the product's photo stands in, and says so ----
panel = await openOrder(MIXED);
await openDoc(panel, /Job sheet/);
await page.locator('.rx-print-sheet [data-rx-line-picture-file]').nth(1).waitFor({ timeout: 20000 }).catch(() => {});
await page.locator('.rx-print-sheet [data-rx-line-picture-pdf]').first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
const cells = await page.locator('.rx-print-sheet [data-rx-sheet-picture]').allInnerTexts();
check('an AI file: the product\'s photo, labelled "Product photo" and "AI file" — never passing for the artwork', /AI file/i.test(cells[0] ?? '') && /Product photo/i.test(cells[0] ?? ''), JSON.stringify(cells));
check('a PDF that will not open: the same, saying "PDF file"', /PDF file/i.test(cells[1] ?? '') && /Product photo/i.test(cells[1] ?? ''), JSON.stringify(cells));
check('…and the good PDF beside them is drawn', (await page.locator('.rx-print-sheet [data-rx-line-picture-pdf]').count()) === 1);
await page.screenshot({ path: `${SHOTS}/153-sheet-undrawable.png` });
await closeDoc();
await openDoc(panel, 'Packing slip');
await page.locator('.rx-print-sheet [data-rx-line-picture-file]').nth(1).waitFor({ timeout: 20000 }).catch(() => {});
const slipCells = await page.locator('.rx-print-sheet [data-rx-slip-picture]').allInnerTexts();
check('…the packing slip says the same', /AI file/i.test(slipCells[0] ?? '') && /PDF file/i.test(slipCells[1] ?? '') && slipCells.slice(0, 2).every((x) => /Product photo/i.test(x)), JSON.stringify(slipCells));
await closeDoc();
await page.waitForTimeout(1500);
const workers = page.workers().map((w) => w.url());
check('the sheets closed: at most the one shared pdf.js worker is left (each PDF used to keep its own)', workers.length <= 1, JSON.stringify(workers));

const real = errors.filter((e) => !/no-such-file\.ai|status of 404/.test(e));
check('no page errors', real.length === 0, real.slice(0, 3).join(' | '));
await cleanup();
await browser.close();
process.exit(summary() ? 1 : 0);
