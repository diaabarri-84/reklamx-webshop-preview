// Phase 7 — "one A4 page only". Every printed document, for orders of 1, 5, 15
// and 30 lines, printed to a real A4 PDF by Chromium; the PDF is the only thing
// believed — its page count, and (pdftotext) that the order really is on it.
// Up to 15 lines (six long options each) must be one page; at 30 lines one page
// is physically impossible for some documents at any readable size, and then
// the check is that a real PDF at the smallest type proves it, and that the
// document printed at its normal size instead.
//
// page.pdf() fires beforeprint and afterprint itself, exactly as pressing Print
// does (checked: ["before", "mq:true", "after"]) — and beforeprint is what fits
// the sheet (src/lib/printFit.ts). The test fires it once by hand first only to
// READ the zoom it chose. The PDF gets the same 10 mm margins the stylesheet's
// @page asks a printer for, so its printable area is the real one.
//
// Then the 15-line order again in a 390 px window with the browser's text size at
// 20 px: what is measured must not depend on the window (the review of Phase 7 —
// window breakpoints inside the documents made a phone measure a different
// layout from the one it printed).
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, loginAdmin, BASE, SHOTS, db, check, summary } from './lib.mjs';

const OPTIONS = {
  Material: 'Blockout 440 g PVC-free banner', Lamination: 'Matte anti-scratch', Hemming: 'Welded hem, all sides',
  Eyelets: 'Every 50 cm, chrome', 'Design service': 'Designer creates the design — basic', Delivery: 'Express — 2 working days',
};
const line = (i) => ({
  productId: 'p', productName: `Roll Up Premium ${85 + i}×200 cm — double-sided print, carry bag`, sku: `RX-${1000 + i}`,
  quantity: 2 + (i % 5), unitPrice: 990 + i, price: (990 + i) * (2 + (i % 5)), options: OPTIONS,
  setupFee: 49, onceCharges: 995, onceOptions: [{ label: 'Designer creates the design — basic', amount: 995 }],
  // Every line cut to a shape — the job sheet's "Cut:" badge on every row is the
  // worst case for one page (round 16, item 4).
  shapes: [[{ outline: 'circle', label: 'Round (circle)' }], [{ outline: 'custom', label: 'Custom die-cut contour (your own outline)' }], [{ outline: 'star', label: 'Star' }]][i % 3],
});
const order = (id, n) => ({
  id, userId: 'guest', createdAt: new Date().toISOString(), status: 'in_print', paymentStatus: 'paid', paidAt: new Date().toISOString(),
  customerName: 'Anna Svensson', customerEmail: 'anna@firma.se', currency: 'SEK',
  customerDetails: { firstName: 'Anna', lastName: 'Svensson', company: 'Firma AB', taxId: 'SE556677889901', phone: '070-123 45 67',
    address1: 'Storgatan 1', postcode: '111 22', city: 'Stockholm', country: 'Sverige' },
  shippingMethod: 'standard', shippingMethodTitle: 'Standard delivery (DHL / DSV / UPS)', shippingCost: 99,
  items: Array.from({ length: n }, (_, i) => line(i)),
  goodsNet: 1000 * n, netTotal: 1000 * n + 99, vatAmount: 250 * n, grossTotal: 1250 * n + 124, dueDate: '2026-10-20', printDate: '2026-10-12',
  priority: 'urgent', notes: 'Please check the logo colours carefully — the blue must match our previous order exactly.',
});
// 17 and 20: the job sheet's picture box was sized in pixels for a while and printed
// a third bigger than the old rem box — a 17-line sheet ran onto a second page.
const SIZES = [1, 5, 15, 17, 20, 30];
// Ids of this suite's own: 2026910nn. 20269nnnn collided with orders.mjs's
// 202690001 and 202690005, and each suite overwrote the other's orders.
const idOf = (n) => `2026910${String(n).padStart(2, '0')}`;
for (const n of SIZES) await db.collection('orders').doc(idOf(n)).set(order(idOf(n), n));

const DOCS = [
  { button: 'Invoice', key: 'invoice' },
  { button: 'Receipt', key: 'receipt' },
  { button: /Job sheet/, key: 'jobsheet' },
  { button: 'Packing slip', key: 'packingslip' },
];

// The numbers printFit.ts works to: A4 less 10 mm margins, less its 12 px slack.
const MIN_PRINT_ZOOM = 0.6;
const PAGE_ROOM = 1046 - 12;
const PDF = { format: 'A4', preferCSSPageSize: true, printBackground: true, margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' } };

let canReadPdf = true;
try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); } catch { canReadPdf = false; }
if (!canReadPdf) console.log('  ⚠️  pdftotext is not installed — the PDFs\' CONTENT is not checked (brew install poppler)');

const { browser, page, errors } = await launch();
await loginAdmin(page);
await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {});
await page.getByRole('button', { name: 'Orders', exact: true }).first().click();
const cdp = await page.context().newCDPSession(page);

