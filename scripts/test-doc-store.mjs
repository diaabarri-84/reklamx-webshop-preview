#!/usr/bin/env node
// The MySQL document store (src/lib/db/docStore.ts) must answer server.ts's
// Firestore calls with Firestore's results — merge rules, update dot paths,
// query typing, ordering, paging, transactions — or the shop's logic quietly
// changes when it moves off Firebase. And every Firestore document must come
// back from MySQL byte-identical (src/lib/db/tableMap.ts, migration/schema.sql).
//
// Needs a database, so it is not part of test:units. Two ways to run it:
//   npm run test:db                       starts a throwaway MySQL 8.4 itself
//   MYSQL_TEST_URL=mysql://root@127.0.0.1:3399/rt npm run test:db
//                                         any empty database you point it at (e.g. MariaDB)
import { build } from 'esbuild';
import mysql from 'mysql2/promise';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deepStrictEqual } from 'node:assert';
import crypto from 'node:crypto';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'reklamx-docstore-'));
const out = join(dir, 'm.mjs');
await build({ entryPoints: [join(ROOT, 'src/lib/db/docStore.ts')], outfile: out, bundle: true, format: 'esm', platform: 'node', external: ['mysql2'], logLevel: 'silent' });
const { DocStore, FieldValue, FieldPath } = await import(pathToFileURL(out).href);
await build({ entryPoints: [join(ROOT, 'src/lib/db/tableMap.ts')], outfile: join(dir, 't.mjs'), bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const { toRow, serializeDoc, TABLES } = await import(pathToFileURL(join(dir, 't.mjs')).href);
rmSync(dir, { recursive: true, force: true });

let server = null;
let uri = process.env.MYSQL_TEST_URL;
if (!uri) {
  const { createDB } = await import('mysql-memory-server');
  server = await createDB({ version: '8.4.x', logLevel: 'ERROR' });
  uri = `mysql://${server.username}@127.0.0.1:${server.port}/${server.dbName}`;
}

let failed = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ✅ ${name}`); } catch (e) { failed += 1; console.error(`  ❌ ${name} — ${e?.message ?? e}`); }
};
const throwsCode = async (fn, code) => {
  try { await fn(); } catch (e) { if (code === undefined || e.code === code) return; throw new Error(`threw code ${e.code}, wanted ${code}: ${e.message}`); }
  throw new Error('did not throw');
};

const admin = await mysql.createConnection({ uri, multipleStatements: true });
const [[{ v: version }]] = await admin.query('SELECT VERSION() AS v');
console.log(`Database: ${version}`);
await admin.query(readFileSync(join(ROOT, 'migration/schema.sql'), 'utf8'));
const pool = mysql.createPool({ uri, charset: 'utf8mb4', connectionLimit: 10 });
const db = new DocStore(pool, { secretsKey: crypto.randomBytes(32) });

try {
  console.log('\nStored documents come back identical');
  const tricky = {
    price: 0.085, total: 0.1 + 0.2, third: 1 / 3, big: 1e21, tiny: 5e-324, neg: -1234.5678,
    text: 'Visitkort – åäö 😀 العربية "q" \\ \n \t \u0000', broken: 'cut \ud83d',
    nested: { a: [1, 'two', { three: [true, false, null] }], empty: {}, list: [] },
    'key.with.dots': 1, '': 'empty key', i18n: { sv: 'Skyltar', da: null },
  };
  for (const name of Object.keys(TABLES)) {
    await check(`${name}: round-trips through set/get`, async () => {
      const ref = db.collection(name).doc(`rt-${name}`);
      await ref.set(tricky);
      deepStrictEqual((await ref.get()).data(), tricky);
    });
  }
  await check('a 1 MiB document (the Firestore maximum) round-trips', async () => {
    const doc = { hero: 'data:image/jpeg;base64,' + 'C'.repeat(1024 * 1024 - 100) };
    await db.collection('settings').doc('big').set(doc);
    deepStrictEqual((await db.collection('settings').doc('big').get()).data(), doc);
  });
  await check('ids differing only by case or accent stay separate', async () => {
    for (const id of ['Skyltar', 'skyltar', 'kläder', 'klader']) await db.collection('categories').doc(id).set({ name: id });
    deepStrictEqual((await db.collection('categories').doc('skyltar').get()).data(), { name: 'skyltar' });
    deepStrictEqual((await db.collection('categories').doc('klader').get()).data(), { name: 'klader' });
  });
  await check('a missing document: exists false, data() undefined', async () => {
    const s = await db.collection('orders').doc('nope').get();
    if (s.exists || s.data() !== undefined || s.id !== 'nope') throw new Error('wrong snapshot');
  });
  await check('data() is a fresh object each call', async () => {
    const s = await db.collection('orders').doc('rt-orders').get();
    s.data().price = 1;
    if (s.data().price !== 0.085) throw new Error('mutation leaked');
  });
  await check('secrets are stored encrypted and read back', async () => {
    await db.collection('secrets').doc('integrations').set({ mollie: { key: 'live_SECRET' } });
    const [[row]] = await pool.query("SELECT ciphertext FROM secrets WHERE id = 'integrations'");
    if (row.ciphertext.includes('live_SECRET')) throw new Error('plain text in the table');
    deepStrictEqual((await db.collection('secrets').doc('integrations').get()).data(), { mollie: { key: 'live_SECRET' } });
  });
  await check('without DB_SECRETS_KEY the secrets table refuses, instead of storing plain text', async () => {
    const noKey = new DocStore(pool, {});
    await throwsCode(() => noKey.collection('secrets').doc('x').set({ a: 1 }));
  });
  await check('values JSON would change are refused (NaN, Infinity, Date)', async () => {
    for (const bad of [{ a: NaN }, { a: Infinity }, { a: new Date() }]) await throwsCode(() => db.collection('orders').doc('bad').set(bad));
  });

  console.log('\nWrites — Firestore semantics');
  const ref = db.collection('orders').doc('w1');
  await check('set() without merge replaces the document', async () => {
    await ref.set({ a: 1, b: { c: 2, d: 3 } });
    await ref.set({ x: 1 });
    deepStrictEqual((await ref.get()).data(), { x: 1 });
  });
  await check('set(merge): omitted keys kept, nested maps merged, null stored', async () => {
    await ref.set({ a: 1, b: { c: 2, d: 3 }, keep: 'k' });
    await ref.set({ b: { c: 20 }, a: null }, { merge: true });
    deepStrictEqual((await ref.get()).data(), { a: null, b: { c: 20, d: 3 }, keep: 'k' });
  });
  await check('set(merge) with an EMPTY map replaces the field with {}', async () => {
    await ref.set({ b: {} }, { merge: true });
    deepStrictEqual((await ref.get()).data().b, {});
  });
  await check('set(merge) with FieldValue.delete() removes the key', async () => {
    await ref.set({ keep: FieldValue.delete() }, { merge: true });
    if ('keep' in (await ref.get()).data()) throw new Error('key still there');
  });
  await check('set(merge) on a missing document creates it', async () => {
    await db.collection('orders').doc('w-new').set({ a: 1 }, { merge: true });
    deepStrictEqual((await db.collection('orders').doc('w-new').get()).data(), { a: 1 });
  });
  await check('set(merge) keys containing dots are literal keys, not paths', async () => {
    await ref.set({ 'x.y': 1 }, { merge: true });
    const d = (await ref.get()).data();
    if (d['x.y'] !== 1 || typeof d.x === 'object') throw new Error(JSON.stringify(d));
  });
  await check('update(): dot paths set nested keys, siblings kept', async () => {
    await ref.set({ sideEffects: { pointsApplied: true, emailsSent: false }, drive: { error: 'x', files: 2 } });
    await ref.update({ 'sideEffects.emailsSent': true, 'drive.error': FieldValue.delete() });
    deepStrictEqual((await ref.get()).data(), { sideEffects: { pointsApplied: true, emailsSent: true }, drive: { files: 2 } });
  });
  await check('update(): a map value REPLACES the whole map', async () => {
    await ref.update({ sideEffects: { only: 1 } });
    deepStrictEqual((await ref.get()).data().sideEffects, { only: 1 });
  });
  await check('update() on a missing document fails with NOT_FOUND (5)', () => throwsCode(() => db.collection('orders').doc('missing').update({ a: 1 }), 5));
  await check('create() on an existing document fails with ALREADY_EXISTS (6)', async () => {
    await db.collection('orders').doc('c1').create({ a: 1 });
    await throwsCode(() => db.collection('orders').doc('c1').create({ a: 2 }), 6);
    deepStrictEqual((await db.collection('orders').doc('c1').get()).data(), { a: 1 });
  });
  await check('arrayUnion adds only missing elements (objects compared by value)', async () => {
    await ref.set({ creditNoteNumbers: ['K1'], list: [{ a: 1, b: 2 }] });
    await ref.update({ creditNoteNumbers: FieldValue.arrayUnion('K1', 'K2'), list: FieldValue.arrayUnion({ b: 2, a: 1 }, { a: 3 }) });
    const d = (await ref.get()).data();
    deepStrictEqual(d.creditNoteNumbers, ['K1', 'K2']);
    deepStrictEqual(d.list, [{ a: 1, b: 2 }, { a: 3 }]);
  });
  await check('undefined in written data is refused, like the Admin SDK (3)', async () => {
    await throwsCode(() => ref.set({ a: undefined }), 3);
    await throwsCode(() => ref.update({ 'x.y': undefined }), 3);
  });
  await check('delete() removes; deleting a missing document is fine', async () => {
    await db.collection('orders').doc('c1').delete();
    await db.collection('orders').doc('c1').delete();
    if ((await db.collection('orders').doc('c1').get()).exists) throw new Error('still there');
  });
  await check('add() creates a document with a 20-character auto id', async () => {
    const r = await db.collection('contact_inquiries').add({ name: 'N' });
    if (!/^[A-Za-z0-9]{20}$/.test(r.id)) throw new Error(r.id);
    deepStrictEqual((await r.get()).data(), { name: 'N' });
  });
  await check('the index copies follow the written document', async () => {
    await db.collection('orders').doc('ix').set({ userId: 'u1', shipmentOpen: true });
    await db.collection('orders').doc('ix').update({ shipmentOpen: false, userId: 'u2' });
    const [[row]] = await pool.query("SELECT user_id, shipment_open FROM orders WHERE id = 'ix'");
    deepStrictEqual({ ...row }, { user_id: 'u2', shipment_open: 0 });
  });

  console.log('\nQueries — Firestore semantics');
  const orders = db.collection('orders');
  const seed = [
    ['q01', { userId: 'u1', createdAt: '2026-09-01T10:00:00.000Z', nextStageAt: '2026-10-01T00:00:00.000Z', shipmentOpen: true, paymentMode: 'test' }],
    ['q02', { userId: 'u1', createdAt: '2026-09-03T10:00:00.000Z', nextStageAt: null, shipmentOpen: 'true' }],
    ['q03', { userId: 'u2', createdAt: '2026-09-02T10:00:00.000Z', nextStageAt: '2026-10-20T00:00:00.000Z', shipmentOpen: false }],
    ['q04', { userId: 'u1', createdAt: '2026-09-03T10:00:00.000Z' }],
    ['q05', { userId: 'u3' }],
    ['q06', { userId: 42, createdAt: 7 }],
  ];
  for (const [id, d] of seed) await orders.doc(id).set(d);
  const ids = (snap) => snap.docs.map((d) => d.id);

  await check("where('userId','==','u1') matches only that string", async () => {
    deepStrictEqual(ids(await orders.where('userId', '==', 'u1').get()), ['q01', 'q02', 'q04']);
  });
  await check("where('shipmentOpen','==',true) matches the boolean only, not 'true'", async () => {
    deepStrictEqual(ids(await orders.where('shipmentOpen', '==', true).get()), ['q01']);
  });
  // The one deliberate difference from Firestore: an index column holds ONE
  // type, so a filter of another type matches nothing (Firestore would find
  // q06 for the number 42). Every filter in server.ts uses the column's type.
  await check("the string '42' does not match the number 42, and a number filter on a text column matches nothing", async () => {
    deepStrictEqual(ids(await orders.where('userId', '==', '42').get()), []);
    deepStrictEqual(ids(await orders.where('userId', '==', 42).get()), []);
  });
  await check('auto-stage sweep: nextStageAt <= now, orderBy nextStageAt, limit — skips null/missing', async () => {
    deepStrictEqual(ids(await orders.where('nextStageAt', '<=', '2026-10-13T00:00:00.000Z').orderBy('nextStageAt').limit(50).get()), ['q01']);
  });
  await check('reports: createdAt range, orderBy createdAt asc (string comparison, numbers excluded)', async () => {
    const snap = await orders.where('createdAt', '>=', '2026-09-02').where('createdAt', '<', '2026-09-04').orderBy('createdAt', 'asc').get();
    deepStrictEqual(ids(snap), ['q03', 'q02', 'q04']);
  });
  await check('orderBy desc breaks ties by id desc; documents without the field are left out', async () => {
    deepStrictEqual(ids(await orders.where('userId', '==', 'u1').orderBy('createdAt', 'desc').get()), ['q04', 'q02', 'q01']);
  });
  await check('no orderBy: results come in id order', async () => {
    deepStrictEqual(ids(await orders.where('userId', '==', 'u1').get()), ['q01', 'q02', 'q04']);
  });
  await check("where(FieldPath.documentId(), 'in', [...]) — missing ids simply absent", async () => {
    deepStrictEqual(ids(await orders.where(FieldPath.documentId(), 'in', ['q03', 'q01', 'zz']).get()), ['q01', 'q03']);
  });
  await check('paging with startAfter returns every document once', async () => {
    const seen = [];
    let q = orders.orderBy('createdAt', 'desc').limit(2);
    for (let page = await q.get(); page.size; page = await q.startAfter(page.docs[page.size - 1]).get()) seen.push(...ids(page));
    const all = ids(await orders.orderBy('createdAt', 'desc').get());
    deepStrictEqual(seen, all);
    if (new Set(seen).size !== seen.length) throw new Error('duplicates');
  });
  await check('select() returns only the asked fields', async () => {
    const snap = await orders.where(FieldPath.documentId(), 'in', ['q03', 'q05']).select('createdAt').get();
    // q05 has no createdAt: Firestore returns it with empty data, not without it.
    deepStrictEqual(snap.docs.map((d) => d.data()), [{ createdAt: '2026-09-02T10:00:00.000Z' }, {}]);
  });
  await check('count()', async () => {
    deepStrictEqual((await orders.where('userId', '==', 'u1').count().get()).data(), { count: 3 });
  });
  await check('querying by a field with no index column fails loudly', () => throwsCode(async () => orders.where('customerEmail', '==', 'x'), 3));
  await check('getAll(): order kept, missing documents exists=false, fieldMask applied', async () => {
    const snaps = await db.getAll(orders.doc('q03'), orders.doc('zz'), orders.doc('q01'), { fieldMask: ['userId'] });
    deepStrictEqual(snaps.map((s) => [s.id, s.exists, s.data()]), [['q03', true, { userId: 'u2' }], ['zz', false, undefined], ['q01', true, { userId: 'u1' }]]);
  });
  await check('subcollection users/{uid}/pointsLedger: where orderId & type, orderBy date', async () => {
    const ledger = db.collection('users').doc('u1').collection('pointsLedger');
    await ledger.doc('o1-e').set({ orderId: 'o1', type: 'earned', date: '2026-09-02', points: 5 });
    await ledger.doc('o1-x1').set({ orderId: 'o1', type: 'refund-reversal', date: '2026-09-03', points: -5 });
    await db.collection('users').doc('u9').collection('pointsLedger').doc('o1-x1').set({ orderId: 'o1', type: 'refund-reversal' });
    deepStrictEqual(ids(await ledger.where('orderId', '==', 'o1').where('type', '==', 'refund-reversal').get()), ['o1-x1']);
    deepStrictEqual(ids(await ledger.orderBy('date', 'asc').limit(1000).get()), ['o1-e', 'o1-x1']);
    if (ledger.doc('a').path !== 'users/u1/pointsLedger/a') throw new Error(ledger.doc('a').path);
  });

  console.log('\nBatches and transactions');
  await check('a batch is all-or-nothing', async () => {
    const b = db.batch();
    b.set(orders.doc('b1'), { a: 1 });
    b.update(orders.doc('does-not-exist'), { a: 1 });
    await throwsCode(() => b.commit(), 5);
    if ((await orders.doc('b1').get()).exists) throw new Error('first write was applied');
  });
  await check('a transaction that throws changes nothing', async () => {
    await throwsCode(() => db.runTransaction(async (tx) => {
      tx.set(orders.doc('t1'), { a: 1 });
      throw Object.assign(new Error('boom'), { code: 'boom' });
    }), 'boom');
    if ((await orders.doc('t1').get()).exists) throw new Error('write survived');
  });
  await check('30 concurrent order numbers: no duplicates, no gaps (counter transaction)', async () => {
    const counter = db.collection('counters').doc('orders-2026');
    const next = () => db.runTransaction(async (tx) => {
      const snap = await tx.get(counter);
      const value = (snap.data()?.value ?? 0) + 1;
      tx.set(counter, { value, updatedAt: 'x' }, { merge: true });
      return value;
    }, { maxAttempts: 50 });
    const got = (await Promise.all(Array.from({ length: 30 }, next))).sort((a, b) => a - b);
    deepStrictEqual(got, Array.from({ length: 30 }, (_, i) => i + 1));
    deepStrictEqual((await counter.get()).data().value, 30);
  });
  await check('concurrent merges to one document lose nothing', async () => {
    const r = orders.doc('m1');
    await r.set({});
    await Promise.all(Array.from({ length: 20 }, (_, i) => r.set({ [`k${i}`]: i }, { merge: true })));
    if (Object.keys((await r.get()).data()).length !== 20) throw new Error('a merge was lost');
  });
  await check('coupon marker pattern: only one of two racing transactions claims it', async () => {
    const marker = db.collection('couponRedemptions').doc('order-777');
    const claim = () => db.runTransaction(async (tx) => {
      if ((await tx.get(marker)).exists) return false;
      tx.create(marker, { code: 'X', orderId: '777' });
      return true;
    }, { maxAttempts: 50 });
    const results = await Promise.all([claim(), claim(), claim()]);
    deepStrictEqual(results.filter(Boolean).length, 1);
  });
  await check('a query inside a transaction (pay-on-delivery guard)', async () => {
    await orders.doc('pod1').set({ checkoutAttemptId: 'att-1', userId: 'u1' });
    const found = await db.runTransaction(async (tx) => ids(await tx.get(orders.where('checkoutAttemptId', '==', 'att-1').limit(5))));
    deepStrictEqual(found, ['pod1']);
  });

  console.log('\nImport rows (tableMap.toRow)');
  await check('the import and the shop build the same row', async () => {
    const doc = { userId: 'u5', createdAt: '2026-10-01T00:00:00.000Z', shipmentOpen: true };
    await orders.doc('same').set(doc);
    const [[shop]] = await pool.query("SELECT * FROM orders WHERE id = 'same'");
    const { row } = toRow('orders', 'same', doc);
    for (const [k, v] of Object.entries(row)) deepStrictEqual(shop[k], v, k);
  });
  await check('serializeDoc refuses an unconverted Firestore Timestamp', async () => {
    await throwsCode(async () => serializeDoc({ at: new (class Timestamp { constructor() { this.seconds = 1; } })() }));
  });
} finally {
  await pool.end();
  await admin.end();
  if (server) await server.stop();
}

console.log(failed ? `\n❌ ${failed} failed` : '\n✅ all passed');
process.exitCode = failed ? 1 : 0;
