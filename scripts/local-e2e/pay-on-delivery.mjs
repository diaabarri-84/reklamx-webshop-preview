// Client, 2026-10-07: "make an option that a customer can pay on delivery — but do
// not switch it on for the customers; an option where I pick the customer".
//
//   the owner: a "Pay on delivery" switch per customer on the Users screen, off
//   for everyone, kept where no customer can write it;
//   a customer he did NOT pick: the checkout as always — and the server refuses
//   the choice even when a page sends it;
//   the customer he picked: the choice at the checkout (but not with points or a
//   discount code, which are spent only when money arrives); a refusal is said in
//   his language; placing lands on "you pay on delivery", the basket empties, the
//   order is in production while unpaid, both e-mails go out — and pressing again
//   (a timeout, a reload) answers with THE SAME order, never a second one;
//   the reports count it as owed, not as a failed payment;
//   the owner records the payment (a method chosen, then confirmed): paid, the
//   points follow; a cancelled one tells the customer so.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { launch, loginAdmin, BASE, SHOTS, db, check, summary, MAIL_LOG } from './lib.mjs';

const PRODUCT_ID = 'prod-pmp-696';
const PASSWORD = 'emulator-customer-1';
const COUPON = { id: 'podtest10', code: 'PODTEST10', percent: 10, active: true, expiresAt: '2099-12-31', maxUses: 100, oncePerCustomer: false, minOrderAmount: 0 };
// One use left, held by another customer's unpaid order (review 2026-10-11, A).
const HELD_COUPON = { id: 'podheld10', code: 'PODHELD10', percent: 10, active: true, expiresAt: '2099-12-31', maxUses: 1, usedCount: 0, oncePerCustomer: false, minOrderAmount: 0 };
// One use left, held by the customer's OWN unpaid guest order (review 2026-10-11, F).
const MINE_COUPON = { id: 'podmine10', code: 'PODMINE10', percent: 10, active: true, expiresAt: '2099-12-31', maxUses: 1, usedCount: 0, oncePerCustomer: false, minOrderAmount: 0 };
const stamp = Date.now();
const ON = { email: `pod-on-${stamp}@emulator.test`, name: 'Petra Leverans' };
const OFF = { email: `pod-off-${stamp}@emulator.test`, name: 'Olle Online' };
const CANCELLED_ID = `2026918${String(stamp).slice(-2)}`;

const mails = () => {
  try {
    return readFileSync(MAIL_LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
};
const waitMail = async (since, pred, ms = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const hit = mails().slice(since).find(pred);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
};
const poll = async (read, ok, tries = 80) => {
  let v;
  for (let i = 0; i < tries; i++) {
    v = await read();
    if (ok(v)) return v;
    await new Promise((r) => setTimeout(r, 250));
  }
  return v;
};
const signIn = async (email, password) =>
  (await (await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  })).json()).idToken;

// ---- two customers, and a discount code ----
const signUp = async (who) => {
  const r = await (await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: who.email, password: PASSWORD, returnSecureToken: true }),
  })).json();
  await db.collection('users').doc(r.localId).set({
    uid: r.localId, email: who.email, displayName: who.name, role: 'client', status: 'active', accountType: 'individual',
    loyaltyPoints: 0, loyaltyTier: 'Silver', pointsHistory: [], createdAt: new Date().toISOString(),
  });
  return { ...who, uid: r.localId, idToken: r.idToken };
};
const on = await signUp(ON);
const off = await signUp(OFF);
await db.collection('coupons').doc(COUPON.id).set({ ...COUPON, createdAt: new Date().toISOString() });
const cleanup = async () => {
  for (const c of [on, off]) {
    await db.collection('customerTerms').doc(c.uid).delete().catch(() => {});
    for (const d of (await db.collection('orders').where('customerEmail', '==', c.email).get()).docs) await d.ref.delete();
    for (const d of (await db.collection('checkoutAttempts').where('uid', '==', c.uid).get()).docs) await d.ref.delete();
    await db.collection('users').doc(c.uid).delete().catch(() => {});
    await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:delete?key=demo-api-key', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: c.idToken }),
    }).catch(() => {});
  }
  await db.collection('coupons').doc(COUPON.id).delete().catch(() => {});
  await db.collection('coupons').doc(HELD_COUPON.id).delete().catch(() => {});
  await db.collection('coupons').doc(MINE_COUPON.id).delete().catch(() => {});
  await db.collection('orders').doc(CANCELLED_ID).delete().catch(() => {});
};
process.on('uncaughtException', async (err) => { console.error(err); await cleanup().catch(() => {}); process.exit(1); });

