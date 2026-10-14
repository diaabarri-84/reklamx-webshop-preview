// Phase 1 + 6 — the orders, as the owner and as a member of staff.
// Seeds seven orders of its own into the EMULATOR, then clicks: the overview's
// tiles and latest orders, the admin Orders tab (search, filters, the four
// sorts, one order's page with its stage history), and the production queue
// (sort, paid only, search, priority and print date set by staff) — and, since
// the review of round 16, every fix it asked for: a test payment kept out of
// the tiles' lists, closed orders sorted last, money rows that add up, the
// artwork downloaded, dates written when the box is left, Escape, a tile's
// filter that does not stick, and "Show older" reading each page once.
import { launch, loginAdmin, BASE, SHOTS, db, check, summary } from './lib.mjs';

const day = (offset) => {
  const d = new Date(Date.now() + offset * 86400000);
  return d.toISOString().slice(0, 10);
};
const at = (offsetHours) => new Date(Date.now() + offsetHours * 3600000).toISOString();
const item = (name, qty, unit) => ({ productId: 'p', productName: name, quantity: qty, unitPrice: unit, price: unit * qty, options: { Paper: 'Matt' } });
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const base = (id, extra) => ({
  id, userId: 'guest', currency: 'SEK', customerDetails: {}, items: [item('Roll Up Compact', 1, 990)],
  grossTotal: 1237.5, netTotal: 990, vatAmount: 247.5, shippingMethod: 'standard', shippingMethodTitle: 'Standard',
  ...extra,
});
const SEEDED = [
  base('202690001', { createdAt: at(-120), customerName: 'Anna Ångström', customerEmail: 'anna@firma.se', customerDetails: { phone: '070-123 45 67', company: 'Firma AB' },
    status: 'in_print', paymentStatus: 'paid', dueDate: day(6), printDate: day(2),
    // 990 kr of goods, a 100 kr coupon, 100 kr shipping: the review's example.
    goodsNet: 890, discountAmount: 100, discountCode: 'SAVE100', shippingCost: 100,
    items: [{ ...item('Roll Up Compact', 1, 990), fileSpecs: { fileName: 'logo-anna.png', fileType: 'PNG', fileUrl: PNG } }],
    stageHistory: [{ stage: 'in_design', at: at(-100), by: 'auto' }, { stage: 'in_print', at: at(-50), by: 'Lars' }] }),
  base('202690002', { createdAt: at(-96), customerName: 'Bo Berg', customerEmail: 'bo@berg.se', status: 'pending', paymentStatus: 'expired', dueDate: day(3) }),
  base('202690003', { createdAt: at(-72), customerName: 'Cecilia Carlsson', customerEmail: 'cc@cc.se', status: 'in_design', paymentStatus: 'paid', priority: 'urgent', dueDate: day(9) }),
  base('202690004', { createdAt: at(-48), customerName: 'David Dahl', customerEmail: 'dd@dd.se', status: 'finishing', paymentStatus: 'paid', priority: 'high', dueDate: day(2), printDate: day(1) }),
  base('202690005', { createdAt: at(-24), customerName: 'Eva Ek', customerEmail: 'eva@ek.se', status: 'completed', paymentStatus: 'paid', dueDate: day(-1) }),
  base('202690006', { createdAt: at(-1), customerName: 'Fredrik Falk', customerEmail: 'ff@ff.se', status: 'pending', paymentStatus: 'open', dueDate: day(8) }),
  // Paid — with Mollie's TEST key. Never money: not in the tiles, not in their lists.
  base('202690007', { createdAt: at(-2), customerName: 'Gustav Test', customerEmail: 'g@test.se', status: 'in_print', paymentStatus: 'paid', paymentMode: 'test', dueDate: day(5) }),
];
for (const o of SEEDED) await db.collection('orders').doc(o.id).set(o);

const { browser, page, errors } = await launch();
await loginAdmin(page);
await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {});

// ---- the overview ----
await page.getByText('Latest orders').waitFor({ timeout: 20000 });
// Among the orders THIS suite seeded (other suites place orders of their own,
// "now", so the absolute first row is not ours to predict).
const latestRows = await page.locator('xpath=//h3[normalize-space()="Latest orders"]/ancestor::div[contains(@class,"rounded-3xl")][1]//button[.//span]').allInnerTexts();
const latestOurs = latestRows.map((r) => (r.match(/2026900\d\d/) ?? [])[0]).filter(Boolean);
check('overview: latest orders lists the newest first', latestOurs[0] === '202690006', latestOurs.join(','));
await page.getByRole('button', { name: /Active Orders/ }).click();
await page.locator('[data-order-row]').first().waitFor({ timeout: 20000 });
const activeIds = await page.locator('[data-order-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-order-row')));
check('the "Active Orders" tile opens ONLY paid, unfinished orders — the test payment is not one', JSON.stringify([...activeIds].sort()) === JSON.stringify(['202690001', '202690003', '202690004']), activeIds.join(','));
check('…sorted by delivery date (the tile\'s own sort)', activeIds[0] === '202690004', activeIds.join(','));
await page.screenshot({ path: `${SHOTS}/80-orders-active.png` });

