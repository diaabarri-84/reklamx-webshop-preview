#!/usr/bin/env node
// Telling the server a basket exists — src/lib/cartBeacon.ts. Plan task 5.7c.
//
// THE RULE THIS FILE EXISTS TO PROVE: a report may never break a purchase. The
// basket belongs to the customer; this is bookkeeping that happens beside it, and
// every failure path has to be silent.
//
// And the trap it is built around: src/lib/cart.ts claims writeCart() is "THE ONLY
// WAY THE BASKET IS WRITTEN", and it is not — addConfiguredLineToCart() calls
// localStorage.setItem itself, and that is the path the configurator and the
// product page use. Hooking writeCart would have missed most baskets and produced
// a report that looked like it worked. So the beacon listens to the EVENT that all
// three paths dispatch.
//
// Usage:  node scripts/test-cart-beacon.mjs

import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// A browser, enough of one. The module reads localStorage, listens on window and
// calls fetch; nothing else.
const store = new Map();
const listeners = new Map();
let sent = [];
let failNextFetch = false;

globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.window = {
  addEventListener: (name, fn) => { listeners.set(name, [...(listeners.get(name) ?? []), fn]); },
  removeEventListener: (name, fn) => {
    listeners.set(name, (listeners.get(name) ?? []).filter((f) => f !== fn));
  },
  dispatchEvent: (e) => { for (const fn of listeners.get(e?.type) ?? []) fn(e); return true; },
};
// NOT `class { constructor(type) { this.type = type } }`.
//
// tsconfig.json sets allowJs with no `include`, so `tsc --noEmit` type-checks
// every .mjs in this repo — and an anonymous class expression assigned to a
// global, with a `this.x = x` in its constructor, CRASHES the compiler:
//   Debug Failure. False expression.
//     at getConstructorDefinedThisAssignmentTypes
// Not an error in this file's logic; a compiler bug this shape of code walks
// into. A plain factory does the same job and does not.
globalThis.Event = function (type) { return { type }; };
// `attempts` counts every call that REACHED fetch, whether it then failed or
// not. Without it a "nothing was sent" assertion passes just as well when the
// beacon was never listening — which is exactly how this file once fooled itself.
let attempts = 0;
globalThis.fetch = async (url, init) => {
  attempts += 1;
  if (failNextFetch) { failNextFetch = false; throw new Error('network down'); }
  sent.push({ url, body: JSON.parse(init?.body ?? '{}'), auth: init?.headers?.Authorization ?? null });
  return { ok: true, status: 204 };
};

const outDir = mkdtempSync(join(tmpdir(), 'reklamx-beacon-'));
const out = join(outDir, 'cartBeacon.mjs');
await build({
  entryPoints: [join(ROOT, 'src', 'lib', 'cartBeacon.ts')],
  outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
});
const { startCartBeacon, markCartConverted, resetCartBeaconForTests } =
  await import(pathToFileURL(out).href);
rmSync(outDir, { recursive: true, force: true });

