// 2026-10-08 — the sixth outage. The free database counts its daily limit in READ
// UNITS BY SIZE (measured in Cloud Monitoring), and settings/siteConfig had grown to
// ~800 KB of the UI Customizer's pictures: ~209 units a read. Every visitor's browser
// kept a live listener on it, and the server read it whole every 15 minutes.
//
//   the shop's settings reach a visitor from the server's copy (/api/site-settings),
//   with no Firestore listener on settings/siteConfig in the visitor's browser;
//   the copy is kept until the dashboard signals a change — then it shows at once;
//   the dashboard keeps its live listener;
//   a slide picture from the UI Customizer goes to Storage — the settings keep its
//   address, not the picture;
//   a product page reads the server's copy of the product (/api/catalogue/product);
//   when the database refuses (worker C: its database cannot be reached): the
//   settings and a product come from the last copy, and a product with no copy
//   says "cannot be shown right now" — never "may have been removed";
//   the supplier screen's counts are kept until a recount is asked for;
//   a screen that saves the settings writes its own keys only: a key written
//   behind an open About editor survives its Save (code review ADM-05);
//   a browser whose storage is full still saves, and the shop stays on screen
//   (code review 2026-10-11, REVIEW-3 #3); a Save the database refuses is said
//   in the editor, which keeps what was typed and can save again (REVIEW-3 #6).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, loginAdmin, BASE, SHOTS, db, check, summary, chromium } from './lib.mjs';

// The Admin SDK's Auth goes to the local emulator (run-all.sh exports only the
// Firestore one) — set before the first getAuth() below.
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
const APP = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(join(APP, 'package.json'));
const { FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { getApps } = require('firebase-admin/app');
const C = 'http://127.0.0.1:3102';
const SLUG = 'settings-copy-product';
const PID = 'prod-settings-copy';
const SLUG2 = 'settings-nocopy-product';
const PID2 = 'prod-settings-nocopy';
const ONE = 'Footer from the server copy · one';
const TWO = 'Footer from the server copy · two';
// A real PNG (8 × 8, red) — the bucket's rules accept image/* only.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC',
  'base64',
);

const settingsRef = db.collection('settings').doc('siteConfig');
const before = (await settingsRef.get()).data() ?? {};
const restoreOf = (k) => (before[k] === undefined ? FieldValue.delete() : before[k]);

const signIn = await (await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@emulator.test', password: 'emulator-admin-1', returnSecureToken: true }),
})).json();
const asAdmin = { Authorization: `Bearer ${signIn.idToken}` };
const invalidate = (base = BASE) => fetch(`${base}/api/admin/cache/invalidate`, { method: 'POST', headers: asAdmin }).then((r) => r.status);
const siteSettings = (base = BASE) => fetch(`${base}/api/site-settings`).then((r) => r.json());

// The live owner's account carries the `admin` claim storage.rules ask for
// (read 2026-10-08); the emulator's admin is given the same for this suite.
const auth = getAuth(getApps().find((a) => a.name === 'e2e'));
const adminUser = await auth.getUserByEmail('admin@emulator.test');
const claimsBefore = adminUser.customClaims ?? null;
await auth.setCustomUserClaims(adminUser.uid, { ...(claimsBefore ?? {}), admin: true });

let workerC = null;
// §9 takes the admin's role away for one Save; put back here too, should it crash.
let roleToRestore = null;
const cleanup = async () => {
  workerC?.kill('SIGTERM');
  if (roleToRestore) await db.collection('users').doc(adminUser.uid).set({ role: roleToRestore }, { merge: true }).catch(() => {});
  await settingsRef.set({
    footerText: restoreOf('footerText'), footerTextI18n: restoreOf('footerTextI18n'),
    heroSlides: restoreOf('heroSlides'), heroImageUrl: restoreOf('heroImageUrl'),
    aboutUsPageSettings: restoreOf('aboutUsPageSettings'),
  }, { merge: true });
  await db.collection('products').doc(PID).delete().catch(() => {});
  await db.collection('products').doc(PID2).delete().catch(() => {});
  await auth.setCustomUserClaims(adminUser.uid, claimsBefore).catch(() => {});
  for (const id of [PID, PID2]) rmSync(join(APP, '.cache', `product-${id}.json`), { force: true });
  await invalidate().catch(() => {});
};
process.on('uncaughtException', async (err) => { console.error(err); await cleanup().catch(() => {}); process.exit(1); });

