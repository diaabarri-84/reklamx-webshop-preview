// Phase 3, the product dialog — as the owner would do it, with a mouse.
import { launch, loginAdmin, BASE, SHOTS, db, check, summary, dragTo } from './lib.mjs';

const PRODUCT_ID = 'prod-pmp-696';
const before = (await db.collection('products').doc(PRODUCT_ID).get()).data();
const PRODUCT_NAME = before.name;
const PROPS = ['Shape', 'Lamination', 'Printed sides', 'Corners', 'Design service'];

const { browser, page, errors } = await launch();
await loginAdmin(page);
await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {});
await page.getByRole('button', { name: 'Products Admin' }).click();
await page.getByText(PRODUCT_NAME, { exact: true }).first().waitFor({ timeout: 20000 });

const openEditor = async () => {
  const edit = page.locator(`xpath=//*[normalize-space()=${JSON.stringify(PRODUCT_NAME)}]/ancestor::div[.//button[normalize-space()='Edit']][1]//button[normalize-space()='Edit']`).first();
  await edit.click();
  await page.getByRole('button', { name: 'Save Product' }).waitFor({ timeout: 15000 });
};
await openEditor();

// 0 — the minimum unit price, a field of its own now (code review ADM-14): it opens
// on what is stored, or the 149 every product without one is priced at.
const storedMin = before.customUploadRules?.minPrice ?? 149;
const minShown = await page.locator('[data-rx-product-min-price]').inputValue().catch(() => null);
check('the editor shows the product\'s minimum unit price — what is stored, or the shop\'s 149', Number(minShown) === Number(storedMin), `${minShown} vs ${storedMin}`);

// 1 — switch five library properties on for this product.
const search = page.getByPlaceholder(/Search properties/);
for (const name of PROPS) {
  await search.fill(name);
  const toggle = page.locator(`xpath=//span[normalize-space()=${JSON.stringify(name)}]/ancestor::div[contains(@class,'rounded-2xl')][1]//button[@title='Turn this property on for this product']`).first();
  await toggle.click();
}
await search.fill('');

const pageOrder = async () =>
  page.locator('[aria-label^="Drag \\""], [aria-label="Drag the quantity table"]').evaluateAll((els) =>
    els.map((e) => (e.getAttribute('aria-label') === 'Drag the quantity table' ? '#QTY' : e.getAttribute('aria-label').slice(6, -1))));

const initial = await pageOrder();
check('the page-order list shows the five properties and the quantity table', initial.length === 6 && PROPS.every((p) => initial.includes(p)), JSON.stringify(initial));
await page.locator('[aria-label="Drag the quantity table"]').scrollIntoViewIfNeeded();
await page.screenshot({ path: `${SHOTS}/10-page-order-before.png` });

// 2 — drag the 4th row to the top, then the quantity table to the top.
const fourth = initial.filter((x) => x !== '#QTY')[3];
await dragTo(page, page.locator(`[aria-label="Drag \\"${fourth}\\""]`), page.locator(`[aria-label="Drag \\"${initial[0] === '#QTY' ? initial[1] : initial[0]}\\""]`), { offsetY: -12 });
const afterRowDrag = await pageOrder();
check(`"${fourth}" dragged to the top`, afterRowDrag.filter((x) => x !== '#QTY')[0] === fourth, JSON.stringify(afterRowDrag));
await dragTo(page, page.locator('[aria-label="Drag the quantity table"]'), page.locator(`[aria-label="Drag \\"${afterRowDrag.filter((x) => x !== '#QTY')[0]}\\""]`), { offsetY: -12 });
const afterQty = await pageOrder();
check('the quantity table dragged to the top', afterQty[0] === '#QTY', JSON.stringify(afterQty));
await page.screenshot({ path: `${SHOTS}/11-page-order-after.png` });

// 3 — inside "Shape": drag the 3rd option to the top.
await page.locator(`xpath=//span[normalize-space()='Shape']/ancestor::button[@aria-expanded][1]`).first().click();
const shapeEditor = page.locator(`xpath=//span[normalize-space()='Shape']/ancestor::div[contains(@class,'rounded-2xl')][1]`).first();
const optionLabels = async () => shapeEditor.locator('input[placeholder="Option label (e.g. Navy Blue)"]').evaluateAll((els) => els.map((e) => e.value));
const optsBefore = await optionLabels();
const optHandles = shapeEditor.locator('[aria-label="Drag this option"]');
await dragTo(page, optHandles.nth(2), optHandles.nth(0), { offsetY: -14 });
const optsAfter = await optionLabels();
check('an option dragged inside "Shape"', optsAfter[0] === optsBefore[2] && optsAfter.length === optsBefore.length, `${optsBefore.slice(0, 4)} → ${optsAfter.slice(0, 4)}`);
await page.screenshot({ path: `${SHOTS}/12-option-drag.png` });