const { browser, page, errors } = await launch();

// ---- the owner switches it on for ONE customer ----
await loginAdmin(page);
await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {});
await page.getByRole('button', { name: /^Users & Staff/ }).first().click();
const chip = page.locator(`[data-rx-pay-on-delivery-switch="${on.uid}"]`);
await chip.waitFor({ timeout: 20000 });
check('Users: every customer has a "Pay on delivery" switch, OFF until he turns it on',
  (await chip.getAttribute('aria-pressed')) === 'false' && (await page.locator(`[data-rx-pay-on-delivery-switch="${off.uid}"]`).getAttribute('aria-pressed')) === 'false');
await chip.click();
const terms = await poll(async () => (await db.collection('customerTerms').doc(on.uid).get()).data(), (v) => v?.payOnDelivery === true);
check('…turned on for one customer: kept by the server (customerTerms), not on the customer\'s own profile',
  terms?.payOnDelivery === true && (await db.collection('users').doc(on.uid).get()).data()?.payOnDelivery === undefined, JSON.stringify(terms));
check('…and the switch shows it', (await chip.getAttribute('aria-pressed')) === 'true');
await page.screenshot({ path: `${SHOTS}/180-users-pay-on-delivery.png` });

// A customer cannot give it to himself: the collection is closed to every browser.
const selfWrite = await fetch(
  `http://127.0.0.1:8085/v1/projects/demo-reklamx/databases/(default)/documents/customerTerms/${off.uid}?updateMask.fieldPaths=payOnDelivery`,
  { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${off.idToken}` }, body: JSON.stringify({ fields: { payOnDelivery: { booleanValue: true } } }) },
);
check('a customer writing the switch for himself is refused by the database rules', selfWrite.status === 403, String(selfWrite.status));

// ---- a basket, and the checkout form ----
const addToBasket = async (p) => {
  await p.goto(`${BASE}/products/${PRODUCT_ID}`, { waitUntil: 'domcontentloaded' });
  await p.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {});
  // Typed, not picked: this product has no price break, so since 2026-10-10 its
  // quantity ladder shows no steps to pick from (the client's audit — steps that
  // all cost the same promised a discount that is not there).
  const qty = p.locator('[data-rx-qty-custom]').first();
  await qty.fill('50');
  await qty.press('Enter');
  await p.getByRole('button', { name: /Add to cart/i }).first().click();
  await p.waitForTimeout(800);
};
const fillForm = async (p, who) => {
  await p.goto(`${BASE}/checkout`, { waitUntil: 'domcontentloaded' });
  await p.locator('#co-firstname').waitFor({ timeout: 15000 });
  await p.fill('#co-firstname', who.name.split(' ')[0]);
  await p.fill('#co-lastname', who.name.split(' ')[1]);
  await p.fill('#co-address1', 'Storgatan 1');
  await p.fill('#co-postcode', '111 22');
  await p.fill('#co-city', 'Stockholm');
  await p.selectOption('#co-country', 'SE');
  await p.fill('#co-email', who.email);
  await p.fill('#co-phone', '070-123 45 67');
  const terms = p.locator('label:has(a[href*="terms"]) input[type="checkbox"], label:has(a[href*="privacy"]) input[type="checkbox"]').last();
  if (!(await terms.isChecked())) await terms.check();
};

// ---- a customer he did NOT pick ----
const offCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const op = await offCtx.newPage();
op.on('pageerror', (e) => errors.push(String(e?.message ?? e)));
await loginAdmin(op, off.email, PASSWORD);
await addToBasket(op);
await fillForm(op, off);
await op.waitForTimeout(1500);
check('a customer he did not pick: the checkout as always — no choice, no "pay on delivery"',
  (await op.locator('[data-rx-pay-choice]').count()) === 0 && (await op.getByRole('button', { name: /^Pay/ }).count()) >= 1);
const forged = await fetch(`${BASE}/api/checkout/pay`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${off.idToken}` },
  body: JSON.stringify({ paymentMethod: 'on_delivery', termsAccepted: true, shippingMethod: 'standard', customer: { email: off.email, firstName: 'Olle' }, items: [] }),
});
const forgedBody = await forged.json().catch(() => null);
check('…and when a page sends "pay on delivery" for him anyway, the server refuses it (403), nothing is placed',
  forged.status === 403 && forgedBody?.code === 'no_pay_on_delivery' &&
    (await db.collection('orders').where('customerEmail', '==', off.email).get()).empty, `${forged.status} ${JSON.stringify(forgedBody)}`);
