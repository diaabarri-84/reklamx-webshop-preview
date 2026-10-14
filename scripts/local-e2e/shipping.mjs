// Round 16, item 2 — "there is no place to edit shipping prices and countries".
// The owner edits them in Admin → Shipping; then a customer's checkout, and the
// SERVER, must follow — including when someone posts what the page never offers.
//
//   the owner: Sweden's standard price 99 → 79, express Sweden-only, the
//   Netherlands added at 249, Germany switched off, express dragged above
//   standard, a typo refused; saved — and nothing else in the document touched.
//   a customer: Sweden / Norway / the Netherlands / Germany each get their menu.
//   the server: a body claiming Sweden for a Dutch address, express to Norway,
//   delivery to switched-off Germany, a half-filled delivery address, and a total
//   that is no longer the price — each refused or priced from the address.
//   a price changed while the checkout is open: Pay is refused (409), the page
//   says so and shows the new fee.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launch, loginAdmin, dragTo, BASE, SHOTS, db, check, summary } from './lib.mjs';

const REPO = process.env.REPO || fileURLToPath(new URL('../..', import.meta.url));
const { FieldValue } = createRequire(`${REPO}/package.json`)('firebase-admin/firestore');

const PRODUCT_ID = 'prod-pmp-696';
const EMAIL = `ship-${Date.now()}@emulator.test`;
const settingsRef = db.collection('settings').doc('printSettings');
const original = (await settingsRef.get()).data()?.shipping;
// Start from "never saved" whatever an earlier, crashed run left behind, and put
// the original back however this run ends.
await settingsRef.set({ shipping: FieldValue.delete() }, { merge: true });
const restore = async () => {
  await settingsRef.set({ shipping: original === undefined ? FieldValue.delete() : original }, { merge: true });
  for (const doc of (await db.collection('orders').where('customerEmail', 'in', [EMAIL.toLowerCase(), `nl-${EMAIL}`.toLowerCase(), `one-${EMAIL}`.toLowerCase(), `code-${EMAIL}`.toLowerCase()]).get()).docs) await doc.ref.delete();
};
process.on('uncaughtException', async (err) => { console.error(err); await restore().catch(() => {}); process.exit(1); });
process.on('unhandledRejection', async (err) => { console.error(err); await restore().catch(() => {}); process.exit(1); });
const docBefore = (await settingsRef.get()).data() ?? {};
const { shipping: shippingBefore, ...othersBefore } = docBefore;

const { browser, page, errors } = await launch();
await loginAdmin(page);
await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {});
await page.getByRole('button', { name: 'Shipping', exact: true }).first().click();
await page.locator('[data-rx-shipping-admin]').waitFor({ timeout: 20000 });
const price = (method, code) => page.locator(`[data-ship-price="${method}:${code}"]`);

// ---- the owner ----
check('the tab starts from what the shop charges today: standard 99 to Sweden', (await price('standard', 'SE').inputValue()) === '99');
check('…and the five countries checkout listed', (await page.locator('[data-ship-country]').count()) === 5);

await price('standard', 'SE').fill('79');
for (const c of ['NO', 'DK', 'FI', 'DE']) await price('express', c).fill('');
await page.getByRole('button', { name: 'Add a country' }).click();
const newRow = page.locator('[data-ship-country]').last();
await newRow.getByRole('textbox', { name: 'Code' }).fill('NL');
await page.locator('[data-ship-country="NL"]').getByRole('textbox', { name: 'Name on orders' }).fill('Nederländerna');
await price('standard', 'NL').fill('249');
await page.locator('[data-ship-country="DE"]').getByRole('checkbox', { name: 'Delivers here' }).uncheck();
await dragTo(page, page.locator('[data-ship-method="express"] button[aria-label^="Drag"]'), page.locator('[data-ship-method="standard"]'), { offsetY: -10 });
await page.waitForTimeout(300);
const methodOrder = await page.locator('[data-ship-method]').evaluateAll((els) => els.map((e) => e.getAttribute('data-ship-method')));
check('express dragged above standard', methodOrder.join(',') === 'express,standard,pickup', methodOrder.join(','));
const previewSE = await page.locator('[data-ship-preview]').innerText();
check('the preview shows what a Swede will see', /Express/.test(previewSE) && /79\.00 kr/.test(previewSE) && /Free/.test(previewSE), previewSE.replace(/\s+/g, ' '));

