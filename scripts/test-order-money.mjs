#!/usr/bin/env node
// An order's money (src/lib/orderMoney.ts) — the invoice, the receipt and the
// admin's order page all print these rows, so every row must add up. The
// admin's page once printed 1000 kr goods, a 100 kr coupon and 100 kr shipping
// as rows summing to 1150 under a 1250 total.
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'reklamx-ordermoney-'));
const out = join(dir, 'm.mjs');
await build({ entryPoints: [join(ROOT, 'src/lib/orderMoney.ts')], outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const { orderMoney } = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });

let failed = 0;
const check = (name, ok, detail = '') => { if (ok) console.log(`  ✅ ${name}`); else { failed += 1; console.error(`  ❌ ${name} ${detail}`); } };
const near = (a, b) => Math.abs(a - b) < 0.005;
const addsUp = (m) => near(m.goodsBeforeDiscounts - m.coupon - m.points, m.goodsNet) && near(m.goodsNet + m.shipping, m.net) && near(m.net + m.vat, m.gross);

// The review's own example, as the server writes it: goodsNet is AFTER the coupon.
const coupon = orderMoney({ goodsNet: 900, discountAmount: 100, shippingCost: 100, netTotal: 1000, vatAmount: 250, grossTotal: 1250 });
check('1000 kr goods, 100 kr coupon, 100 kr shipping: goods row is 1000 (before the coupon)', coupon.goodsBeforeDiscounts === 1000, JSON.stringify(coupon));
check('…and every row adds up to the 1250 total', addsUp(coupon) && coupon.gross === 1250);
const pts = orderMoney({ goodsNet: 850, discountAmount: 100, pointsDiscountAmount: 50, shippingCost: 99, netTotal: 949, vatAmount: 237.25, grossTotal: 1186.25 });
check('loyalty points are a row of their own, and the rows add up', pts.points === 50 && pts.goodsBeforeDiscounts === 1000 && addsUp(pts));
const old = orderMoney({ totalAmount: 1250, shippingCost: 100 });
check('an order from before the breakdown: derived from the total at 25 %', near(old.net, 1000) && near(old.vat, 250) && near(old.goodsNet, 900) && addsUp(old));
const noGoods = orderMoney({ netTotal: 1099, vatAmount: 274.75, grossTotal: 1373.75, shippingCost: 99 });
check('no goodsNet stored: goods = net − shipping', near(noGoods.goodsNet, 1000) && addsUp(noGoods));
const nulls = orderMoney({ netTotal: null, vatAmount: null, grossTotal: null, totalAmount: 125 });
check('explicit nulls are "not stored", not zero', near(nulls.gross, 125) && near(nulls.net, 100));
check('a missing order gives zeros, not NaN', Object.values(orderMoney(null)).every((v) => typeof v === 'string' || v === 0 || v === 0.25));
check('the currency defaults to SEK', orderMoney({}).currency === 'SEK' && orderMoney({ currency: 'EUR' }).currency === 'EUR');
check('refunds are reported, not subtracted from the invoice total', orderMoney({ grossTotal: 1250, netTotal: 1000, vatAmount: 250, refundedAmount: 200 }).refunded === 200);

console.log(failed ? `\n❌ ${failed} failed\n` : '\n✅ all order-money checks passed\n');
process.exit(failed ? 1 : 0);
