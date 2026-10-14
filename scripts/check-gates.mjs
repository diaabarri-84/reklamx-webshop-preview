#!/usr/bin/env node
// Did the gates actually pass? — the check that checks the checking.
//
// WHY IT EXISTS, and it is a mistake I made and shipped towards a deploy.
//
// I had been verifying like this:
//
//     npx tsc --noEmit 2>&1 | head -3 && echo "✅"
//
// A pipeline's exit status is the LAST command's, so `head` succeeding made the
// whole thing succeed, `&&` fired, and a green tick was printed over a compiler
// that had crashed. I did it more than once, saw `throw e` scroll past, and read
// the tick instead. The deploy's own `npm run verify` then refused — correctly —
// and that refusal was the first honest signal in the whole sequence.
//
// The same trap applies to `| grep -c "❌"`: grep exits 1 when it matches
// nothing, and 0 when it finds failures. A count is not a verdict.
//
// So this runs each gate as a CHILD PROCESS and reads its exit code. Nothing is
// piped, nothing is grepped, and a crash cannot look like a pass.
//
//   node scripts/check-gates.mjs

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GATES = [
  ['typecheck', 'npm', ['run', 'typecheck']],
  ['i18n',      'npm', ['run', 'check:i18n']],
  ['dates',     'npm', ['run', 'check:dates']],
  ['units',     'npm', ['run', 'test:units']],
  ['build',     'npm', ['run', 'build']],
  ['rules',     'node', ['scripts/check-rules-compile.mjs']],
  // EXIT 2 MEANS "I COULD NOT LOOK", and it is counted as a failure on purpose —
  // see below. This gate needs a key and a network; without them it says so
  // rather than passing quietly.
  ['ai-models', 'node', ['scripts/check-ai-models.mjs']],
];

// "I could not look" is not "it passed". A gate that answers 2 is reported as
// NOT CHECKED and still counts against the run, because the alternative is a
// green board that means nothing — which is the exact failure this file exists
// to prevent. AI_PROBE_OPTIONAL=1 downgrades it to a warning, deliberately and
// visibly, for a machine with no key.
const PROBE_OPTIONAL = process.env.AI_PROBE_OPTIONAL === '1';

let failed = 0;
console.log('');
for (const [name, cmd, args] of GATES) {
  const t0 = Date.now();
  const out = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', shell: false });
  // `status` is null when the process was killed by a signal — which is a
  // failure, and `!== 0` would have called it one anyway; being explicit so the
  // reason is printed rather than guessed at.
  const code = out.status;
  const couldNotLook = code === 2 && name === 'ai-models';
  const okay = code === 0 || (couldNotLook && PROBE_OPTIONAL);
  if (!okay) failed += 1;
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const mark = code === 0 ? '✅' : couldNotLook ? '⏭ ' : '❌';
  const label = couldNotLook ? `${name} NOT CHECKED` : name;
  console.log(`  ${mark} ${label.padEnd(10)} exit=${code === null ? `signal ${out.signal}` : code}  ${secs}s`);
  if (code !== 0) {
    // The tail of what it actually said, because "it failed" is not a report.
    const text = `${out.stdout ?? ''}${out.stderr ?? ''}`.trimEnd().split('\n').slice(-12);
    for (const line of text) console.log(`       ${line}`);
  }
}

console.log(`\n${failed === 0 ? 'Every gate passed, by its exit code.' : `${failed} gate(s) FAILED.`}\n`);
process.exit(failed === 0 ? 0 : 1);