await offCtx.close();

// ---- the customer he picked ----
const onCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const cp = await onCtx.newPage();
cp.on('pageerror', (e) => errors.push(String(e?.message ?? e)));
await loginAdmin(cp, on.email, PASSWORD);
await addToBasket(cp);
await fillForm(cp, on);
const choice = cp.locator('[data-rx-pay-choice]');
await choice.waitFor({ timeout: 15000 });
check('the customer he picked: both ways at the checkout, paying online chosen to start with',
  (await cp.locator('[data-rx-pay-choice-option="online"]').getAttribute('aria-checked')) === 'true');
await cp.locator('[data-rx-pay-choice-option="on_delivery"]').click();
const note = await cp.locator('[data-rx-pay-on-delivery-note]').innerText().catch(() => '');
const placeBtn = cp.getByRole('button', { name: /^Place order/ }).last();
check('…"Pay on delivery" chosen: it says what happens and what he pays, and the button is "Place order"',
  /production/i.test(note) && /\d.*kr/.test(note) && (await placeBtn.count()) === 1, note);

// A discount code with pay on delivery: said, and the button waits until it is removed.
await cp.getByPlaceholder('Discount code').last().fill(COUPON.code);
await cp.getByRole('button', { name: 'Apply' }).last().click();
await cp.getByRole('button', { name: 'Remove' }).last().waitFor({ timeout: 15000 });
await cp.locator('[data-rx-pay-on-delivery-no-discounts]').waitFor({ timeout: 10000 }).catch(() => {});
check('a discount code with pay on delivery: "points and codes are for paying online", and Place order waits',
  (await cp.locator('[data-rx-pay-on-delivery-no-discounts]').count()) === 1 && (await placeBtn.isDisabled()));
