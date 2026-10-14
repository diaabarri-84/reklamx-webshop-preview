// The dashboard's revenue goal as he types it (src/lib/goalAmount.ts): "100,000"
// was saved as 100 kronor, and "1.000.000" as nothing — which deleted the goal.
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'goal-amount-'));
await build({ entryPoints: [join(ROOT, 'src/lib/goalAmount.ts')], outfile: join(tmp, 'g.mjs'), bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const { parseGoalAmount } = await import(pathToFileURL(join(tmp, 'g.mjs')).href);
rmSync(tmp, { recursive: true, force: true });

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}${ok ? '' : `\n       ${detail}`}`);
  if (!ok) failed++;
};
const cases = [
  ['50000', 50000],
  ['50 000', 50000],
  ['50 000 kr', 50000],
  ['100,000', 100000],
  ['1.000.000', 1000000],
  ['1,000,000 SEK', 1000000],
  ['20000,50', 20000],
  ['', 0],
  ['0', 0],
  ['abc', null],
  ['-500', null],
  ['5e4', null],
];
for (const [typed, want] of cases) {
  const got = parseGoalAmount(typed);
  check(`"${typed}" → ${want === null ? 'not an amount' : want}`, got === want, `got ${got}`);
}
console.log(failed ? `\n❌ ${failed} failed` : '\n✅ all passed');
process.exit(failed ? 1 : 0);
