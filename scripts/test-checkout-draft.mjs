#!/usr/bin/env node
// The half-typed checkout, and when it must be forgotten — src/lib/checkoutDraft.ts.
//
// WHY IT EXISTS. CheckoutPage wrote the customer's name, company, organisation
// number, full address, both e-mail addresses, telephone and free-text comments
// to localStorage on every keystroke, and deleted it in exactly ONE place: after
// a payment was CONFIRMED. A customer who filled the form in and did not pay left
// all of that in the browser indefinitely — and on a shared machine, the next
// person to open the checkout found it typed in for them. The cookie policy did
// not disclose the key at all.
//
// Usage:  node scripts/test-checkout-draft.mjs

import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), 'reklamx-draft-'));
const out = join(outDir, 'checkoutDraft.mjs');
await build({
  entryPoints: [join(ROOT, 'src', 'lib', 'checkoutDraft.ts')],
  outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
});
const {
  draftIsFresh, draftHasPersonalData, stampDraft, DRAFT_TTL_HOURS, CHECKOUT_DRAFT_KEY,
  podAttemptIdFor, notePodAttemptOrder, forgetPodAttemptOf, POD_ATTEMPT_KEY, clearCheckoutDraft,
} = await import(pathToFileURL(out).href);
rmSync(outDir, { recursive: true, force: true });

