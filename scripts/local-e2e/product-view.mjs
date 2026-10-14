// Client, 2026-10-07: "when I press VIEW it should show the user interface, not
// this" — the products list's VIEW opened a read-only "Product Details View" box.
//
//   VIEW is a link to the product's own page, in a new tab: what customers see;
//   a HIDDEN product opens for the admin, with a note that only admins see it —
//   and for a staff account he lets manage products (it has the same button) —
//   and is still "not found" for a customer.
//   A DUPLICATE gets its own address: it carried the original's, so VIEW on the
//   copy opened the original.
import { launch, loginAdmin, BASE, SHOTS, db, check, summary } from './lib.mjs';

const SHOWN = 'prod-view-shown';
const HIDDEN = 'prod-view-hidden';
const product = (id, name, slug, isHidden) => ({ id, name, slug, isHidden, basePrice: 199, images: [`${BASE}/og-image.png`], categoryId: 'indoor', description: `${name} — the page customers see.` });
await db.collection('products').doc(SHOWN).set(product(SHOWN, 'View test product', 'view-test-product', false));
await db.collection('products').doc(HIDDEN).set(product(HIDDEN, 'View test hidden product', 'view-test-hidden', true));
// A staff account with "manage products" (made here, removed at the end).
const STAFF_EMAIL = `staff-view-${Date.now()}@emulator.test`;
const STAFF_PASSWORD = 'emulator-staff-1';
const signUp = await (await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: STAFF_EMAIL, password: STAFF_PASSWORD, returnSecureToken: true }),
})).json();
await db.collection('users').doc(signUp.localId).set({
  uid: signUp.localId, email: STAFF_EMAIL, role: 'staff', status: 'active', displayName: 'Staff View',
  permissions: { canManageProducts: true }, createdAt: new Date().toISOString(),
});
const copies = async () => (await db.collection('products').where('name', '==', 'View test product (copy)').get()).docs;
const cleanup = async () => {
  for (const id of [SHOWN, HIDDEN]) await db.collection('products').doc(id).delete().catch(() => {});
  for (const d of await copies().catch(() => [])) await d.ref.delete().catch(() => {});
  await db.collection('users').doc(signUp.localId).delete().catch(() => {});
  await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:delete?key=demo-api-key', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: signUp.idToken }),
  }).catch(() => {});
};
process.on('uncaughtException', async (err) => { console.error(err); await cleanup().catch(() => {}); process.exit(1); });

const { browser, page, errors } = await launch();
await loginAdmin(page);
await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {});
await page.getByRole('button', { name: 'Products Admin' }).click();
const view = page.locator(`[data-rx-product-view="${SHOWN}"]`);
await view.waitFor({ timeout: 20000 });
check('VIEW is a link to the product\'s own page, in a new tab', (await view.getAttribute('href')) === '/products/view-test-product' && (await view.getAttribute('target')) === '_blank');
const [tab] = await Promise.all([page.context().waitForEvent('page'), view.click()]);
await tab.waitForLoadState('domcontentloaded');
await tab.getByRole('heading', { name: 'View test product' }).first().waitFor({ timeout: 20000 });
check('…it opens the storefront page (what customers see), not the old details box',
  /\/products\/view-test-product$/.test(tab.url()) && (await page.getByText('Product Details View').count()) === 0, tab.url());
await tab.screenshot({ path: `${SHOTS}/160-product-view.png` });
await tab.close();

const hiddenView = page.locator(`[data-rx-product-view="${HIDDEN}"]`);
await hiddenView.waitFor({ timeout: 20000 });
const [tab2] = await Promise.all([page.context().waitForEvent('page'), hiddenView.click()]);
await tab2.waitForLoadState('domcontentloaded');
await tab2.locator('[data-rx-hidden-note]').waitFor({ timeout: 20000 });
check('a HIDDEN product opens for the admin, saying only admins see it',
  (await tab2.getByRole('heading', { name: 'View test hidden product' }).count()) >= 1 && /only admins/i.test(await tab2.locator('[data-rx-hidden-note]').innerText()));
await tab2.close();

