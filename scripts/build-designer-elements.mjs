#!/usr/bin/env node
// The online designer's ELEMENTS library: shapes, lines, frames, badges, contact
// icons, social logos and emojis — built once, committed, loaded with the panel.
//
// Sources (pinned, fetched from unpkg; nothing is added to package.json):
//   simple-icons 16.34.0  — CC0 1.0           (social logos; LinkedIn is not in it)
//   lucide-static 1.52.0  — ISC               (contact and everyday icons)
//   @twemoji/svg 15.0.0   — graphics CC BY 4.0 (emojis; attribution shown in the panel)
//   shapes, lines, frames, badges — drawn here.
//
// EVERY SVG IS REBUILT FROM A WHITELIST: only shape elements (path, circle, ellipse,
// rect, polygon, polyline, line, g) and only geometry and paint attributes survive.
// No <style>, <use>, <image>, gradients, links, scripts or ids — the server's
// template cleaner refuses anything else, and an element must never carry a URL.
//
// EVERY ELEMENT HAS ITS NAME IN SWEDISH, DANISH AND NORWEGIAN too (NAMES below), with
// the words a customer searches for in his own language: a search for "hjärta" found
// nothing in a Swedish shop (code review DSN-20). A new element needs its names.
//
//   node scripts/build-designer-elements.mjs           — fetch, clean and name everything
//   node scripts/build-designer-elements.mjs --names   — only the names, into the library
//                                                        as it is (nothing downloaded)
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(join(ROOT, 'package.json'));
const { JSDOM } = require('jsdom');
const OUT = join(ROOT, 'src/components/product/designer/elementLibrary.json');
const { DOMParser, XMLSerializer } = new JSDOM('').window;

