#!/usr/bin/env node
// The content type an upload is stored as (src/lib/uploadFile.ts, storedContentType).
//
// WHY IT EXISTS
// The bucket (storage.rules) takes a customer's file only as image/*,
// application/pdf or application/postscript. Browsers hand back an empty type
// for .eps, .ai and .psd — or a name of their own — and that used to be stored
// as application/octet-stream: the bucket refused a perfectly good print file,
// and the product page read the refusal as "storage is down" (code review
// WEB-04). The extension decides now, whenever the stated type will not do.
//
// Usage:  node scripts/test-upload-type.mjs

import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'reklamx-upload-type-'));
const out = join(dir, 'u.mjs');
// The module starts Firebase on import; nothing here needs it — stand-ins only.
const stubs = {
  name: 'firebase-stubs',
  setup(b) {
    b.onResolve({ filter: /^firebase\/|^\.\.\/firebase$/ }, (args) => ({ path: args.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: ['getApp', 'connectStorageEmulator', 'deleteObject', 'getStorage', 'ref', 'uploadBytesResumable', 'getDownloadURL']
        .map((n) => `export const ${n} = () => { throw new Error('${n}: not in a unit test'); };`).join('\n'),
      loader: 'js',
    }));
  },
};
await build({
  entryPoints: [join(ROOT, 'src/lib/uploadFile.ts')], outfile: out, bundle: true, format: 'esm', platform: 'node',
  logLevel: 'silent', plugins: [stubs],
});
const u = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });

let failed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ✅ ${name}`);
  else { failed += 1; console.error(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`); }
};
const type = u.storedContentType;

console.log('\n== a type the bucket takes is kept ==\n');
check('a PDF the browser named', type('card.pdf', undefined, 'application/pdf'), 'application/pdf');
check('a picture the browser named', type('photo.jpg', undefined, 'image/jpeg'), 'image/jpeg');
check('the caller\'s type before the browser\'s', type('logo.ai', 'application/postscript', 'application/illustrator'), 'application/postscript');
check('…and the browser\'s when the caller\'s will not do', type('logo.eps', 'application/eps', 'image/x-eps'), 'image/x-eps');
check('a type written in capitals is still the same type', type('photo.png', undefined, 'IMAGE/PNG'), 'image/png');

console.log('\n== no type, or one the bucket refuses: the extension decides ==\n');
check('an EPS with no type (Chrome, Safari)', type('logo.eps', undefined, ''), 'application/postscript');
check('an AI the browser calls application/illustrator', type('logo.AI', undefined, 'application/illustrator'), 'application/postscript');
check('an EPS called application/eps', type('logo.eps', 'application/eps', 'application/eps'), 'application/postscript');
check('a PSD with no type', type('layers.psd', undefined, ''), 'image/vnd.adobe.photoshop');
check('a PDF sent as octet-stream', type('card.pdf', undefined, 'application/octet-stream'), 'application/pdf');
check('a TIFF with no type', type('scan.tiff', null, ''), 'image/tiff');

console.log('\n== nothing to go on: as stated, else octet-stream (the bucket says no, as before) ==\n');
check('an unknown extension keeps the stated type (a public upload may be anything)', type('clip.mp4', 'video/mp4', 'video/mp4'), 'video/mp4');
check('no extension and no type', type('README', undefined, ''), 'application/octet-stream');
check('a name that is a prototype key is not a content type', type('x.constructor', undefined, ''), 'application/octet-stream');

console.log('\n== the formats ArtworkUploadBox offers ==\n');
check('every one maps to a type the bucket takes',
  Object.entries(u.ARTWORK_CONTENT_TYPES).filter(([, t]) => !(t.startsWith('image/') || t === 'application/pdf' || t === 'application/postscript')).map(([e]) => e), []);
check('eps, ai and psd are among them', ['eps', 'ai', 'psd'].every((e) => e in u.ARTWORK_CONTENT_TYPES), true);

console.log(failed ? `\n❌ ${failed} check(s) failed\n` : '\n✅ all upload-type checks passed\n');
process.exit(failed ? 1 : 0);
