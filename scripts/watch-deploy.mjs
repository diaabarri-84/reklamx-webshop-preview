#!/usr/bin/env node
// Is the new bundle live yet? — a check that does not depend on the deploy script.
//
// WHY IT EXISTS. On 2026-09-13 cpanel-deploy.sh reported a FAILED deploy that had
// in fact succeeded: its verify is a curl against a host that times out on about
// one request in five, and under `set -euo pipefail` an empty answer killed the
// script before it printed anything. The launcher then told the operator the host
// still had the old code, which was false — and the first thing that sentence
// makes a worried person do is roll back.
//
// So this asks the live page directly, on its own, and keeps asking. It has since
// answered the question twice, both times before the deploy script did: the new
// bundle appeared on attempt 2 once and attempt 6 another time.
//
//   node scripts/watch-deploy.mjs index-BGksAFOP.js
//
// The hash is the one `npm run build` just produced:
//   ls dist/assets/index-*.js | xargs basename
const WANT = process.argv[2] || 'index-BGksAFOP.js';
for (let i = 1; i <= 14; i += 1) {
  const t0 = Date.now();
  try {
    const res = await fetch('https://shop.reklamx.se/?cb=' + Date.now(), { signal: AbortSignal.timeout(45000) });
    const html = await res.text();
    const hit = html.match(/assets\/(index-[A-Za-z0-9_-]+\.js)/);
    const ms = Date.now() - t0;
    if (hit && hit[1] === WANT) { console.log(`✅ الجديد بقى حي — ${hit[1]} (محاولة ${i}، ${ms}ms)`); break; }
    console.log(`   محاولة ${i}: ${res.status} · ${ms}ms · ${hit ? hit[1] + ' (لسه القديم)' : 'مفيش bundle'}`);
  } catch (e) {
    console.log(`   محاولة ${i}: فشلت بعد ${Date.now() - t0}ms`);
  }
  if (i < 14) await new Promise((r) => setTimeout(r, 25000));
}