let failed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) console.log(`  ✅ ${name}`);
  else { failed += 1; console.error(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`); }
};

const NOW = Date.parse('2026-09-13T12:00:00.000Z');
const ago = (hours) => new Date(NOW - hours * 3600_000).toISOString();

console.log('\ndraftIsFresh — the recall stays, the permanence goes');
check('typed a minute ago', draftIsFresh({ savedAt: ago(0.02) }, NOW), true);
check('typed an hour ago — a failed card must not cost an address twice',
  draftIsFresh({ savedAt: ago(1) }, NOW), true);
check(`${DRAFT_TTL_HOURS} hours less a minute is still fresh`,
  draftIsFresh({ savedAt: ago(DRAFT_TTL_HOURS - 0.02) }, NOW), true);
check('a day later it is a stranger’s leftovers', draftIsFresh({ savedAt: ago(DRAFT_TTL_HOURS + 1) }, NOW), false);
check('a month later, certainly', draftIsFresh({ savedAt: ago(24 * 30) }, NOW), false);

// The dangerous case: everything already in every customer's browser today was
// written without a timestamp. There is no way to tell a five-minute-old one
// from a five-month-old one, and the safe reading is to drop it.
check('a draft with NO timestamp is refused — that is every draft written until today',
  draftIsFresh({ firstName: 'Anna', email: 'a@b.se' }, NOW), false);
check('a clock set forward is stale, not fresh', draftIsFresh({ savedAt: ago(-5) }, NOW), false);
check('an unreadable timestamp is refused', draftIsFresh({ savedAt: 'yesterday' }, NOW), false);
check('and so are null, undefined and nonsense',
  [draftIsFresh(null, NOW), draftIsFresh(undefined, NOW), draftIsFresh('x', NOW), draftIsFresh(42, NOW)],
  [false, false, false, false]);

console.log('\ndraftHasPersonalData — an empty form leaves nothing behind');
// The effect runs on mount, so an empty form used to write an empty draft on
// every single visit to the checkout.
check('a form nobody has typed in holds nothing',
  draftHasPersonalData({ company: '', firstName: '', email: '', country: 'Sverige' }), false);
check('a country alone is not personal data — it is the default',
  draftHasPersonalData({ country: 'Sverige', isBusiness: false }), false);
check('a first name is', draftHasPersonalData({ firstName: 'Anna' }), true);
check('an e-mail is', draftHasPersonalData({ email: 'anna@example.se' }), true);
check('a telephone is', draftHasPersonalData({ phone: '+46 70 123 45 67' }), true);
check('a street is', draftHasPersonalData({ address1: 'Storgatan 1' }), true);
check('a company and an org number are', 
  [draftHasPersonalData({ company: 'AB' }), draftHasPersonalData({ taxId: 'SE556…' })], [true, true]);
check('whitespace is not', draftHasPersonalData({ firstName: '   ' }), false);
check('and neither is nothing at all',
  [draftHasPersonalData(null), draftHasPersonalData({})], [false, false]);

console.log('\nstampDraft — every stored draft can say how old it is');
const stamped = stampDraft({ firstName: 'Anna', email: 'a@b.se' }, ago(0));
check('the fields survive', [stamped.firstName, stamped.email], ['Anna', 'a@b.se']);
check('and it is now datable', draftIsFresh(stamped, NOW), true);
check('the key is the one the checkout has always used — nothing is orphaned',
  CHECKOUT_DRAFT_KEY, 'reklamx_checkout_form');

console.log('\nclearCheckoutDraft — signing out on a shared computer takes the form with it');
{
  const m = new Map([[CHECKOUT_DRAFT_KEY, JSON.stringify(stampDraft({ firstName: 'Anna' }, ago(0)))], ['reklamx_cart', '[1]']]);
  clearCheckoutDraft({ removeItem: (k) => void m.delete(k) });
  check('the draft is gone at once — not a day later — and nothing else is touched (the basket stays)',
    [m.has(CHECKOUT_DRAFT_KEY), m.get('reklamx_cart')], [false, '[1]']);
  let threw = false;
  try {
    clearCheckoutDraft({ removeItem: () => { throw new Error('denied'); } });
    clearCheckoutDraft(null);
  } catch {
    threw = true;
  }
  check('a storage that refuses, or none at all: nothing throws (the sign-out goes on)', threw, false);
}

// ---------------------------------------------------------------------------
// The tab's pay-on-delivery attempt (code review 2026-10-11, REVIEW-3 #1). It was
// forgotten at the checkout's answer while the basket stayed full until the order
// page loaded: Back, or a slow order page, and Place order again made a second
// order that went straight into production.
console.log('\npay on delivery — one order per basket until the order page has it');
const tab = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    peek: () => (m.has(POD_ATTEMPT_KEY) ? JSON.parse(m.get(POD_ATTEMPT_KEY)) : null),
  };
};
let n = 0;
const fresh = () => `attempt${++n}`;
const BASKET = JSON.stringify([['prod-1', 50, [], null, null]]);
{
  const s = tab();
  const first = podAttemptIdFor(s, BASKET, fresh);
  check('the first press makes an attempt and keeps it for the tab', [first, s.peek()?.id], [first, first]);
  check('pressed again before any answer (a timeout): the same attempt', podAttemptIdFor(s, BASKET, fresh), first);
  notePodAttemptOrder(s, first, '202600123');
  check('the answer is NOTED on the attempt, not the end of it', s.peek(), { basket: BASKET, id: first, orderId: '202600123' });
  check('Back, or a slow order page, and Place order again: the same attempt — the server answers with the same order',
    podAttemptIdFor(s, BASKET, fresh), first);
  forgetPodAttemptOf(s, '202600999');
  check('another order\'s page leaves this attempt alone', s.peek()?.id, first);
  forgetPodAttemptOf(s, '202600123');
  check('its own order page, emptying the basket, ends it', s.peek(), null);
  const repeat = podAttemptIdFor(s, BASKET, fresh);
  check('…so the same basket ordered again afterwards is a NEW order (PAY-22)', repeat !== first && s.peek()?.id === repeat, true);
}
{
  const s = tab();
  const a = podAttemptIdFor(s, BASKET, fresh);
  notePodAttemptOrder(s, a, 'X1');
  const b = podAttemptIdFor(s, JSON.stringify([['prod-1', 100, [], null, null]]), fresh);
  check('a changed basket is a new attempt, and replaces the old one', b !== a && s.peek()?.id === b && s.peek()?.orderId === undefined, true);
  notePodAttemptOrder(s, a, 'X1');
  check('a late answer for the OLD attempt does not stamp the new one', s.peek()?.orderId, undefined);
  forgetPodAttemptOf(s, 'X1');
  check('…and the old order\'s page does not end the new basket\'s attempt (it names no order yet)', s.peek()?.id, b);
}
{
  // Storage refused (some private modes throw on every call): nothing breaks.
  const refusing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } };
  const id = podAttemptIdFor(refusing, BASKET, fresh);
  notePodAttemptOrder(refusing, id, 'X2');
  forgetPodAttemptOf(refusing, 'X2');
  check('storage refused: an attempt id all the same, and nothing throws', typeof id === 'string' && id.length > 0, true);
  check('no storage at all: the same', typeof podAttemptIdFor(null, BASKET, fresh) === 'string', true);
  const s = tab();
  s.setItem(POD_ATTEMPT_KEY, '{not json');
  check('an unreadable entry is replaced by a new attempt', podAttemptIdFor(s, BASKET, fresh) === s.peek()?.id, true);
}
check('the key is the one the checkout has always used', POD_ATTEMPT_KEY, 'reklamx_pod_attempt');

console.log(`\n${failed === 0 ? 'A half-typed checkout is remembered for a day, not for ever.' : `${failed} failing.`}`);
process.exit(failed === 0 ? 0 : 1);
