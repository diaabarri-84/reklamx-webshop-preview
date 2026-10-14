// What the order e-mails SAY about the money (src/lib/email.ts): an order placed to
// pay on delivery is not paid, and neither e-mail may say it was — the customer is
// told he pays when he receives it, the shop's notice says PAY ON DELIVERY. Once the
// owner records the payment, the ordinary paid wording is right again.
import { build } from 'esbuild';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// Built INSIDE the project (its git-ignored .cache), so the mail library it imports
// is found in node_modules.
mkdirSync(join(ROOT, '.cache'), { recursive: true });
const tmp = mkdtempSync(join(ROOT, '.cache', 'mail-wording-'));
await build({
  entryPoints: [join(ROOT, 'src/lib/email.ts')], outfile: join(tmp, 'e.mjs'), bundle: true, format: 'esm',
  platform: 'node', packages: 'external', logLevel: 'silent',
});
const { customerConfirmation, shopNotification } = await import(pathToFileURL(join(tmp, 'e.mjs')).href);
rmSync(tmp, { recursive: true, force: true });

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}${ok ? '' : `\n       ${detail}`}`);
  if (!ok) failed++;
};
const order = (extra) => ({
  id: '202691801', customerName: 'Petra Leverans', customerEmail: 'petra@firma.test', currency: 'SEK',
  customerDetails: { firstName: 'Petra', lastName: 'Leverans', address1: 'Storgatan 1', postcode: '111 22', city: 'Stockholm', country: 'Sverige' },
  items: [{ productName: 'Roll-up 85 × 200 cm', quantity: 1, unitPrice: 999, price: 999, options: {} }],
  goodsNet: 999, shippingCost: 0, netTotal: 999, vatAmount: 249.75, grossTotal: 1248.75,
  shippingMethod: 'pickup', shippingMethodTitle: 'Pickup', ...extra,
});
const text = (html) => String(html).replace(/<[^>]+>/g, ' ').replace(/&nbsp;| | /g, ' ').replace(/\s+/g, ' ');

const cod = order({ payOnDelivery: true, paymentStatus: 'unpaid' });
const c1 = customerConfirmation(cod, 'ReklamX', 'https://shop.test/order/202691801?t=x');
check('pay on delivery — the customer: "you pay when you receive it", with the amount',
  /You pay when you receive it/.test(text(c1.html)) && /1\s?248,75|1\s?248\.75|1\s?249/.test(text(c1.html)), text(c1.html).slice(0, 200));
check('…and never "we have received your payment"', !/received your payment/i.test(text(c1.html)));
const s1 = shopNotification(cod, 'ReklamX');
check('pay on delivery — the shop\'s notice: "PAY ON DELIVERY", the amount still to be paid, and not "New paid order"',
  /PAY ON DELIVERY/.test(s1.subject) && !/New paid order/.test(s1.subject) && /still to be paid/.test(text(s1.html)) && !/A paid order has arrived/.test(text(s1.html)),
  `${s1.subject} · ${text(s1.html).slice(0, 160)}`);

const paid = order({ paymentStatus: 'paid' });
check('an order paid online: "we have received your payment" and "New paid order", as before',
  /received your payment/.test(text(customerConfirmation(paid, 'ReklamX', 'https://shop.test/o').html)) && /^New paid order/.test(shopNotification(paid, 'ReklamX').subject));
const recorded = order({ payOnDelivery: true, paymentStatus: 'paid' });
check('paid on delivery and recorded: the paid wording is right again',
  /received your payment/.test(text(customerConfirmation(recorded, 'ReklamX', 'https://shop.test/o').html)) && /^New paid order/.test(shopNotification(recorded, 'ReklamX').subject));

console.log(failed ? `\n❌ ${failed} failed` : '\n✅ all passed');
process.exit(failed ? 1 : 0);