// ---- the Orders tab ----
await page.getByRole('button', { name: 'Clear filters' }).click();
const rows = async () => page.locator('[data-order-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-order-row')));
await page.getByPlaceholder(/Search: order number/).first().fill('angstrom');
check('search: "angstrom" finds Anna Ångström', JSON.stringify(await rows()) === JSON.stringify(['202690001']), (await rows()).join(','));
await page.getByPlaceholder(/Search: order number/).first().fill('');
const sortSel = page.locator('xpath=//label[contains(.,"Sort")]//select').first();
await sortSel.selectOption('priority');
const byPriority = (await rows()).filter((id) => id.startsWith('2026900'));
check('sort by priority: urgent, then high, first', byPriority[0] === '202690003' && byPriority[1] === '202690004', byPriority.join(','));
await sortSel.selectOption('printDate');
const byPrint = (await rows()).filter((id) => id.startsWith('2026900'));
check('sort by print date: the soonest print day first', byPrint[0] === '202690004' && byPrint[1] === '202690001', byPrint.join(','));
await sortSel.selectOption('dueDate');
const byDue = (await rows()).filter((id) => id.startsWith('2026900'));
check('sort by delivery date: the soonest promise among the LIVE orders first', byDue[0] === '202690004', byDue.join(','));
check('…the completed order and the expired checkout after all the live work', JSON.stringify(byDue.slice(-2)) === JSON.stringify(['202690005', '202690002']), byDue.join(','));
await page.locator('select').filter({ hasText: 'Paid only' }).first().selectOption('paid');
const paidOnly = (await rows()).filter((id) => id.startsWith('2026900'));
check('paid only hides the expired and open checkouts — and the test payment', !paidOnly.includes('202690002') && !paidOnly.includes('202690006') && !paidOnly.includes('202690007'), paidOnly.join(','));
await page.locator('select').filter({ hasText: 'Paid only' }).first().selectOption('all');
check('the test payment says so in the list', /Test payment/i.test(await page.locator('[data-order-row="202690007"]').innerText()));
// Client, 2026-10-07: the stage in colour — yellow waiting, red cancelled, and so on.
const stageOfRow = (id) => page.locator(`[data-order-row="${id}"] [data-rx-stage]`).evaluate((el) => ({ stage: el.getAttribute('data-rx-stage'), cls: el.className }));
const waiting = await stageOfRow('202690006');
const printing = await stageOfRow('202690001');
const done = await stageOfRow('202690005');
check('the stage is a coloured badge: waiting yellow, printing orange, completed green',
  waiting.stage === 'pending' && /amber/.test(waiting.cls) && printing.stage === 'in_print' && /orange/.test(printing.cls) && done.stage === 'completed' && /emerald/.test(done.cls),
  JSON.stringify({ waiting, printing, done }));
await sortSel.selectOption('newest');

