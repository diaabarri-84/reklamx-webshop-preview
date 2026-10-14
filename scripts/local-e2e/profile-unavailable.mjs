// Client, 2026-10-07: "why is my account like this? did you lock my account?" — the
// owner, signed in while the database had used up its daily reads, saw his admin
// account as a CUSTOMER: the page could not read his profile and put a plain
// customer profile in its place, without a word.
//
//   the database cut off from the page: the header SAYS so — the daily limit, and
//   when it comes back, when the server knows that's the reason; no "Customer"
//   badge; the account form will not save its blanks over his real details;
//   the database back: his real account (Admin) returns by itself, no reload.
import { launch, loginAdmin, BASE, check, summary } from './lib.mjs';

const { browser, page, errors } = await launch();
await loginAdmin(page);
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {});

const accountMenu = async (p) => {
  await p.locator('[data-rx-account-menu]').first().click({ timeout: 15000 }).catch(() => {});
};
const badge = (p) => p.locator('[data-rx-role-badge]');

// ---- as it should be ----
await page.waitForTimeout(1500);
await accountMenu(page);
await badge(page).waitFor({ timeout: 15000 }).catch(() => {});
check('signed in normally: the account menu says Admin', /admin/i.test(await badge(page).innerText().catch(() => '')));

// ---- the database refuses: a window in Stockholm's time, signed in, then cut off
// from Firestore. (Signed in HERE: Firebase keeps the session in IndexedDB, which
// a copied storage state does not carry.) ----
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Europe/Stockholm' });
const p2 = await ctx.newPage();
p2.on('pageerror', (e) => errors.push(String(e?.message ?? e)));
await loginAdmin(p2);
await p2.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await p2.locator('[data-rx-account-menu]').waitFor({ timeout: 20000 });
let cut = true;
await ctx.route('http://127.0.0.1:8085/**', (route) => (cut ? route.abort() : route.continue()));
// What the server answers while the free daily reads are used up (it learns that
// from its own refused reads; the emulator never refuses, so it is answered here).
await ctx.route('**/api/health?database=1', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', database: 'quota', databaseBackAt: '2026-10-08T07:00:00.000Z' }) }));
await p2.goto(`${BASE}/customer-dashboard`, { waitUntil: 'domcontentloaded' });
const banner = p2.locator('[data-rx-profile-unavailable]');
await banner.waitFor({ timeout: 45000 }).catch(() => {});
const bannerText = await banner.innerText().catch(() => '');
check('the profile cannot be read: the page SAYS why — the database\'s free daily reads — and when it is back (09:00 in Stockholm)',
  (await banner.getAttribute('data-rx-profile-unavailable').catch(() => null)) === 'quota' && /daily|today/i.test(bannerText) && /09[.:]00/.test(bannerText) && /nothing is wrong with your account/i.test(bannerText),
  bannerText);
await p2.screenshot({ path: `${process.env.SHOTS || '/tmp'}/170-profile-unavailable.png` });
await accountMenu(p2);
await p2.waitForTimeout(500);
check('…no "Customer" badge on his account in the meantime (he is signed in: the account menu is there)',
  (await p2.locator('[data-rx-account-menu]').count()) === 1 && (await badge(p2).count()) === 0);
await p2.keyboard.press('Escape').catch(() => {});
// The account form, behind "Account" in the side menu.
await p2.getByRole('button', { name: /^Account$/ }).first().click({ timeout: 10000 }).catch(() => {});
const save = p2.locator('[data-rx-profile-save]');
await save.waitFor({ timeout: 15000 }).catch(() => {});
check('…and the account form cannot save its blanks over his real details', await save.isDisabled().catch(() => false));

// ---- the database answers again: his account comes back by itself ----
cut = false;
await ctx.unroute('**/api/health?database=1');
await banner.waitFor({ state: 'detached', timeout: 150000 }).catch(() => {});
check('the database back: the message goes by itself (the profile is read again, no reload)', (await banner.count()) === 0);
await accountMenu(p2);
await badge(p2).waitFor({ timeout: 15000 }).catch(() => {});
check('…and his account is Admin again', /admin/i.test(await badge(p2).innerText().catch(() => '')));

// The aborted reads above are the test's own.
const real = errors.filter((e) => !/net::ERR_FAILED|Failed to load resource|client is offline|Could not reach Cloud Firestore|WebChannelConnection|Firestore/i.test(e));
check('no page errors', real.length === 0, real.slice(0, 3).join(' | '));
await browser.close();
process.exit(summary() ? 1 : 0);