// Firestore traffic from a page, as the emulator sees it: the address and the body.
const watchFirestore = (page) => {
  const seen = [];
  page.on('request', (req) => {
    if (!req.url().startsWith('http://127.0.0.1:8085/')) return;
    let body = '';
    try { body = decodeURIComponent(req.postData() ?? ''); } catch { body = req.postData() ?? ''; }
    seen.push(`${decodeURIComponent(req.url())} ${body}`);
  });
  return seen;
};

// ---- 1. the server's copy -------------------------------------------------------
await settingsRef.set({ footerText: ONE, footerTextI18n: FieldValue.delete() }, { merge: true });
check('a change from the dashboard is signalled', (await invalidate()) === 200);
const s1 = await siteSettings();
check('/api/site-settings serves the shop\'s settings from the server\'s copy', s1?.settings?.footerText === ONE && !s1.stale, JSON.stringify(s1).slice(0, 160));
await settingsRef.set({ footerText: TWO }, { merge: true });
check('…and KEEPS that copy while nothing was signalled (no read per visit)', (await siteSettings())?.settings?.footerText === ONE);
await invalidate();
check('…a change from the dashboard shows at once', (await siteSettings())?.settings?.footerText === TWO);

// ---- 2. a visitor ------------------------------------------------------------------
{
  const { browser, page, errors } = await launch();
  const fs = watchFirestore(page);
  const apiCalls = [];
  page.on('request', (req) => { if (req.url().includes('/api/site-settings')) apiCalls.push(req.url()); });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.getByText(TWO).first().waitFor({ timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);
  check('a visitor\'s page shows the server\'s settings (the footer)', (await page.getByText(TWO).count()) > 0);
  check('…fetched from /api/site-settings', apiCalls.length >= 1, String(apiCalls.length));
  check('…and the visitor\'s browser opens NO Firestore listener on settings/siteConfig',
    !fs.some((r) => r.includes('settings/siteConfig')), fs.filter((r) => r.includes('siteConfig')).slice(0, 2).join('\n').slice(0, 300));
  check('…no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

// ---- 3. the dashboard: live, and a slide picture goes to Storage -------------------
{
  const { browser, page, errors } = await launch();
  const fs = watchFirestore(page);
  await loginAdmin(page);
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {});
  await page.getByRole('button', { name: 'UI Customizer' }).first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  check('the dashboard keeps its LIVE listener on the settings', fs.some((r) => r.includes('settings/siteConfig')));
  await page.getByRole('button', { name: 'UI Customizer' }).first().click();
  await page.locator('[data-rx-customizer-tab="images"]').click();
  const input = page.locator('input[data-rx-slide-file="0"]');
  await input.waitFor({ state: 'attached', timeout: 20000 });
  await input.setInputFiles({ name: 'slide.png', mimeType: 'image/png', buffer: PNG });
  const save = page.locator('[data-rx-customizer-save]');
  // Save waits for the upload: disabled while it runs, then enabled again.
  await page.waitForFunction(() => !document.querySelector('[data-rx-customizer-uploading]'), null, { timeout: 30000 });
  await save.waitFor({ state: 'visible' });
  check('the upload is done and Save is open again', await save.isEnabled());
  await save.click();
  let saved = null;
  for (let i = 0; i < 40; i++) {
    saved = (await settingsRef.get()).data();
    if (String(saved?.heroSlides?.[0]?.imageUrl ?? '').includes('public%2Fsite%2F')) break;
    await page.waitForTimeout(500);
  }
  const url = String(saved?.heroSlides?.[0]?.imageUrl ?? '');
  check('the slide picture went to Storage — the settings keep its address, not the picture',
    /^http:\/\/127\.0\.0\.1:9199\/.+public%2Fsite%2F/.test(url) && !url.startsWith('data:'), url.slice(0, 160));
  check('…and the first slide is also the hero picture, the same address', saved?.heroImageUrl === url);
  const served = await siteSettings();
  check('…Save waited for the server\'s copy: /api/site-settings already serves the new address', served?.settings?.heroSlides?.[0]?.imageUrl === url);
  const picture = await fetch(url).then((r) => r.status).catch(() => 0);
  check('…and the picture is there', picture === 200, String(picture));
  await page.screenshot({ path: `${SHOTS}/180-customizer-slide-storage.png` });
  check('…no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

// ---- 4. a product from the server's copy ------------------------------------------
const field = { id: 'size', name: 'Size', enabled: true, options: [{ id: 'sz-a4', label: 'A4', value: 'a4', priceModifier: 0, isDefault: true }] };
await db.collection('products').doc(PID).set({
  id: PID, name: 'Settings copy product', slug: SLUG, isHidden: false, basePrice: 120, categoryId: 'indoor',
  images: [], description: 'From the server\'s copy.', printingFields: [field], minQuantity: 1, maxQuantity: 100, stock: 100,
});
await db.collection('products').doc(PID2).set({
  id: PID2, name: 'Settings no-copy product', slug: SLUG2, isHidden: false, basePrice: 90, categoryId: 'indoor',
  images: [], description: 'Never asked for.', printingFields: [field], minQuantity: 1, maxQuantity: 100, stock: 100,
});
await invalidate();
const p1 = await (await fetch(`${BASE}/api/catalogue/product?param=${SLUG}`)).json();
check('/api/catalogue/product serves the WHOLE product (its properties too) by its address', p1?.product?.id === PID && Array.isArray(p1.product.printingFields) && !p1.stale, JSON.stringify(p1).slice(0, 160));
check('…an unknown address: 404', (await fetch(`${BASE}/api/catalogue/product?param=no-such-product-here`)).status === 404);
{
  const { browser, page, errors } = await launch();
  const fs = watchFirestore(page);
  const asked = [];
  page.on('request', (req) => { if (req.url().includes('/api/catalogue/product')) asked.push(req.url()); });
  await page.goto(`${BASE}/products/${SLUG}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Settings copy product' }).first().waitFor({ timeout: 30000 }).catch(() => {});
  check('a visitor\'s product page shows the product', (await page.getByRole('heading', { name: 'Settings copy product' }).count()) > 0);
  check('…from the server\'s copy — the browser does not read the product from Firestore',
    asked.length >= 1 && !fs.some((r) => r.includes(`products/${PID}`)), `${asked.length} · ${fs.filter((r) => r.includes(PID)).length}`);
  check('…no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

// ---- 5. the database refuses: worker C cannot reach it ----------------------------
workerC = spawn('./node_modules/.bin/tsx', ['server.ts'], {
  cwd: APP,
  env: {
    ...process.env, PORT: '3102', DISABLE_HMR: 'true', AUTO_STAGE_SWEEP: 'off', VITE_FIREBASE_EMULATOR: '1',
    // Nothing listens here: every read this worker tries fails.
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:8099', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
    FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199', GCLOUD_PROJECT: 'demo-reklamx',
  },
  stdio: 'ignore',
});
let up = false;
for (let i = 0; i < 160 && !up; i++) {
  up = await fetch(`${C}/api/health`).then((r) => r.ok).catch(() => false);
  if (!up) await new Promise((r) => setTimeout(r, 500));
}
check('worker C is up (its database cannot be reached)', up);
// A change signalled just now: every copy is out of date, so worker C must try
// the database — and, refused, fall back to the last copy.
await invalidate();
const t0 = Date.now();
const sC = await siteSettings(C);
check('the settings come from the LAST copy, marked stale — the shop keeps its own look', sC?.stale === true && sC?.settings?.footerText === TWO,
  `${JSON.stringify(sC).slice(0, 120)} (${Date.now() - t0} ms)`);
const pC = await (await fetch(`${C}/api/catalogue/product?param=${SLUG}`)).json();
check('a product someone looked at comes from its last copy, marked stale', pC?.product?.id === PID && pC.stale === true, JSON.stringify(pC).slice(0, 120));
const pC2 = await fetch(`${C}/api/catalogue/product?param=${SLUG2}`);
check('a product nobody looked at has no copy: the server says it cannot answer (not 404)', pC2.status >= 500, String(pC2.status));
{
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  // The visitor's browser cannot read the database either.
  await context.route('http://127.0.0.1:8085/**', (route) => route.abort());
  const page = await context.newPage();
  await page.goto(`${C}/products/${SLUG}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Settings copy product' }).first().waitFor({ timeout: 150000 }).catch(() => {});
  check('refused: the product page still shows a product from its copy', (await page.getByRole('heading', { name: 'Settings copy product' }).count()) > 0);
  await page.goto(`${C}/products/${SLUG2}`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-rx-product-unavailable]').waitFor({ timeout: 180000 }).catch(() => {});
  const body = await page.locator('main').innerText().catch(() => '');
  check('…and a product with no copy says it "cannot be shown right now" — not that it may have been removed',
    (await page.locator('[data-rx-product-unavailable]').count()) === 1 && !/could not find that product|may have been removed/i.test(body), body.slice(0, 200));
  await page.screenshot({ path: `${SHOTS}/181-product-unavailable.png` });
  await browser.close();
}
workerC.kill('SIGTERM');
workerC = null;

// ---- 6. the supplier screen's counts are kept --------------------------------------
const sup = (q = '') => fetch(`${BASE}/api/admin/suppliers${q}`, { headers: asAdmin }).then((r) => r.json());
const a = await sup('?recount=1');
await new Promise((r) => setTimeout(r, 1100));
const b = await sup();
const c = await sup('?recount=1');
check('the supplier counts are KEPT (each count costs ~200 read units on the live database)', !!a.countsAt && b.countsAt === a.countsAt, `${a.countsAt} · ${b.countsAt}`);
check('…and counted again when asked', !!c.countsAt && c.countsAt > a.countsAt, `${a.countsAt} → ${c.countsAt}`);

// ---- 7. a save writes its own keys, never the page's whole copy ---------------------
// The About page's editor holds the settings it loaded and listens to nothing. Its
// Save wrote that whole copy back: a key changed meanwhile — by the dashboard, by
// another tab — was put back as it was.
{
  const { browser, page, errors } = await launch();
  await loginAdmin(page);
  await page.goto(`${BASE}/about`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {});
  await page.getByRole('button', { name: 'Edit About Us Info' }).click({ timeout: 20000 });
  await page.getByRole('heading', { name: 'Edit About Us Page Content' }).waitFor({ timeout: 10000 });
  const HERO = `About hero ${Date.now()}`;
  const BEHIND = 'Footer written behind the About editor';
  await page.getByText('Hero Title', { exact: true }).locator('xpath=following-sibling::input[1]').fill(HERO);
  // Behind the open page's back, as another screen would.
  await settingsRef.set({ footerText: BEHIND }, { merge: true });
  await page.getByRole('button', { name: 'Save About Us Content' }).click();
  let after = null;
  for (let i = 0; i < 40; i++) {
    after = (await settingsRef.get()).data();
    if (after?.aboutUsPageSettings?.heroTitle === HERO) break;
    await page.waitForTimeout(250);
  }
  check('the About editor\'s Save writes the About page — and a key written meanwhile elsewhere stays as written (its old copy was put back)',
    after?.aboutUsPageSettings?.heroTitle === HERO && after?.footerText === BEHIND,
    JSON.stringify({ hero: after?.aboutUsPageSettings?.heroTitle ?? null, footer: after?.footerText ?? null }));
  check('…no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

// ---- 8. a browser that will not keep the settings' copy (code review REVIEW-3 #3) ----
// A full storage threw inside the settings' state updater; React rethrew it while
// rendering, outside the error boundary, and the shop went blank on Save.
{
  const { browser, page, errors } = await launch();
  await page.addInitScript(() => {
    const keep = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'reklamx_site_settings') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      return keep.call(this, key, value);
    };
  });
  await loginAdmin(page);
  await page.goto(`${BASE}/about`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {});
  await page.getByRole('button', { name: 'Edit About Us Info' }).click({ timeout: 20000 });
  await page.getByRole('heading', { name: 'Edit About Us Page Content' }).waitFor({ timeout: 10000 });
  const HERO = `About hero, storage full ${Date.now()}`;
  await page.getByText('Hero Title', { exact: true }).locator('xpath=following-sibling::input[1]').fill(HERO);
  await page.getByRole('button', { name: 'Save About Us Content' }).click();
  await page.getByRole('heading', { name: 'Edit About Us Page Content' }).waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(800);
  const saved = (await settingsRef.get()).data()?.aboutUsPageSettings?.heroTitle;
  check('storage full: Save saves, and the shop is still on screen — not blank',
    saved === HERO && (await page.getByRole('button', { name: 'Edit About Us Info' }).count()) === 1,
    JSON.stringify({ saved: saved ?? null, editButton: await page.getByRole('button', { name: 'Edit About Us Info' }).count() }));
  check('…no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

// ---- 9. a Save the database refuses (code review REVIEW-3 #6) -----------------------
// updateSettings rethrows; the About, Services and Contact editors stayed on "saving"
// for good, with nothing said.
{
  const { browser, page, errors } = await launch();
  await loginAdmin(page);
  await page.goto(`${BASE}/about`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {});
  await page.getByRole('button', { name: 'Edit About Us Info' }).click({ timeout: 20000 });
  await page.getByRole('heading', { name: 'Edit About Us Page Content' }).waitFor({ timeout: 10000 });
  const HERO = `About hero, refused first ${Date.now()}`;
  const heroBox = page.getByText('Hero Title', { exact: true }).locator('xpath=following-sibling::input[1]');
  await heroBox.fill(HERO);
  // The database stops taking his writes: the rules read the role from users/{uid}.
  const userRef = db.collection('users').doc(adminUser.uid);
  roleToRestore = (await userRef.get()).data()?.role ?? 'admin';
  await userRef.set({ role: 'client' }, { merge: true });
  const saveBtn = page.getByRole('button', { name: 'Save About Us Content' });
  await saveBtn.click();
  const said = page.locator('[data-rx-page-edit-error]');
  await said.waitFor({ timeout: 20000 }).catch(() => {});
  check('a Save the database refuses: the editor says so, keeps what he typed, and Save can be pressed again — not "saving" for good',
    (await said.count()) === 1 && !(await saveBtn.isDisabled()) && (await heroBox.inputValue()) === HERO,
    `${await said.innerText().catch(() => 'no notice')} · disabled ${await saveBtn.isDisabled()}`);
  await userRef.set({ role: roleToRestore }, { merge: true });
  roleToRestore = null;
  await saveBtn.click();
  await page.getByRole('heading', { name: 'Edit About Us Page Content' }).waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
  check('…allowed again, the same Save goes through and the editor closes',
    (await settingsRef.get()).data()?.aboutUsPageSettings?.heroTitle === HERO && (await said.count()) === 0);
  // The refusal itself is logged (updateSettings) — anything else is not expected.
  const other = errors.filter((e) => !/Saving site settings failed|permission/i.test(e));
  check('…no other page errors', other.length === 0, other.slice(0, 3).join(' | '));
  await browser.close();
}

await cleanup();
process.exit(summary() ? 1 : 0);