let failed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) console.log(`  ✅ ${name}`);
  else { failed += 1; console.error(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`); }
};
const ok = (name, cond) => check(name, Boolean(cond), true);

const CART = [{ productId: 'p1', name: 'Roll Up', quantity: 2, totalPrice: 1490, artworkPending: false }];
const setCart = (items) => store.set('reklamx_cart', JSON.stringify(items));
const fireChange = () => globalThis.window.dispatchEvent(new globalThis.Event('reklamx:cart'));
const settle = () => new Promise((r) => realSleep(r, 60));

// The beacon waits 20 s before speaking. The tests drive the clock instead.
const realTimeout = globalThis.setTimeout;
const realSleep = (fn, ms) => realTimeout(fn, ms);
let pending = [];
globalThis.setTimeout = (fn, ms) => {
  if (ms >= 1000) { const h = { fn }; pending.push(h); return h; }
  return realTimeout(fn, ms);
};
globalThis.clearTimeout = (h) => { if (h && h.fn) pending = pending.filter((p) => p !== h); else realTimeout(() => {}, 0); };
const runQuiet = async () => { const due = pending; pending = []; for (const h of due) h.fn(); await settle(); };

console.log('\nit says nothing at all unless the customer is signed in');
resetCartBeaconForTests(); sent = [];
let stop = startCartBeacon(async () => null);          // no token
setCart(CART); fireChange(); await runQuiet();
check('a guest is never recorded — the shop has no anonymous id and invents none', sent.length, 0);
stop();

console.log('\na signed-in customer’s basket is recorded, once it settles');
resetCartBeaconForTests(); sent = [];
stop = startCartBeacon(async () => 'token-abc');
setCart(CART); fireChange();
check('nothing is sent immediately — it waits for the customer to stop fiddling', sent.length, 0);
await runQuiet();
check('and then exactly one call', sent.length, 1);
check('to the snapshot endpoint', sent[0].url, '/api/cart/snapshot');
check('carrying the token', sent[0].auth, 'Bearer token-abc');
check('and the basket’s value', sent[0].body.value, 1490);
ok('and no artwork, ever', !JSON.stringify(sent[0].body).includes('fileUrl'));

console.log('\nit does not repeat itself');
sent = [];
fireChange(); await runQuiet();
check('an unchanged basket is not sent again', sent.length, 0);

console.log('\nand it refuses to be a write-per-keystroke');
resetCartBeaconForTests(); sent = [];
setCart([{ ...CART[0], quantity: 3, totalPrice: 2235 }]); fireChange(); await runQuiet();
check('a real change is sent', sent.length, 1);
sent = [];
for (let i = 4; i < 12; i += 1) {
  setCart([{ ...CART[0], quantity: i, totalPrice: 745 * i }]);
  fireChange();
}
await runQuiet();
// Eight changes inside the five-minute window — the free Firestore tier on this
// project has taken the shop dark three times.
check('eight more changes in five minutes send NOTHING', sent.length, 0);

console.log('\nan empty or worthless basket is not an abandoned one');
resetCartBeaconForTests(); sent = [];
setCart([]); fireChange(); await runQuiet();
check('an empty basket says nothing', sent.length, 0);
resetCartBeaconForTests(); sent = [];
setCart([{ productId: 'x', quantity: 1, totalPrice: 0 }]); fireChange(); await runQuiet();
check('and neither does one worth nothing', sent.length, 0);

console.log('\nTHE RULE: it can never break a purchase');
resetCartBeaconForTests(); sent = []; attempts = 0;
failNextFetch = true;
setCart(CART); fireChange();
let threw = null;
try { await runQuiet(); } catch (e) { threw = e; }
check('a dead network does not throw into the shop', threw, null);
// The assertion above is worthless unless the call really happened.
check('and it really did try — otherwise this proves nothing', attempts, 1);
check('but nothing was recorded', sent.length, 0);

resetCartBeaconForTests(); sent = []; attempts = 0;
store.set('reklamx_cart', '{{{ not json');
fireChange();
try { await runQuiet(); } catch (e) { threw = e; }
check('a corrupt basket does not throw either', threw, null);
check('and nothing is sent for one', sent.length, 0);
check('it did not even try', attempts, 0);

resetCartBeaconForTests(); sent = []; attempts = 0;
stop();
stop = startCartBeacon(async () => { throw new Error('auth exploded'); });
setCart([{ ...CART[0], totalPrice: 999 }]); fireChange();
try { await runQuiet(); } catch (e) { threw = e; }
check('nor does a token provider that throws', threw, null);
check('and it never reached the network without a token', attempts, 0);
stop();

console.log('\nthe basket that became an order stops counting');
resetCartBeaconForTests(); sent = []; attempts = 0;
const stopConv = startCartBeacon(async () => 'token-abc');
setCart(CART);
markCartConverted();
await settle();
check('conversion is sent at once, not after the quiet period', sent.length, 1);
check('and says so', sent[0].body.converted, true);

stopConv();

console.log('\nstopping it really stops it');
resetCartBeaconForTests(); sent = [];
const stop2 = startCartBeacon(async () => 'token-abc');
stop2();
setCart(CART); fireChange(); await runQuiet();
check('no listener is left behind', sent.length, 0);

console.log('\nstarted twice, it still listens once');
resetCartBeaconForTests(); sent = [];
startCartBeacon(async () => 'token-abc');
const stop3 = startCartBeacon(async () => 'token-abc');   // React StrictMode does this
setCart([{ productId: 'p9', name: 'Twice', quantity: 1, totalPrice: 500 }]);
fireChange(); await runQuiet();
// Two listeners would be two writes for one basket change.
check('one change is still one write', sent.length, 1);
stop3();

console.log(`\n${failed === 0 ? 'The report can never cost a sale.' : `${failed} failing.`}`);
process.exit(failed === 0 ? 0 : 1);
