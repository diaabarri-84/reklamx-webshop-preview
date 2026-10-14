// Client, 2026-10-07: "when an order is created I must get an e-mail".
//
//   the owner: Payments & API keys says whether the mail server can send at all,
//   takes the addresses the new-order e-mail goes to, warns when one is the
//   shop's own sending address (Gmail files that under "Sent"), and proves the
//   road with a test e-mail.
//   an order: its e-mails are shown (a failed send — the old SMTP password — was
//   invisible), and "Send again" sends the confirmation to the customer and the
//   "New paid order" notice to HIS addresses.
//
// Read back from the local mail server (smtp-sink.mjs, started by start.sh) —
// nothing leaves this machine.
import { readFileSync } from 'node:fs';
import { launch, loginAdmin, BASE, SHOTS, db, check, summary, MAIL_LOG } from './lib.mjs';

const mails = () => {
  try {
    return readFileSync(MAIL_LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
};
/** The first message, among those sent after the `since`-th, that matches. */
const waitMail = async (since, pred, ms = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const hit = mails().slice(since).find(pred);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
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

const PAID = '202690801';
const UNPAID = '202690802';
const CANCELLED = '202690803';
// Paid while the host had no mail server: no line per recipient, only the reason.
const NO_SMTP = '202690804';
// Paid, e-mailed, then refunded.
const REFUNDED = '202690805';
const BOSS = 'boss@reklamx.test';
const WORKSHOP = 'workshop@reklamx.test';
const CUSTOMER = 'anna.mail@firma.test';
const secrets = db.collection('secrets').doc('integrations');
const notifyBefore = (await secrets.get()).data()?.notify ?? null;

const order = (id, paid) => ({
  id, userId: 'guest', createdAt: new Date().toISOString(), status: paid ? 'in_print' : 'pending',
  paymentStatus: paid ? 'paid' : 'unpaid', ...(paid ? { paidAt: new Date().toISOString() } : {}),
  publicToken: `tok-${id}`, customerName: 'Anna Mail', customerEmail: CUSTOMER, currency: 'SEK',
  customerDetails: { firstName: 'Anna', lastName: 'Mail', company: 'Firma AB', phone: '070-123 45 67',
    address1: 'Storgatan 1', postcode: '111 22', city: 'Stockholm', country: 'Sverige' },
  shippingMethod: 'standard', shippingMethodTitle: 'Standard delivery', shippingCost: 99,
  items: [{ productId: 'p', productName: 'Roll-up 85 × 200 cm', sku: 'RX-1', quantity: 1, unitPrice: 999, price: 999, options: { Size: '85 × 200 cm' } }],
  goodsNet: 999, netTotal: 1098, vatAmount: 274.5, grossTotal: 1372.5,
  // What the live shop's first paid order carries: the send failed (the old SMTP password).
  ...(paid ? { emailStatus: 'failed', emailDetail: { customer: 'failed: Invalid login: 535', shop: 'failed: Invalid login: 535' } } : {}),
});
await db.collection('orders').doc(PAID).set(order(PAID, true));
await db.collection('orders').doc(UNPAID).set(order(UNPAID, false));
await db.collection('orders').doc(CANCELLED).set({ ...order(CANCELLED, false), status: 'cancelled', paymentStatus: 'canceled' });
await db.collection('orders').doc(NO_SMTP).set({ ...order(NO_SMTP, true), emailStatus: 'smtp_not_configured', emailDetail: null });
await db.collection('orders').doc(REFUNDED).set({ ...order(REFUNDED, true), paymentStatus: 'refunded', emailStatus: 'sent', emailDetail: { customer: 'sent', shop: 'sent' } });
const cleanup = async () => {
  for (const id of [PAID, UNPAID, CANCELLED, NO_SMTP, REFUNDED]) await db.collection('orders').doc(id).delete().catch(() => {});
  await secrets.set({ notify: notifyBefore ?? { orderEmails: [] } }, { merge: true });
};
process.on('uncaughtException', async (err) => { console.error(err); await cleanup().catch(() => {}); process.exit(1); });

const { browser, page, errors } = await launch();
// The "nonsense" address below is refused with a 400 ON PURPOSE; that one is the test's own.
let refusedOnPurpose = 0;
page.on('response', (r) => { if (r.status() === 400 && r.url().includes('/api/admin/notifications')) refusedOnPurpose++; });
await loginAdmin(page);
await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {});

// ---- the owner: where the e-mail goes ----
await page.getByRole('button', { name: 'Payments & API keys' }).first().click();
const card = page.locator('[data-rx-order-mail]');
await card.waitFor({ timeout: 20000 });
await card.locator('[data-rx-mail-ready]').waitFor({ timeout: 15000 });
check('Payments & API keys has "New-order e-mails", and says the mail server is set up', (await card.locator('[data-rx-mail-ready]').getAttribute('data-rx-mail-ready')) === 'yes');
const input = card.locator('[data-rx-order-mail-input]');
await input.fill('info@reklamx.test');
check('the shop\'s own sending address is warned about (Gmail files a mail to itself under "Sent")', (await card.locator('[data-rx-order-mail-self]').count()) === 1);
await input.fill('nonsense');
await card.locator('[data-rx-order-mail-save]').click();
await card.locator('[data-rx-order-mail-result="bad"]').waitFor({ timeout: 10000 });
check('something that is not an address is refused, nothing saved', (await secrets.get()).data()?.notify?.orderEmails?.includes('nonsense') !== true);
await input.fill(`${BOSS}, ${WORKSHOP}`);
// The status refresh after the save FAILS here: the box used to go back to the old
// addresses and stay there, under "Saved — new orders are e-mailed to…".
let abortedOnPurpose = 0;
await page.route('**/api/admin/integrations', (route) => {
  if (route.request().method() !== 'GET') return route.continue();
  abortedOnPurpose++;
  return route.abort();
});
await card.locator('[data-rx-order-mail-save]').click();
const saved = await poll(async () => (await secrets.get()).data()?.notify?.orderEmails ?? [], (v) => v.length === 2);
check('his two addresses are saved (server-side only — not in a settings document visitors can read)', JSON.stringify(saved) === JSON.stringify([BOSS, WORKSHOP]), JSON.stringify(saved));
await card.locator('[data-rx-order-mail-result="ok"]').waitFor({ timeout: 10000 });
await page.waitForTimeout(800);
check('…and the box KEEPS them, with Save off — even with the refresh after it failed',
  (await input.inputValue()) === `${BOSS}, ${WORKSHOP}` && (await card.locator('[data-rx-order-mail-save]').isDisabled()), await input.inputValue());
await page.unroute('**/api/admin/integrations');
await input.fill(BOSS);
check('addresses typed and not saved: the test is off, and says it goes to the saved ones',
  (await card.locator('[data-rx-order-mail-test]').isDisabled()) && (await card.locator('[data-rx-order-mail-unsaved]').count()) === 1);
await input.fill(`${BOSS}, ${WORKSHOP}`);
check('…the saved ones back in the box: the test is on again', !(await card.locator('[data-rx-order-mail-test]').isDisabled()));
const sinceTest = mails().length;
await card.locator('[data-rx-order-mail-test]').click();
await card.locator('[data-rx-order-mail-result="ok"]').waitFor({ timeout: 15000 });
const test = await waitMail(sinceTest, (m) => /test: new-order e-mails/.test(m.subject));
check('"Send a test e-mail" reaches HIS addresses, from the shop\'s sender', !!test && test.to.includes(BOSS) && test.to.includes(WORKSHOP) && test.from === 'info@reklamx.test', JSON.stringify(test));
await card.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${SHOTS}/130-order-mail-card.png` });

// ---- an order: its e-mails, and "Send again" ----
await page.getByRole('button', { name: 'Orders' }).first().click();
await page.locator(`[data-order-row="${PAID}"]`).waitFor({ timeout: 20000 });
const cancelledBadge = await page.locator(`[data-order-row="${CANCELLED}"] [data-rx-stage]`).evaluate((el) => ({ stage: el.getAttribute('data-rx-stage'), cls: el.className, text: el.textContent }));
check('a cancelled order\'s stage is RED in the list (client: "red cancelled, yellow waiting")', cancelledBadge.stage === 'cancelled' && /red/.test(cancelledBadge.cls) && /Cancelled/i.test(cancelledBadge.text), JSON.stringify(cancelledBadge));
await page.locator(`[data-order-row="${PAID}"]`).click();
const box = page.locator('[data-rx-order-emails]');
await box.waitFor({ timeout: 15000 });
check('the order shows its e-mails failed — and why, in words (it was invisible; then a raw "535")',
  /refused its password/.test(await box.locator('[data-rx-order-email="customer"]').innerText()) && /refused its password/.test(await box.locator('[data-rx-order-email="shop"]').innerText()),
  await box.innerText());
const sinceResend = mails().length;
await box.locator('[data-rx-order-email-resend]').click();
await box.getByText('Sent again.').waitFor({ timeout: 20000 });
const toCustomer = await waitMail(sinceResend, (m) => m.to.includes(CUSTOMER));
const toShop = await waitMail(sinceResend, (m) => /New paid order/.test(m.subject));
check('"Send again": the customer gets the order confirmation', !!toCustomer && toCustomer.replyTo === 'info@reklamx.test', JSON.stringify(toCustomer));
check('…and the "New paid order" notice goes to HIS addresses, not the server\'s default', !!toShop && toShop.to.includes(BOSS) && toShop.to.includes(WORKSHOP) && !toShop.to.includes('order@reklamx.test') && toShop.subject.includes(PAID), JSON.stringify(toShop));
const after = (await db.collection('orders').doc(PAID).get()).data();
check('the order records it: both sent, and not to be sent again by itself',
  after?.emailDetail?.customer === 'sent' && after?.emailDetail?.shop === 'sent' && after?.emailStatus === 'sent' && after?.sideEffects?.emailsSent === true,
  JSON.stringify({ d: after?.emailDetail, s: after?.emailStatus, se: after?.sideEffects }));
check('…and the panel says so', /Sent/.test(await box.locator('[data-rx-order-email="shop"]').innerText()));
await box.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${SHOTS}/131-order-mail-resend.png` });

