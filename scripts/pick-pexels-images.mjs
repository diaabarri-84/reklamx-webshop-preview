#!/usr/bin/env node
// CANDIDATE PHOTOS FROM PEXELS, one search per place on the site that shows a
// stock picture — worded after the text beside that picture, so the photo
// says what the words say.
//
//   node scripts/pick-pexels-images.mjs [out.json] [contact-sheet.html]
//
// Reads VITE_PEXELS_API_KEY (or PEXELS_API_KEY) from .env. Writes the top
// candidates per place, and a contact sheet to look at them side by side. The
// chosen URLs are then written into the defaults by hand: the shop never calls
// Pexels at run time, so the key never reaches a browser and no visitor waits
// on a third-party API. Pexels photos are free to use, attribution appreciated
// but not required (pexels.com/license).
import { readFileSync, writeFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const KEY = process.env.PEXELS_API_KEY || env.PEXELS_API_KEY || env.VITE_PEXELS_API_KEY;
if (!KEY) { console.error('No Pexels key in .env (VITE_PEXELS_API_KEY).'); process.exit(1); }
const [out = 'pexels-candidates.json', sheet = 'pexels-candidates.html'] = process.argv.slice(2);

// place → [what the text next to it says, the search, orientation]
const PLACES = {
  'hero.s1 Roll-up — "Seen from the very first step"': ['roll up banner stand', 'portrait'],
  'hero.s2 Trade show — "Your stand, ready to build"': ['trade show booth exhibition', 'portrait'],
  'hero.s3 Labels on roll — "Straight into the machine"': ['sticker label roll', 'portrait'],
  'hero.s4 Packaging — "Boxes worth keeping"': ['luxury gift box packaging', 'portrait'],
  'bento.b1 Gift boxes': ['gift boxes ribbon', 'portrait'],
  'bento.b2 Custom labels': ['product labels jars', 'portrait'],
  'bento.b3 Exhibition stands': ['exhibition stand expo hall', 'portrait'],
  'bento.b4 Paper cups': ['paper coffee cup takeaway', 'portrait'],
  'bento.b5 Doypacks': ['stand up pouch packaging', 'portrait'],
  'bento.b6 Illuminated signs': ['illuminated shop sign night', 'portrait'],
  'news.rollup Roll-ups ready for the trade show': ['roll up banner exhibition', 'landscape'],
  'news.pos Six new POS display models': ['cardboard display stand retail store', 'landscape'],
  'news.autumn Autumn retail campaigns': ['autumn sale shop window', 'landscape'],
  'services.srv-1 Digital & offset printing': ['offset printing press', 'landscape'],
  'services.srv-2 Packaging & rigid boxes': ['custom packaging boxes', 'landscape'],
  'services.srv-3 Large format banners & event displays': ['large format printer', 'landscape'],
  'services.srv-4 Labels, stickers & roll printing': ['label printing machine', 'landscape'],
  'services.srv-5 Upload & prepress check': ['graphic designer print proof', 'landscape'],
  'services.srv-6 Delivery & shipping': ['parcel delivery boxes', 'landscape'],
  'about.banner The print shop': ['printing press workshop', 'landscape'],
  'home.gallery Find inspiration — signage': ['shop signage storefront', 'landscape'],
  'home.gallery Custom packaging': ['branded packaging boxes', 'landscape'],
  'home.gallery Storefront signage': ['storefront poster window display', 'landscape'],
};

const results = {};
for (const [place, [query, orientation]] of Object.entries(PLACES)) {
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&orientation=${orientation}&per_page=8`;
  const res = await fetch(url, { headers: { Authorization: KEY } });
  if (!res.ok) { console.error(`${place}: ${res.status}`); continue; }
  const { photos = [] } = await res.json();
  results[place] = {
    query,
    candidates: photos.map((p) => ({
      id: p.id,
      alt: p.alt,
      photographer: p.photographer,
      page: p.url,
      thumb: p.src.medium,
      // The form written into the defaults: Pexels' own CDN, resized on request.
      url: `https://images.pexels.com/photos/${p.id}/pexels-photo-${p.id}.jpeg?auto=compress&cs=tinysrgb&w=1600`,
    })),
  };
  console.log(`${place}: ${photos.length}`);
}
writeFileSync(out, JSON.stringify(results, null, 2));

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
writeFileSync(sheet, `<!doctype html><meta charset="utf-8"><style>
body{font:12px system-ui;margin:12px;background:#fff}h2{font-size:14px;margin:16px 0 4px}
.row{display:flex;gap:6px}.c{width:150px}.c img{width:150px;height:110px;object-fit:cover;border-radius:6px;display:block}
.c b{font-size:11px}.c span{font-size:10px;color:#555;display:block;height:26px;overflow:hidden}</style>
${Object.entries(results).map(([place, r]) => `<h2>${esc(place)} <small>(${esc(r.query)})</small></h2><div class="row">${
  r.candidates.map((c, i) => `<div class="c"><img src="${c.thumb}"><b>${i} · ${c.id}</b><span>${esc(c.alt)}</span></div>`).join('')}</div>`).join('')}`);
console.log(`wrote ${out} and ${sheet}`);
