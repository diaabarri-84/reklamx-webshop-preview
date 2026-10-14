// Client, 2026-10-07: "lay out the pages and order them" — over the UI Customizer,
// whose seven tabs sat in one scrolling row with the last cut off.
//
//   the tabs: all seven in view, none cut, no scrolling row;
//   the home page's order: drag "News" to the top in Page Sections, Save & Apply,
//   and the shop's home page shows News first.
import { launch, loginAdmin, BASE, SHOTS, db, check, summary, dragTo } from './lib.mjs';

const settingsRef = db.collection('settings').doc('siteConfig');
const orderBefore = (await settingsRef.get()).data()?.homeSectionOrder ?? null;
// Put back behind the dashboard's back — and signalled, as its Save does: visitors
// read the server's copy of the settings (2026-10-08).
const cleanup = async () => {
  await settingsRef.set({ homeSectionOrder: orderBefore }, { merge: true });
  const signIn = await (await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@emulator.test', password: 'emulator-admin-1', returnSecureToken: true }),
  })).json().catch(() => ({}));
  if (signIn.idToken) await fetch(`${BASE}/api/admin/cache/invalidate`, { method: 'POST', headers: { Authorization: `Bearer ${signIn.idToken}` } }).catch(() => {});
};
process.on('uncaughtException', async (err) => { console.error(err); await cleanup().catch(() => {}); process.exit(1); });
await settingsRef.set({ homeSectionOrder: null }, { merge: true });

const { browser, page, errors } = await launch();
await loginAdmin(page);
await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {});
await page.getByRole('button', { name: 'UI Customizer' }).first().click();
const tabs = page.locator('[data-rx-customizer-tabs]');
await tabs.waitFor({ timeout: 20000 });
const fit = await tabs.evaluate((grid) => {
  const box = grid.getBoundingClientRect();
  const items = [...grid.querySelectorAll('[data-rx-customizer-tab]')].map((b) => {
    const r = b.getBoundingClientRect();
    const label = b.querySelector('span');
    return { id: b.getAttribute('data-rx-customizer-tab'), inside: r.left >= box.left - 1 && r.right <= box.right + 1, whole: label ? label.scrollWidth <= label.clientWidth + 1 : true };
  });
  return { items, scrolls: grid.scrollWidth > grid.clientWidth + 1 };
});
check('UI Customizer: all seven tabs in view, none cut off, no scrolling row',
  fit.items.length === 7 && fit.items.every((i) => i.inside && i.whole) && !fit.scrolls, JSON.stringify(fit));
await tabs.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${SHOTS}/170-customizer-tabs.png` });

await page.getByRole('button', { name: 'Page Sections' }).click();
const list = page.locator('[data-rx-home-order]');
await list.waitFor({ timeout: 15000 });
const order = async () => list.locator('[data-rx-home-section]').evaluateAll((els) => els.map((e) => e.getAttribute('data-rx-home-section')));
check('Page Sections: the home page\'s five sections, in the page\'s order', JSON.stringify(await order()) === JSON.stringify(['hero', 'categories', 'inspiration', 'benefits', 'news']));
await dragTo(page, list.locator('[data-rx-home-section="news"] [aria-label^="Drag"]'), list.locator('[data-rx-home-section="hero"]'), { offsetY: -14 });
check('"News" dragged to the top', (await order())[0] === 'news', JSON.stringify(await order()));
await page.screenshot({ path: `${SHOTS}/171-home-order.png` });
await page.getByRole('button', { name: 'Save & Apply' }).click();
let saved = null;
for (let i = 0; i < 40 && saved?.[0] !== 'news'; i++) { await page.waitForTimeout(250); saved = (await settingsRef.get()).data()?.homeSectionOrder; }
check('Save & Apply: his order is saved', Array.isArray(saved) && saved[0] === 'news', JSON.stringify(saved));

const shop = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const sp = await shop.newPage();
await sp.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await sp.locator('main section').first().waitFor({ timeout: 20000 });
await sp.waitForTimeout(1500);
const first = await sp.locator('main > section').first().innerText();
check('the shop\'s home page now opens with News', /news|nyheter/i.test(first.slice(0, 200)), first.slice(0, 120));
await sp.screenshot({ path: `${SHOTS}/172-home-news-first.png` });
await shop.close();

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await cleanup();
await browser.close();
process.exit(summary() ? 1 : 0);