const SHAPE_TAGS = new Set(['path', 'circle', 'ellipse', 'rect', 'polygon', 'polyline', 'line', 'g']);
const GEOMETRY = ['d', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'width', 'height', 'points', 'x1', 'y1', 'x2', 'y2', 'transform'];
const PAINT = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'fill-rule', 'clip-rule', 'opacity', 'fill-opacity', 'stroke-opacity'];
const SAFE_VALUE = /^[-+0-9.eE ,#a-zA-Z()%]*$/; // numbers, colours, matrix(...), keywords — never a url( or a quote
const COLOUR = /^(#[0-9a-fA-F]{3,8}|none|black|white|currentColor)$/;

/** Rebuild an SVG from the whitelist. Throws on anything outside it (the element is then left out). */
function clean(svgText, { inherit = {}, colour = null } = {}) {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.tagName !== 'svg') throw new Error('not an svg');
  const viewBox = (root.getAttribute('viewBox') || '').trim();
  if (!/^[-0-9. ]+$/.test(viewBox) || viewBox.split(/\s+/).length !== 4) throw new Error('no viewBox');
  // Presentation attributes on the root are pushed down: a child keeps its own.
  const rootPaint = { ...inherit };
  for (const a of PAINT) if (root.hasAttribute(a)) rootPaint[a] = root.getAttribute(a);
  const parts = [];
  const walk = (el, paint) => {
    for (const child of el.children) {
      const tag = child.tagName;
      if (tag === 'title' || tag === 'desc') continue;
      if (!SHAPE_TAGS.has(tag)) throw new Error(`<${tag}> is not allowed`);
      const own = { ...paint };
      for (const a of PAINT) if (child.hasAttribute(a)) own[a] = child.getAttribute(a);
      if (tag === 'g') {
        if (child.hasAttribute('transform')) throw new Error('transformed group');
        walk(child, own);
        continue;
      }
      const attrs = [];
      for (const a of GEOMETRY) {
        if (!child.hasAttribute(a)) continue;
        const v = child.getAttribute(a);
        if (!SAFE_VALUE.test(v) || /url/i.test(v)) throw new Error(`unsafe ${a}`);
        attrs.push(`${a}="${v}"`);
      }
      for (const [a, raw] of Object.entries(own)) {
        let v = String(raw);
        if (colour && (a === 'fill' || a === 'stroke') && v === 'currentColor') v = colour;
        if ((a === 'fill' || a === 'stroke') && !COLOUR.test(v)) throw new Error(`paint ${a}=${v}`);
        if (!SAFE_VALUE.test(v) || /url/i.test(v)) throw new Error(`unsafe ${a}`);
        attrs.push(`${a}="${v}"`);
      }
      parts.push(`<${tag} ${attrs.join(' ')}/>`);
    }
  };
  walk(root, rootPaint);
  if (parts.length === 0) throw new Error('empty');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${parts.join('')}</svg>`;
}

const fetchText = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
};

// ---- the names in the shop's other languages: [label, ...search words] ----
// Social logos are brand names, the same in every language (their category's name,
// "Sociala medier" etc., is searched too).
const NAMES = {
  'icon-phone': { sv: ['Telefon', 'ringa', 'samtal'], da: ['Telefon', 'ringe', 'opkald'], no: ['Telefon', 'ringe', 'samtale'] },
  'icon-smartphone': { sv: ['Mobil', 'mobiltelefon', 'smartphone'], da: ['Mobil', 'mobiltelefon', 'smartphone'], no: ['Mobil', 'mobiltelefon', 'smarttelefon'] },
  'icon-mail': { sv: ['E-post', 'mejl', 'kuvert'], da: ['E-mail', 'mail', 'kuvert'], no: ['E-post', 'epost', 'konvolutt'] },
  'icon-at-sign': { sv: ['Snabel-a', 'e-post', 'mejl'], da: ['Snabel-a', 'e-mail', 'mail'], no: ['Krøllalfa', 'e-post', 'epost'] },
  'icon-globe': { sv: ['Webbplats', 'webb', 'internet', 'hemsida'], da: ['Hjemmeside', 'web', 'internet', 'website'], no: ['Nettside', 'nett', 'internett', 'hjemmeside'] },
  'icon-link': { sv: ['Länk', 'url', 'webbadress'], da: ['Link', 'url', 'webadresse'], no: ['Lenke', 'url', 'nettadresse'] },
  'icon-map-pin': { sv: ['Adress', 'plats', 'nål'], da: ['Adresse', 'sted', 'placering'], no: ['Adresse', 'sted', 'plassering'] },
  'icon-map': { sv: ['Karta', 'plats', 'vägbeskrivning'], da: ['Landkort', 'sted', 'vejvisning'], no: ['Kart', 'sted', 'veibeskrivelse'] },
  'icon-clock': { sv: ['Öppettider', 'tid', 'klocka'], da: ['Åbningstider', 'tid', 'ur'], no: ['Åpningstider', 'tid', 'klokke'] },
  'icon-calendar': { sv: ['Kalender', 'datum'], da: ['Kalender', 'dato'], no: ['Kalender', 'dato'] },
  'icon-user': { sv: ['Person', 'kontakt'], da: ['Person', 'kontakt'], no: ['Person', 'kontakt'] },
  'icon-users': { sv: ['Personer', 'team', 'grupp'], da: ['Personer', 'team', 'gruppe'], no: ['Personer', 'team', 'gruppe'] },
  'icon-building-2': { sv: ['Kontor', 'företag', 'byggnad'], da: ['Kontor', 'firma', 'virksomhed', 'bygning'], no: ['Kontor', 'firma', 'bedrift', 'bygning'] },
  'icon-house': { sv: ['Hem', 'hus', 'bostad'], da: ['Hjem', 'hus', 'bolig'], no: ['Hjem', 'hus', 'bolig'] },
  'icon-briefcase': { sv: ['Företag', 'arbete', 'jobb', 'portfölj'], da: ['Forretning', 'arbejde', 'job', 'mappe'], no: ['Forretning', 'arbeid', 'jobb', 'dokumentmappe', 'stresskoffert'] },
  'icon-store': { sv: ['Butik', 'affär'], da: ['Butik', 'forretning'], no: ['Butikk', 'forretning'] },
  'icon-shopping-cart': { sv: ['Kundvagn', 'handla', 'butik'], da: ['Indkøbsvogn', 'handle', 'butik', 'kurv'], no: ['Handlekurv', 'handle', 'butikk', 'vogn'] },
  'icon-truck': { sv: ['Leverans', 'frakt', 'lastbil'], da: ['Levering', 'fragt', 'lastbil'], no: ['Levering', 'frakt', 'lastebil'] },
  'icon-printer': { sv: ['Tryck', 'skrivare', 'utskrift'], da: ['Tryk', 'printer', 'udskrift'], no: ['Trykk', 'skriver', 'utskrift'] },
  'icon-wifi': { sv: ['Wi-Fi', 'wifi', 'internet', 'trådlöst'], da: ['Wi-Fi', 'wifi', 'internet', 'trådløst'], no: ['Wi-Fi', 'wifi', 'internett', 'trådløst'] },
  'icon-car': { sv: ['Bil', 'parkering'], da: ['Bil', 'parkering'], no: ['Bil', 'parkering'] },
  'icon-star': { sv: ['Stjärna', 'betyg'], da: ['Stjerne', 'bedømmelse'], no: ['Stjerne', 'vurdering'] },
  'icon-heart': { sv: ['Hjärta', 'kärlek'], da: ['Hjerte', 'kærlighed'], no: ['Hjerte', 'kjærlighet'] },
  'icon-thumbs-up': { sv: ['Tummen upp', 'gilla'], da: ['Tommel op', 'synes godt om'], no: ['Tommel opp', 'liker'] },
  'icon-circle-check': { sv: ['Bock', 'ok', 'klar', 'godkänd'], da: ['Flueben', 'ok', 'færdig', 'godkendt'], no: ['Hake', 'ok', 'ferdig', 'godkjent'] },
  'icon-award': { sv: ['Utmärkelse', 'pris', 'medalj'], da: ['Udmærkelse', 'pris', 'medalje'], no: ['Utmerkelse', 'pris', 'medalje'] },
  'icon-gift': { sv: ['Present', 'gåva', 'paket'], da: ['Gave', 'pakke'], no: ['Gave', 'pakke'] },
  'icon-tag': { sv: ['Etikett', 'pris', 'märke'], da: ['Etiket', 'pris', 'mærke'], no: ['Etikett', 'pris', 'merke'] },
  'icon-percent': { sv: ['Procent', 'rea', 'rabatt'], da: ['Procent', 'udsalg', 'rabat'], no: ['Prosent', 'salg', 'rabatt'] },
  'icon-camera': { sv: ['Kamera', 'foto', 'bild'], da: ['Kamera', 'foto', 'billede'], no: ['Kamera', 'foto', 'bilde'] },
  'icon-coffee': { sv: ['Kaffe', 'kafé', 'fika'], da: ['Kaffe', 'café'], no: ['Kaffe', 'kafé'] },
  'icon-utensils': { sv: ['Restaurang', 'mat', 'bestick'], da: ['Restaurant', 'mad', 'bestik'], no: ['Restaurant', 'mat', 'bestikk'] },
  'icon-scissors': { sv: ['Sax', 'frisör', 'hår', 'salong'], da: ['Saks', 'frisør', 'hår', 'salon'], no: ['Saks', 'frisør', 'hår', 'salong'] },
  'icon-leaf': { sv: ['Löv', 'eko', 'natur', 'miljö'], da: ['Blad', 'øko', 'natur', 'miljø'], no: ['Blad', 'øko', 'natur', 'miljø'] },
  'emoji-1f600': { sv: ['Flinande', 'glad', 'smiley'], da: ['Grinende', 'glad', 'smiley'], no: ['Glisende', 'glad', 'smiley'] },
  'emoji-1f603': { sv: ['Leende', 'glad', 'smiley'], da: ['Smilende', 'glad', 'smiley'], no: ['Smilende', 'glad', 'smiley'] },
  'emoji-1f604': { sv: ['Stort leende', 'glad', 'smiley'], da: ['Stort smil', 'glad', 'smiley'], no: ['Stort smil', 'glad', 'smiley'] },
  'emoji-1f601': { sv: ['Strålande', 'glad', 'smiley'], da: ['Strålende', 'glad', 'smiley'], no: ['Strålende', 'glad', 'smiley'] },
  'emoji-1f60a': { sv: ['Rodnande', 'glad', 'smiley'], da: ['Rødmende', 'glad', 'smiley'], no: ['Rødmende', 'glad', 'smiley'] },
  'emoji-1f60d': { sv: ['Hjärtögon', 'kär', 'smiley'], da: ['Hjerteøjne', 'forelsket', 'smiley'], no: ['Hjerteøyne', 'forelsket', 'smiley'] },
  'emoji-1f60e': { sv: ['Solglasögon', 'cool', 'smiley'], da: ['Solbriller', 'cool', 'smiley'], no: ['Solbriller', 'kul', 'smiley'] },
  'emoji-1f929': { sv: ['Stjärnögon', 'imponerad', 'smiley'], da: ['Stjerneøjne', 'imponeret', 'smiley'], no: ['Stjerneøyne', 'imponert', 'smiley'] },
  'emoji-1f602': { sv: ['Glädjetårar', 'skratt', 'smiley'], da: ['Glædestårer', 'grin', 'smiley'], no: ['Gledestårer', 'latter', 'smiley'] },
  'emoji-1f973': { sv: ['Fest', 'kalas', 'smiley'], da: ['Fest', 'fejring', 'smiley'], no: ['Fest', 'feiring', 'smiley'] },
  'emoji-1f44d': { sv: ['Tummen upp', 'gilla'], da: ['Tommel op', 'synes godt om'], no: ['Tommel opp', 'liker'] },
  'emoji-1f44f': { sv: ['Applåd', 'klappa händerna'], da: ['Klapsalve', 'klappe'], no: ['Applaus', 'klappe'] },
  'emoji-1f64c': { sv: ['Händerna i luften', 'hurra'], da: ['Hænderne i vejret', 'hurra'], no: ['Hendene i været', 'hurra'] },
  'emoji-1f64f': { sv: ['Tack', 'tacksam'], da: ['Tak', 'taknemmelig'], no: ['Takk', 'takknemlig'] },
  'emoji-2764': { sv: ['Rött hjärta', 'kärlek'], da: ['Rødt hjerte', 'kærlighed'], no: ['Rødt hjerte', 'kjærlighet'] },
  'emoji-1f499': { sv: ['Blått hjärta', 'kärlek'], da: ['Blåt hjerte', 'kærlighed'], no: ['Blått hjerte', 'kjærlighet'] },
  'emoji-1f49a': { sv: ['Grönt hjärta', 'kärlek'], da: ['Grønt hjerte', 'kærlighed'], no: ['Grønt hjerte', 'kjærlighet'] },
  'emoji-1f49b': { sv: ['Gult hjärta', 'kärlek'], da: ['Gult hjerte', 'kærlighed'], no: ['Gult hjerte', 'kjærlighet'] },
  'emoji-1f9e1': { sv: ['Orange hjärta', 'kärlek'], da: ['Orange hjerte', 'kærlighed'], no: ['Oransje hjerte', 'kjærlighet'] },
  'emoji-1f49c': { sv: ['Lila hjärta', 'kärlek'], da: ['Lilla hjerte', 'kærlighed'], no: ['Lilla hjerte', 'kjærlighet'] },
  'emoji-2b50': { sv: ['Stjärna'], da: ['Stjerne'], no: ['Stjerne'] },
  'emoji-1f31f': { sv: ['Glittrande stjärna', 'stjärna'], da: ['Glitrende stjerne', 'stjerne'], no: ['Glitrende stjerne', 'stjerne'] },
  'emoji-2728': { sv: ['Gnistor', 'glitter'], da: ['Gnister', 'glimmer'], no: ['Gnister', 'glitter'] },
  'emoji-1f525': { sv: ['Eld', 'låga', 'het'], da: ['Ild', 'flamme', 'hot', 'varm', 'hed'], no: ['Ild', 'flamme', 'het'] },
  'emoji-1f389': { sv: ['Konfetti', 'fest', 'firande'], da: ['Konfetti', 'fest', 'fejring'], no: ['Konfetti', 'fest', 'feiring'] },
  'emoji-1f381': { sv: ['Present', 'gåva', 'paket'], da: ['Gave', 'pakke'], no: ['Gave', 'pakke'] },
  'emoji-1f388': { sv: ['Ballong', 'kalas'], da: ['Ballon', 'fest'], no: ['Ballong', 'fest'] },
  'emoji-1f382': { sv: ['Födelsedagstårta', 'tårta', 'födelsedag'], da: ['Fødselsdagskage', 'kage', 'fødselsdag'], no: ['Bursdagskake', 'kake', 'bursdag'] },
  'emoji-1f3c6': { sv: ['Pokal', 'vinnare'], da: ['Pokal', 'vinder'], no: ['Pokal', 'vinner'] },
  'emoji-1f947': { sv: ['Guldmedalj', 'medalj', 'vinnare'], da: ['Guldmedalje', 'medalje', 'vinder'], no: ['Gullmedalje', 'medalje', 'vinner'] },
  'emoji-1f4cd': { sv: ['Nål', 'plats', 'adress'], da: ['Kortnål', 'sted', 'adresse'], no: ['Nål', 'sted', 'adresse'] },
  'emoji-1f4de': { sv: ['Telefonlur', 'telefon', 'ringa'], da: ['Telefonrør', 'telefon', 'ringe'], no: ['Telefonrør', 'telefon', 'ringe'] },
  'emoji-2709': { sv: ['Kuvert', 'brev', 'e-post'], da: ['Kuvert', 'brev', 'post'], no: ['Konvolutt', 'brev', 'post'] },
  'emoji-1f4a1': { sv: ['Glödlampa', 'idé'], da: ['Elpære', 'idé'], no: ['Lyspære', 'idé'] },
  'emoji-2705': { sv: ['Bock', 'klar', 'ok'], da: ['Flueben', 'færdig', 'ok'], no: ['Hake', 'ferdig', 'ok'] },
  'emoji-2600': { sv: ['Sol', 'sommar'], da: ['Sol', 'sommer'], no: ['Sol', 'sommer'] },
  'emoji-1f338': { sv: ['Körsbärsblom', 'blomma', 'vår'], da: ['Kirsebærblomst', 'blomst', 'forår'], no: ['Kirsebærblomst', 'blomst', 'vår'] },
  'emoji-1f33f': { sv: ['Ört', 'växt', 'grön'], da: ['Krydderurt', 'plante', 'grøn'], no: ['Urt', 'plante', 'grønn'] },
  'emoji-1f355': { sv: ['Pizza', 'mat'], da: ['Pizza', 'mad'], no: ['Pizza', 'mat'] },
  'emoji-2615': { sv: ['Varm dryck', 'kaffe', 'te'], da: ['Varm drik', 'kaffe', 'te'], no: ['Varm drikke', 'kaffe', 'te'] },
  'shape-square': { sv: ['Kvadrat', 'fyrkant'], da: ['Kvadrat', 'firkant'], no: ['Kvadrat', 'firkant'] },
  'shape-rounded': { sv: ['Rundad kvadrat', 'fyrkant', 'rundade hörn'], da: ['Afrundet kvadrat', 'firkant', 'runde hjørner'], no: ['Avrundet kvadrat', 'firkant', 'runde hjørner'] },
  'shape-circle': { sv: ['Cirkel', 'rund'], da: ['Cirkel', 'rund'], no: ['Sirkel', 'rund'] },
  'shape-ellipse': { sv: ['Oval', 'ellips'], da: ['Oval', 'ellipse'], no: ['Oval', 'ellipse'] },
  'shape-triangle': { sv: ['Triangel', 'trekant'], da: ['Trekant', 'triangel'], no: ['Trekant', 'triangel'] },
  'shape-right-triangle': { sv: ['Rätvinklig triangel', 'trekant'], da: ['Retvinklet trekant', 'triangel'], no: ['Rettvinklet trekant', 'triangel'] },
  'shape-diamond': { sv: ['Romb', 'diamant', 'ruter'], da: ['Rombe', 'diamant', 'ruder'], no: ['Rombe', 'diamant', 'ruter'] },
  'shape-pentagon': { sv: ['Femhörning', 'pentagon'], da: ['Femkant', 'pentagon'], no: ['Femkant', 'pentagon'] },
  'shape-hexagon': { sv: ['Sexhörning', 'hexagon'], da: ['Sekskant', 'heksagon'], no: ['Sekskant', 'heksagon'] },
  'shape-octagon': { sv: ['Åttahörning', 'oktagon'], da: ['Ottekant', 'oktagon'], no: ['Åttekant', 'oktagon'] },
  'shape-star': { sv: ['Stjärna'], da: ['Stjerne'], no: ['Stjerne'] },
  'shape-star-6': { sv: ['Sexuddig stjärna', 'stjärna'], da: ['Sekstakket stjerne', 'stjerne'], no: ['Sekstakket stjerne', 'stjerne'] },
  'shape-heart': { sv: ['Hjärta', 'kärlek'], da: ['Hjerte', 'kærlighed'], no: ['Hjerte', 'kjærlighet'] },
  'shape-cross': { sv: ['Plus', 'kors'], da: ['Plus', 'kors'], no: ['Pluss', 'kors'] },
  'shape-bubble': { sv: ['Pratbubbla', 'bubbla', 'citat'], da: ['Taleboble', 'boble', 'citat'], no: ['Snakkeboble', 'boble', 'sitat'] },
  'shape-line': { sv: ['Linje', 'streck'], da: ['Linje', 'streg'], no: ['Linje', 'strek'] },
  'shape-arrow': { sv: ['Pil'], da: ['Pil'], no: ['Pil'] },
  'shape-arrow-double': { sv: ['Dubbelpil', 'pil'], da: ['Dobbeltpil', 'pil'], no: ['Dobbeltpil', 'pil'] },
  'shape-chevron': { sv: ['Vinkel', 'pil', 'chevron'], da: ['Vinkel', 'pil', 'chevron'], no: ['Vinkel', 'pil', 'chevron'] },
  'shape-arrow-thin': { sv: ['Smal pil', 'pil'], da: ['Tynd pil', 'pil'], no: ['Tynn pil', 'pil'] },
  'shape-frame-square': { sv: ['Fyrkantig ram', 'ram'], da: ['Firkantet ramme', 'ramme'], no: ['Firkantet ramme', 'ramme'] },
  'shape-frame-rounded': { sv: ['Rundad ram', 'ram'], da: ['Afrundet ramme', 'ramme'], no: ['Avrundet ramme', 'ramme'] },
  'shape-frame-circle': { sv: ['Rund ram', 'ram', 'cirkel'], da: ['Rund ramme', 'ramme', 'cirkel'], no: ['Rund ramme', 'ramme', 'sirkel'] },
  'shape-frame-double': { sv: ['Dubbel ram', 'ram'], da: ['Dobbelt ramme', 'ramme'], no: ['Dobbel ramme', 'ramme'] },
  'shape-burst': { sv: ['Explosion', 'stjärna', 'märke'], da: ['Eksplosion', 'stjerne', 'mærke'], no: ['Eksplosjon', 'stjerne', 'merke'] },
  'shape-seal': { sv: ['Sigill', 'märke', 'stämpel'], da: ['Segl', 'mærke', 'stempel'], no: ['Segl', 'merke', 'stempel'] },
  'shape-starburst': { sv: ['Stjärnexplosion', 'stjärna', 'erbjudande'], da: ['Stjerneeksplosion', 'stjerne', 'tilbud'], no: ['Stjerneeksplosjon', 'stjerne', 'tilbud'] },
  'shape-ribbon': { sv: ['Banderoll', 'band', 'banner'], da: ['Bånd', 'banner', 'banderole'], no: ['Bånd', 'banner', 'banderole'] },
  'shape-tag': { sv: ['Prislapp', 'pris', 'etikett'], da: ['Prismærke', 'pris', 'etiket'], no: ['Prislapp', 'pris', 'etikett'] },
  'shape-label': { sv: ['Etikett', 'märke'], da: ['Etiket', 'mærkat'], no: ['Etikett', 'merkelapp'] },
};

/** An element with its names in the shop's other languages beside its English ones. */
function withNames(e) {
  const names = NAMES[e.id];
  if (!names && e.lib !== 'social') throw new Error(`${e.id}: no Swedish, Danish and Norwegian names (NAMES)`);
  const i18n = {};
  for (const lang of ['sv', 'da', 'no']) {
    const [label, ...keywords] = names ? names[lang] : [e.label];
    if (!label) throw new Error(`${e.id}: no ${lang} name`);
    i18n[lang] = { label, keywords };
  }
  const { id, lib, category, label, keywords, paint, svg } = e;
  return { id, lib, category, label, keywords, i18n, paint, svg };
}

if (process.argv.includes('--names')) {
  const current = JSON.parse(readFileSync(OUT, 'utf8'));
  writeFileSync(OUT, JSON.stringify(current.map(withNames), null, 1) + '\n');
  console.log(`names for ${current.length} elements → ${OUT}`);
  process.exit(0);
}

const elements = [];
const add = (lib, category, id, label, svg, paint, keywords = []) =>
  elements.push({ id: `${lib}-${id}`, lib, category, label, keywords, paint, svg });

// ---- socials (simple-icons, CC0) ----
const SOCIALS = [
  ['facebook', 'Facebook'], ['instagram', 'Instagram'], ['whatsapp', 'WhatsApp'], ['x', 'X'], ['youtube', 'YouTube'],
  ['tiktok', 'TikTok'], ['pinterest', 'Pinterest'], ['snapchat', 'Snapchat'], ['telegram', 'Telegram'], ['messenger', 'Messenger'],
  ['threads', 'Threads'], ['behance', 'Behance'], ['dribbble', 'Dribbble'], ['spotify', 'Spotify'], ['tripadvisor', 'Tripadvisor'],
];
for (const [slug, label] of SOCIALS) {
  try {
    const svg = clean(await fetchText(`https://unpkg.com/simple-icons@16.34.0/icons/${slug}.svg`), { inherit: { fill: '#000000' } });
    add('social', 'socials', slug, label, svg, 'fill', [slug, label.toLowerCase(), 'social']);
  } catch (e) {
    console.warn(`social ${slug}: left out (${e.message})`);
  }
}