// 4 — photos: drag the 2nd one onto the cover position.
const photoSrcs = async () => page.locator('img[alt^="Product "]').evaluateAll((els) => els.map((e) => e.getAttribute('src')));
const photosBefore = await photoSrcs();
const photoHandles = page.locator('[aria-label="Drag this photo"]');
await dragTo(page, photoHandles.nth(1), page.locator('img[alt="Product 0"]'));
const photosAfter = await photoSrcs();
check('the 2nd photo dragged to the cover', photosAfter[0] === photosBefore[1] && photosAfter.length === photosBefore.length, `${photosBefore.length} photos`);

// 5 — save, and believe only what is stored.
await page.getByRole('button', { name: 'Save Product' }).click();
await page.waitForTimeout(2500);
const saved = (await db.collection('products').doc(PRODUCT_ID).get()).data();
const enabledOrder = (saved.printingFields || []).filter((f) => f.enabled && !['production_delivery_speed', 'artwork_supply_method'].includes(f.id)).map((f) => f.name);
check('stored: the properties in the dragged order', JSON.stringify(enabledOrder) === JSON.stringify(afterQty.filter((x) => x !== '#QTY')), `${JSON.stringify(enabledOrder)}`);
check('stored: the quantity table first', saved.quantityAfterFieldId === '__quantity_first__', String(saved.quantityAfterFieldId));
const shape = (saved.printingFields || []).find((f) => f.id === 'product_shape');
check('stored: Shape options in the dragged order', shape?.options?.[0]?.label === optsAfter[0], shape?.options?.slice(0, 3).map((o) => o.label).join(', '));
check('stored: Shape keeps every option', shape?.options?.length === optsBefore.length);
check('stored: the new cover photo', saved.images?.[0] === photosBefore[1] && saved.images.length === before.images.length);
check('stored: the minimum unit price as it was — saved without touching it, the product keeps its price',
  Number(saved.customUploadRules?.minPrice) === Number(storedMin), String(saved.customUploadRules?.minPrice));

// 6 — reopen: the dialog shows what was stored.
await openEditor();
const reopened = await pageOrder();
check('reopened: the same order on screen', JSON.stringify(reopened) === JSON.stringify(afterQty), JSON.stringify(reopened));
await page.keyboard.press('Escape');

// 7 — the shop renders that order.
const shopPage = await page.context().newPage();
await shopPage.goto(`${BASE}/products/${PRODUCT_ID}`, { waitUntil: 'domcontentloaded' });
await shopPage.waitForTimeout(3000);
const shopText = await shopPage.locator('main').innerText().catch(() => '');
const positions = enabledOrder.map((n) => shopText.indexOf(n));
check('the shop shows the properties in his order', positions.every((p) => p >= 0) && positions.every((p, i) => i === 0 || p > positions[i - 1]), JSON.stringify(positions));
check('"Design it online" is not offered on the shop', !/Design it online with a free template/i.test(shopText));
await shopPage.screenshot({ path: `${SHOTS}/13-shop-product.png`, fullPage: false });
await shopPage.close();

// 8 — the minimum's box emptied (code review 2026-10-11): the hint said only
// "0 = no minimum", and an emptied box KEEPS the minimum. It now says both, and the
// save does what it says.
// "Reopened" above left the editor open; opening it again from behind its own
// window was the click that never landed.
if (!(await page.locator('[data-rx-product-min-price]').isVisible().catch(() => false))) await openEditor();
const minBox = page.locator('[data-rx-product-min-price]');
await minBox.fill('');
const minHint = await page.locator('[data-rx-product-min-price-hint]').innerText().catch(() => '');
check('the minimum\'s hint says what 0 does and what an empty box does', /\b0 removes the minimum\b/.test(minHint) && /left empty, the box\s+keeps/.test(minHint), minHint);
await page.getByRole('button', { name: 'Save Product' }).click();
await page.waitForTimeout(2500);
const keptMin = (await db.collection('products').doc(PRODUCT_ID).get()).data()?.customUploadRules?.minPrice;
check('…emptied and saved: the product keeps its minimum, as the hint says', Number(keptMin) === Number(storedMin), String(keptMin));

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
process.exit(summary() ? 1 : 0);
