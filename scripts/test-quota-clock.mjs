// When the free database's daily reads come back (src/lib/quotaClock.ts): midnight
// in California, Google's quota day — what the signed-in owner is told while his
// profile cannot be read. 09:00 in Stockholm in summer AND winter.
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'quota-clock-'));
await build({ entryPoints: [join(ROOT, 'src/lib/quotaClock.ts')], outfile: join(tmp, 'q.mjs'), bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const { nextPacificMidnight } = await import(pathToFileURL(join(tmp, 'q.mjs')).href);
rmSync(tmp, { recursive: true, force: true });

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}${ok ? '' : `\n       ${detail}`}`);
  if (!ok) failed++;
};
const stockholm = (d) => d.toLocaleTimeString('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit' });
const cases = [
  ['2026-10-07T06:50:00Z', '2026-10-07T07:00:00.000Z', 'summer, ten minutes before'],
  ['2026-10-07T07:00:01Z', '2026-10-08T07:00:00.000Z', 'summer, just after: tomorrow'],
  ['2026-10-06T19:58:00Z', '2026-10-07T07:00:00.000Z', 'the evening it ran out'],
  ['2026-12-15T07:30:00Z', '2026-12-15T08:00:00.000Z', 'winter'],
  ['2027-03-08T09:00:00Z', '2027-03-09T08:00:00.000Z', 'winter, before America moves its clocks'],
];
for (const [now, want, what] of cases) {
  const got = nextPacificMidnight(new Date(now));
  check(`${what}: ${now} → ${want} (${stockholm(got)} in Stockholm)`, got.toISOString() === want && stockholm(got) === '09:00', got.toISOString());
}
console.log(failed ? `\n❌ ${failed} failed` : '\n✅ all passed');
process.exit(failed ? 1 : 0);