// ---- contact and everyday icons (lucide, ISC) — drawn with strokes ----
const CONTACTS = [
  ['phone', 'Phone', 'telephone call'], ['smartphone', 'Mobile', 'mobile cell'], ['mail', 'E-mail', 'email envelope'],
  ['at-sign', 'At sign', 'email'], ['globe', 'Website', 'web internet'], ['link', 'Link', 'url'], ['map-pin', 'Address', 'location pin'],
  ['map', 'Map', 'location'], ['clock', 'Opening hours', 'time hours'], ['calendar', 'Calendar', 'date'], ['user', 'Person', 'contact'],
  ['users', 'People', 'team'], ['building-2', 'Office', 'company building'], ['house', 'Home', 'house'], ['briefcase', 'Business', 'work'],
  ['store', 'Shop', 'store'], ['shopping-cart', 'Cart', 'shop'], ['truck', 'Delivery', 'shipping'], ['printer', 'Print', 'printer'],
  ['wifi', 'Wi-Fi', 'internet'], ['car', 'Car', 'parking'], ['star', 'Star', 'rating'], ['heart', 'Heart', 'love'],
  ['thumbs-up', 'Thumbs up', 'like'], ['circle-check', 'Check', 'ok done'], ['award', 'Award', 'prize'], ['gift', 'Gift', 'present'],
  ['tag', 'Tag', 'price label'], ['percent', 'Percent', 'sale discount'], ['camera', 'Camera', 'photo'], ['coffee', 'Coffee', 'cafe'],
  ['utensils', 'Restaurant', 'food cutlery'], ['scissors', 'Scissors', 'hair salon'], ['leaf', 'Leaf', 'eco nature'],
];
for (const [name, label, words] of CONTACTS) {
  try {
    const raw = await fetchText(`https://unpkg.com/lucide-static@1.52.0/icons/${name}.svg`);
    const svg = clean(raw, { colour: '#000000' });
    add('icon', 'contacts', name, label, svg, 'stroke', words.split(' '));
  } catch (e) {
    console.warn(`icon ${name}: left out (${e.message})`);
  }
}