// A typo is refused, and nothing is written.
await price('standard', 'NO').fill('9O');
await page.getByRole('button', { name: 'Save shipping' }).click();
await page.getByRole('alert').filter({ hasText: 'not a number' }).waitFor({ timeout: 5000 });
check('a price that is not a number is refused at Save', true);
check('…and nothing was written', JSON.stringify((await settingsRef.get()).data()?.shipping ?? null) === JSON.stringify(shippingBefore ?? null));
await price('standard', 'NO').fill('99');
await page.getByRole('button', { name: 'Save shipping' }).click();
await page.getByRole('status').filter({ hasText: 'Saved' }).waitFor({ timeout: 10000 });
await page.screenshot({ path: `${SHOTS}/95-shipping-admin.png`, fullPage: true });

const saved = (await settingsRef.get()).data();
const m = (id) => saved.shipping.methods.find((x) => x.id === id);
check('saved: standard 79 to Sweden, 249 to the Netherlands', m('standard').prices.SE === 79 && m('standard').prices.NL === 249, JSON.stringify(m('standard').prices));
check('saved: express to Sweden only', JSON.stringify(Object.keys(m('express').prices)) === '["SE"]', JSON.stringify(m('express').prices));
check('saved: the Netherlands added, Germany off, Sweden still home',
  saved.shipping.countries.some((c) => c.code === 'NL' && c.name === 'Nederländerna' && c.enabled) &&
  saved.shipping.countries.some((c) => c.code === 'DE' && !c.enabled) && saved.shipping.homeCountry === 'SE');
check('saved: his order of the methods', saved.shipping.methods.map((x) => x.id).join(',') === 'express,standard,pickup');
const { shipping: _s, ...othersAfter } = saved;
check('saved: nothing else in the settings document was touched (VAT, loyalty, print rules)', JSON.stringify(othersAfter) === JSON.stringify(othersBefore));
check('the Netherlands\' code is fixed once saved', await page.locator('[data-ship-country="NL"]').getByRole('textbox', { name: 'Code' }).isDisabled());

// ---- a customer ----
const shopCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const cp = await shopCtx.newPage();
cp.on('pageerror', (e) => errors.push(String(e?.message ?? e)));
await cp.goto(`${BASE}/products/${PRODUCT_ID}`, { waitUntil: 'domcontentloaded' });
await cp.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {});
await cp.getByRole('button', { name: /Add to cart/i }).first().click();
await cp.waitForTimeout(800);
await cp.goto(`${BASE}/checkout`, { waitUntil: 'domcontentloaded' });
await cp.locator('#co-firstname').waitFor({ timeout: 15000 });

const menu = async () => {
  await cp.waitForTimeout(400);
  await cp.locator('[data-ship-option]').first().waitFor({ timeout: 15000 });
  return cp.locator('[data-ship-option]').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-ship-option')} ${(e.textContent || '').match(/[\d.]+ kr|No fee/)?.[0] ?? ''}`.trim()));
};
const waitMenu = async (want) => {
  for (let i = 0; i < 40; i++) {
    const got = await menu().catch(() => []);
    if (JSON.stringify(got) === JSON.stringify(want)) return got;
    await cp.waitForTimeout(250);
  }
  return menu().catch(() => []);
};
const billing = await cp.locator('#co-country option').evaluateAll((os) => os.map((o) => o.value));
check('billing lists every country he has — switched-off Germany too', ['SE', 'NO', 'DK', 'FI', 'DE', 'NL'].every((c) => billing.includes(c)), billing.join(','));
const nlLabel = await cp.locator('#co-country option[value="NL"]').innerText();
check('…named in the shopper\'s language (Netherlands)', nlLabel === 'Netherlands', nlLabel);

