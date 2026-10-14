// Reproduce the sign-in the way a person does it, and report what actually
// happens — console errors, failed requests, and where the app ends up.
//
//   node scripts/try-login.mjs <email> <password>

import { chromium } from 'playwright';

const EMAIL = process.argv[2];
const PASSWORD = process.argv[3];
const BASE = 'http://localhost:3000';

const browser = await chromium.launch();
const page = await browser.newPage();

const consoleErrors = [];
const failedRequests = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push(`[${m.type()}] ${m.text().slice(0, 200)}`);
});
page.on('pageerror', (e) => consoleErrors.push(`[pageerror] ${e.message.slice(0, 200)}`));
page.on('requestfailed', (r) => failedRequests.push(`${r.method()} ${r.url().slice(0, 110)} — ${r.failure()?.errorText}`));

console.log('1. opening the site');
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);

console.log('2. looking for a way in');
const signInCandidates = ['text=Sign In', 'text=Logga in', 'button:has-text("Sign")', '[aria-label*="ign"]'];
let opened = false;
for (const sel of signInCandidates) {
  const el = page.locator(sel).first();
  if (await el.count() && await el.isVisible().catch(() => false)) {
    await el.click();
    opened = true;
    console.log(`   clicked ${sel}`);
    break;
  }
}
if (!opened) console.log('   !! no visible sign-in control found');

await page.waitForTimeout(1200);

console.log('3. filling the form');
const emailInput = page.locator('input[type="email"]').first();
const passInput = page.locator('input[type="password"]').first();

if (!(await emailInput.count())) {
  console.log('   !! no email field on screen — dumping the visible buttons/tabs:');
  const labels = await page.locator('button, [role="tab"]').allInnerTexts();
  console.log('   ', labels.filter(Boolean).map((s) => s.replace(/\s+/g, ' ').trim()).slice(0, 25).join(' | '));
} else {
  await emailInput.fill(EMAIL);
  await passInput.fill(PASSWORD);
  console.log('   filled, submitting');
  const submit = page.locator('button[type="submit"]').first();
  if (await submit.count()) await submit.click();
  else await passInput.press('Enter');
  await page.waitForTimeout(5000);
}

// Whatever the app decided, read it back out of the running app rather than
// guessing from the screen.
const state = await page.evaluate(() => ({
  url: location.pathname,
  bodyText: document.body.innerText.slice(0, 300).replace(/\s+/g, ' '),
  localStorageKeys: Object.keys(localStorage).filter((k) => k.toLowerCase().includes('firebase')).length,
}));

console.log('\n4. after submitting');
console.log('   path:', state.url);
console.log('   firebase keys in localStorage:', state.localStorageKeys, state.localStorageKeys ? '(signed in)' : '(NOT signed in)');

console.log('\n5. going to /admin');
await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
const adminPath = await page.evaluate(() => location.pathname);
const adminText = await page.evaluate(() => document.body.innerText.slice(0, 200).replace(/\s+/g, ' '));
console.log('   ended up at:', adminPath, adminPath === '/admin' ? '✅' : '🔴 redirected away');
console.log('   page says:', adminText);

await page.screenshot({ path: 'login-attempt.png', fullPage: false });
console.log('\n   screenshot: login-attempt.png');

if (consoleErrors.length) {
  console.log('\n=== console errors ===');
  [...new Set(consoleErrors)].slice(0, 12).forEach((e) => console.log('  ', e));
} else console.log('\n=== no console errors ===');

if (failedRequests.length) {
  console.log('\n=== failed requests ===');
  [...new Set(failedRequests)].slice(0, 8).forEach((e) => console.log('  ', e));
}

await browser.close();
