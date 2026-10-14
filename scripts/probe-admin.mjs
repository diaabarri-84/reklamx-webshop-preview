// Two questions, answered separately:
//   1. What does an anonymous visitor actually get at /admin?
//   2. What does the sign-in form do when it is given correct credentials?

import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const [EMAIL, PASSWORD] = process.argv.slice(2);

const browser = await chromium.launch();

// ---- 1. anonymous ----
{
  const page = await browser.newPage();
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  const r = await page.evaluate(() => {
    const main = document.querySelector('main');
    const text = (main?.innerText ?? '').replace(/\s+/g, ' ').trim();
    return {
      path: location.pathname,
      mainChars: text.length,
      mainStart: text.slice(0, 160),
      // Things only the real admin panel renders.
      hasAdminTiles: /Total Revenue|totalRevenue|Printer Load|printerLoad|Active Orders/i.test(document.body.innerText),
      hasProductsTab: /Products|Categories|Coupons/i.test(main?.innerText ?? ''),
    };
  });

  console.log('=== 1. زائر مش مسجّل يفتح /admin ===');
  console.log('   المسار         :', r.path);
  console.log('   محتوى <main>   :', r.mainChars, 'حرف');
  console.log('   بداية المحتوى  :', r.mainStart || '(فاضي)');
  console.log('   بيعرض لوحة أدمن:', r.hasAdminTiles || r.hasProductsTab ? '🔴 أيوه — ثغرة!' : '✅ لأ');
  await page.close();
}

// ---- 2. the sign-in form ----
{
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 160));
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  await page.locator('text=Sign In').first().click();
  await page.waitForTimeout(1200);

  // What tabs does the modal offer?
  const tabs = (await page.locator('[role="dialog"] button, .fixed button').allInnerTexts())
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  console.log('\n=== 2. نافذة الدخول ===');
  console.log('   الأزرار:', [...new Set(tabs)].slice(0, 14).join(' | '));

  const email = page.locator('input[type="email"]').first();
  const pass = page.locator('input[type="password"]').first();
  console.log('   خانة إيميل:', (await email.count()) ? 'موجودة' : '🔴 مش موجودة');
  console.log('   خانة باسورد:', (await pass.count()) ? 'موجودة' : '🔴 مش موجودة');

  if (await email.count()) {
    await email.fill(EMAIL);
    await pass.fill(PASSWORD);
    const submit = page.locator('button[type="submit"]').first();
    console.log('   زرار إرسال:', (await submit.count()) ? (await submit.innerText()).trim() : '🔴 مش موجود');
    if (await submit.count()) await submit.click();
    else await pass.press('Enter');
    await page.waitForTimeout(6000);
  }

  const after = await page.evaluate(() => ({
    signedIn: Object.keys(localStorage).some((k) => k.startsWith('firebase:authUser')),
    // Whatever the modal is telling the user, if anything.
    visibleError: Array.from(document.querySelectorAll('.fixed *'))
      .map((el) => el.textContent ?? '')
      .filter((t) => /error|invalid|fail|wrong|denied|بريد|كلمة/i.test(t) && t.length < 200)
      .slice(0, 3),
    modalStillOpen: !!document.querySelector('input[type="password"]'),
  }));

  console.log('   بعد الإرسال — مسجّل دخول:', after.signedIn ? '✅ أيوه' : '🔴 لأ');
  console.log('   النافذة لسه مفتوحة:', after.modalStillOpen ? 'أيوه' : 'لأ');
  if (after.visibleError.length) console.log('   رسالة ظاهرة:', after.visibleError.join(' / ').slice(0, 200));
  if (errors.length) {
    console.log('   أخطاء الكونسول:');
    [...new Set(errors)].slice(0, 6).forEach((e) => console.log('     -', e));
  } else {
    console.log('   أخطاء الكونسول: مفيش');
  }
  await page.close();
}

await browser.close();