// Both delivered, "Send again" once more: HIS notice again (a new inbox, a lost
// mail) — never the customer's confirmation a second time.
const sinceSecond = mails().length;
await box.locator('[data-rx-order-email-resend]').click();
const shopAgain = await waitMail(sinceSecond, (m) => /New paid order/.test(m.subject));
await page.waitForTimeout(1500);
check('a second "Send again": the shop\'s notice only — the customer is not sent the confirmation twice',
  !!shopAgain && !mails().slice(sinceSecond).some((m) => m.to.includes(CUSTOMER)), JSON.stringify(mails().slice(sinceSecond).map((m) => m.to)));

const openOrder = async (id) => {
  await page.keyboard.press('Escape').catch(() => {});
  await page.locator(`[data-order-row="${id}"]`).click();
  await page.locator('[data-rx-order-emails]').waitFor({ timeout: 15000 });
  await page.waitForTimeout(300);
  return page.locator('[data-rx-order-emails]');
};
const noSmtp = await openOrder(NO_SMTP);
check('paid while the host had no mail server: both lines say so, in words (they said "Not sent yet")',
  /mail server is not set up/.test(await noSmtp.locator('[data-rx-order-email="customer"]').innerText()) && /mail server is not set up/.test(await noSmtp.locator('[data-rx-order-email="shop"]').innerText()),
  await noSmtp.innerText());
