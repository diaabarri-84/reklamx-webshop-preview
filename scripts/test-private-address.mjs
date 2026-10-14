#!/usr/bin/env node
// The SSRF guard behind /api/admin/media/rehost — src/lib/privateAddress.ts.
//
// WHY IT EXISTS
// That endpoint fetches a URL the caller supplies. If this function is wrong,
// an admin session — or anyone who has taken one — can make the SERVER fetch
// 169.254.169.254 and read back whatever the cloud metadata service hands out,
// or reach the cPanel interface on 127.0.0.1 that is not exposed to the internet
// at all. Every case below is an address that must be refused, or one that must
// not be, and getting either wrong is a security bug rather than a bug.
//
// Usage:  node scripts/test-private-address.mjs
// Exit:   0 = every address is judged correctly

import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), 'reklamx-ssrf-'));
const outFile = join(outDir, 'privateAddress.mjs');
await build({
  entryPoints: [join(ROOT, 'src', 'lib', 'privateAddress.ts')],
  outfile: outFile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
});
const { isPrivateAddress } = await import(pathToFileURL(outFile).href);
rmSync(outDir, { recursive: true, force: true });

let failed = 0;
const check = (address, family, expected, why) => {
  const actual = isPrivateAddress(address, family);
  if (actual === expected) {
    console.log(`  ✅ ${expected ? 'refused' : 'allowed'}  ${address.padEnd(28)} ${why}`);
  } else {
    failed += 1;
    console.error(`  ❌ ${address.padEnd(28)} expected ${expected ? 'refused' : 'allowed'} — ${why}`);
  }
};

console.log('\nMUST BE REFUSED — IPv4');
check('127.0.0.1', 4, true, 'loopback');
check('127.1.2.3', 4, true, 'the whole 127/8 is loopback, not just .0.1');
check('0.0.0.0', 4, true, '"this network"');
check('10.0.0.7', 4, true, 'RFC1918');
check('192.168.1.1', 4, true, 'RFC1918');
check('172.16.0.1', 4, true, 'RFC1918, bottom of the range');
check('172.31.255.254', 4, true, 'RFC1918, top of the range');
check('169.254.169.254', 4, true, 'THE cloud metadata address');
check('169.254.0.1', 4, true, 'link-local');
check('100.64.0.1', 4, true, 'carrier-grade NAT');
check('192.0.0.1', 4, true, 'IETF protocol assignments');
check('198.18.0.1', 4, true, 'benchmarking range');
check('224.0.0.1', 4, true, 'multicast');
check('255.255.255.255', 4, true, 'broadcast');

console.log('\nMUST BE ALLOWED — IPv4 (refusing these would break real suppliers)');
check('8.8.8.8', 4, false, 'a public resolver');
check('172.15.0.1', 4, false, 'just BELOW the RFC1918 block');
check('172.32.0.1', 4, false, 'just ABOVE the RFC1918 block');
check('100.63.255.255', 4, false, 'just below carrier-grade NAT');
check('100.128.0.1', 4, false, 'just above carrier-grade NAT');
check('11.0.0.1', 4, false, 'adjacent to 10/8 but public');
check('192.167.1.1', 4, false, 'adjacent to 192.168/16 but public');
check('126.1.1.1', 4, false, 'adjacent to 127/8 but public');
check('1.0.0.1', 4, false, 'adjacent to 0/8 but public');
check('104.18.32.7', 4, false, 'a Cloudflare CDN address, where supplier images live');

console.log('\nMUST BE REFUSED — IPv6');
check('::1', 6, true, 'loopback');
check('::', 6, true, 'unspecified');
check('fe80::1', 6, true, 'link-local');
check('fc00::1', 6, true, 'unique local');
check('fd12:3456::1', 6, true, 'unique local');
check('::ffff:127.0.0.1', 6, true, 'IPv4 loopback written as IPv6');
check('::ffff:169.254.169.254', 6, true, 'the metadata address written as IPv6');
check('::ffff:7f00:1', 6, true, 'the same thing in hex — the form that gets missed');
check('::ffff:a9fe:a9fe', 6, true, 'metadata in hex');

console.log('\nMUST BE ALLOWED — IPv6');
check('2606:4700::1111', 6, false, 'a public Cloudflare address');
check('2001:4860:4860::8888', 6, false, 'a public Google address');
check('::ffff:8.8.8.8', 6, false, 'a public IPv4 address written as IPv6');

console.log('\nNOTHING TO TRUST');
check('', 4, true, 'an empty address is refused, not allowed by default');

console.log(`\n${failed === 0 ? 'Every address judged correctly.' : `${failed} wrong.`}`);
process.exit(failed === 0 ? 0 : 1);