// ---- emojis (Twemoji graphics, CC BY 4.0) — multi-coloured, not recoloured ----
const EMOJIS = [
  ['1f600', 'Grinning'], ['1f603', 'Smile'], ['1f604', 'Big smile'], ['1f601', 'Beaming'], ['1f60a', 'Blush'], ['1f60d', 'Heart eyes'],
  ['1f60e', 'Sunglasses'], ['1f929', 'Star struck'], ['1f602', 'Tears of joy'], ['1f973', 'Party'], ['1f44d', 'Thumbs up'],
  ['1f44f', 'Clapping'], ['1f64c', 'Raised hands'], ['1f64f', 'Thank you'], ['2764', 'Red heart'], ['1f499', 'Blue heart'],
  ['1f49a', 'Green heart'], ['1f49b', 'Yellow heart'], ['1f9e1', 'Orange heart'], ['1f49c', 'Purple heart'], ['2b50', 'Star'],
  ['1f31f', 'Glowing star'], ['2728', 'Sparkles'], ['1f525', 'Fire'], ['1f389', 'Party popper'], ['1f381', 'Gift'],
  ['1f388', 'Balloon'], ['1f382', 'Birthday cake'], ['1f3c6', 'Trophy'], ['1f947', 'Gold medal'], ['1f4cd', 'Pin'],
  ['1f4de', 'Telephone'], ['2709', 'Envelope'], ['1f4a1', 'Light bulb'], ['2705', 'Check mark'], ['2600', 'Sun'],
  ['1f338', 'Blossom'], ['1f33f', 'Herb'], ['1f355', 'Pizza'], ['2615', 'Hot drink'],
];
for (const [code, label] of EMOJIS) {
  try {
    const svg = clean(await fetchText(`https://unpkg.com/@twemoji/svg@15.0.0/${code}.svg`));
    add('emoji', 'emojis', code, label, svg, 'none', [label.toLowerCase(), 'emoji']);
  } catch (e) {
    console.warn(`emoji ${code}: left out (${e.message})`);
  }
}

