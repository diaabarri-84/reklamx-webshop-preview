#!/usr/bin/env node
// Make the imported EasyGifts products DESIGNABLE in the local test shop.
//
// An import brings a supplier's products in as finished goods: no artwork step,
// no size, so "Design online" cannot appear. EasyGifts does say, per product,
// where and how big it can print — `markings`, e.g. "L1 (laser engraving)
// 5 x 0,6 cm" — and the shop's importer drops that. This puts it back, for
// testing: each product gets
//   * "Print area" — one option per supplier marking, its size as the option's
//     dimensions, so the designer opens at the supplier's real print area
//     (a round "ø 4 cm" one cut round);
//   * the catalogue's "Artwork supply method" — upload, or Design online;
//   * the artwork step switched on.
//
//   node scripts/local-e2e/make-supplier-designable.mjs
//
// Local only: writes to the Firestore EMULATOR (127.0.0.1:8085), nothing else.
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085';
process.env.GCLOUD_PROJECT = 'demo-reklamx';
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

const tmp = mkdtempSync(join(tmpdir(), 'reklamx-designable-'));
await build({ entryPoints: [join(ROOT, 'src/components/Admin/optionCatalogue.ts')], outfile: join(tmp, 'c.mjs'), bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const { OPTION_CATALOGUE } = await import(pathToFileURL(join(tmp, 'c.mjs')).href);
rmSync(tmp, { recursive: true, force: true });
const artworkMethod = { ...structuredClone(OPTION_CATALOGUE.find((f) => f.id === 'artwork_supply_method')), enabled: true };
delete artworkMethod.required;

console.log('▸ reading the EasyGifts feed for print areas…');
const feed = await (await fetch('https://easygifts.com.pl/data/webapi2/en/json/offer.json')).json();
const rows = Array.isArray(feed) ? feed : Object.values(feed);
const markingsByProduct = new Map();
for (const r of rows) {
  const key = String(r?.baseinfo?.code_short ?? '').trim();
  if (key && !markingsByProduct.has(key) && Array.isArray(r.markings) && r.markings.length) markingsByProduct.set(key, r.markings);
}

/** "5 x 0,6 cm" → { wMm: 50, hMm: 6 }; "ø 4 cm" → a 40 mm circle; anything else → null. */
function printSize(raw) {
  const s = String(raw ?? '').toLowerCase().replace(/,/g, '.');
  const unit = /\bmm\b/.test(s) ? 1 : 10;
  const nums = (s.match(/\d+(\.\d+)?/g) ?? []).map(Number).filter((n) => n > 0);
  if (/ø|⌀|fi\b|diam/.test(s) && nums.length >= 1) return { wMm: nums[0] * unit, hMm: nums[0] * unit, round: true };
  if (nums.length >= 2) return { wMm: nums[0] * unit, hMm: nums[1] * unit, round: false };
  return null;
}
const mm = (n) => String(Math.round(n * 10) / 10);

function printAreaField(productId, markings) {
  const options = [];
  for (const [i, m] of (markings ?? []).entries()) {
    const size = printSize(m.size);
    if (!size) continue;
    const label = `${String(m.name ?? m.code ?? 'Print').trim()} — ${String(m.size).trim()}`;
    options.push({
      id: `pa-${i}`, label, labelI18n: null, value: String(m.code ?? i), priceModifier: 0,
      dimensions: `${mm(size.wMm)} × ${mm(size.hMm)} mm`, ...(size.round ? { outline: 'circle' } : {}),
    });
  }
  if (!options.length) {
    options.push({ id: 'pa-std', label: 'Standard print area — 5 x 3 cm', labelI18n: null, value: 'std', priceModifier: 0, dimensions: '50 × 30 mm' });
  }
  options[0].isDefault = true;
  return {
    id: `print-area-${productId}`, name: 'Print area', nameI18n: { sv: 'Tryckyta', da: 'Trykområde', no: 'Trykkområde' },
    group: 'default', enabled: true, display: 'cards', options,
  };
}

const { initializeApp } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const db = getFirestore(initializeApp({ projectId: 'demo-reklamx' }, 'designable'));
const snap = await db.collection('products').get();
const targets = snap.docs.filter((d) => d.id.startsWith('prod-easygifts-'));
let fromSupplier = 0;
for (let i = 0; i < targets.length; i += 400) {
  const batch = db.batch();
  for (const d of targets.slice(i, i + 400)) {
    const p = d.data();
    const key = String(p.supplierOfferId ?? d.id.replace('prod-easygifts-', ''));
    const markings = markingsByProduct.get(key);
    if (markings) fromSupplier++;
    const keep = (p.printingFields ?? []).filter((f) => !String(f.id).startsWith('print-area-') && f.id !== 'artwork_supply_method');
    batch.update(d.ref, {
      printingFields: [...keep, printAreaField(d.id, markings), artworkMethod],
      artworkEnabled: true, artworkRequired: false, onlineDesign: true, isWeb2Print: true,
      customUploadRules: { ...(p.customUploadRules ?? {}), enabled: true, areaPriced: false, allowedFormats: ['pdf', 'png', 'jpg', 'jpeg', 'svg', 'ai', 'eps'], maxFileSizeMb: 100 },
    });
  }
  await batch.commit();
}
console.log(`✓ ${targets.length} products designable — ${fromSupplier} with the supplier's own print areas, ${targets.length - fromSupplier} with a standard 5 × 3 cm area`);
process.exit(0);
