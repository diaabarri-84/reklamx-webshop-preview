// Phase 0 as a CUSTOMER: the one-off charge on the product page, the server's
// agreement with it, and the delivery address with its own country.
// Needs product-dialog.mjs first (it switches Design service on for the product).
import { launch, BASE, SHOTS, db, check, summary } from './lib.mjs';

const PRODUCT_ID = 'prod-pmp-696';
const product = (await db.collection('products').doc(PRODUCT_ID).get()).data();
const design = (product.printingFields || []).find((f) => f.id === 'design_service');
const basic = design?.options?.find((o) => o.id === 'sv-dsgn-basic');
check('setup: Design service is on this product', Boolean(design?.enabled && basic));

const { browser, page, errors } = await launch();
await page.goto(`${BASE}/products/${PRODUCT_ID}`, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {});
const card = page.locator(`[data-option-card="sv-dsgn-basic"]`);
await card.scrollIntoViewIfNeeded();
const cardText = (await card.innerText()).replace(/\s+/g, ' ');
check('the designer card says ONE-OFF, not per unit', /995 kr one-off/.test(cardText) && !/kr\/unit/.test(cardText), cardText);
check('"Design it online" is not a card', (await page.locator('[data-option-card="sv-dsgn-online"]').count()) === 0);
await card.click();

// 50 pieces, from the quantity table.
await page.getByText('50 pcs', { exact: true }).first().click();
await page.waitForTimeout(600);
// The quantity table's 50-piece row: the smallest element holding both "50 pcs"
// and a SEK amount (the header echo "QUANTITY: 50 pcs" has no amount).
const ladderTotal50 = await page.locator('xpath=//*[.//*[normalize-space()="50 pcs"] and contains(normalize-space(.), "SEK") and not(.//*[.//*[normalize-space()="50 pcs"] and contains(normalize-space(.), "SEK")])]').first().innerText().catch(() => '');
await page.screenshot({ path: `${SHOTS}/20-oneoff-product.png` });
const summaryText = (await page.locator('text=/one-off charges/').first().innerText().catch(() => '')).replace(/\s+/g, ' ');
check('the price line names the one-off charge', /one-off charges/.test(summaryText), summaryText);

// The SERVER's price for the same selection — the number Mollie would charge.
const selectedIds = await page.locator('[data-option-card][aria-pressed="true"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-option-card')));
const selects = await page.locator('select').evaluateAll((els) => els.map((e) => e.value).filter(Boolean));
const optionIds = [...new Set([...selectedIds, ...selects])];
const quote = await (await fetch(`${BASE}/api/checkout/quote`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ items: [{ productId: PRODUCT_ID, quantity: 50, optionIds }], shippingMethod: 'pickup' }),
})).json();
const line = quote?.items?.[0] ?? quote?.lines?.[0];
const unit = Number(line?.unitPrice);
const setup = Number(line?.setupFee) || 0;
check('server: the 995 is added ONCE, not ×50', Number(line?.onceCharges) === 995 && Number(line?.totalPrice) === unit * 50 + setup + 995,
  `unit ${unit} × 50 + setup ${setup} + once ${line?.onceCharges} = ${line?.totalPrice}`);
check('the page and the server agree on the 50-piece total', ladderTotal50.replace(/[\s\u00a0\u202f]/g, '').includes(`${Math.round(Number(line?.totalPrice))}SEK`),
  `page row: "${ladderTotal50.replace(/\s+/g, ' ')}" vs server ${line?.totalPrice}`);

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
process.exit(summary() ? 1 : 0);
