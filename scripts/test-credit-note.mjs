#!/usr/bin/env node
// Credit notes — src/lib/creditNote.ts.
//
// WHY IT EXISTS
// These are accounting documents. An invoice that has been issued cannot be
// edited or deleted under Swedish rules, so a refund becomes a second document
// carrying negative amounts, and its figures end up in the books.
//
// Two of the cases below are ways of getting it wrong that reconcile to nothing:
//
//   * `refundedAmount` on the order is CUMULATIVE. Refund 100 then 150 and it
//     reads 250 — a credit note for 250 the second time credits the customer 350
//     on paper against a 250 refund;
//   * a zero-rated order — reverse charge or export — has no VAT to give back,
//     and a 25% fallback would credit VAT that was never charged.
//
// Usage:  node scripts/test-credit-note.mjs
// Exit:   0 = every figure reconciles

import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), 'reklamx-credit-'));
const outFile = join(outDir, 'creditNote.mjs');
await build({
  entryPoints: [join(ROOT, 'src', 'lib', 'creditNote.ts')],
  outfile: outFile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
});
const { creditNoteAmountDue, creditNoteFigures, formatCreditNoteNumber } =
  await import(pathToFileURL(outFile).href);
rmSync(outDir, { recursive: true, force: true });

let failed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) console.log(`  ✅ ${name}`);
  else { failed += 1; console.error(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`); }
};
const ok = (name, cond, detail) => {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed += 1; console.error(`  ❌ ${name}${detail ? `\n       ${detail}` : ''}`); }
};

console.log('\ncreditNoteAmountDue — the increment, never the running total');
check('a first refund', creditNoteAmountDue(0, 100, 1000), 100);
// THE ONE THAT WOULD NOT RECONCILE.
check('a SECOND refund credits only the difference', creditNoteAmountDue(100, 250, 1000), 150);
check('a repeated webhook with no change is null', creditNoteAmountDue(250, 250, 1000), null);
check('nothing refunded at all is null', creditNoteAmountDue(0, 0, 1000), null);
check('a figure that went DOWN is null, not a negative note', creditNoteAmountDue(250, 100, 1000), null);
check('a full refund', creditNoteAmountDue(0, 1000, 1000), 1000);
check('a refund larger than the order is capped at the order', creditNoteAmountDue(0, 1500, 1000), 1000);
check('and capped against what is already credited', creditNoteAmountDue(900, 1500, 1000), 100);
check('once the order is fully credited, nothing more is due', creditNoteAmountDue(1000, 1200, 1000), null);
check('öre are kept', creditNoteAmountDue(0, 12.34, 1000), 12.34);
check('nonsense in is null out', creditNoteAmountDue('x', 'y', 'z'), null);

console.log('\ncreditNoteFigures — the split comes from the ORDER');
const order25 = { grossTotal: 1250, netTotal: 1000, vatAmount: 250, vatRate: 0.25 };
let f = creditNoteFigures(order25, 1250);
check('a full refund of a 25% order', [f.gross, f.net, f.vat], [1250, 1000, 250]);
ok('and it reconciles', f.net + f.vat === f.gross, JSON.stringify(f));
f = creditNoteFigures(order25, 500);
check('a partial refund splits in the same proportion', [f.gross, f.net, f.vat], [500, 400, 100]);
ok('and reconciles too', f.net + f.vat === f.gross);

// A 6% order refunded years later must return 6%, whatever the rate is by then.
const order6 = { grossTotal: 1060, netTotal: 1000, vatAmount: 60, vatRate: 0.06 };
f = creditNoteFigures(order6, 1060);
check('a 6% order returns 6% VAT, not today\'s rate', [f.net, f.vat], [1000, 60]);

console.log('\nTHE ZERO-RATED ORDER — reverse charge or export');
const reverse = { grossTotal: 1000, netTotal: 1000, vatAmount: 0, vatRate: 0 };
f = creditNoteFigures(reverse, 1000);
check('no VAT was charged, so none is credited', [f.gross, f.net, f.vat], [1000, 1000, 0]);
const exportNoBreakdown = { grossTotal: 1000, vatRate: 0 };
f = creditNoteFigures(exportNoBreakdown, 1000);
ok('…even with no stored breakdown, the 25% fallback must NOT apply', f.vat === 0, JSON.stringify(f));

console.log('\norders written before the breakdown existed');
f = creditNoteFigures({ grossTotal: 1250, vatRate: 0.25 }, 1250);
check('derived from the rate on the order', [f.net, f.vat], [1000, 250]);
f = creditNoteFigures({ grossTotal: 1250 }, 1250, 0.25);
check('and from the caller\'s fallback when even that is missing', [f.net, f.vat], [1000, 250]);

console.log('\ncorrupt stored figures cannot produce an impossible document');
f = creditNoteFigures({ grossTotal: 100, netTotal: 10, vatAmount: 500 }, 100);
ok('VAT can never exceed the total', f.vat <= f.gross, JSON.stringify(f));
ok('and net is never negative', f.net >= 0, JSON.stringify(f));
f = creditNoteFigures({ grossTotal: 100, netTotal: 80, vatAmount: -20 }, 100);
ok('a negative stored VAT does not become a negative credit', f.vat >= 0, JSON.stringify(f));
f = creditNoteFigures(order25, -50);
check('a negative refund is clamped to zero', [f.gross, f.net, f.vat], [0, 0, 0]);

console.log('\nnumbering — its own series, never a reused order number');
check('the shape', formatCreditNoteNumber(2026, 1), 'K202600001');
check('it pads', formatCreditNoteNumber(2026, 42), 'K202600042');
check('and keeps going past five digits', formatCreditNoteNumber(2026, 123456), 'K2026123456');
ok('it can never collide with an order number, which has no prefix',
  !/^\d/.test(formatCreditNoteNumber(2026, 1)));

console.log(`\n${failed === 0 ? 'Every credit-note figure reconciles.' : `${failed} failing.`}`);
process.exit(failed === 0 ? 0 : 1);