// ---- shapes, lines, frames and badges: drawn here ----
const n = (v) => Math.round(v * 100) / 100;
const regular = (sides, r = 50, rot = -90) =>
  Array.from({ length: sides }, (_, i) => {
    const a = ((rot + (360 / sides) * i) * Math.PI) / 180;
    return `${n(50 + r * Math.cos(a))},${n(50 + r * Math.sin(a))}`;
  }).join(' ');
const star = (points, inner, r = 50) =>
  Array.from({ length: points * 2 }, (_, i) => {
    const rr = i % 2 ? r * inner : r;
    const a = ((-90 + (180 / points) * i) * Math.PI) / 180;
    return `${n(50 + rr * Math.cos(a))},${n(50 + rr * Math.sin(a))}`;
  }).join(' ');
const seal = (bumps = 16) => {
  let d = '';
  for (let i = 0; i < bumps; i += 1) {
    const a0 = (2 * Math.PI * i) / bumps;
    const a1 = (2 * Math.PI * (i + 1)) / bumps;
    const p0 = [50 + 44 * Math.cos(a0), 50 + 44 * Math.sin(a0)];
    const p1 = [50 + 44 * Math.cos(a1), 50 + 44 * Math.sin(a1)];
    const am = (a0 + a1) / 2;
    const c = [50 + 56 * Math.cos(am), 50 + 56 * Math.sin(am)];
    d += `${i === 0 ? `M${n(p0[0])} ${n(p0[1])}` : ''}Q${n(c[0])} ${n(c[1])} ${n(p1[0])} ${n(p1[1])}`;
  }
  return `${d}Z`;
};
const svg = (viewBox, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>`;
const F = 'fill="#000000"';
const S = (w = 4) => `fill="none" stroke="#000000" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
const SHAPES = [
  ['shapes', 'square', 'Square', svg('0 0 100 100', `<rect x="0" y="0" width="100" height="100" ${F}/>`), 'fill'],
  ['shapes', 'rounded', 'Rounded square', svg('0 0 100 100', `<rect x="0" y="0" width="100" height="100" rx="16" ry="16" ${F}/>`), 'fill'],
  ['shapes', 'circle', 'Circle', svg('0 0 100 100', `<circle cx="50" cy="50" r="50" ${F}/>`), 'fill'],
  ['shapes', 'ellipse', 'Oval', svg('0 0 100 64', `<ellipse cx="50" cy="32" rx="50" ry="32" ${F}/>`), 'fill'],
  ['shapes', 'triangle', 'Triangle', svg('0 0 100 100', `<polygon points="50,0 100,100 0,100" ${F}/>`), 'fill'],
  ['shapes', 'right-triangle', 'Right triangle', svg('0 0 100 100', `<polygon points="0,0 100,100 0,100" ${F}/>`), 'fill'],
  ['shapes', 'diamond', 'Diamond', svg('0 0 100 100', `<polygon points="50,0 100,50 50,100 0,50" ${F}/>`), 'fill'],
  ['shapes', 'pentagon', 'Pentagon', svg('0 0 100 100', `<polygon points="${regular(5)}" ${F}/>`), 'fill'],
  ['shapes', 'hexagon', 'Hexagon', svg('0 0 100 100', `<polygon points="${regular(6, 50, 0)}" ${F}/>`), 'fill'],
  ['shapes', 'octagon', 'Octagon', svg('0 0 100 100', `<polygon points="${regular(8, 50, -112.5)}" ${F}/>`), 'fill'],
  ['shapes', 'star', 'Star', svg('0 0 100 100', `<polygon points="${star(5, 0.42)}" ${F}/>`), 'fill'],
  ['shapes', 'star-6', 'Six-point star', svg('0 0 100 100', `<polygon points="${star(6, 0.55)}" ${F}/>`), 'fill'],
  ['shapes', 'heart', 'Heart', svg('0 0 100 90', `<path d="M50 90C22 68 0 50 0 26C0 11 12 0 26 0C37 0 45 6 50 14C55 6 63 0 74 0C88 0 100 11 100 26C100 50 78 68 50 90Z" ${F}/>`), 'fill'],
  ['shapes', 'cross', 'Plus', svg('0 0 100 100', `<polygon points="35,0 65,0 65,35 100,35 100,65 65,65 65,100 35,100 35,65 0,65 0,35 35,35" ${F}/>`), 'fill'],
  ['shapes', 'bubble', 'Speech bubble', svg('0 0 100 90', `<path d="M12 0H88C95 0 100 5 100 12V58C100 65 95 70 88 70H40L18 90V70H12C5 70 0 65 0 58V12C0 5 5 0 12 0Z" ${F}/>`), 'fill'],
  ['lines', 'line', 'Line', svg('0 0 100 8', `<line x1="4" y1="4" x2="96" y2="4" ${S(4)}/>`), 'stroke'],
  ['lines', 'arrow', 'Arrow', svg('0 0 100 40', `<polygon points="0,14 70,14 70,0 100,20 70,40 70,26 0,26" ${F}/>`), 'fill'],
  ['lines', 'arrow-double', 'Double arrow', svg('0 0 100 40', `<polygon points="0,20 28,0 28,14 72,14 72,0 100,20 72,40 72,26 28,26 28,40" ${F}/>`), 'fill'],
  ['lines', 'chevron', 'Chevron', svg('0 0 60 100', `<polygon points="0,0 30,0 60,50 30,100 0,100 30,50" ${F}/>`), 'fill'],
  ['lines', 'arrow-thin', 'Thin arrow', svg('0 0 100 40', `<path d="M4 20H94M74 6L94 20L74 34" ${S(5)}/>`), 'stroke'],
  ['frames', 'frame-square', 'Square frame', svg('0 0 100 100', `<rect x="3" y="3" width="94" height="94" ${S(6)}/>`), 'stroke'],
  ['frames', 'frame-rounded', 'Rounded frame', svg('0 0 100 100', `<rect x="3" y="3" width="94" height="94" rx="14" ry="14" ${S(6)}/>`), 'stroke'],
  ['frames', 'frame-circle', 'Circle frame', svg('0 0 100 100', `<circle cx="50" cy="50" r="47" ${S(6)}/>`), 'stroke'],
  ['frames', 'frame-double', 'Double frame', svg('0 0 100 100', `<rect x="2" y="2" width="96" height="96" ${S(3)}/><rect x="10" y="10" width="80" height="80" ${S(2)}/>`), 'stroke'],
  ['badges', 'burst', 'Burst', svg('0 0 100 100', `<polygon points="${star(12, 0.78)}" ${F}/>`), 'fill'],
  ['badges', 'seal', 'Seal', svg('0 0 100 100', `<path d="${seal(16)}" ${F}/>`), 'fill'],
  ['badges', 'starburst', 'Starburst', svg('0 0 100 100', `<polygon points="${star(20, 0.84)}" ${F}/>`), 'fill'],
  ['badges', 'ribbon', 'Ribbon banner', svg('0 0 120 40', `<polygon points="0,0 120,0 108,20 120,40 0,40 12,20" ${F}/>`), 'fill'],
  ['badges', 'tag', 'Price tag', svg('0 0 100 60', `<path d="M20 0H96C98 0 100 2 100 4V56C100 58 98 60 96 60H20L0 30Z" ${F}/>`), 'fill'],
  ['badges', 'label', 'Label', svg('0 0 100 50', `<rect x="0" y="0" width="100" height="50" rx="25" ry="25" ${F}/>`), 'fill'],
];
for (const [category, id, label, raw, paint] of SHAPES) add('shape', category, id, label, clean(raw), paint, [label.toLowerCase()]);

writeFileSync(OUT, JSON.stringify(elements.map(withNames), null, 1) + '\n');
const by = elements.reduce((m, e) => ({ ...m, [e.category]: (m[e.category] ?? 0) + 1 }), {});
console.log(JSON.stringify(by), `→ ${OUT} (${(JSON.stringify(elements).length / 1024).toFixed(0)} KB)`);
