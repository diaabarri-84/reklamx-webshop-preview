// 2026-10-09 — the seventh outage. The product editor kept uploaded gallery pictures
// INSIDE the product documents (base64); the 87 products grew to ~9 MB, and on this
// database a read is billed by size: every reload of the catalogue cost ~2 230 units,
// and the hourly reload alone spent more than the day's limit.
//
//   a picture added in the product editor goes to Storage — the product keeps its
//   address, not the picture — and Save waits for the upload; when Storage refuses,
//   the owner is told and the picture is NOT kept inside the product instead (code
//   review ADM-11);
//   scripts/migrate-product-pictures.mjs moves the pictures already inside products
//   out to Storage (gallery and option pictures), and its rollback puts them back.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, loginAdmin, BASE, SHOTS, db, check, summary } from './lib.mjs';

process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
const APP = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(join(APP, 'package.json'));
const { getAuth } = require('firebase-admin/auth');
const { getApps } = require('firebase-admin/app');
const PID = 'prod-picture-test';
const NAME = 'Picture test product';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC',
  'base64',
);
const INLINE = `data:image/png;base64,${PNG.toString('base64')}`;

const signIn = await (await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@emulator.test', password: 'emulator-admin-1', returnSecureToken: true }),
})).json();
const invalidate = () => fetch(`${BASE}/api/admin/cache/invalidate`, { method: 'POST', headers: { Authorization: `Bearer ${signIn.idToken}` } }).then((r) => r.status);
// The live owner's account carries the `admin` claim storage.rules ask for.
const auth = getAuth(getApps().find((a) => a.name === 'e2e'));
const adminUser = await auth.getUserByEmail('admin@emulator.test');
const claimsBefore = adminUser.customClaims ?? null;
await auth.setCustomUserClaims(adminUser.uid, { ...(claimsBefore ?? {}), admin: true });

const ref = db.collection('products').doc(PID);
const cleanup = async () => {
  await ref.delete().catch(() => {});
  await auth.setCustomUserClaims(adminUser.uid, claimsBefore).catch(() => {});
  await invalidate().catch(() => {});
};
process.on('uncaughtException', async (err) => { console.error(err); await cleanup().catch(() => {}); process.exit(1); });

await ref.set({
  id: PID, name: NAME, slug: 'picture-test-product', isHidden: false, basePrice: 100, categoryId: 'indoor',
  images: ['/placeholder-print.svg'], description: 'For the picture test.', minQuantity: 1, maxQuantity: 100, stock: 100,
  printingFields: [],
});
await invalidate();

