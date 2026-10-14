// Phase 0 end to end: a customer orders 50 with a designer (one-off) and a
// SEPARATE delivery address in Denmark; then staff open the order.
import { launch, loginAdmin, BASE, SHOTS, db, check, summary } from './lib.mjs';

const PRODUCT_ID = 'prod-pmp-696';
const EMAIL = `buyer-${Date.now()}@emulator.test`;

const { browser, page, errors } = await launch();
await page.goto(`${BASE}/products/${PRODUCT_ID}`, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {});
await page.locator('[data-option-card="sv-dsgn-basic"]').click();
await page.getByText('50 pcs', { exact: true }).first().click();
await page.getByRole('button', { name: /Add to cart/i }).first().click();
await page.waitForTimeout(800);

await page.goto(`${BASE}/checkout`, { waitUntil: 'domcontentloaded' });
await page.locator('#co-firstname').waitFor({ timeout: 15000 });
await page.fill('#co-firstname', 'Anna');
await page.fill('#co-lastname', 'Svensson');
await page.fill('#co-address1', 'Storgatan 1');
await page.fill('#co-postcode', '111 22');
await page.fill('#co-city', 'Stockholm');
// The lists hold ISO codes now (round 16, item 2); the order is still filed
// under the owner's name for the country — 'Danmark' — as the checks below require.
await page.selectOption('#co-country', 'SE');
await page.fill('#co-email', EMAIL);
await page.fill('#co-phone', '070-123 45 67');

await page.getByText('Different Shipping Address', { exact: true }).click();
const shipForm = page.locator('#co-ship-country');
check('the delivery form has its own country field', (await shipForm.count()) === 1);
check('…starting from the billing country', (await shipForm.inputValue()) === 'SE', await shipForm.inputValue());
await page.getByPlaceholder('First Name', { exact: true }).fill('Lars');
await page.getByPlaceholder('Street Address', { exact: true }).fill('Strøget 10');
await page.getByPlaceholder('Postcode', { exact: true }).fill('1160');
await page.getByPlaceholder('City', { exact: true }).fill('København');
await shipForm.selectOption('DK');
await page.screenshot({ path: `${SHOTS}/30-checkout-ship.png`, fullPage: false });

// Terms, then Pay. There is no payment key in the test copy, so the payment
// step fails — after the server has created the order, which is what we read.
// The terms box is the checkbox in the label that links to the terms/privacy pages.
await page.locator('label:has(a[href*="terms"]) input[type="checkbox"], label:has(a[href*="villkor"]) input[type="checkbox"], label:has(a[href*="privacy"]) input[type="checkbox"]').last().check();
// The payment step needs Mollie, which the test copy deliberately does not
// have. So the EXACT body the checkout page sends to /api/checkout/pay is
// captured, and the same body is placed through the admin order endpoint —
// the order is the one the form built, with no payment involved.
let payBody = null;
await page.route('**/api/checkout/pay', async (route) => {
  payBody = route.request().postDataJSON();
  await route.continue();
});
const payBtn = page.getByRole('button', { name: /^Pay/ }).last();
console.log('   pay button enabled:', await payBtn.isEnabled().catch(() => 'n/a'));
await payBtn.click().catch((e) => console.log('   pay click failed:', e.message.slice(0, 120)));
await page.waitForTimeout(3000);
await page.screenshot({ path: `${SHOTS}/32-after-pay.png`, fullPage: false });
console.log('   alerts:', (await page.locator('[role="alert"], .text-red-600, .text-red-700').allInnerTexts().catch(() => [])).slice(0, 4).join(' | ').slice(0, 300));

check('the checkout page sent the order body', Boolean(payBody));
if (payBody) {
  const signIn = await (await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@emulator.test', password: 'emulator-admin-1', returnSecureToken: true }),
  })).json();
  const placed = await fetch(`${BASE}/api/checkout/order`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signIn.idToken}` },
    body: JSON.stringify(payBody),
  });
  console.log('   placed through the admin endpoint:', placed.status);
}
let order = null;
for (let i = 0; i < 30 && !order; i++) {
  await page.waitForTimeout(500);
  const snap = await db.collection('orders').where('customerEmail', '==', EMAIL.toLowerCase()).get();
  if (!snap.empty) order = { id: snap.docs[0].id, ...snap.docs[0].data() };
}
check('the order was created', Boolean(order), 'no order for ' + EMAIL);
if (order) {
  const cd = order.customerDetails || {};
  check('stored: a separate delivery address', cd.differentShippingAddress === true && cd.shippingAddressDetails?.city === 'København');
  check('stored: its country is Danmark, not Sverige', cd.shippingAddressDetails?.country === 'Danmark', String(cd.shippingAddressDetails?.country));
  const item = order.items?.[0] || {};
  check('stored: the one-off charge on the line', item.onceCharges === 995 && (item.onceOptions || []).some((o) => o.amount === 995), JSON.stringify({ once: item.onceCharges, opts: item.onceOptions }));
  check('stored: the line is unit × 50 + 995', item.price === item.unitPrice * 50 + (item.setupFee || 0) + 995, `${item.unitPrice} × 50 + ${item.setupFee} + 995 = ${item.price}`);

  // Staff open it: the packing slip and the card name the DANISH address.
  const staff = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const sp = await staff.newPage();
  await loginAdmin(sp);
  await sp.goto(`${BASE}/staff-dashboard`, { waitUntil: 'domcontentloaded' });
  await sp.getByText(order.id).first().waitFor({ timeout: 20000 });
  const cardBody = await sp.locator(`xpath=//*[contains(normalize-space(.), ${JSON.stringify(order.id)})]/ancestor::div[.//button[normalize-space()='Packing slip']][1]`).first().innerText();
  check('staff card: delivers to København, Danmark', /Strøget 10/.test(cardBody) && /København/.test(cardBody) && /Danmark/.test(cardBody), cardBody.slice(0, 300).replace(/\s+/g, ' '));
  await sp.locator(`xpath=//*[contains(normalize-space(.), ${JSON.stringify(order.id)})]/ancestor::div[.//button[normalize-space()='Packing slip']][1]//button[normalize-space()='Packing slip']`).first().click();
  await sp.locator('.rx-print-sheet').first().waitFor({ timeout: 10000 });
  const slip = await sp.locator('.rx-print-sheet').first().innerText();
  check('packing slip: the Danish address, not Stockholm', /Strøget 10/.test(slip) && /Danmark/.test(slip) && !/Storgatan 1/.test(slip), slip.slice(0, 300).replace(/\s+/g, ' '));
  await sp.screenshot({ path: `${SHOTS}/31-packing-slip.png` });
  await staff.close();
}

check('no page errors on the shop side', errors.filter((e) => !/payment|mollie|503|500|Failed to load resource/i.test(e)).length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
process.exit(summary() ? 1 : 0);