const refunded = await openOrder(REFUNDED);
check('a refunded order: what went out when it was paid — not "E-mails go out when the payment is confirmed", and no "Send again"',
  /Sent/.test(await refunded.locator('[data-rx-order-email="customer"]').innerText()) && (await refunded.getByText('E-mails go out when the payment is confirmed.').count()) === 0 &&
    (await refunded.locator('[data-rx-order-email-resend]').count()) === 0);

await page.locator(`[data-order-row="${UNPAID}"]`).click().catch(async () => {
  await page.keyboard.press('Escape');
  await page.locator(`[data-order-row="${UNPAID}"]`).click();
});
await page.locator('[data-rx-order-emails]').getByText('E-mails go out when the payment is confirmed.').waitFor({ timeout: 15000 });
check('an unpaid order: no e-mail yet, and no "Send again" (an abandoned basket must not e-mail anyone)',
  (await page.locator('[data-rx-order-email-resend]').count()) === 0);

const real = errors.filter((e) => !(refusedOnPurpose > 0 && /status of 400/.test(e)) && !(abortedOnPurpose > 0 && /net::ERR_FAILED/.test(e)));
check('no page errors (the one refusal and the failed refresh above were the test\'s own)', real.length === 0 && refusedOnPurpose === 1, real.slice(0, 3).join(' | '));
await cleanup();
await browser.close();
process.exit(summary() ? 1 : 0);
