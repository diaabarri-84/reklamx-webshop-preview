// The home page's section order (src/lib/homeSections.ts): his order kept, unknown
// ids dropped, duplicates once, a section he never placed added at the end.
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'home-sections-'));
await build({ entryPoints: [join(ROOT, 'src/lib/homeSections.ts')], outfile: join(tmp, 'h.mjs'), bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const { homeSectionOrder, HOME_SECTIONS } = await import(pathToFileURL(join(tmp, 'h.mjs')).href);
rmSync(tmp, { recursive: true, force: true });

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}${ok ? '' : `\n       ${detail}`}`);
  if (!ok) failed++;
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
check('nothing saved: the page as it always was', eq(homeSectionOrder(undefined), [...HOME_SECTIONS]));
check('his order, whole', eq(homeSectionOrder(['news', 'hero', 'benefits', 'categories', 'inspiration']), ['news', 'hero', 'benefits', 'categories', 'inspiration']));
check('a section he never placed is added at the end, not lost', eq(homeSectionOrder(['news', 'hero']), ['news', 'hero', 'categories', 'benefits', 'inspiration']));
check('unknown ids and duplicates are dropped', eq(homeSectionOrder(['x', 'news', 'news', 7, null]), ['news', 'hero', 'categories', 'benefits', 'inspiration']));
check('not a list: the default', eq(homeSectionOrder('news,hero'), [...HOME_SECTIONS]));
console.log(failed ? `\n❌ ${failed} failed` : '\n✅ all passed');
process.exit(failed ? 1 : 0);