const discounted = await fetch(`${BASE}/api/checkout/pay`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await signIn(on.email, PASSWORD)}` },
  body: JSON.stringify({ paymentMethod: 'on_delivery', couponCode: COUPON.code, termsAccepted: true, shippingMethod: 'standard', customer: { email: on.email, firstName: 'Petra' }, items: [] }),
});
check('…and the server refuses it too (a code is spent only when money arrives)', discounted.status === 400 && (await discounted.json()).code === 'on_delivery_no_discounts');
await cp.getByRole('button', { name: 'Remove' }).last().click();
await cp.locator('[data-rx-pay-on-delivery-no-discounts]').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
await cp.waitForTimeout(1200); // the quote without the code
check('…removed: Place order is free again', !(await placeBtn.isDisabled()));

// The server says no (switched off meanwhile): said in his language, back to paying online.
await cp.route('**/api/checkout/pay', (route) =>
  route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Paying on delivery is not available on this account. Please pay online.', code: 'no_pay_on_delivery' }) }));
await placeBtn.click();
await cp.getByText(/not available on this account any more/i).first().waitFor({ timeout: 10000 }).catch(() => {});
check('refused at the last moment: told so ("…any more. Please pay online."), and the choice is gone',
  (await cp.getByText(/not available on this account any more/i).count()) >= 1 && (await cp.locator('[data-rx-pay-choice]').count()) === 0);
await cp.unroute('**/api/checkout/pay');

// …and placed, for real, from a fresh page.
await fillForm(cp, on);
await cp.locator('[data-rx-pay-choice]').waitFor({ timeout: 15000 });
await cp.locator('[data-rx-pay-choice-option="on_delivery"]').click();
let placedBody = null;
await cp.route('**/api/checkout/pay', async (route) => {
  placedBody = route.request().postDataJSON();
  await route.continue();
});
await cp.screenshot({ path: `${SHOTS}/181-checkout-pay-on-delivery.png` });
const sincePlace = mails().length;
await cp.getByRole('button', { name: /^Place order/ }).last().click();
await cp.waitForURL(/\/order\//, { timeout: 30000 });
await cp.locator('[data-rx-order-on-delivery]').waitFor({ timeout: 20000 });
check('placed: the order page says "you pay on delivery" (not a payment being confirmed)',
  /pay on delivery/i.test(await cp.locator('[data-rx-order-on-delivery]').innerText()));
const basket = await poll(() => cp.evaluate(() => JSON.parse(localStorage.getItem('reklamx_cart') || '[]').length), (n) => n === 0, 40);
check('…and the basket is emptied (the order is confirmed)', basket === 0, String(basket));
await cp.screenshot({ path: `${SHOTS}/182-order-pay-on-delivery.png` });

const placed = await poll(async () => {
  const s = await db.collection('orders').where('customerEmail', '==', on.email).get();
  return s.empty ? null : { id: s.docs[0].id, ...s.docs[0].data() };
}, (o) => !!o && o.sideEffects?.emailsSent === true);
check('the order: unpaid, "pay on delivery" from its very creation, and in production already (a stage plan)',
  !!placed && placed.payOnDelivery === true && placed.paymentStatus === 'unpaid' && placed.paymentMethodTitle === 'Pay on delivery' &&
    !!placed.confirmedAt && !!placed.checkoutAttemptId && !!placed.stagePlan && !!placed.nextStageAt && !placed.molliePaymentId,
  JSON.stringify(placed && { pod: placed.payOnDelivery, ps: placed.paymentStatus, attempt: placed.checkoutAttemptId, plan: !!placed.stagePlan }));

// Pressed again (a timeout, a reload): the SAME order — never a second one in production.
const again = await fetch(`${BASE}/api/checkout/pay`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await signIn(on.email, PASSWORD)}` },
  body: JSON.stringify(placedBody),
});
const againBody = await again.json().catch(() => null);
const ordersNow = (await db.collection('orders').where('customerEmail', '==', on.email).get()).size;
check('the same attempt sent again answers with the SAME order, and there is still only one',
  again.ok && againBody?.orderId === placed.id && againBody?.again === true && ordersNow === 1, `${again.status} ${JSON.stringify(againBody)} · ${ordersNow} order(s)`);