const se = await waitMenu(['express 169.00 kr', 'standard 79.00 kr', 'pickup No fee']);
check('Sweden: his order, his prices — express first, standard 79, pickup free', JSON.stringify(se) === JSON.stringify(['express 169.00 kr', 'standard 79.00 kr', 'pickup No fee']), se.join(' | '));
await cp.selectOption('#co-country', 'NO');
const no = await waitMenu(['standard 99.00 kr', 'pickup No fee']);
check('Norway: no express (Sweden only), standard at Norway\'s price', JSON.stringify(no) === JSON.stringify(['standard 99.00 kr', 'pickup No fee']), no.join(' | '));
check('…and the chosen express was swapped for one Norway can have', await cp.locator('[data-ship-option="standard"] input').isChecked());
await cp.selectOption('#co-country', 'NL');
const nl = await waitMenu(['standard 249.00 kr', 'pickup No fee']);
check('the Netherlands: the new country at its own price', JSON.stringify(nl) === JSON.stringify(['standard 249.00 kr', 'pickup No fee']), nl.join(' | '));
await cp.selectOption('#co-country', 'DE');
const de = await waitMenu(['pickup No fee']);
check('Germany (switched off): pickup only, and the page says why', JSON.stringify(de) === JSON.stringify(['pickup No fee']) && (await cp.getByText(/don't deliver to/).count()) > 0, de.join(' | '));
await cp.screenshot({ path: `${SHOTS}/96-checkout-germany-off.png` });
const deliveryList = await (async () => {
  await cp.getByText('Different Shipping Address', { exact: true }).click();
  return cp.locator('#co-ship-country option').evaluateAll((os) => os.map((o) => o.value));
})();
check('the DELIVERY list leaves switched-off Germany out', !deliveryList.includes('DE') && deliveryList.includes('NL'), deliveryList.join(','));
check('…and a delivery address starts on home, not on Germany', (await cp.locator('#co-ship-country').inputValue()) === 'SE');
// Billing Sweden, parcel to Norway: the menu is the PARCEL's country.
await cp.selectOption('#co-country', 'SE');
await cp.locator('#co-ship-country').selectOption('NO');
const toNorway = await waitMenu(['standard 99.00 kr', 'pickup No fee']);
check('billing Sweden, delivery to Norway: Norway\'s menu and price (99, not Sweden\'s 79)', JSON.stringify(toNorway) === JSON.stringify(['standard 99.00 kr', 'pickup No fee']), toNorway.join(' | '));
await cp.getByText('Different Shipping Address', { exact: true }).click();

// Capture a real order body from this page, to bend it on its way to the server.
await cp.selectOption('#co-country', 'SE');
await waitMenu(['express 169.00 kr', 'standard 79.00 kr', 'pickup No fee']).catch(() => {});
await cp.fill('#co-firstname', 'Jan');
await cp.fill('#co-lastname', 'de Vries');
await cp.fill('#co-address1', 'Storgatan 1');
await cp.fill('#co-postcode', '111 22');
await cp.fill('#co-city', 'Stockholm');
await cp.fill('#co-email', EMAIL);
await cp.fill('#co-phone', '070-123 45 67');
await cp.locator('[data-ship-option="standard"]').click();
await cp.waitForTimeout(800);
await cp.locator('label:has(a[href*="terms"]) input[type="checkbox"], label:has(a[href*="privacy"]) input[type="checkbox"]').last().check();

// ---- a price changes while the checkout is open ----
// The test copy has no payment key, so /api/checkout/pay answers 503 before it
// creates anything. The page's request is handed to the admin order endpoint
// instead — the same createOrder, the real 409 — and its answer goes back to the
// page, which is what is being tested here.
const signIn = await (await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@emulator.test', password: 'emulator-admin-1', returnSecureToken: true }),
})).json();
let payStatus = null;
let payBody = null;
await cp.route('**/api/checkout/pay', async (route) => {
  payBody = route.request().postDataJSON();
  const r = await fetch(`${BASE}/api/checkout/order`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signIn.idToken}` }, body: JSON.stringify(payBody),
  });
  payStatus = r.status;
  await route.fulfill({ status: r.status, contentType: 'application/json', body: await r.text() });
});
await settingsRef.set({ shipping: { ...saved.shipping, methods: saved.shipping.methods.map((x) => (x.id === 'standard' ? { ...x, prices: { ...x.prices, SE: 89 } } : x)) } }, { mergeFields: ['shipping'] });
const payButton = cp.getByRole('button', { name: /^Pay/ }).last();
await payButton.click();
const saidSo = await cp.getByText(/A price changed while you were here/).waitFor({ timeout: 15000 }).then(() => true, () => false);
if (!saidSo) await cp.screenshot({ path: `${SHOTS}/97-price-change-debug.png`, fullPage: true });
check('a price raised behind the customer\'s back: Pay is refused (409), not charged', payStatus === 409, String(payStatus));
check('…and the page says the price changed', saidSo);
const after = await waitMenu(['express 169.00 kr', 'standard 89.00 kr', 'pickup No fee']);
check('…and shows the new fee (89)', after.includes('standard 89.00 kr'), after.join(' | '));
check('the order body named what was on screen', Number.isFinite(payBody?.expectedGrossTotal));
const firstBody = payBody;
// Pay again, now that the new total is the one on screen: it goes through.
await cp.waitForTimeout(800);
await payButton.click();
let paidOrder = null;
for (let i = 0; i < 40 && !paidOrder; i++) {
  await cp.waitForTimeout(250);
  paidOrder = (await db.collection('orders').where('customerEmail', '==', EMAIL.toLowerCase()).get()).docs[0]?.data() ?? null;
}
check('the second Pay goes through, at the new fee', payStatus === 200 && paidOrder?.shippingCost === 89, `${payStatus} ${paidOrder?.shippingCost}`);
payBody = firstBody;

// ---- the server, given what the page never offers ----
const place = async (patch) => {
  const customer = { ...payBody.customer, ...(patch.customer ?? {}) };
  // The page sends each address's country as a code AND a name, and the server
  // trusts the code first. A check that changes the country by name drops the
  // page's code — as a page from before this release would send it.
  if (patch.customer?.country !== undefined && patch.customer?.countryCode === undefined) delete customer.countryCode;
  const body = { ...payBody, expectedGrossTotal: undefined, ...patch, customer };
  const r = await fetch(`${BASE}/api/checkout/order`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signIn.idToken}` }, body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const dutch = { country: 'Nederländerna', address1: 'Damrak 1', postcode: '1012 LG', city: 'Amsterdam' };
const claimed = await place({ deliveryCountry: 'SE', customer: { ...dutch, email: `nl-${EMAIL}` } });
const nlOrder = claimed.body?.orderId ? (await db.collection('orders').doc(claimed.body.orderId).get()).data() : null;
check('a Dutch address claiming "SE" in the body pays the Dutch price', claimed.status === 200 && nlOrder?.shippingCost === 249, `${claimed.status} ${nlOrder?.shippingCost}`);
check('…filed as Nederländerna, delivery code NL (what Zendr gets)', nlOrder?.customerDetails?.country === 'Nederländerna' && nlOrder?.deliveryCountryCode === 'NL');
const byCode = await place({ customer: { email: `code-${EMAIL}`, country: 'Sverige', countryCode: 'NO' } });
const byCodeOrder = byCode.body?.orderId ? (await db.collection('orders').doc(byCode.body.orderId).get()).data() : null;
check('the code the page sends decides, and the order is filed under his name for it (NO → Norge, 99)',
  byCode.status === 200 && byCodeOrder?.shippingCost === 99 && byCodeOrder?.customerDetails?.country === 'Norge' && byCodeOrder?.deliveryCountryCode === 'NO',
  `${byCode.status} ${byCodeOrder?.shippingCost} ${byCodeOrder?.customerDetails?.country}`);
const exNo = await place({ shippingMethod: 'express', customer: { country: 'Norge' } });
check('express posted for Norway (not offered there): refused', exNo.status === 400, `${exNo.status} ${exNo.body?.error}`);
const toDe = await place({ customer: { country: 'Deutschland' } });
check('delivery to switched-off Germany: refused, by name', toDe.status === 400 && /Deutschland/.test(toDe.body?.error ?? ''), `${toDe.status} ${toDe.body?.error}`);
const truthy = await place({ customer: { email: `one-${EMAIL}`, country: 'Norge', differentShippingAddress: 1, shippingAddressDetails: { city: 'Stockholm', country: 'Sverige' } } });
const truthyOrder = truthy.body?.orderId ? (await db.collection('orders').doc(truthy.body.orderId).get()).data() : null;
check('"differentShippingAddress: 1" is not a ticked box: priced and filed by the billing address (Norway 99)',
  truthy.status === 200 && truthyOrder?.shippingCost === 99 && truthyOrder?.customerDetails?.differentShippingAddress === false, `${truthy.status} ${truthyOrder?.shippingCost}`);
const half = await place({ customer: { differentShippingAddress: true, shippingAddressDetails: { firstName: 'X', address1: '', postcode: '', city: '', country: 'Danmark' } } });
check('a ticked delivery address with no street: refused', half.status === 400 && /delivery address/.test(half.body?.error ?? ''), `${half.status} ${half.body?.error}`);
const stale = await place({ expectedGrossTotal: 1 });
check('a total that is no longer the price: 409', stale.status === 409, String(stale.status));
const proto = await place({ customer: { country: '__proto__' } });
check('"__proto__" as the country: no delivery sold', proto.status === 400, `${proto.status} ${proto.body?.error}`);

// ---- a reload must not turn a Dutch customer Swedish ----
// The form is saved in the browser; his settings arrive a moment after the page.
// Corrected against the compiled five countries in that moment, 'NL' became 'SE'.
const raceCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const rp = await raceCtx.newPage();
await rp.addInitScript((draft) => {
  if (!sessionStorage.getItem('rx-race-seeded')) {
    localStorage.setItem('reklamx_checkout_form', JSON.stringify(draft));
    sessionStorage.setItem('rx-race-seeded', '1');
  }
}, { country: 'NL', firstName: 'Jan', lastName: 'de Vries', address1: 'Damrak 1', postcode: '1012 LG', city: 'Amsterdam', email: 'jan@x.nl', savedAt: new Date().toISOString() });
// Locally the emulator answers before the lazily-loaded checkout has even
// mounted, so the race never happens on its own (a first version of this check
// passed with the bug put back). Hold the database back for three seconds, as a
// slow network to Google does, so the checkout mounts first.
await rp.route('http://127.0.0.1:8085/**', async (route) => {
  await new Promise((r) => setTimeout(r, 3000));
  await route.continue().catch(() => {});
});
await rp.goto(`${BASE}/checkout`, { waitUntil: 'domcontentloaded' });
await rp.locator('#co-country').waitFor({ timeout: 15000 });
await rp.waitForTimeout(6000);
check('a saved Dutch address is still Dutch once his settings arrive (it was turned into SE)', (await rp.locator('#co-country').inputValue()) === 'NL', await rp.locator('#co-country').inputValue());
await raceCtx.close();

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();

// Leave the emulator as it was found.
await restore();
process.exit(summary() ? 1 : 0);
