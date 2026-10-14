// End-to-end smoke test: drive the real app in a real browser and report what
// actually happens. Console errors anywhere fail the run.
//
//   node scripts/smoke.mjs <admin-email> <admin-password>

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { request as rawRequest } from 'node:http';

const BASE = 'http://localhost:3000';
const [EMAIL, PASSWORD] = process.argv.slice(2);

// The run used to assume a server was already listening. If one was — started
// by hand at some point, from an older build — the API checks below tested that
// older binary and reported a pass for code that was no longer on disk. Worse,
// with nothing listening the whole run died on ERR_CONNECTION_REFUSED with a
// stack trace instead of a result. So the test owns its own server: it starts
// one, waits for it, and stops it at the end.
let server = null;

async function reachable() {
  try {
    const r = await fetch(BASE, { signal: AbortSignal.timeout(1500) });
    return r.ok || r.status < 500;
  } catch {
    return false;
  }
}

async function startServer() {
  if (await reachable()) {
    console.log('  (using the server already listening on :3000)\n');
    return;
  }
  server = spawn('node', ['dist/server.cjs'], {
    stdio: 'ignore',
    env: { ...process.env, NODE_ENV: 'production' },
  });
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await reachable()) return;
  }
  throw new Error('The server did not start. Run `npm run build` first.');
}

function stopServer() {
  if (server && !server.killed) server.kill('SIGTERM');
}

const results = [];
const consoleErrors = [];
let browser;

const ok = (name, detail = '') => results.push({ pass: true, name, detail });
const bad = (name, detail = '') => results.push({ pass: false, name, detail });

function watch(page, label) {
  page.on('pageerror', (e) => consoleErrors.push(`${label}: ${e.message.slice(0, 140)}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // Unsplash blocks the headless UA; that is the network, not the app.
    if (/ERR_BLOCKED_BY_ORB|images\.unsplash|favicon/i.test(t)) return;
    // The wrong-password step below deliberately provokes a 400 from Firebase.
    if (/status of 400/.test(t) && label === 'sign-in') return;
    consoleErrors.push(`${label}: ${t.slice(0, 140)}`);
  });
}

async function open(path, label) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  watch(page, label);
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  return page;
}

await startServer();
browser = await chromium.launch();

// ---- public pages render something ----
for (const [path, label] of [
  ['/', 'home'],
  ['/products', 'products'],
  ['/services', 'services'],
  ['/about', 'about'],
  ['/contact', 'contact'],
  ['/custom-upload', 'custom upload'],
]) {
  const page = await open(path, label);
  const chars = await page.evaluate(() => (document.querySelector('main')?.innerText ?? '').trim().length);
  chars > 80 ? ok(`page ${label}`, `${chars} chars`) : bad(`page ${label}`, `only ${chars} chars`);
  await page.close();
}

// ---- an unknown URL gets a 404, not a blank page ----
{
  const page = await open('/definitely-not-a-page', '404');
  const text = await page.evaluate(() => document.body.innerText);
  /404/.test(text) ? ok('404 page') : bad('404 page', 'no 404 shown');
  await page.close();
}

// ---- guarded routes bounce anonymous visitors to the staff sign-in ----
for (const [path, label] of [['/admin', 'admin'], ['/staff-dashboard', 'staff']]) {
  const page = await open(path, `guard ${label}`);
  const where = await page.evaluate(() => location.pathname);
  where === '/admin/login'
    ? ok(`guard ${label}`, `→ ${where}`)
    : bad(`guard ${label}`, `landed on ${where}`);
  await page.close();
}

// ---- the shop speaks the visitor's language ----
for (const [locale, expect] of [['sv-SE', 'sv'], ['da-DK', 'da'], ['nb-NO', 'no'], ['fr-FR', 'en']]) {
  const ctx = await browser.newContext({ locale });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  const lang = await page.evaluate(() => document.documentElement.lang);
  lang === expect ? ok(`language ${locale}`, `→ ${lang}`) : bad(`language ${locale}`, `got ${lang}, wanted ${expect}`);
  await ctx.close();
}

// ---- the server, not the browser, decides the price ----
// The shop owner adds and removes products, so a hard-coded id eventually
// 404s and takes six unrelated pricing checks down with it. PRICING_PRODUCT
// names one of the shop's own long-lived products; override it from the
// environment when that one goes too.
const PRICING_PRODUCT = process.env.SMOKE_PRODUCT_ID || 'prod-001';
{
  const r = await fetch(`${BASE}/api/checkout/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: [{ productId: PRICING_PRODUCT, quantity: 100 }],
      // dsv_zone has been refused since the checkout stopped offering it; this
      // check quietly read `totals` off a 400. The owner's methods now.
      shippingMethod: 'standard',
      deliveryCountry: 'SE',
      couponCode: 'TOTALLY-MADE-UP',
    }),
  });
  const q = await r.json();
  const netPlusVat = Math.round(q.totals.netTotal * (1 + q.vatRate) * 100) / 100;
  const grossOk = Math.abs(netPlusVat - Math.round(q.totals.grossTotal * 100) / 100) < 0.01;

  r.ok ? ok('quote endpoint', `gross ${q.totals.grossTotal.toFixed(2)} SEK`) : bad('quote endpoint', `HTTP ${r.status}`);
  grossOk ? ok('VAT maths', `net × ${1 + q.vatRate} = gross`) : bad('VAT maths', `${netPlusVat} ≠ ${q.totals.grossTotal}`);
  q.coupon === null ? ok('forged coupon rejected') : bad('forged coupon rejected', 'it was accepted');
}

