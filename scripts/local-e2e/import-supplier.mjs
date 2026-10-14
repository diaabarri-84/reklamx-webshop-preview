#!/usr/bin/env node
// Import a supplier's WHOLE catalogue into the LOCAL test shop, through the same
// admin endpoints the dashboard's "Browse a supplier" screen calls: build the
// index (index/step, in a loop), list it (catalogue), import in chunks of 500.
//
//   node scripts/local-e2e/import-supplier.mjs [supplier] [marginPercent] [eurRate]
//   node scripts/local-e2e/import-supplier.mjs easygifts 150 11.5
//
// Defaults are the dashboard's own (SupplierPicker.tsx): 150 % margin, 11.5 kr
// per euro. Products are imported VISIBLE so they can be clicked through — the
// dashboard always imports hidden, for the owner to review first.
//
// Local only: it signs in through the Auth EMULATOR and talks to the test copy
// on 127.0.0.1:3100 (start-windows.mjs / start.sh). It cannot reach the live shop.
const BASE = 'http://127.0.0.1:3100';
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key';
const [supplier = 'easygifts', margin = '150', rate = '11.5'] = process.argv.slice(2);

const fail = (s) => { console.error(`✗ ${s}`); process.exit(1); };
const signIn = await fetch(AUTH, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'owner@reklamx.test', password: 'ReklamX-local-1', returnSecureToken: true }),
}).catch(() => null);
if (!signIn?.ok) fail('could not sign in to the Auth emulator — is local test mode running?');
const { idToken } = await signIn.json();
const api = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${idToken}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) fail(`${path}: ${res.status} ${data.error ?? ''}`);
  return data;
};

console.log(`▸ building the ${supplier} index (fetching the supplier's feed)…`);
let state;
for (let i = 0; i < 1000; i++) {
  state = await api(`/api/admin/suppliers/${supplier}/index/step`, {});
  if (state.phase === 'done') break;
  if (state.phase === 'blocked') fail(`index blocked: ${state.reason}`);
  if (state.phase === 'write') process.stdout.write(`\r  ${state.cursor}/${state.total} rows`);
}
console.log(`\n  index done: ${state.total} rows`);

const keys = [];
for (let offset = 0; offset !== null;) {
  const page = await api(`/api/admin/suppliers/${supplier}/catalogue?limit=200&offset=${offset}`);
  keys.push(...page.products.map((p) => p.productKey));
  offset = page.nextOffset;
  if (offset === null && page.hiddenUnpriced) console.log(`  ${page.hiddenUnpriced} products without a price skipped (cannot be sold)`);
}
// The shop lists products BY CATEGORY, so an import without one is invisible on
// /products. One category per supplier, made in the emulator if it is missing.
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085';
process.env.GCLOUD_PROJECT = 'demo-reklamx';
const { initializeApp } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
// Into one holding category first; categorize-supplier.mjs then files every
// product under the supplier's own product type and removes this one.
const categoryId = 'promotional-products';
const catRef = getFirestore(initializeApp({ projectId: 'demo-reklamx' }, 'import')).collection('categories').doc(categoryId);
if (!(await catRef.get()).exists) {
  await catRef.set({ name: 'Promotional products', nameI18n: { sv: 'Profilprodukter', da: 'Profilprodukter', no: 'Profilprodukter' },
    description: '', parentId: '', image: '/placeholder-print.svg', isHidden: false, sortOrder: 70, productOrder: [] });
}
console.log(`▸ importing ${keys.length} products at ${margin} % margin, ${rate} kr/€, visible, into "${categoryId}"…`);

let imported = 0, skipped = 0;
for (let i = 0; i < keys.length; i += 500) {
  const r = await api(`/api/admin/suppliers/${supplier}/import`, {
    productKeys: keys.slice(i, i + 500), marginPercent: Number(margin), rate: Number(rate), hidden: false, categoryId,
  });
  imported += r.imported ?? 0;
  skipped += r.skipped?.length ?? 0;
  process.stdout.write(`\r  ${imported} imported${skipped ? `, ${skipped} skipped` : ''}`);
}
console.log(`\n✓ done — ${imported} ${supplier} products in the test shop (${BASE}/products)`);
console.log('  next: node scripts/local-e2e/categorize-supplier.mjs        (file them under their own product types)');
console.log('        node scripts/local-e2e/make-supplier-designable.mjs   (open the designer on them)');