// ---- 1. a picture added in the editor goes to Storage ------------------------------
{
  const { browser, page, errors } = await launch();
  await loginAdmin(page);
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {});
  await page.getByRole('button', { name: 'Products Admin' }).click();
  await page.getByText(NAME, { exact: true }).first().waitFor({ timeout: 20000 });
  await page.locator(`xpath=//*[normalize-space()=${JSON.stringify(NAME)}]/ancestor::div[.//button[normalize-space()='Edit']][1]//button[normalize-space()='Edit']`).first().click();
  const save = page.locator('[data-rx-product-save]');
  await save.waitFor({ timeout: 15000 });
  await page.locator('input[data-rx-product-picture-file]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PNG });
  // Save is held while the picture uploads, then reads "Save Product" again.
  await page.waitForFunction(() => {
    const b = document.querySelector('[data-rx-product-save]');
    return !!b && !b.hasAttribute('disabled') && /Save Product/.test(b.textContent ?? '');
  }, null, { timeout: 30000 });
  check('the upload is done and Save is open again', await save.isEnabled());
  await save.click();
  let images = [];
  for (let i = 0; i < 40; i++) {
    images = (await ref.get()).data()?.images ?? [];
    if (images.some((u) => String(u).includes('public%2Fproducts%2F'))) break;
    await page.waitForTimeout(500);
  }
  const url = String(images.find((u) => String(u).includes('public%2Fproducts%2F')) ?? '');
  check('the picture went to Storage — the product keeps its address, not the picture',
    /^http:\/\/127\.0\.0\.1:9199\/.+public%2Fproducts%2F/.test(url) && !images.some((u) => String(u).startsWith('data:')), JSON.stringify(images).slice(0, 200));
  check('…and the picture is there', (await fetch(url).then((r) => r.status).catch(() => 0)) === 200);
  await page.screenshot({ path: `${SHOTS}/182-product-picture-storage.png` });
  check('…no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  // Storage refuses the next one (an outage, a lost permission): it used to go INSIDE
  // the product with nothing said — the size problem back, a picture at a time.
  const kept = (await ref.get()).data()?.images ?? [];
  let told = null;
  await page.route('http://127.0.0.1:9199/v0/b/**', (route) => (route.request().method() === 'POST'
    ? route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { code: 403, message: 'Permission denied.' } }) })
    : route.continue()));
  await page.locator(`xpath=//*[normalize-space()=${JSON.stringify(NAME)}]/ancestor::div[.//button[normalize-space()='Edit']][1]//button[normalize-space()='Edit']`).first().click();
  await save.waitFor({ timeout: 15000 });
  await page.locator('input[data-rx-product-picture-file]').setInputFiles({ name: 'photo-refused.png', mimeType: 'image/png', buffer: PNG });
  // Said in the page now (ADM-11 review fix), not in a browser alert a muted tab never
  // shows; its overlay is closed before Save, as the owner would.
  const notice = page.getByRole('alertdialog', { name: 'The picture could not be uploaded. Please try again.' });
  await notice.waitFor({ timeout: 15000 }).catch(() => {});
  told = (await notice.count()) ? 'The picture could not be uploaded. Please try again.' : null;
  await notice.getByRole('button', { name: 'OK' }).click().catch(() => {});
  await page.unroute('http://127.0.0.1:9199/v0/b/**');
  await page.waitForFunction(() => {
    const b = document.querySelector('[data-rx-product-save]');
    return !!b && !b.hasAttribute('disabled') && /Save Product/.test(b.textContent ?? '');
  }, null, { timeout: 30000 });
  await save.click();
  await save.waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
  const refusedAfter = (await ref.get()).data()?.images ?? [];
  check('Storage refusing: the owner is told the picture could not be uploaded — and it is NOT kept inside the product',
    told === 'The picture could not be uploaded. Please try again.' && !refusedAfter.some((u) => String(u).startsWith('data:')) &&
    JSON.stringify(refusedAfter) === JSON.stringify(kept),
    JSON.stringify({ told, before: kept.length, after: refusedAfter.length, inline: refusedAfter.some((u) => String(u).startsWith('data:')) }));
  await browser.close();
}

// ---- 2. the migration script moves pictures already inside a product ---------------
await ref.set({
  images: ['/placeholder-print.svg', INLINE],
  printingFields: [{ id: 'size', name: 'Size', enabled: true, options: [{ id: 'sz-a', label: 'A', value: 'a', imageUrl: INLINE }] }],
}, { merge: true });
const env = {
  ...process.env, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8085', FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', GCLOUD_PROJECT: 'demo-reklamx', SHOP_URL: BASE,
};
const run = (...a) => spawnSync('node', ['scripts/migrate-product-pictures.mjs', ...a], { cwd: APP, env, encoding: 'utf8' });
const plan = run();
check('the plan lists the product with its two inline pictures, and writes nothing',
  plan.status === 0 && plan.stdout.includes(PID) && /2 picture\(s\)/.test(plan.stdout) && (await ref.get()).data()?.images?.[1] === INLINE,
  (plan.stdout + plan.stderr).slice(-400));
const applied = run('--apply');
const after = (await ref.get()).data();
const galleryUrl = String(after?.images?.[1] ?? '');
const optionUrl = String(after?.printingFields?.[0]?.options?.[0]?.imageUrl ?? '');
check('--apply: the gallery picture and the option picture are Storage addresses now — one file for the same picture',
  applied.status === 0 && galleryUrl.includes('public%2Fproducts%2F') && galleryUrl === optionUrl, `${galleryUrl.slice(0, 120)} · ${optionUrl.slice(0, 60)}\n${applied.stdout.slice(-300)}`);
check('…the picture answers', (await fetch(galleryUrl).then((r) => r.status).catch(() => 0)) === 200);
const rollbackFile = readdirSync(join(APP, '.backups')).filter((f) => f.startsWith('products-pictures-rollback-')).sort().pop();
const back = run('--rollback', join(APP, '.backups', rollbackFile), '--apply');
const restored = (await ref.get()).data();
check('the rollback puts the pictures back as they were',
  back.status === 0 && restored?.images?.[1] === INLINE && restored?.printingFields?.[0]?.options?.[0]?.imageUrl === INLINE, back.stdout.slice(-200));

await cleanup();
process.exit(summary() ? 1 : 0);
