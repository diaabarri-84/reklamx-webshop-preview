#!/usr/bin/env node
// Does every admin endpoint actually refuse an unauthenticated caller?
//
// WHY IT EXISTS
// On 2026-09-12 /api/admin/suppliers/:supplier/test answered 502 instead of 401.
// Its catch block turned EVERY error into a bad-gateway response — including the
// 401 that requireAdmin throws — so the wrong status was the small half of the
// problem. The large half was that the fetch inside it had already run: anyone
// on the internet could make this server hammer a supplier by hitting the URL in
// a loop.
//
// The shape of that bug is invisible in a diff and trivial to reintroduce, since
// `catch (err) { res.status(502) }` reads as careful error handling. So it is
// checked statically, on every `npm run verify`, without needing a server.
//
// Usage:  node scripts/test-admin-auth.mjs
// Exit:   0 = every admin route lets requireAdmin's status through

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const lines = readFileSync(join(ROOT, 'server.ts'), 'utf8').split('\n');

// A route may delegate to the shared handler instead of checking inline. That is
// the BETTER shape — it also stops raw driver errors reaching the browser — but
// it only counts if the handler itself passes the status through, so that is
// asserted first. Otherwise this test would bless a helper that quietly stopped.
const source = lines.join('\n');
const helper = /function adminError\(res: express\.Response, err: any, fallback: string\) \{([\s\S]*?)\n\}/.exec(source);
if (!helper) {
  console.error('\n  ❌ adminError() is gone — routes that delegated to it now answer whatever it used to.');
  process.exit(1);
}
if (!/err\?\.status|err\.status/.test(helper[1])) {
  console.error('\n  ❌ adminError() no longer passes the auth status through — every route using it is now open.');
  process.exit(1);
}

const offenders = [];
let checked = 0;

for (let i = 0; i < lines.length; i += 1) {
  const m = /^app\.(get|post|put|delete|patch)\('([^']+)'/.exec(lines[i]);
  if (!m) continue;
  // The route ends at the first `});` in column zero.
  let end = i + 1;
  while (end < lines.length && lines[end] !== '});') end += 1;
  const block = lines.slice(i, end + 1).join('\n');
  if (!/requireAdmin\(/.test(block)) continue;

  checked += 1;
  // requireAdmin throws `Object.assign(new Error(…), { status })`. A catch that
  // never reads that status cannot answer 401, whatever else it does.
  if (!/err\?\.status|err\.status/.test(block) && !/adminError\(res, err/.test(block)) {
    offenders.push({ route: `${m[1].toUpperCase()} ${m[2]}`, line: i + 1 });
  }
}

console.log(`\n${checked} admin route(s) checked.\n`);
if (offenders.length === 0) {
  console.log('  ✅ every one lets requireAdmin\'s status reach the caller');
  console.log('  ✅ and adminError(), which most of them delegate to, still passes it through');
  console.log('\nEvery admin route refuses an unauthenticated caller.');
  process.exit(0);
}
for (const o of offenders) {
  console.error(`  ❌ ${o.route}  (server.ts:${o.line}) — its catch swallows the auth status`);
}
console.error(`\n${offenders.length} route(s) would answer something other than 401 to a stranger.`);
process.exit(1);
