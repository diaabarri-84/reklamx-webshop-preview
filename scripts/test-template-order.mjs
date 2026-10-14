#!/usr/bin/env node
// The owner's order of every design, his and the shop's — src/lib/templateOrder.ts.
//
//   node scripts/test-template-order.mjs
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'reklamx-tplorder-'));
await build({ entryPoints: [join(ROOT, 'src/lib/templateOrder.ts')], outfile: join(dir, 'o.mjs'), bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const { inOwnerOrder, offeredDesigns } = await import(pathToFileURL(join(dir, 'o.mjs')).href);
rmSync(dir, { recursive: true, force: true });

let failed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ✅ ${name}`);
  else { failed += 1; console.error(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`); }
};
const own = (id) => ({ id, own: true });
const shop = (id) => ({ id, own: false });
const ids = (list) => list.map((x) => x.id);
const order = (items, saved) => ids(inOwnerOrder(items, (x) => x.id, (x) => x.own, saved));

console.log('\n== his order of every design ==\n');
check('never arranged: as they come (his first, then the shop\'s)', order([own('a'), own('b'), shop('s1'), shop('s2')], undefined), ['a', 'b', 's1', 's2']);
check('arranged: exactly his order, his and the shop\'s mixed', order([own('a'), own('b'), shop('s1'), shop('s2')], ['s2', 'a', 's1', 'b']), ['s2', 'a', 's1', 'b']);
check('a template of his made SINCE he arranged them comes first — not below every shop design',
  order([own('new'), own('a'), shop('s1'), shop('s2')], ['s1', 's2', 'a']), ['new', 's1', 's2', 'a']);
check('…two new ones keep the order they came in', order([own('n1'), own('n2'), shop('s1')], ['s1']), ['n1', 'n2', 's1']);
check('a shop design the order never saw (an update) comes last: his arrangement stands',
  order([own('a'), shop('s1'), shop('s-new')], ['a', 's1']), ['a', 's1', 's-new']);
check('ids in the order that no longer exist change nothing', order([own('a'), shop('s1')], ['gone', 's1', 'deleted', 'a']), ['s1', 'a']);

console.log('\n== what a customer is offered: the gallery AND the studio\'s Designs panel ==\n');
const tpl = (id, sortOrder, fits = true) => ({ id, sortOrder, fits });
const starter = (id) => ({ id });
const offered = (over) => offeredDesigns({
  templates: [tpl('t2', 2), tpl('t1', 1), tpl('big', 0, false)],
  fits: (x) => x.fits,
  starters: [starter('starter-a'), starter('starter-b'), starter('starter-c')],
  startersOn: true,
  hidden: [],
  order: undefined,
  ...over,
}).map((d) => `${d.type}:${d.id}`);
check('his templates that fit (by their sortOrder), then the shop\'s own', offered({}), ['shop:t1', 'shop:t2', 'starter:starter-a', 'starter:starter-b', 'starter:starter-c']);
check('none he hid — his or the shop\'s', offered({ hidden: ['starter-b', 't2'] }), ['shop:t1', 'starter:starter-a', 'starter:starter-c']);
check('the shop\'s own switched off: only his', offered({ startersOn: false }), ['shop:t1', 'shop:t2']);
check('in his order, a new template of his first', offered({ order: ['starter-c', 't2', 'starter-a', 'starter-b'] }), ['shop:t1', 'starter:starter-c', 'shop:t2', 'starter:starter-a', 'starter:starter-b']);
check('the list could not be had (null): the shop\'s own still offered', offeredDesigns({ templates: null, fits: () => true, starters: [starter('s')], startersOn: true, hidden: null, order: null }).map((d) => d.id), ['s']);

console.log(failed ? `\n❌ ${failed} check(s) failed\n` : '\n✅ the owner\'s order holds\n');
process.exit(failed ? 1 : 0);
