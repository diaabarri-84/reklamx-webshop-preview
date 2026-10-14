// Client, 2026-10-07: "the dashboard is incomplete" — with a reference dashboard
// (revenue and orders over time, this period vs the one before, a revenue goal,
// orders by category, revenue by category).
//
//   the overview: the headline figures are the server's own (reports API) and
//   say how they moved; the four charts are drawn; his monthly goal is saved
//   server-side and measured against this month and quarter; the periods switch;
//   the Reports screen is back in the menu.
import { launch, loginAdmin, BASE, SHOTS, db, check, summary } from './lib.mjs';

const secrets = db.collection('secrets').doc('integrations');
const goalBefore = (await secrets.get()).data()?.dashboard ?? null;

const now = Date.now();
const daysAgo = (n) => new Date(now - n * 86_400_000).toISOString();
const order = (id, ago, lines) => {
  const net = lines.reduce((s, [, price]) => s + price, 0);
  return {
    id, userId: 'guest', createdAt: daysAgo(ago), status: 'completed', paymentStatus: 'paid', paidAt: daysAgo(ago),
    customerName: `Insight ${id}`, customerEmail: `insight-${id}@firma.test`, currency: 'SEK',
    items: lines.map(([cat, price], i) => ({ productId: `p-insight-${cat}-${i}`, productName: `Insight ${cat}`, quantity: 1, unitPrice: price, price, categoryId: cat })),
    goodsNet: net, netTotal: net, vatAmount: net * 0.25, grossTotal: net * 1.25,
  };
};
const SEED = [
  order('202690701', 3, [['indoor', 1000]]),
  order('202690702', 40, [['outdoor', 2000], ['indoor', 1000]]),
  order('202690703', 200, [['Banners', 4000]]),
  // The same category by its NAME — both kinds are in the live data: one slice.
  order('202690705', 100, [['BANNERS', 500]]),
  // The year before: what "vs the period before" compares the 12 months with.
  order('202690704', 400, [['indoor', 800]]),
];
for (const o of SEED) await db.collection('orders').doc(o.id).set(o);
// The server keeps finished reports five minutes, and any suite that opened the
// dashboard before this one left its 12 months there — without these orders.
const signIn = await (await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@emulator.test', password: 'emulator-admin-1', returnSecureToken: true }),
})).json();
await fetch(`${BASE}/api/admin/reports?slim=1&refresh=1&from=2026-01-01&to=2026-01-02`, { headers: { Authorization: `Bearer ${signIn.idToken}` } });
const cleanup = async () => {
  for (const o of SEED) await db.collection('orders').doc(o.id).delete().catch(() => {});
  await secrets.set({ dashboard: goalBefore ?? { monthlyGoal: 0 } }, { merge: true });
};
process.on('uncaughtException', async (err) => { console.error(err); await cleanup().catch(() => {}); process.exit(1); });

const { browser, page, errors } = await launch();
// The period's own report is the one that ends TODAY (the one before it is fetched
// alongside, and may well answer first).
const pad = (n) => String(n).padStart(2, '0');
const today = (() => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; })();
const reports = [];
// Every report reads its orders, slim or not: the goal's month and quarter come from
// the 12 months' own days — no extra report for them.
const slimCalls = [];
page.on('request', (r) => { if (r.url().includes('/api/admin/reports?') && r.url().includes('slim=1')) slimCalls.push(r.url()); });
page.on('response', async (r) => {
  if (r.url().includes('/api/admin/reports?') && !r.url().includes('slim=1') && r.ok()) {
    reports.push({ url: r.url(), body: await r.json().catch(() => null) });
  }
});
await loginAdmin(page);
await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {});

const insights = page.locator('[data-rx-insights]');
await insights.waitFor({ timeout: 20000 });
await page.locator('[data-rx-insight-tile="revenue"]').waitFor({ timeout: 20000 });
await page.waitForTimeout(1500);
const year = reports.find((r) => r.body?.categories && r.url.includes(`to=${today}`))?.body;
check('the overview has the insights, from the reports API with categories in it', !!year && Array.isArray(year.categories?.totals), JSON.stringify(Object.keys(year ?? {})).slice(0, 120));
const tileText = await page.locator('[data-rx-insight-tile="revenue"]').innerText();
const shown = Number((tileText.match(/([\d\s ]+)\s*SEK/) ?? [])[1]?.replace(/[\s ]/g, ''));
check('the revenue figure is the server\'s own (12 months, paid, incl. VAT)', shown === Math.round(year.totals.grossRevenue), `${tileText} vs ${year.totals.grossRevenue}`);
check('…and it says how it moved against the 12 months before', /%/.test(tileText) || /nothing to compare/.test(tileText), tileText);
const indoor = year.categories.totals.find((c) => c.key === 'indoor');
check('by category: the two indoor orders and their revenue are counted (the shared order split by its lines)',
  !!indoor && indoor.orders >= 2 && indoor.revenue >= 1250 + 1250, JSON.stringify(indoor));