// ---- one order's page ----
await page.locator('[data-order-row="202690001"]').click();
const panel = page.getByRole('dialog', { name: /Order 202690001/ });
await panel.waitFor({ timeout: 10000 });
const panelText = await panel.innerText();
check('details: customer, phone and company', /Anna Ångström/.test(panelText) && /070-123 45 67/.test(panelText) && /Firma AB/.test(panelText));
check('details: the stage history that was never shown', /Stage history/i.test(panelText) && /by Lars/.test(panelText));
check('details: money and dates', /1\s?237,50 SEK/.test(panelText) && /Print date/i.test(panelText));
const o1Now = async () => (await db.collection('orders').doc('202690001').get()).data();
// The money rows add up the way the invoice's do (src/lib/orderMoney.ts).
const moneyRows = await panel.locator('[data-rx-money]').evaluate((dl) => {
  const n = (s) => Number(String(s).replace(/[^\d,−-]/g, '').replace('−', '-').replace(',', '.'));
  const dds = [...dl.querySelectorAll('dd')].slice(0, 6).map((d) => n(d.textContent));
  return { labels: [...dl.querySelectorAll('dt')].map((d) => d.textContent.trim()), dds };
});
const [goods, disc, ship, net, vat, gross] = moneyRows.dds;
check('details: the goods row is BEFORE the coupon (990, not 890)', goods === 990, JSON.stringify(moneyRows));
check('details: goods − coupon + shipping = net, and net + VAT = total', Math.abs(goods + disc + ship - net) < 0.01 && Math.abs(net + vat - gross) < 0.01, JSON.stringify(moneyRows.dds));
// The artwork is a data: URL — it must download, not open a blank tab.
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 10000 }),
  panel.getByRole('button', { name: 'logo-anna.png' }).click(),
]);
check('details: the artwork downloads (a data: URL, which Chrome will not open in a tab)', download.suggestedFilename() === 'logo-anna.png', download.suggestedFilename());
await panel.locator('select').first().selectOption('urgent');
// Dates are written when the box is left, not on every keystroke.
const printBox = panel.getByRole('textbox', { name: 'Print date' });
await printBox.fill(day(4));
await page.waitForTimeout(900);
check('details: a print date is NOT written while it is still being typed', (await o1Now()).printDate === day(2), String((await o1Now()).printDate));
await printBox.press('Enter');
await page.waitForTimeout(1500);
const o1 = await o1Now();
check('details: priority set by staff is stored', o1.priority === 'urgent');
check('details: print date set by staff is stored (on Enter)', o1.printDate === day(4), String(o1.printDate));
const dueBox = panel.getByRole('textbox', { name: 'Promised for' });
await dueBox.click();
await dueBox.press('ControlOrMeta+a');
await dueBox.press('Backspace');
await page.waitForTimeout(900);
check('details: clearing the promised date to retype it does not blank it in the order', (await o1Now()).dueDate === day(6), String((await o1Now()).dueDate));
await dueBox.fill(day(7));
await dueBox.press('Tab');
await page.waitForTimeout(1500);
check('details: …and the new date is stored when the box is left', (await o1Now()).dueDate === day(7), String((await o1Now()).dueDate));
await dueBox.fill('2026-02-30');
await dueBox.press('Tab');
await page.waitForTimeout(900);
check('details: a day that does not exist (30 February) is refused, not stored as 2 March', (await o1Now()).dueDate === day(7), String((await o1Now()).dueDate));
await dueBox.fill(day(7));
await page.screenshot({ path: `${SHOTS}/81-order-details.png` });
await panel.getByRole('button', { name: /Job sheet/ }).click();
const sheet = await page.locator('.rx-print-sheet').first().innerText();
check('job sheet: URGENT and the print date are printed', /URGENT/.test(sheet) && sheet.includes(`Print date: ${day(4)}`));
await page.locator('button:has(svg.lucide-x)').last().click();
await page.locator('.rx-print-sheet').waitFor({ state: 'detached' });
await page.keyboard.press('Escape');
check('details: Escape closes the order page', await panel.waitFor({ state: 'detached', timeout: 4000 }).then(() => true, () => false));

// ---- a tile's filter, or an order opened from the overview, does not stick ----
const sidebar = (name) => page.getByRole('button', { name, exact: true }).first();
await sidebar('Overview').click();
await page.getByText('Latest orders').waitFor();
await page.locator('xpath=//h3[normalize-space()="Latest orders"]/ancestor::div[contains(@class,"rounded-3xl")][1]//button[.//span]').nth(1).click();
await page.getByRole('dialog').waitFor();
await page.keyboard.press('Escape');
await page.getByRole('dialog').waitFor({ state: 'detached' });
await sidebar('Products Admin').click();
await sidebar('Orders').click();
await page.locator('[data-order-row]').first().waitFor({ timeout: 20000 });
check('an order opened from "Latest orders" and closed does not re-open on the next visit', (await page.getByRole('dialog').count()) === 0);
await sidebar('Overview').click();
await page.getByRole('button', { name: /Printer Capacity/ }).click();
await page.locator('[data-order-row]').first().waitFor({ timeout: 20000 });
await sidebar('Products Admin').click();
await sidebar('Orders').click();
await page.locator('[data-order-row]').first().waitFor({ timeout: 20000 });
check('a tile\'s filter does not stick to the next visit from the sidebar',
  (await page.getByRole('combobox', { name: 'Stage' }).inputValue()) === 'all' && (await sortSel.inputValue()) === 'newest');
await sidebar('Overview').click();
await page.getByRole('button', { name: /Staff Members/ }).click();
const roleSel = page.locator('select').filter({ hasText: 'All Roles' }).first();
await roleSel.waitFor({ timeout: 20000 });
await page.getByText('staff@emulator.test').first().waitFor({ timeout: 20000 });
check('the "Staff Members" tile opens the people it counts — staff and production, not every account',
  (await roleSel.inputValue()) === 'team' && (await page.getByText('admin@emulator.test').count()) === 0);
