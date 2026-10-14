// 2026-10-07: the free database's 50 000 reads a day ran out at 19:58 UTC and the
// shop was dark until 07:00 — the owner's own login showed him as a customer. The
// server re-read EVERY product every five minutes (and again every ten for the
// search engines' pages), in every worker.
//
//   a copy is used until something CHANGES: a second worker (the host runs several)
//   takes the copy another worker read, from disk — it does not read again;
//   the search engines' pages (sitemap) come from that same copy — no read of
//   their own;
//   a change from the dashboard shows at once on EVERY worker;
//   what a visitor downloads carries no search-engine fields;
//   /api/health?database=1 answers whether the database refuses (here: it does not).
//
// Worker A is the kit's own server (:3100, development). Worker B is started here
// (:3101, production — the search-engine routes exist only there) in the same
// folder, so the two share `.cache/` exactly as two Passenger workers do.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE, db, check, summary } from './lib.mjs';

const APP = fileURLToPath(new URL('../..', import.meta.url));
const B = 'http://127.0.0.1:3101';
const ID = 'prod-read-budget';

const signIn = await (await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@emulator.test', password: 'emulator-admin-1', returnSecureToken: true }),
})).json();
const asAdmin = { Authorization: `Bearer ${signIn.idToken}` };
const invalidate = (base) => fetch(`${base}/api/admin/cache/invalidate`, { method: 'POST', headers: asAdmin }).then((r) => r.status);
const find = async (base) => {
  const r = await (await fetch(`${base}/api/catalogue?q=read%20budget&limit=10`)).json();
  return (r.products ?? []).find((p) => p.id === ID) ?? null;
};
const sitemap = (base) => fetch(`${base}/sitemap.xml`).then((r) => r.text());

let workerB = null;
const cleanup = async () => {
  workerB?.kill('SIGTERM');
  await db.collection('products').doc(ID).delete().catch(() => {});
  await invalidate(BASE).catch(() => {});
};
process.on('uncaughtException', async (err) => { console.error(err); await cleanup().catch(() => {}); process.exit(1); });

// ---- a product, seen by worker A (which reads it and leaves its copy on disk) ----
await db.collection('products').doc(ID).set({
  id: ID, name: 'Read budget one', slug: 'read-budget-one', isHidden: false, basePrice: 100, categoryId: 'indoor',
  images: [], description: 'A product for the read budget test.', seoTitle: 'Search title one', brand: 'ReklamX',
});
check('the change is signalled from the dashboard (the stamp every worker checks)', (await invalidate(BASE)) === 200);
const seenByA = await find(BASE);
check('worker A shows the product', seenByA?.name === 'Read budget one', JSON.stringify(seenByA));
check('…and a visitor\'s copy carries no search-engine fields (they ride along for the sitemap only)',
  !!seenByA && !('seoTitle' in seenByA) && !('brand' in seenByA) && !('updatedAt' in seenByA), JSON.stringify(Object.keys(seenByA ?? {})));

// ---- changed BEHIND the dashboard's back: nobody signalled it ----
await db.collection('products').doc(ID).set({ name: 'Read budget two', slug: 'read-budget-two' }, { merge: true });

// ---- worker B: a fresh process, nothing in memory ----
if (!existsSync(join(APP, 'dist', 'index.html'))) {
  const built = spawnSync('npm', ['run', 'build'], { cwd: APP, encoding: 'utf8' });
  if (built.status !== 0) throw new Error(`the build for worker B failed: ${(built.stderr || built.stdout).slice(-400)}`);
}
workerB = spawn('./node_modules/.bin/tsx', ['server.ts'], {
  cwd: APP,
  env: {
    ...process.env, NODE_ENV: 'production', PORT: '3101', DISABLE_HMR: 'true', AUTO_STAGE_SWEEP: 'off',
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:8085', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
    FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199', GCLOUD_PROJECT: 'demo-reklamx',
  },
  stdio: 'ignore',
});
let up = false;
for (let i = 0; i < 120 && !up; i++) {
  up = await fetch(`${B}/api/health`).then((r) => r.ok).catch(() => false);
  if (!up) await new Promise((r) => setTimeout(r, 500));
}
check('worker B is up (production mode, the same folder)', up);

const seenByB = await find(B);
check('worker B does NOT read the products again: it takes worker A\'s copy from disk (still "one" — the database says "two")',
  seenByB?.name === 'Read budget one', JSON.stringify(seenByB?.name));
const mapB = await sitemap(B);
check('the sitemap on worker B comes from that same copy — no read of its own (it read every product every ten minutes)',
  mapB.includes('/products/read-budget-one') && !mapB.includes('/products/read-budget-two'), mapB.slice(0, 200));

// ---- the dashboard signals a change: EVERY worker reads again, at once ----
check('a change from the dashboard (to worker A)', (await invalidate(BASE)) === 200);
const afterB = await find(B);
const mapAfter = await sitemap(B);
check('…worker B shows it at once — the product and the sitemap ("two")',
  afterB?.name === 'Read budget two' && mapAfter.includes('/products/read-budget-two') && !mapAfter.includes('/products/read-budget-one'),
  `${afterB?.name} · ${mapAfter.includes('/products/read-budget-two')}`);
check('…and worker A too', (await find(BASE))?.name === 'Read budget two');

// ---- is the database refusing? (the signed-in owner's message asks) ----
const health = await (await fetch(`${B}/api/health?database=1`)).json();
check('/api/health?database=1 says whether the database refuses for its daily limit — here: it does not', health.database === 'ok', JSON.stringify(health));
const plain = await (await fetch(`${B}/api/health`)).json();
check('…and only when asked (a plain health check reads nothing)', !('database' in plain), JSON.stringify(plain));

await cleanup();
process.exit(summary() ? 1 : 0);