const banners = year.categories.totals.filter((c) => /^banners$/i.test(c.key) || /^banners$/i.test(c.name));
check('a category given by its id on one order and its NAME on another: ONE slice, both orders in it',
  banners.length === 1 && banners[0].key === 'Banners' && banners[0].orders >= 2 && banners[0].revenue >= (4000 + 500) * 1.25, JSON.stringify(banners));
const sumCategories = year.categories.totals.reduce((s, c) => s + c.revenue, 0);
check('…and the categories add up to the revenue figure', Math.abs(sumCategories - year.totals.grossRevenue) < 1, `${sumCategories} vs ${year.totals.grossRevenue}`);
check('every month of the 12 is in the revenue-by-category series', year.categories.monthly.length >= 12, String(year.categories.monthly.length));

const bars = async (chart) => page.locator(`[data-rx-insight-chart="${chart}"] .recharts-bar-rectangle, [data-rx-insight-chart="${chart}"] .recharts-pie-sector`).count();
check('revenue and orders over time: drawn (bars for orders, a line for revenue)',
  (await bars('over-time')) > 0 && (await page.locator('[data-rx-insight-chart="over-time"] .recharts-line').count()) === 1);
check('orders by category: a slice per category', (await bars('category-orders')) >= 3);
check('revenue by category, month by month: drawn', (await bars('category-revenue')) > 0);
await insights.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${SHOTS}/140-insights-12m.png`, fullPage: false });

// His goal, kept server-side, measured against this month and this quarter.
await page.locator('[data-rx-goal-edit]').click();
await page.locator('[data-rx-goal-input]').fill('20000');
await page.locator('[data-rx-goal-save]').click();
// Saved when the form closes (the server answered), not when a bar is visible: a
// goal the server still holds from before would show a bar at once.
await page.locator('[data-rx-goal-input]').waitFor({ state: 'detached', timeout: 15000 });
await page.locator('[data-rx-goal="month"]').waitFor({ timeout: 15000 });
let savedGoal = null;
for (let i = 0; i < 40 && savedGoal !== 20000; i++) {
  savedGoal = (await secrets.get()).data()?.dashboard?.monthlyGoal;
  if (savedGoal !== 20000) await page.waitForTimeout(250);
}
const monthText = await page.locator('[data-rx-goal="month"]').innerText();
const quarterText = await page.locator('[data-rx-goal="quarter"]').innerText();
check('the goal is saved (server-side) and shown: this month against 20 000, this quarter against 60 000',
  savedGoal === 20000 && /20\s000 SEK/.test(monthText) && /60\s000 SEK/.test(quarterText), `${savedGoal} · ${monthText} · ${quarterText}`);
// This month so far, as the server counts it (asked here, outside the page).
const monthStart = `${today.slice(0, 8)}01`;
const serverMonth = await (await fetch(`${BASE}/api/admin/reports?slim=1&from=${monthStart}&to=${today}`, { headers: { Authorization: `Bearer ${signIn.idToken}` } })).json();
const barMonth = Number((monthText.match(/([\d\s ]+) SEK of/) ?? [])[1]?.replace(/[\s ]/g, ''));
check('…this month\'s figure is the server\'s own (added up from the 12 months\' days, not asked for again)',
  barMonth === Math.round(serverMonth.totals.grossRevenue), `${barMonth} vs ${serverMonth.totals?.grossRevenue}`);

// His goal as he would type it.
const saveGoal = async (typed) => {
  await page.locator('[data-rx-goal-edit]').click();
  await page.locator('[data-rx-goal-input]').fill(typed);
  await page.locator('[data-rx-goal-save]').click();
};
await saveGoal('100,000');
await page.locator('[data-rx-goal-input]').waitFor({ state: 'detached', timeout: 15000 });
const commaGoal = await (async () => {
  for (let i = 0; i < 40; i++) {
    const v = (await secrets.get()).data()?.dashboard?.monthlyGoal;
    if (v === 100000) return v;
    await page.waitForTimeout(250);
  }
  return (await secrets.get()).data()?.dashboard?.monthlyGoal;
})();
check('"100,000" is a hundred thousand kronor (it was saved as 100)', commaGoal === 100000, String(commaGoal));
await saveGoal('a lot');
await page.locator('[data-rx-goal-error]').waitFor({ timeout: 5000 }).catch(() => {});
check('…something that is not an amount: said, the box stays open, nothing saved (a bad entry used to DELETE the goal)',
  (await page.locator('[data-rx-goal-error]').count()) === 1 && (await page.locator('[data-rx-goal-input]').count()) === 1 &&
    (await secrets.get()).data()?.dashboard?.monthlyGoal === 100000);
await page.locator('[data-rx-goal-input]').fill('20 000 kr');
await page.locator('[data-rx-goal-save]').click();
await page.locator('[data-rx-goal-input]').waitFor({ state: 'detached', timeout: 15000 });

// The periods. The 30 days' answer is held back a moment: the 12 months' figures
// used to stay under the new button until it came (for good, if it failed).
const from30 = (() => { const d = new Date(Date.now() - 29 * 86_400_000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; })();
await page.route('**/api/admin/reports?**', async (route) => {
  if (route.request().url().includes(`from=${from30}`)) await new Promise((r) => setTimeout(r, 2500));
  await route.continue();
});
const before30 = reports.length;
await page.locator('[data-rx-insights-period="30"]').click();
await page.waitForTimeout(400);
check('30 days pressed, its figures not here yet: no 12-month figure under the new button (a placeholder instead)',
  (await page.locator('[data-rx-insight-tile="revenue"]').count()) === 0);
for (let i = 0; i < 40 && !reports.slice(before30).some((r) => r.url.includes(`to=${today}`)); i++) await page.waitForTimeout(250);
await page.waitForTimeout(800);
const month = reports.slice(before30).find((r) => r.body?.categories && r.url.includes(`to=${today}`))?.body;
const tile30 = await page.locator('[data-rx-insight-tile="revenue"]').innerText();
const shown30 = Number((tile30.match(/([\d\s ]+)\s*SEK/) ?? [])[1]?.replace(/[\s ]/g, ''));
check('30 days: the figures follow the period (the 40- and 200-day-old orders are out)', !!month && shown30 === Math.round(month.totals.grossRevenue) && month.totals.grossRevenue < year.totals.grossRevenue, `${tile30} · ${month?.totals.grossRevenue} < ${year.totals.grossRevenue}`);
await page.screenshot({ path: `${SHOTS}/141-insights-30d.png` });
await page.unroute('**/api/admin/reports?**');
// The second axis's labels (orders on the left, revenue on the right).
const ticks = (await page.locator('[data-rx-insight-chart="over-time"] .recharts-yAxis-tick-labels').nth(1).locator('.recharts-cartesian-axis-tick-value').allTextContents()).map((x) => x.trim());
check('the revenue axis of a small month reads as amounts — every label different, one zero (it read "0k 1k 1k 2k 2k")',
  ticks.length >= 3 && new Set(ticks).size === ticks.length && ticks.filter((x) => /^0k?$/i.test(x)).length === 1, JSON.stringify(ticks));
// (The overview's own all-time tiles ask from 2000-01-01: not the goal's.)
const goalCalls = slimCalls.filter((u) => !u.includes('from=2000-01-01'));
check('…and the goal\'s month and quarter cost no report of their own', goalCalls.length === 0, goalCalls.join(' | '));

// A goal that cannot be loaded is said — not "no goal set yet".
await page.route('**/api/admin/dashboard-goal', (route) => (route.request().method() === 'GET' ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"down"}' }) : route.continue()));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.locator('[data-rx-goal-failed]').waitFor({ timeout: 20000 }).catch(() => {});
check('the goal failing to load: said so, and not "No goal set yet"',
  (await page.locator('[data-rx-goal-failed]').count()) === 1 && (await page.getByText(/No goal set yet/).count()) === 0);
await page.unroute('**/api/admin/dashboard-goal');

check('the Reports screen is back in the menu', (await page.getByRole('button', { name: /Reports & analytics/ }).count()) >= 1);
await page.getByRole('button', { name: /Reports & analytics/ }).first().click();
const statusCard = page.locator('h2', { hasText: 'Orders by status' }).locator('xpath=..');
await statusCard.locator('.recharts-legend-item-text').first().waitFor({ timeout: 20000 });
const legend = await statusCard.locator('.recharts-legend-item-text').allTextContents();
check('Reports: the stages in the status chart are named — "Completed", not "completed" or "in_print"',
  legend.length > 0 && legend.includes('Completed') && !legend.some((x) => /^[a-z_]+$/.test(x)), JSON.stringify(legend));

// The 500 staged for the goal above is the test's own.
const real = errors.filter((e) => !/status of 500/.test(e));
check('no page errors', real.length === 0, real.slice(0, 3).join(' | '));
await cleanup();
await browser.close();
process.exit(summary() ? 1 : 0);