// A code sent as an ARRAY (review 2026-10-11, PAY-21): the early check reads only a
// string, and the pricing String()s ["PODTEST10"] into a working code. Refused on
// what was PRICED. The real basket, no attempt id (a new placing) and no expected
// total — without the fix this would place a second, discounted order.
const { attemptId: _attempt, expectedGrossTotal: _shown, ...bareBody } = placedBody ?? {};
const arrayCode = await fetch(`${BASE}/api/checkout/pay`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await signIn(on.email, PASSWORD)}` },
  body: JSON.stringify({ ...bareBody, couponCode: [COUPON.code] }),
});
const arrayBody = await arrayCode.json().catch(() => null);
check('a discount code sent as an array is refused as well (400), and no second order is placed',
  arrayCode.status === 400 && arrayBody?.code === 'on_delivery_no_discounts' &&
    (await db.collection('orders').where('customerEmail', '==', on.email).get()).size === 1,
  `${arrayCode.status} ${JSON.stringify(arrayBody)}`);

// A LIMITED code whose last use ANOTHER customer's unpaid order holds (review
// 2026-10-11, A). A guest's quote cannot see whose hold it is and accepts the code;
// placing the order knows the e-mail and drops it — and that was answered as "the
// price changed", so the checkout re-quoted the same code and was refused the same
// way for as long as the hold lasted. The total sent here is NOT the one priced, so
// the old order of checks answered price_changed; the code's own refusal comes first.
await db.collection('coupons').doc(HELD_COUPON.id).set({
  ...HELD_COUPON, createdAt: new Date().toISOString(),
  holds: { '202699901': { holder: 'uid:another-customer', at: new Date().toISOString() } },
});
const heldCode = await fetch(`${BASE}/api/checkout/pay`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await signIn(on.email, PASSWORD)}` },
  body: JSON.stringify({ ...bareBody, couponCode: [HELD_COUPON.code], expectedGrossTotal: 1 }),
});
const heldBody = await heldCode.json().catch(() => null);
check('a code whose last use another customer holds: 409 "usedUp" with its code — not "the price changed" — and nothing placed',
  heldCode.status === 409 && heldBody?.code === 'usedUp' &&
    (await db.collection('orders').where('customerEmail', '==', on.email).get()).size === 1,
  `${heldCode.status} ${JSON.stringify(heldBody)}`);