const pagesOf = (pdf) => (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
const zoomOf = () => page.evaluate(() => Number(document.querySelector('.rx-print-sheet').style.getPropertyValue('--rx-print-zoom') || '1'));
/** The sheet's printed height at a zoom, measured exactly as printFit.ts measures it. */
const heightAt = (z) => page.evaluate((zz) => {
  const sheet = document.querySelector('.rx-print-sheet');
  const before = sheet.style.getPropertyValue('--rx-print-zoom');
  document.documentElement.classList.add('rx-printing');
  sheet.style.setProperty('--rx-print-zoom', String(zz));
  const h = sheet.getBoundingClientRect().height;
  if (before) sheet.style.setProperty('--rx-print-zoom', before); else sheet.style.removeProperty('--rx-print-zoom');
  document.documentElement.classList.remove('rx-printing');
  return h;
}, z);

async function openDoc(panel, d) {
  await panel.getByRole('button', { name: d.button }).click();
  await page.locator('.rx-print-sheet').first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);
}
async function closeDoc() {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  if (await page.locator('.rx-print-sheet').count()) {
    await page.locator('button:has(svg.lucide-x)').last().click().catch(() => {});
    await page.waitForTimeout(200);
  }
}
/** Fit (beforeprint), print to PDF, unfit (afterprint). */
async function printNow(file) {
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  const zoom = await zoomOf();
  const pdf = await page.pdf(PDF);
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  writeFileSync(file, pdf);
  return { zoom, pages: pagesOf(pdf) };
}

for (const n of SIZES) {
  const id = idOf(n);
  await page.locator(`[data-order-row="${id}"]`).waitFor({ timeout: 20000 });
  await page.locator(`[data-order-row="${id}"]`).click();
  const panel = page.getByRole('dialog', { name: new RegExp(`Order ${id}`) });
  await panel.waitFor();
  for (const d of DOCS) {
    await openDoc(panel, d);
    if (n === 5) await page.screenshot({ path: join(SHOTS, `90-screen-${d.key}.png`) }); // how it looks before printing
    const file = join(SHOTS, `print-${d.key}-${n}.pdf`);
    const { zoom, pages } = await printNow(file);
    const label = `${d.key}, ${n} line${n === 1 ? '' : 's'}`;

    if (n <= 15 || pages === 1) {
      check(`${label}: ONE A4 page (zoom ${zoom.toFixed(2)})`, pages === 1, `${pages} pages`);
      if (n === 1) check(`${label}: printed at full size, not shrunk`, zoom === 1, String(zoom));
      // Not shrunk more than it needs: one step larger no longer fits.
      if (zoom < 1) {
        const larger = Math.min(1, zoom + 0.01);
        check(`${label}: the zoom is the largest that fits (${larger.toFixed(2)} is too tall)`, (await heightAt(larger)) > PAGE_ROOM);
      }
    } else {
      // More than one page is only right when one page is IMPOSSIBLE — proven on
      // a real PDF at the smallest zoom, not by the code under test measuring
      // itself — and then the document prints at its normal size.
      // page.pdf() fires beforeprint, and printFit re-fits the sheet (to 1,
      // here). A first version of this check set the floor and printed — at 1 —
      // and so "proved" nothing; stopping printFit's listener does not work
      // either (on window, Chromium runs listeners in the order they were added,
      // capture or not). So a listener added AFTER printFit's puts the floor back.
      await page.evaluate((min) => {
        window.__rxFloor = () => document.querySelector('.rx-print-sheet').style.setProperty('--rx-print-zoom', String(min));
        window.addEventListener('beforeprint', window.__rxFloor);
      }, MIN_PRINT_ZOOM);
      const floorPdf = await page.pdf(PDF);
      await page.evaluate(() => {
        window.removeEventListener('beforeprint', window.__rxFloor);
        document.querySelector('.rx-print-sheet').style.removeProperty('--rx-print-zoom');
      });
      const floorPages = pagesOf(floorPdf);
      writeFileSync(join(SHOTS, `print-floor-${d.key}-${n}.pdf`), floorPdf);
      check(`${label}: cannot fit one page even at the smallest type (a PDF at ${MIN_PRINT_ZOOM}: ${floorPages} pages) → normal size, ${pages} pages`,
        floorPages > 1 && zoom === 1, `zoom ${zoom}, ${floorPages} pages at the floor`);
      // …and the paper agrees with the measurement printFit decided by.
      check(`${label}: the measurement agrees with the paper at the floor`, ((await heightAt(MIN_PRINT_ZOOM)) > PAGE_ROOM) === (floorPages > 1));
    }
    if (canReadPdf) {
      // The order really is on the paper — a blank page is one page too.
      const text = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });
      check(`${label}: the PDF carries the order number and its LAST line`, text.includes(id) && text.includes(`${85 + n - 1}×200`));
    }

    // The same 15-line order in a phone-wide window with the browser's text at
    // 20 px: the document must measure — and print — exactly as on the desktop.
    if (n === 15) {
      await page.setViewportSize({ width: 390, height: 844 });
      await cdp.send('Page.setFontSizes', { fontSizes: { standard: 20, fixed: 16 } });
      await page.waitForTimeout(300);
      const phone = await printNow(join(SHOTS, `print-phone-${d.key}-${n}.pdf`));
      check(`${label}, 390 px window, 20 px text: still ONE page, at the desktop's zoom (${phone.zoom.toFixed(2)} vs ${zoom.toFixed(2)})`,
        phone.pages === 1 && Math.abs(phone.zoom - zoom) <= 0.011, `${phone.pages} pages, zoom ${phone.zoom}`);
      await cdp.send('Page.setFontSizes', { fontSizes: { standard: 16, fixed: 13 } });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.waitForTimeout(300);
    }
    await closeDoc();
  }
  await panel.getByRole('button', { name: 'Close' }).click();
}

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
// Leave the emulator as it was found: these are paid, urgent, in-print orders,
// and the orders suite counts exactly such orders.
for (const n of SIZES) await db.collection('orders').doc(idOf(n)).delete();
process.exit(summary() ? 1 : 0);