await sidebar('Orders').click();
await page.locator('[data-order-row]').first().waitFor({ timeout: 20000 });

// ---- "Show older": the next page, read once, every order once ----
const BULK = Array.from({ length: 205 }, (_, i) => `2026B${String(i).padStart(4, '0')}`);
const bulk = db.batch();
BULK.forEach((id, i) => bulk.set(db.collection('orders').doc(id), base(id, {
  createdAt: new Date(Date.UTC(2021, 0, 1) + i * 60000).toISOString(), customerName: `Old ${i}`, customerEmail: 'old@old.se', status: 'completed', paymentStatus: 'paid',
})));
await bulk.commit();
const olderBtn = page.getByRole('button', { name: 'Show older orders' });
await olderBtn.waitFor({ timeout: 20000 });
const shown = await page.locator('[data-order-row]').count();
check('the newest 200 orders are listed, with "Show older"', shown === 200, String(shown));
const total = (await db.collection('orders').count().get()).data().count;
await olderBtn.click();
await page.waitForFunction((n) => document.querySelectorAll('[data-order-row]').length > n, shown, { timeout: 20000 });
const allIds = await rows();
check('"Show older" brings the rest — every order, each once', allIds.length === total && new Set(allIds).size === allIds.length, `${allIds.length} rows, ${total} orders`);
check('…and the button goes when nothing older is left', (await olderBtn.count()) === 0);
const unbulk = db.batch();
BULK.forEach((id) => unbulk.delete(db.collection('orders').doc(id)));
await unbulk.commit();

// ---- the production queue, as STAFF ----
const staffCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const sp = await staffCtx.newPage();
await loginAdmin(sp, 'staff@emulator.test', 'emulator-staff-1');
// staff need canManageOrders to edit; give it in the emulator like the admin would
const staffUid = (await db.collection('users').where('email', '==', 'staff@emulator.test').get()).docs[0].id;
await db.collection('users').doc(staffUid).set({ permissions: { canManageOrders: true } }, { merge: true });
await sp.goto(`${BASE}/staff-dashboard`, { waitUntil: 'domcontentloaded' });
await sp.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {});
await sp.getByText('202690001').first().waitFor({ timeout: 20000 });
const queueSort = sp.locator('xpath=//label[contains(.,"Sort")]//select').first();
await queueSort.selectOption('priority');
const firstCard = await sp.locator('span.font-black.text-gray-900.text-xl').first().innerText();
check('queue: sorted by priority, an urgent job comes first', ['202690001', '202690003'].includes(firstCard.trim()), firstCard);
const testCard = sp.locator('xpath=//span[normalize-space()="202690007"]/ancestor::div[contains(@class,"rounded-3xl")][1]').first();
check('queue: a test payment is marked on its card', /Test payment/i.test(await testCard.innerText()));
await sp.locator('select').filter({ hasText: 'Paid only' }).first().selectOption('paid');
const queueIds = await sp.locator('span.font-black.text-gray-900.text-xl').allInnerTexts();
check('queue: "paid only" hides the unpaid checkouts and the test payment', !queueIds.includes('202690002') && !queueIds.includes('202690006') && !queueIds.includes('202690007'), queueIds.join(','));
await sp.getByPlaceholder(/Search: order number/).fill('Dahl');
const dahl = await sp.locator('span.font-black.text-gray-900.text-xl').allInnerTexts();
check('queue: search by name', JSON.stringify(dahl) === JSON.stringify(['202690004']), dahl.join(','));
const card4 = sp.locator('xpath=//span[normalize-space()="202690004"]/ancestor::div[contains(@class,"rounded-3xl")][1]').first();
await card4.locator('select[aria-label="Priority"]').selectOption('urgent');
await sp.waitForTimeout(1500);
check('queue: staff set the priority, and it is stored', (await db.collection('orders').doc('202690004').get()).data().priority === 'urgent');
const badge = await card4.innerText();
check('queue: the card shows the URGENT badge', /Urgent/i.test(badge));
await sp.screenshot({ path: `${SHOTS}/82-queue-staff.png` });
await sp.getByPlaceholder(/Search: order number/).fill('');
await sp.reload({ waitUntil: 'domcontentloaded' });
await sp.getByText('202690001').first().waitFor({ timeout: 20000 });
check('queue: the chosen sort is remembered after a reload', (await sp.locator('xpath=//label[contains(.,"Sort")]//select').first().inputValue()) === 'priority');
await staffCtx.close();

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
// Leave the emulator as it was found, so the next run (and the other suites) see
// exactly the orders they seed.
for (const o of SEEDED) await db.collection('orders').doc(o.id).delete();
process.exit(summary() ? 1 : 0);