// ---- a duplicate: its own address ----
await page.locator(`[data-rx-product-view="${SHOWN}"]`).locator('xpath=..').getByTitle(/Make a hidden copy/).click();
await page.getByRole('button', { name: 'Save Product' }).waitFor({ timeout: 15000 });
let copy = null;
for (let i = 0; i < 40 && !copy; i++) {
  copy = (await copies())[0] ?? null;
  if (!copy) await page.waitForTimeout(250);
}
check('the duplicate is written with ITS OWN address, not the original\'s', copy?.data()?.slug === 'view-test-product-copy', String(copy?.data()?.slug));
await page.keyboard.press('Escape').catch(() => {});
await page.getByRole('button', { name: /^Close|Cancel$/ }).first().click({ timeout: 3000 }).catch(() => {});
const copyView = page.locator(`[data-rx-product-view="${copy?.id}"]`);
await copyView.waitFor({ timeout: 20000 });
const [tab3] = await Promise.all([page.context().waitForEvent('page'), copyView.click()]);
await tab3.waitForLoadState('domcontentloaded');
await tab3.locator('[data-rx-hidden-note]').waitFor({ timeout: 20000 });
check('…VIEW on the copy opens THE COPY (hidden, for the admin) — not the original',
  /\/products\/view-test-product-copy$/.test(tab3.url()) && (await tab3.getByRole('heading', { name: 'View test product (copy)' }).count()) >= 1, tab3.url());
await tab3.close();

const guest = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const gp = await guest.newPage();
await gp.goto(`${BASE}/products/view-test-hidden`, { waitUntil: 'domcontentloaded' });
await gp.getByText(/could not find that product|hittade inte den produkten/i).first().waitFor({ timeout: 20000 });
check('…and a customer still gets "not found" for it', (await gp.locator('[data-rx-hidden-note]').count()) === 0);
await gp.goto(`${BASE}/products/view-test-product`, { waitUntil: 'domcontentloaded' });
await gp.getByRole('heading', { name: 'View test product' }).first().waitFor({ timeout: 20000 });
check('…the ORIGINAL\'s address still opens the original for a customer, with its copy beside it',
  (await gp.getByRole('heading', { name: 'View test product (copy)' }).count()) === 0);
// A mistyped address: the server's "no such product" is the answer — the browser
// does not then read every product document itself. A read of the WHOLE collection
// is a query on "products" with no filter, seen in the Firestore traffic; the
// admin's lookup (which must still find a hidden product) proves the detector.
const watchScans = (p) => {
  const seen = [];
  p.on('request', (r) => {
    if (!r.url().startsWith('http://127.0.0.1:8085/')) return;
    let body = r.postData() ?? '';
    try {
      body = decodeURIComponent(body.replace(/\+/g, ' '));
    } catch {
      /* not form-encoded */
    }
    for (const m of body.matchAll(/"from":\[\{"collectionId":"products"\}\](.{0,12})/g)) if (!/where/.test(m[1])) seen.push(m[0]);
  });
  return seen;
};
const BAD = `/products/no-such-product-${Date.now()}`;
const guestScans = watchScans(gp);
await gp.goto(`${BASE}${BAD}`, { waitUntil: 'domcontentloaded' });
await gp.getByText(/could not find that product|hittade inte den produkten/i).first().waitFor({ timeout: 20000 });
await gp.waitForTimeout(800);
const adminTab = await page.context().newPage();
const adminScans = watchScans(adminTab);
await adminTab.goto(`${BASE}${BAD}-admin`, { waitUntil: 'domcontentloaded' });
await adminTab.getByText(/could not find that product|hittade inte den produkten/i).first().waitFor({ timeout: 20000 });
await adminTab.close();
check('a mistyped product address: "not found" for a customer WITHOUT reading the whole catalogue (an admin\'s lookup still does, for hidden products)',
  guestScans.length === 0 && adminScans.length >= 1, `customer ${guestScans.length}, admin ${adminScans.length}`);
await guest.close();

// ---- a staff account he lets manage products: the same VIEW button, the same page ----
const staffCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const sp = await staffCtx.newPage();
sp.on('pageerror', (e) => errors.push(String(e?.message ?? e)));
await loginAdmin(sp, STAFF_EMAIL, STAFF_PASSWORD);
await sp.goto(`${BASE}/products/view-test-hidden`, { waitUntil: 'domcontentloaded' });
await sp.locator('[data-rx-hidden-note]').waitFor({ timeout: 20000 }).catch(() => {});
check('staff with "manage products": the hidden product opens for them too, with the note', (await sp.locator('[data-rx-hidden-note]').count()) === 1);
await staffCtx.close();

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await cleanup();
await browser.close();
process.exit(summary() ? 1 : 0);