// One customer is ONE holder (review 2026-10-11, F). His unpaid GUEST order holds
// a limited code's last use — under his e-mail, hashed as the server hashes it.
// Signed in, the quote knows him by his account AND its e-mail, so that hold is
// his own; by the account alone it told him the code was fully redeemed.
const sha24 = (text) => createHash('sha256').update(text).digest('hex').slice(0, 24);
await db.collection('coupons').doc(MINE_COUPON.id).set({
  ...MINE_COUPON, createdAt: new Date().toISOString(),
  holds: { '202699902': { holder: `email:${sha24(on.email.trim().toLowerCase())}`, at: new Date().toISOString() } },
});
// Known by his account's address only once it is VERIFIED (final review): anyone can
// open an account under an address they do not own. The shop sends the link at
// sign-up; here the emulator marks it clicked.
await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/demo-reklamx/accounts:update', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
  body: JSON.stringify({ localId: on.uid, emailVerified: true }),
});
const mineQuote = await fetch(`${BASE}/api/checkout/quote`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await signIn(on.email, PASSWORD)}` },
  body: JSON.stringify({ items: bareBody.items, shippingMethod: bareBody.shippingMethod, deliveryCountry: 'SE', couponCode: MINE_COUPON.code }),
});
const mineBody = await mineQuote.json().catch(() => null);
check('his own guest order holding a code\'s last use does not count against him signed in: the quote applies the code',
  mineQuote.ok && mineBody?.coupon?.code === MINE_COUPON.code && !mineBody?.couponErrorCode,
  `${mineQuote.status} ${JSON.stringify({ coupon: mineBody?.coupon, err: mineBody?.couponErrorCode })}`);

// (What the two e-mails SAY is checked on the templates: test-order-mail-wording.)
const toCustomer = await waitMail(sincePlace, (m) => m.to.includes(on.email));
const toShop = await waitMail(sincePlace, (m) => /PAY ON DELIVERY/.test(m.subject));
check('both e-mails go out when it is placed: the customer\'s confirmation…', !!toCustomer, JSON.stringify(mails().slice(sincePlace).map((m) => m.subject)));
check('…and the shop\'s notice, "New order … PAY ON DELIVERY" — not "New paid order"',
  !!toShop && !/New paid order/.test(toShop.subject), JSON.stringify(toShop?.subject));

// The reports: owed, and in production — not a failed payment.
const adminToken = await signIn('admin@emulator.test', 'emulator-admin-1');
// The reports count whole SWEDISH days (dayKeyInShopTime): an order placed at
// 22:05 UTC belongs to the next day there — the UTC date failed this check
// whenever the suite ran in the last two hours of a UTC day.
const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' })
  .format(new Date(placed.createdAt));
const report = await (await fetch(`${BASE}/api/admin/reports?refresh=1&from=${day}&to=${day}`, { headers: { Authorization: `Bearer ${adminToken}` } })).json();
check('the reports count it as owed on delivery and as work in production — not among the unpaid attempts',
  Number(report?.totals?.onDeliveryOrders) >= 1 && (report?.byStatus ?? []).some((r) => r.key === placed.status && r.count >= 1),
  JSON.stringify({ onDelivery: report?.totals?.onDeliveryOrders, unpaid: report?.totals?.unpaidOrders, byStatus: report?.byStatus }));

// ---- the owner records the money ----
await page.getByRole('button', { name: 'Orders', exact: true }).first().click();
await page.locator(`[data-order-row="${placed.id}"]`).waitFor({ timeout: 20000 });
check('the orders list says "Pay on delivery" for it', /pay on delivery/i.test(await page.locator(`[data-order-row="${placed.id}"]`).innerText()));
await page.locator(`[data-order-row="${placed.id}"]`).click();
const record = page.locator('[data-rx-record-payment="record"]');
await record.waitFor({ timeout: 15000 });
await page.waitForTimeout(600); // the panel slides in
check('the order: "Pay on delivery — … not paid yet"; "Record the payment" waits until a method is chosen',
  /not paid yet/i.test(await record.innerText()) && (await record.locator('[data-rx-record-payment-save]').isDisabled()));
await page.screenshot({ path: `${SHOTS}/183-record-payment.png` });
await record.locator('[data-rx-record-method]').selectOption('cash');
await record.locator('[data-rx-record-payment-save]').click();
const dialog = page.getByRole('alertdialog', { name: 'Record the payment?' });
await dialog.waitFor({ timeout: 10000 });
check('…and asks before recording (it cannot be undone): the amount and the method', /cash/i.test(await dialog.innerText()) && /6\s?436/.test(await dialog.innerText()), await dialog.innerText());
await dialog.getByRole('button', { name: 'Record the payment' }).click();
const paid = await poll(async () => (await db.collection('orders').doc(placed.id).get()).data(), (o) => o?.paymentStatus === 'paid' && o?.sideEffects?.pointsApplied === true);
check('recorded: paid, "Paid on delivery (cash)", the method kept as a code, and the money steps ran (the points)',
  paid?.paymentStatus === 'paid' && paid?.paymentMethodTitle === 'Paid on delivery (cash)' && paid?.paymentRecordedMethod === 'cash' &&
    paid?.sideEffects?.pointsApplied === true && paid?.sideEffects?.couponCounted === true && !!paid?.paidAt,
  JSON.stringify(paid && { ps: paid.paymentStatus, title: paid.paymentMethodTitle, method: paid.paymentRecordedMethod, se: paid.sideEffects }));
const earned = Number(placed.pointsEarned) || 0;
const customerNow = (await db.collection('users').doc(on.uid).get()).data();
check(`…the customer's ${earned} points are on his account`, earned === 0 || Number(customerNow?.loyaltyPoints) === earned, `${customerNow?.loyaltyPoints} vs ${earned}`);
await page.locator('[data-rx-record-payment-note="ok"]').waitFor({ timeout: 10000 }).catch(() => {});
check('…the panel says it is recorded, and no longer offers to record it',
  (await page.locator('[data-rx-record-payment-note="ok"]').count()) === 1 && (await page.locator('[data-rx-record-payment-save]').count()) === 0);
check('…and the order\'s payment line reads "Paid on delivery (Cash)"', /Paid on delivery \(Cash\)/.test(await page.getByRole('dialog', { name: new RegExp(`Order ${placed.id}`) }).innerText()));