// ---- an option the product does not have cannot add money ----
{
  const r = await fetch(`${BASE}/api/checkout/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [{ productId: PRICING_PRODUCT, quantity: 5, optionIds: ['made-up-option'] }] }),
  });
  const q = await r.json();
  q.items[0].optionsSurcharge === 0 ? ok('invented option ignored') : bad('invented option ignored', `+${q.items[0].optionsSurcharge}`);
}

// ---- unknown product is refused ----
{
  const r = await fetch(`${BASE}/api/checkout/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [{ productId: 'no-such-product', quantity: 1 }] }),
  });
  r.status === 404 ? ok('unknown product refused', 'HTTP 404') : bad('unknown product refused', `HTTP ${r.status}`);
}

// ---- prices survive hostile input ----
//
// Each of these produced a wrong total before. They are cheap to check and
// expensive to get wrong, so they stay in the suite.
{
  const quote = (body) =>
    fetch(`${BASE}/api/checkout/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

  const PRODUCT = PRICING_PRODUCT;

  // A negative width used to make a negative line total that offset the cart.
  const neg = await quote({ items: [{ productId: PRODUCT, quantity: 1, widthCm: -100000, heightCm: 70 }] });
  neg.body?.totals?.grossTotal > 0
    ? ok('negative size refused', `gross ${neg.body.totals.grossTotal.toFixed(2)} SEK`)
    : bad('negative size refused', JSON.stringify(neg.body).slice(0, 80));

  // '__proto__' as a shipping method resolved to a function and gave NaN. An
  // unknown method is now refused outright rather than shipped free of charge.
  const proto = await quote({ items: [{ productId: PRODUCT, quantity: 1 }], shippingMethod: '__proto__' });
  proto.status === 400
    ? ok('prototype shipping key', 'refused, HTTP 400')
    : bad('prototype shipping key', `HTTP ${proto.status} ${JSON.stringify(proto.body?.totals ?? proto.body).slice(0, 60)}`);

  const madeUp = await quote({ items: [{ productId: PRODUCT, quantity: 1 }], shippingMethod: 'free-please' });
  madeUp.status === 400
    ? ok('invented shipping method', 'refused, HTTP 400')
    : bad('invented shipping method', `HTTP ${madeUp.status}, shipping ${madeUp.body?.totals?.shippingCost}`);

  // The retired DSV ids are refused like any invented one.
  for (const m of ['dsv_zone', 'dsv_weekday']) {
    const r = await quote({ items: [{ productId: PRODUCT, quantity: 1 }], shippingMethod: m });
    r.status === 400 ? ok(`retired shipping ${m}`, 'refused, HTTP 400') : bad(`retired shipping ${m}`, `HTTP ${r.status}`);
  }
  // Every method the owner offers in his home country prices, at the fee on his menu.
  {
    const menu = await quote({ items: [{ productId: PRODUCT, quantity: 1 }], deliveryCountry: 'SE' });
    const options = menu.body?.shipping?.options ?? [];
    options.length > 0 ? ok('delivery menu for SE', options.map((o) => `${o.id} ${o.fee}`).join(', ')) : bad('delivery menu for SE', `HTTP ${menu.status}`);
    for (const o of options) {
      const r = await quote({ items: [{ productId: PRODUCT, quantity: 1 }], shippingMethod: o.id, deliveryCountry: 'SE' });
      r.status === 200 && r.body?.totals?.shippingCost === o.fee
        ? ok(`shipping ${o.id}`, `${r.body.totals.shippingCost} SEK`)
        : bad(`shipping ${o.id}`, `HTTP ${r.status}, ${r.body?.totals?.shippingCost} vs menu ${o.fee}`);
    }
  }
  // A "country" that is a prototype key delivers nowhere — it must not fall
  // through to a price, let alone a free one.
  for (const country of ['__proto__', 'constructor']) {
    const r = await quote({ items: [{ productId: PRODUCT, quantity: 1 }], shippingMethod: 'standard', deliveryCountry: country });
    const delivered = (r.body?.shipping?.options ?? []).filter((o) => o.id !== 'pickup');
    r.status === 200 && delivered.length === 0 && r.body?.shipping?.selected !== 'standard'
      ? ok(`delivery to "${country}"`, 'nothing delivered')
      : bad(`delivery to "${country}"`, `HTTP ${r.status}, ${JSON.stringify(r.body?.shipping).slice(0, 80)}`);
  }
}

// ---- an unknown API path answers JSON, not a page of HTML ----
{
  const r = await fetch(`${BASE}/api/no-such-endpoint`);
  const type = r.headers.get('content-type') ?? '';
  r.status === 404 && type.includes('json')
    ? ok('unknown API path', 'HTTP 404 JSON')
    : bad('unknown API path', `HTTP ${r.status} ${type}`);
}

// ---- the server's own source is never served, however the path is spelled ----
// SRV-01: a route on the two literal paths let `%2e`, `//`, `/./` and `../` through
// to the file server, which decodes and tidies a path before it opens anything.
// Then (review 2026-10-11, B) a path ENDING in a dot segment — `/server.cjs/.`,
// `/server.cjs/x/..` — got past a check on the last segment alone.
// Sent raw through node:http — fetch() would tidy the path itself before sending.
{
  const raw = (path) => new Promise((resolve) => {
    const u = new URL(BASE);
    const r = rawRequest({ host: u.hostname, port: u.port, path, method: 'GET' }, (res) => {
      let bytes = 0;
      res.on('data', (c) => { bytes += c.length; });
      res.on('end', () => resolve({ status: res.statusCode, bytes }));
    });
    r.on('error', (e) => resolve({ status: `error ${e.message}`, bytes: 0 }));
    r.end();
  });
  for (const path of [
    '/server.cjs', '/server.cjs.map', '/server%2ecjs', '/server.cjs%2emap',
    '//server.cjs', '/./server.cjs', '/assets/../server.cjs', '/assets/%2e%2e/server.cjs',
    '/server.cjs/.', '/server.cjs/%2e', '/server.cjs/x/..', '/assets/../server.cjs/.',
  ]) {
    const r = await raw(path);
    r.status === 404
      ? ok(`server source ${path}`, 'HTTP 404')
      : bad(`server source ${path}`, `HTTP ${r.status}, ${r.bytes} bytes`);
  }
}

// ---- the security headers are actually sent ----
{
  const r = await fetch(BASE);
  const missing = ['x-content-type-options', 'x-frame-options', 'referrer-policy'].filter((h) => !r.headers.get(h));
  missing.length === 0 ? ok('security headers', 'all present') : bad('security headers', `missing ${missing.join(', ')}`);
}

// ---- signing in, and the back office ----
if (EMAIL && PASSWORD) {
  const page = await open('/admin/login', 'sign-in');

  await page.locator('#admin-email').fill(EMAIL);
  await page.locator('#admin-password').fill('wrong-on-purpose');
  await page.locator('button[type="submit"]').click();
  await page.waitForTimeout(4000);
  const msg = await page.locator('[role="alert"]').innerText().catch(() => '');
  /incorrect/i.test(msg) ? ok('wrong password rejected', msg.trim()) : bad('wrong password rejected', msg || 'no message');

  await page.locator('#admin-password').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForTimeout(9000);
  const landed = await page.evaluate(() => location.pathname);
  landed === '/admin' ? ok('sign-in', `→ ${landed}`) : bad('sign-in', `landed on ${landed}`);

  // Every admin tab must render without blowing up.
  const tabs = await page.locator('main button, main [role="tab"]').allInnerTexts();
  const wanted = ['Users', 'Categories', 'Products', 'Coupons', 'Print'];
  for (const w of wanted) {
    const tab = page.locator(`main button:has-text("${w}")`).first();
    if (!(await tab.count())) {
      bad(`admin tab ${w}`, 'not found');
      continue;
    }
    const before = consoleErrors.length;
    await tab.click();
    await page.waitForTimeout(3500);
    const chars = await page.evaluate(() => (document.querySelector('main')?.innerText ?? '').length);
    consoleErrors.length === before && chars > 200
      ? ok(`admin tab ${w}`, `${chars} chars`)
      : bad(`admin tab ${w}`, consoleErrors.length > before ? 'console error' : `only ${chars} chars`);
  }
  await page.screenshot({ path: 'smoke-admin.png' });
  await page.close();
}

await browser.close();
stopServer();

// ---- report ----
const passed = results.filter((r) => r.pass).length;
console.log('');
for (const r of results) console.log(`  ${r.pass ? '✅' : '🔴'} ${r.name.padEnd(28)} ${r.detail}`);
console.log(`\n  ${passed}/${results.length} passed`);

if (consoleErrors.length) {
  console.log('\n  console errors:');
  [...new Set(consoleErrors)].slice(0, 10).forEach((e) => console.log('   -', e));
} else {
  console.log('  no console errors anywhere');
}

process.exit(passed === results.length && consoleErrors.length === 0 ? 0 : 1);
