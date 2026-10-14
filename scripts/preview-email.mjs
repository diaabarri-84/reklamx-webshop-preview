// Renders the two order emails to HTML files so they can be checked in a browser
// without sending anything. Nothing is transmitted.
//
//   node scripts/preview-email.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { customerConfirmation, shopNotification, parseLogo } from '../src/lib/email.ts';

// The real logo out of the last Firestore backup, so the preview shows what the
// customer will actually get. A real send attaches these same bytes and points
// the <img> at cid:; a browser needs the data: URL, so that is what goes in here.
function shopLogo() {
  try {
    const settings = JSON.parse(readFileSync('.backups/firestore-2026-08-24/settings.json', 'utf8'));
    const url = settings?.siteConfig?.logoUrl;
    if (!parseLogo(url)) {
      console.warn('No usable logo in the backup — previewing without one.');
      return undefined;
    }
    return url;
  } catch {
    console.warn('No settings backup to read a logo from — previewing without one.');
    return undefined;
  }
}

const logo = shopLogo();

const order = {
  id: '202600042', currency: 'SEK', vatRate: 0.25,
  netTotal: 5062.2, vatAmount: 1265.55, grossTotal: 6327.75,
  customerName: 'Anna Lindqvist', customerEmail: 'anna@example.se',
  shippingMethodTitle: 'Zone based shipping (DSV / Schenker)',
  notes: 'Please print on matte stock.',
  molliePaymentId: 'tr_WDqYK6vllg',
  customerDetails: { company: 'Lindqvist Design AB', taxId: 'SE556123456701',
    phone: '+46 70 123 45 67', address1: 'Kungsgatan 12', postcode: '211 49', city: 'Malmö', country: 'Sverige' },
  items: [
    { productName: 'Business cards, 400 gsm', quantity: 500, price: 3200 },
    { productName: 'Roll-up banner 85×200', quantity: 2, price: 1799 },
  ],
};

writeFileSync(
  'email-preview-customer.html',
  customerConfirmation(order, 'ReklamX AB', 'https://reklamx.se/order/202600042?t=demo', undefined, logo).html,
);
writeFileSync('email-preview-shop.html', shopNotification(order, 'ReklamX AB', logo).html);
console.log('email-preview-customer.html');
console.log('email-preview-shop.html');