// ---- an order to pay on delivery, cancelled: the customer is told so ----
await db.collection('orders').doc(CANCELLED_ID).set({
  id: CANCELLED_ID, userId: on.uid, customerEmail: on.email, customerName: on.name, createdAt: new Date().toISOString(),
  status: 'cancelled', paymentStatus: 'unpaid', payOnDelivery: true, paymentMethodTitle: 'Pay on delivery', publicToken: `tok-${CANCELLED_ID}`,
  currency: 'SEK', grossTotal: 500, items: [{ productName: 'Flyers', quantity: 100, price: 400, artworkPending: true }],
});
const guest = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const gp = await guest.newPage();
await gp.goto(`${BASE}/order/${CANCELLED_ID}?t=tok-${CANCELLED_ID}`, { waitUntil: 'domcontentloaded' });
await gp.locator('[data-rx-order-on-delivery-cancelled]').waitFor({ timeout: 20000 }).catch(() => {});
// (The footer's "Upload your print file" link is on every page: the upload BOX is
// a file field.)
const cancelledText = await gp.locator('[data-rx-order-on-delivery-cancelled]').innerText().catch(() => '');
check('cancelled: the order page says it is cancelled — not "in production", and offers no upload',
  /cancelled/i.test(cancelledText) && (await gp.locator('[data-rx-order-on-delivery]').count()) === 0 &&
    (await gp.locator('input[type="file"]').count()) === 0,
  `${cancelledText} · file fields: ${await gp.locator('input[type="file"]').count()}`);
await gp.screenshot({ path: `${SHOTS}/184-order-cancelled.png` });
await guest.close();

// ---- pressed again before the order page had the order (code review 2026-10-11, REVIEW-3 #1) ----
// The tab's attempt lasts until the order page has the order and empties the basket:
// back at the checkout meanwhile, Place order answers with the SAME order; once the
// page has it, the same basket ordered again is a new order.
{
  const ordersOf = async () => (await db.collection('orders').where('customerEmail', '==', on.email).get()).size;
  const placeOnDelivery = async () => {
    await fillForm(cp, on);
    await cp.locator('[data-rx-pay-choice]').waitFor({ timeout: 15000 });
    await cp.locator('[data-rx-pay-choice-option="on_delivery"]').click();
    await cp.getByRole('button', { name: /^Place order/ }).last().click();
    await cp.waitForURL(/\/order\//, { timeout: 30000 });
    return cp.url().match(/\/order\/([^/?#]+)/)?.[1] ?? null;
  };
  const before = await ordersOf();
  const statusCall = /\/api\/orders\/[^/]+\/status/;
  await cp.route(statusCall, (route) => route.abort()); // the order page cannot load its order
  await addToBasket(cp);
  const first = await placeOnDelivery();
  const kept = await cp.evaluate(() => sessionStorage.getItem('reklamx_pod_attempt'));
  const again = await placeOnDelivery(); // back at the checkout: the basket is still full
  const afterAgain = (await ordersOf()) - before;
  check('Place order again before the order page had the order: the SAME order, not a second one in production',
    !!first && again === first && afterAgain === 1 && JSON.parse(kept || 'null')?.orderId === first,
    `${first} → ${again} · ${afterAgain} new order(s) · kept ${kept}`);
  await cp.unroute(statusCall);
  await cp.reload({ waitUntil: 'domcontentloaded' });
  await cp.locator('[data-rx-order-on-delivery]').waitFor({ timeout: 20000 });
  const lines = await poll(() => cp.evaluate(() => JSON.parse(localStorage.getItem('reklamx_cart') || '[]').length), (n) => n === 0, 40);
  const ended = await cp.evaluate(() => sessionStorage.getItem('reklamx_pod_attempt'));
  check('…the order page has it: the basket is emptied, and the tab\'s attempt ends with it', lines === 0 && ended === null, `${lines} line(s) · ${ended}`);
  await addToBasket(cp);
  const repeat = await placeOnDelivery();
  const afterRepeat = (await ordersOf()) - before;
  check('…so the same basket ordered again afterwards is a NEW order', !!repeat && repeat !== first && afterRepeat === 2,
    `${first} → ${repeat} · ${afterRepeat} new order(s)`);
}

const real = errors.filter((e) => !/status of 40[03]/.test(e));
check('no page errors', real.length === 0, real.slice(0, 3).join(' | '));
await cleanup();
await browser.close();
process.exit(summary() ? 1 : 0);
