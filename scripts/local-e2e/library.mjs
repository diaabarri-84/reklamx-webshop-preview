// Phase 3, the shared library: drag within a group, edit a price in place,
// and "Update products…" with "update the properties I choose".
// Needs product-dialog.mjs first (prod-pmp-696 carries five properties).
import { launch, loginAdmin, BASE, SHOTS, db, check, summary, dragTo } from './lib.mjs';

const TARGET = 'prod-pmp-696';
const UNTOUCHED = 'prod-pmp-697';
const libBefore = (await db.collection('settings').doc('optionLibrary').get()).data().fields;
const targetBefore = (await db.collection('products').doc(TARGET).get()).data();
const untouchedBefore = (await db.collection('products').doc(UNTOUCHED).get()).data();
const fixBefore = libBefore.find((f) => f.id === 'design_service').options.find((o) => o.id === 'sv-dsgn-fix');

const { browser, page, errors } = await launch();
await loginAdmin(page);
await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {});
await page.getByRole('button', { name: 'Printing fields' }).click();
const group = page.locator('xpath=//div[normalize-space(text())="Default field"]/ancestor::div[contains(@class,"rounded-2xl")][1]').first();
await group.waitFor({ timeout: 20000 });

// 1 — drag the 3rd property of "Default field" to the front.
const chipNames = async () => group.locator('[aria-label^="Drag \\""]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label').slice(6, -1)));
const namesBefore = await chipNames();
const handles = group.locator('[aria-label^="Drag \\""]');
await dragTo(page, handles.nth(2), handles.nth(0), { offsetY: 0 });
const namesAfter = await chipNames();
check('a library property dragged to the front of its group', namesAfter[0] === namesBefore[2] && namesAfter.length === namesBefore.length, `${namesBefore.slice(0, 3)} → ${namesAfter.slice(0, 3)}`);
await page.screenshot({ path: `${SHOTS}/40-library-drag.png` });

// 2 — open "Design service" and change a price IN PLACE (no delete and re-add).
await group.getByRole('button', { name: /^Design service/ }).first().click();
const row = page.locator('xpath=//input[starts-with(@value,"Designer touch-up")]/ancestor::div[contains(@class,"rounded-xl")][1]').first();
await row.waitFor({ timeout: 10000 });
const price = row.locator('input[inputmode="decimal"]').first();
await price.fill('450');
await price.blur();
check('the editor shows the once-per-line switch, ticked for a designer fee', await row.getByText('Once per line').isVisible() && await row.locator('xpath=.//label[contains(.,"Once per line")]//input').isChecked());
await page.screenshot({ path: `${SHOTS}/41-library-editor.png` });
await page.getByRole('button', { name: /^(Save changes|Saved)$/ }).click();
await page.waitForTimeout(2500);
await page.getByRole('button', { name: 'Done' }).click();

const libAfter = (await db.collection('settings').doc('optionLibrary').get()).data().fields;
const fixAfter = libAfter.find((f) => f.id === 'design_service').options.find((o) => o.id === 'sv-dsgn-fix');
check('stored: the new price on the SAME option id', fixAfter?.priceModifier === 450 && fixAfter?.id === fixBefore.id);
const storedDefault = libAfter.filter((f) => f.group === 'default').map((f) => f.name);
check('stored: the group order he dragged', storedDefault[0] === namesBefore[2], storedDefault.slice(0, 3).join(', '));
check('stored: no property lost or added', libAfter.length === libBefore.length);

// 3 — Update products… → only the property he changed, only on the picked product.
await page.getByPlaceholder('Start typing a product or category...').fill(targetBefore.name.slice(0, 18));
await page.getByRole('button', { name: targetBefore.name, exact: true }).first().click();
await page.getByRole('button', { name: 'Update products…' }).click();
await page.getByText('Update the properties I choose').click();
const ticked = await page.locator('xpath=//label[.//span[normalize-space()="changed now"]]//input[@type="checkbox"]').evaluateAll((els) => els.filter((e) => e.checked).length);
check('the dialog pre-ticks the properties changed in this visit', ticked >= 1);
await page.screenshot({ path: `${SHOTS}/42-apply-dialog.png` });
await page.getByRole('button', { name: /^Apply to 1 product$/ }).click();
await page.waitForTimeout(3000);

const targetAfter = (await db.collection('products').doc(TARGET).get()).data();
const ds = targetAfter.printingFields.find((f) => f.id === 'design_service');
check('target: the designer price is the library\'s new one', ds?.options.find((o) => o.id === 'sv-dsgn-fix')?.priceModifier === 450);
check('target: its own order of properties is unchanged', JSON.stringify(targetAfter.printingFields.map((f) => f.id)) === JSON.stringify(targetBefore.printingFields.map((f) => f.id)));
check('target: on/off per property unchanged', JSON.stringify(targetAfter.printingFields.map((f) => f.enabled)) === JSON.stringify(targetBefore.printingFields.map((f) => f.enabled)));
check('target: the other properties untouched (his Shape order survives)', JSON.stringify(targetAfter.printingFields.find((f) => f.id === 'product_shape')) === JSON.stringify(targetBefore.printingFields.find((f) => f.id === 'product_shape')));
const untouchedAfter = (await db.collection('products').doc(UNTOUCHED).get()).data();
check('a product that was not picked is not touched', JSON.stringify(untouchedAfter.printingFields || []) === JSON.stringify(untouchedBefore.printingFields || []));

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
process.exit(summary() ? 1 : 0);
