// The review fixes for Phase 3, in a real browser.
// Run after product-dialog.mjs (prod-pmp-696 carries five properties).
import { launch, loginAdmin, BASE, SHOTS, db, check, summary, dragTo } from './lib.mjs';

const { browser, page, errors } = await launch();
await loginAdmin(page);
await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {});
const confirmDlg = () => page.getByRole('button', { name: 'Confirm', exact: true }).last().click();

// ---- 1. Library "Add option" — three times, quickly, then default + save ----
await page.getByRole('button', { name: 'Printing fields' }).click();
const online = page.locator('xpath=//div[normalize-space(text())="Online design fields"]/ancestor::div[contains(@class,"rounded-2xl")][1]').first();
await online.getByRole('button', { name: /^Lamination\b/ }).first().click();
const modalLabels = () => page.locator('input[placeholder="Option label (e.g. Navy Blue)"]').evaluateAll((els) => els.map((e) => e.value));
const before = await modalLabels();
for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Add option', exact: true }).click();
const labelInputs = page.locator('input[placeholder="Option label (e.g. Navy Blue)"]');
const n = await labelInputs.count();
for (let i = 0; i < 3; i++) await labelInputs.nth(n - 3 + i).fill(`Velvet test ${i + 1}`);
const lastRow = page.locator('xpath=//input[@value="Velvet test 3"]/ancestor::div[contains(@class,"rounded-xl")][1]').first();
await lastRow.locator('input[inputmode="decimal"]').fill('25');
await lastRow.locator('input[inputmode="decimal"]').blur();
await lastRow.locator('input[type="radio"]').check();
await page.getByRole('button', { name: /^(Save changes|Saved)$/ }).click();
await page.waitForTimeout(2500);
const lam = (await db.collection('settings').doc('optionLibrary').get()).data().fields.find((f) => f.id === 'lamination_type');
const added = lam.options.filter((o) => /^Velvet test \d$/.test(o.label));
check('library: three added options all stored WITH their names', added.length === 3, JSON.stringify(lam.options.slice(-3).map((o) => o.label)));
check('library: the price typed into the new option is stored', added.find((o) => o.label === 'Velvet test 3')?.priceModifier === 25);
check('library: exactly one default, and it is the one he ticked', lam.options.filter((o) => o.isDefault).length === 1 && lam.options.find((o) => o.isDefault)?.label === 'Velvet test 3');
check('library: no blank option slipped in', lam.options.every((o) => String(o.label).trim()));
check('library: every option id unique', new Set(lam.options.map((o) => o.id)).size === lam.options.length);
await page.getByRole('button', { name: 'Done' }).click();

// ---- 2. The apply dialog always opens on the safe choice ----
await page.getByRole('button', { name: 'Update products…' }).click();
await page.getByText('Replace everything with the library').click();
await page.getByRole('button', { name: 'Cancel', exact: true }).last().click();
await page.getByRole('button', { name: 'Update products…' }).click();
const safeChecked = await page.locator('xpath=//label[.//span[normalize-space()="Add the new properties only (safest)"]]//input[@type="radio"]').isChecked();
check('the apply dialog re-opens on "Add the new properties only"', safeChecked);
await page.waitForTimeout(400);
await page.screenshot({ path: `${SHOTS}/60-apply-reopened.png` });
await page.getByRole('button', { name: 'Cancel', exact: true }).last().click();

// ---- 3. Update chosen + switch OFF everywhere, on one product ----
const P = 'prod-pmp-696';
const pBefore = (await db.collection('products').doc(P).get()).data();
await page.getByPlaceholder('Start typing a product or category...').fill(pBefore.name.slice(0, 18));
await page.getByRole('button', { name: pBefore.name, exact: true }).first().click();
await page.getByRole('button', { name: 'Update products…' }).click();
await page.getByText('Update the properties I choose').click();
await page.getByRole('button', { name: 'None', exact: true }).click();
await page.getByPlaceholder('Find a property…').fill('Printed sides');
await page.locator('xpath=//label[.//span[normalize-space()="Printed sides"]]//input[@type="checkbox"]').first().check();
await page.getByText('switched OFF everywhere — hidden from customers').click();
await page.getByRole('button', { name: /^Apply to 1 product$/ }).click();
await page.waitForTimeout(3000);
const pAfter = (await db.collection('products').doc(P).get()).data();
check('switch OFF: "Printed sides" is now hidden on the product', pAfter.printingFields.find((f) => f.id === 'printed_sides')?.enabled === false);
check('switch OFF: every other property keeps its on/off', pAfter.printingFields.filter((f) => f.id !== 'printed_sides').every((f) => f.enabled === pBefore.printingFields.find((b) => b.id === f.id)?.enabled));

// ---- 4. Product dialog: reset one property, remove another, nested drag ----
await page.getByRole('button', { name: 'Products Admin' }).click();
await page.getByText(pBefore.name, { exact: true }).first().waitFor({ timeout: 20000 });
await page.locator(`xpath=//*[normalize-space()=${JSON.stringify(pBefore.name)}]/ancestor::div[.//button[normalize-space()='Edit']][1]//button[normalize-space()='Edit']`).first().click();
await page.getByRole('button', { name: 'Save Product' }).waitFor();
const card = (name) => page.locator(`xpath=//span[normalize-space()=${JSON.stringify(name)}]/ancestor::div[contains(@class,'rounded-2xl')][1]`).first();
await page.getByPlaceholder(/Search properties/).fill('Shape');
await card('Shape').locator('button[aria-expanded]').first().click();
await card('Shape').getByRole('button', { name: 'Reset to the library version' }).click();
await confirmDlg();
// nested questions inside "Round (circle)": add two, drag the second above the first
const roundRow = page.locator('xpath=//input[starts-with(@value,"Round")]/ancestor::div[contains(@class,"rounded-xl")][1]').first();
await roundRow.getByRole('button', { name: 'Add options inside this option' }).click();
await roundRow.getByRole('button', { name: 'Add another question inside this option' }).click();
const qNames = roundRow.locator('xpath=.//input[@placeholder="e.g. Paper type"]');
await qNames.nth(0).fill('Question A');
await qNames.nth(1).fill('Question B');
const qHandles = roundRow.locator('[aria-label="Drag this question"]');
await dragTo(page, qHandles.nth(1), qHandles.nth(0), { offsetY: -20 });
const qOrder = await qNames.evaluateAll((els) => els.map((e) => e.value));
check('a question inside an option can be dragged', qOrder[0] === 'Question B' && qOrder[1] === 'Question A', JSON.stringify(qOrder));
await page.getByPlaceholder(/Search properties/).fill('Corners');
await card('Corners').locator('button[aria-expanded]').first().click();
await card('Corners').getByRole('button', { name: 'Remove from this product' }).click();
await confirmDlg();
await page.getByPlaceholder(/Search properties/).fill('');
await page.getByRole('button', { name: 'Save Product' }).click();
await page.waitForTimeout(2500);
const saved = (await db.collection('products').doc(P).get()).data();
const libShape = (await db.collection('settings').doc('optionLibrary').get()).data().fields.find((f) => f.id === 'product_shape');
const sShape = saved.printingFields.find((f) => f.id === 'product_shape');
check('reset: Shape options back in the LIBRARY order', JSON.stringify(sShape.options.map((o) => o.id)) === JSON.stringify(libShape.options.map((o) => o.id)));
check('reset: Shape stays switched on for this product', sShape.enabled === true);
const round = sShape.options.find((o) => /^Round/.test(o.label));
check('stored: the nested questions in the dragged order', JSON.stringify((round.subFields || []).map((f) => f.name)) === JSON.stringify(['Question B', 'Question A']));
check('remove: Corners is gone from the product', !saved.printingFields.some((f) => f.id === 'corner_style'));

// ---- 5. Sub-categories stay under their parent ----
await db.collection('categories').doc('beachflags').set({ parentId: 'flags', sortOrder: 10 }, { merge: true });
await db.collection('categories').doc('labels').set({ parentId: 'flags', sortOrder: 20 }, { merge: true });
await fetch(`${BASE}/api/admin/cache/invalidate`, { method: 'POST' }).catch(() => {});
await page.waitForTimeout(500);
// the cache is per process and the invalidate needs a token; read straight after the 5-min cache is not
// guaranteed, so ask the dashboard to drop it the way it does after an arrange:
const token = await (await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@emulator.test', password: 'emulator-admin-1', returnSecureToken: true }),
})).json();
await fetch(`${BASE}/api/admin/cache/invalidate`, { method: 'POST', headers: { Authorization: `Bearer ${token.idToken}` } });
const cats = (await (await fetch(`${BASE}/api/categories`)).json()).categories;
const idx = (id) => cats.findIndex((c) => c.id === id);
check('sub-categories sit right under their parent, not above the main ones', idx('flags') >= 0 && idx('beachflags') === idx('flags') + 1 && idx('labels') === idx('flags') + 2, cats.map((c) => c.id).join(', '));
const rootCats = cats.filter((c) => !c.parentId);
const rank = (c) => (Number.isFinite(c.sortOrder) ? c.sortOrder : Infinity);
const expectedRoots = [...rootCats].sort((a, b) => (rank(a) - rank(b)) || String(a.name).localeCompare(String(b.name)));
check('main categories keep their own order among themselves', JSON.stringify(rootCats.map((c) => c.id)) === JSON.stringify(expectedRoots.map((c) => c.id)), rootCats.map((c) => c.id).join(', '));

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
process.exit(summary() ? 1 : 0);
