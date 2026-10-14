/**
 * A PDF'S TRIM BOX, READ FROM ITS OWN BYTES — round 16 (D2).
 *
 * A print-ready PDF/X exported "with marks and bleed" (InDesign, Illustrator) is
 * bigger than the product: its page carries the bleed AND a slug area with the
 * crop marks, and its TrimBox says where the product is. The shop measured the
 * page (pdf.js offers nothing else — its public API stops at MediaBox∩CropBox), so
 * an exactly right 85 × 55 card arrived as 105 × 75 and was refused; on the
 * per-metre page the same box set the height, and so the price.
 *
 * This reads /TrimBox and /BleedBox of one page object straight from the file —
 * plain objects and compressed object streams, the LATEST revision when a file
 * was saved incrementally — and gives up (null) on anything it is not sure of:
 * encrypted files, other filters, a page whose own MediaBox∩CropBox does not
 * reproduce what pdf.js measured (then we read the wrong object). Null means:
 * measure the page, exactly as before.
 *
 * Pure, for the browser and for Node (scripts/test-pdf-boxes.mjs).
 */

export type PdfBox = [number, number, number, number];

interface Name { t: 'name'; v: string }
interface Ref { t: 'ref'; num: number; gen: number }
interface Dict { t: 'dict'; v: Record<string, Val> }
interface Str { t: 'str' }
type Val = number | boolean | null | Name | Ref | Dict | Str | Val[] | { t: 'kw'; v: string };

const isWs = (c: number) => c === 0x00 || c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d || c === 0x20;
const isDelim = (c: number) =>
  c === 0x28 || c === 0x29 || c === 0x3c || c === 0x3e || c === 0x5b || c === 0x5d || c === 0x7b || c === 0x7d || c === 0x2f || c === 0x25;
const isDigit = (c: number) => c >= 0x30 && c <= 0x39;
/** An unsigned integer from its digit bytes. */
function digits(b: Uint8Array, start: number, end: number): number {
  let n = 0;
  for (let k = start; k < end; k += 1) n = n * 10 + (b[k] - 0x30);
  return n;
}

/** Files over this are not scanned (the upload limit is 50 MB). */
const MAX_BYTES = 60 * 1024 * 1024;

/** A small recursive-descent reader for ONE PDF value, over bytes. */
class Reader {
  pos: number;
  private budget = 200_000;
  constructor(private b: Uint8Array, pos: number) {
    this.pos = pos;
  }

  private skip(): void {
    const b = this.b;
    for (;;) {
      while (this.pos < b.length && isWs(b[this.pos])) this.pos += 1;
      if (this.pos < b.length && b[this.pos] === 0x25) {
        // A comment, to the end of the line.
        while (this.pos < b.length && b[this.pos] !== 0x0a && b[this.pos] !== 0x0d) this.pos += 1;
        continue;
      }
      return;
    }
  }

  /** The next value; throws on anything malformed (the caller gives up). */
  value(depth = 0): Val {
    if (depth > 32 || (this.budget -= 1) < 0) throw new Error('too deep');
    this.skip();
    const b = this.b;
    if (this.pos >= b.length) throw new Error('eof');
    const c = b[this.pos];
    if (c === 0x3c && b[this.pos + 1] === 0x3c) {
      this.pos += 2;
      const v: Record<string, Val> = Object.create(null);
      for (;;) {
        this.skip();
        if (b[this.pos] === 0x3e && b[this.pos + 1] === 0x3e) {
          this.pos += 2;
          return { t: 'dict', v };
        }
        const key = this.value(depth + 1);
        if (!key || typeof key !== 'object' || (key as Name).t !== 'name') throw new Error('dict key');
        v[(key as Name).v] = this.value(depth + 1);
      }
    }
    if (c === 0x5b) {
      this.pos += 1;
      const out: Val[] = [];
      for (;;) {
        this.skip();
        if (b[this.pos] === 0x5d) {
          this.pos += 1;
          return out;
        }
        out.push(this.value(depth + 1));
      }
    }
    if (c === 0x2f) {
      this.pos += 1;
      let s = '';
      while (this.pos < b.length && !isWs(b[this.pos]) && !isDelim(b[this.pos])) {
        if (b[this.pos] === 0x23 && this.pos + 2 < b.length) {
          s += String.fromCharCode(parseInt(String.fromCharCode(b[this.pos + 1], b[this.pos + 2]), 16) || 0);
          this.pos += 3;
        } else {
          s += String.fromCharCode(b[this.pos]);
          this.pos += 1;
        }
      }
      return { t: 'name', v: s };
    }
    if (c === 0x28) {
      // A literal string: balanced parentheses, backslash escapes.
      let depthParens = 0;
      while (this.pos < b.length) {
        const ch = b[this.pos];
        if (ch === 0x5c) this.pos += 2;
        else {
          if (ch === 0x28) depthParens += 1;
          else if (ch === 0x29) {
            depthParens -= 1;
            if (depthParens === 0) {
              this.pos += 1;
              return { t: 'str' };
            }
          }
          this.pos += 1;
        }
      }
      throw new Error('string');
    }
    if (c === 0x3c) {
      const end = b.indexOf(0x3e, this.pos);
      if (end < 0) throw new Error('hex');
      this.pos = end + 1;
      return { t: 'str' };
    }
    if (isDigit(c) || c === 0x2b || c === 0x2d || c === 0x2e) {
      const n = this.number();
      // `num gen R` — a reference.
      const save = this.pos;
      if (Number.isInteger(n) && n >= 0) {
        this.skip();
        if (isDigit(b[this.pos])) {
          const gen = this.number();
          this.skip();
          if (b[this.pos] === 0x52 && (this.pos + 1 >= b.length || isWs(b[this.pos + 1]) || isDelim(b[this.pos + 1]))) {
            this.pos += 1;
            return { t: 'ref', num: n, gen };
          }
        }
      }
      this.pos = save;
      return n;
    }
    // A keyword: true, false, null — or anything else (stream, endobj…).
    let word = '';
    while (this.pos < b.length && !isWs(b[this.pos]) && !isDelim(b[this.pos])) {
      word += String.fromCharCode(b[this.pos]);
      this.pos += 1;
    }
    if (word === 'true') return true;
    if (word === 'false') return false;
    if (word === 'null') return null;
    if (!word) throw new Error('unexpected byte');
    return { t: 'kw', v: word };
  }

  private number(): number {
    const b = this.b;
    const start = this.pos;
    if (b[this.pos] === 0x2b || b[this.pos] === 0x2d) this.pos += 1;
    while (this.pos < b.length && (isDigit(b[this.pos]) || b[this.pos] === 0x2e)) this.pos += 1;
    let text = '';
    for (let k = start; k < this.pos; k += 1) text += String.fromCharCode(b[k]);
    const n = Number(text);
    if (!Number.isFinite(n)) throw new Error('number');
    return n;
  }

  /** After an object's dictionary: the stream's data, cut by its /Length. */
  streamData(length: number): Uint8Array | null {
    this.skip();
    const b = this.b;
    const kw = String.fromCharCode(...b.subarray(this.pos, this.pos + 6));
    if (kw !== 'stream') return null;
    this.pos += 6;
    if (b[this.pos] === 0x0d) this.pos += 1;
    if (b[this.pos] === 0x0a) this.pos += 1;
    if (!(length >= 0) || this.pos + length > b.length) return null;
    return b.subarray(this.pos, this.pos + length);
  }
}

interface Header {
  num: number;
  gen: number;
  /** Where the value starts, just after `obj`. */
  body: number;
  /** Where the header starts — later in the file = a later revision. */
  at: number;
}

/** Every `num gen obj` header in the file, in file order. */
function objectHeaders(b: Uint8Array): Header[] {
  const out: Header[] = [];
  for (let i = 1; i + 3 <= b.length; i += 1) {
    if (b[i] !== 0x6f || b[i + 1] !== 0x62 || b[i + 2] !== 0x6a) continue; // "obj"
    if (!isWs(b[i - 1])) continue; // not "endobj"
    if (i + 3 < b.length && !isWs(b[i + 3]) && !isDelim(b[i + 3])) continue;
    let j = i - 1;
    while (j >= 0 && isWs(b[j])) j -= 1;
    const genEnd = j + 1;
    while (j >= 0 && isDigit(b[j])) j -= 1;
    const genStart = j + 1;
    if (genStart === genEnd) continue;
    if (j < 0 || !isWs(b[j])) continue;
    while (j >= 0 && isWs(b[j])) j -= 1;
    const numEnd = j + 1;
    while (j >= 0 && isDigit(b[j])) j -= 1;
    const numStart = j + 1;
    if (numStart === numEnd) continue;
    if (j >= 0 && !isWs(b[j]) && !isDelim(b[j])) continue; // "112 0 obj" is not "12 0 obj"
    out.push({ num: digits(b, numStart, numEnd), gen: digits(b, genStart, genEnd), body: i + 3, at: numStart });
  }
  return out;
}

/** Zlib-inflate with the platform's own streams; null where there are none. */
async function inflate(data: Uint8Array): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * A stream's bytes as the reader can use them: inflated, or as they are when the
 * stream has no filter. A /Length that counted the end-of-line after the data —
 * which pdf.js forgives and DecompressionStream does not — is tried once without it.
 */
async function streamBytes(raw: Uint8Array, compressed: boolean): Promise<{ raw: Uint8Array; data: Uint8Array } | null> {
  if (!compressed) return { raw, data: raw };
  const data = await inflate(raw);
  if (data) return { raw, data };
  let end = raw.length;
  while (end > 0 && (raw[end - 1] === 0x0a || raw[end - 1] === 0x0d)) end -= 1;
  if (end === raw.length) return null;
  const trimmed = raw.subarray(0, end);
  const again = await inflate(trimmed);
  return again ? { raw: trimmed, data: again } : null;
}

/** The (object number, offset) pairs heading an object stream — plain integers, read without a value budget. */
function readPairs(data: Uint8Array, n: number): { nums: Int32Array; offsets: Int32Array } | null {
  const nums = new Int32Array(n);
  const offsets = new Int32Array(n);
  let pos = 0;
  const int = (): number | null => {
    while (pos < data.length && isWs(data[pos])) pos += 1;
    const start = pos;
    while (pos < data.length && isDigit(data[pos])) pos += 1;
    if (pos === start || pos - start > 9) return null;
    return digits(data, start, pos);
  };
  for (let k = 0; k < n; k += 1) {
    const num = int();
    const offset = int();
    if (num === null || offset === null) return null;
    nums[k] = num;
    offsets[k] = offset;
  }
  return { nums, offsets };
}

/** /DecodeParms that change nothing: absent, null, an empty dictionary, or an array of those. */
function noDecodeParms(v: Val | undefined): boolean {
  if (v == null) return true;
  if (Array.isArray(v)) return v.every((item) => noDecodeParms(item));
  return (v as Dict).t === 'dict' && Object.keys((v as Dict).v).length === 0;
}

/** An object stream's table of contents. Its members are parsed only when asked for. */
interface ObjStm {
  /** Where its header is — later in the file = a later revision. */
  at: number;
  /** Its bytes as stored: a view into the file, nothing copied. */
  raw: Uint8Array;
  /** FlateDecode (inflated again for each member asked for), or stored as they are. */
  compressed: boolean;
  first: number;
  nums: Int32Array;
  offsets: Int32Array;
}

class Doc {
  private headers: Header[];
  private objStms: Promise<{ streams: ObjStm[]; failedAt: number[] }> | null = null;
  /** The last stream inflated for a member — a page and its parents often share one. */
  private inflated: { stm: ObjStm; data: Uint8Array } | null = null;

  constructor(private b: Uint8Array) {
    this.headers = objectHeaders(b);
  }

  private parseAt(pos: number): Val {
    return new Reader(this.b, pos).value();
  }

  /**
   * Every object stream's TABLE — which objects it holds, and where — and nothing
   * more. Parsing every member of every stream up front held ~1.4 KB per object
   * until the answer came back: a large tagged PDF, 400 000 compressed objects,
   * took 570 MB on the page that picked it. A stream that cannot be read (no
   * DecompressionStream before iOS 16.4, bytes after the data that pdf.js forgives,
   * a filter this does not do) is REMEMBERED: a later revision of the page may be
   * inside it, and then no answer is better than an old one.
   */
  private loadObjStms(): Promise<{ streams: ObjStm[]; failedAt: number[] }> {
    if (!this.objStms) {
      this.objStms = (async () => {
        const streams: ObjStm[] = [];
        const failedAt: number[] = [];
        for (const h of this.headers) {
          // Only an object that says so near its own start — before any "endobj",
          // so the words of the NEXT object do not count as this one's.
          const windowEnd = Math.min(this.b.length, h.body + 1024);
          const own = indexOfAscii(this.b, 'endobj', h.body, windowEnd);
          if (indexOfAscii(this.b, '/ObjStm', h.body, own >= 0 ? own : windowEnd) < 0) continue;
          const r = new Reader(this.b, h.body);
          let dict: Val;
          try {
            dict = r.value();
          } catch {
            failedAt.push(h.at);
            continue;
          }
          if (!dict || (dict as Dict).t !== 'dict') {
            failedAt.push(h.at);
            continue;
          }
          const d = (dict as Dict).v;
          if ((d.Type as Name)?.v !== 'ObjStm') continue; // the words were in something else
          const table = await this.readTable(r, d);
          if (table) streams.push({ at: h.at, ...table });
          else failedAt.push(h.at);
        }
        return { streams, failedAt };
      })();
    }
    return this.objStms;
  }

  /** An object stream's table: its N (object number, offset) pairs. Null when it cannot be read. */
  private async readTable(r: Reader, d: Record<string, Val>): Promise<Omit<ObjStm, 'at'> | null> {
    const filter = d.Filter;
    const compressed = filter != null;
    const flate =
      (filter as Name)?.v === 'FlateDecode' ||
      (Array.isArray(filter) && filter.length === 1 && (filter[0] as Name)?.v === 'FlateDecode');
    if ((compressed && !flate) || !noDecodeParms(d.DecodeParms)) return null;
    // From PLAIN objects only: resolving through object streams here would wait on
    // the very streams being read.
    const length = this.plainNumber(d.Length);
    if (length === null) return null;
    const stored = r.streamData(length);
    if (!stored) return null;
    const n = Number(d.N);
    const first = Number(d.First);
    if (!(n >= 0 && n <= 1_000_000 && Number.isInteger(n)) || !(first >= 0)) return null;
    const bytes = await streamBytes(stored, compressed);
    if (!bytes) return null;
    const pairs = readPairs(bytes.data, n);
    if (!pairs) return null;
    return { raw: bytes.raw, compressed, first, ...pairs };
  }

  /** One member of an object stream — the stream inflated again, that member alone parsed. */
  private async member(stm: ObjStm, index: number): Promise<Val> {
    if (this.inflated?.stm !== stm) {
      const data = stm.compressed ? await inflate(stm.raw) : stm.raw;
      if (!data) throw new Error('An object stream could not be read twice.');
      this.inflated = { stm, data };
    }
    return new Reader(this.inflated.data, stm.first + stm.offsets[index]).value();
  }

  /**
   * The LATEST definition of an object: plain or inside an object stream, whichever
   * is later in the file. Throws when an object stream that could not be read
   * lies later still — the latest definition may be in it.
   */
  async get(num: number, gen: number): Promise<Val | undefined> {
    let bestAt = -1;
    let plainBody = -1;
    for (const h of this.headers) {
      if (h.num === num && h.gen === gen && h.at > bestAt) {
        bestAt = h.at;
        plainBody = h.body;
      }
    }
    let inStream: { stm: ObjStm; index: number } | null = null;
    if (gen === 0) {
      const { streams, failedAt } = await this.loadObjStms();
      for (const stm of streams) {
        if (stm.at <= bestAt) continue;
        const index = stm.nums.indexOf(num);
        if (index >= 0) {
          bestAt = stm.at;
          inStream = { stm, index };
        }
      }
      if (failedAt.some((at) => at > bestAt)) throw new Error('A later revision may be in an unreadable object stream.');
    }
    if (inStream) return this.member(inStream.stm, inStream.index);
    return plainBody >= 0 ? this.parseAt(plainBody) : undefined;
  }

  /** A number, direct or by reference to a plain (uncompressed) object. */
  private plainNumber(v: Val | undefined): number | null {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (!v || typeof v !== 'object' || (v as Ref).t !== 'ref') return null;
    let best: Header | null = null;
    for (const h of this.headers) {
      if (h.num === (v as Ref).num && h.gen === (v as Ref).gen && (!best || h.at > best.at)) best = h;
    }
    if (!best) return null;
    try {
      const n = this.parseAt(best.body);
      return typeof n === 'number' && Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }

  async resolve(v: Val | undefined, hops = 0): Promise<Val | undefined> {
    if (v && typeof v === 'object' && (v as Ref).t === 'ref' && hops < 8) {
      return this.resolve(await this.get((v as Ref).num, (v as Ref).gen), hops + 1);
    }
    return v;
  }

  async number(v: Val | undefined): Promise<number | null> {
    const r = await this.resolve(v);
    return typeof r === 'number' && Number.isFinite(r) ? r : null;
  }

  async box(v: Val | undefined): Promise<PdfBox | null> {
    const r = await this.resolve(v);
    if (!Array.isArray(r) || r.length !== 4) return null;
    const nums: number[] = [];
    for (const item of r) {
      const n = await this.number(item);
      if (n === null) return null;
      nums.push(n);
    }
    return normalize(nums as PdfBox);
  }
}

/** [x0, y0, x1, y1] with x0 < x1 and y0 < y1. */
export function normalize(b: PdfBox): PdfBox {
  return [Math.min(b[0], b[2]), Math.min(b[1], b[3]), Math.max(b[0], b[2]), Math.max(b[1], b[3])];
}

export function intersect(a: PdfBox, b: PdfBox): PdfBox | null {
  const r: PdfBox = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
  return r[2] > r[0] && r[3] > r[1] ? r : null;
}

const sameBox = (a: PdfBox, b: PdfBox, tol = 0.5) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

/**
 * The TrimBox and BleedBox of page `ref`, or null when they cannot be trusted.
 * `view` is what pdf.js measured for that page (its MediaBox∩CropBox): the page
 * object read here must reproduce it, or it is not the page pdf.js drew.
 */
export async function readPageBoxes(
  bytes: Uint8Array,
  ref: { num: number; gen: number } | null | undefined,
  view: number[] | null | undefined,
): Promise<{ trim: PdfBox | null; bleed: PdfBox | null } | null> {
  try {
    if (!ref || !Array.isArray(view) || view.length !== 4 || bytes.length > MAX_BYTES) return null;
    // An encrypted file's strings and streams are ciphertext: not read.
    if (indexOfAscii(bytes, '/Encrypt') >= 0) return null;
    const doc = new Doc(bytes);
    const page = await doc.resolve(await doc.get(ref.num, ref.gen));
    if (!page || (page as Dict).t !== 'dict') return null;
    const d = (page as Dict).v;
    if ((d.Type as Name)?.v !== 'Page') return null;
    // MediaBox and CropBox may be inherited from the page tree; TrimBox and
    // BleedBox may not (PDF 32000, 7.7.3.4 and 14.11.2).
    let media: PdfBox | null = await doc.box(d.MediaBox);
    let crop: PdfBox | null = await doc.box(d.CropBox);
    let parent = await doc.resolve(d.Parent);
    for (let hops = 0; (!media || !crop) && parent && (parent as Dict).t === 'dict' && hops < 16; hops += 1) {
      const pd = (parent as Dict).v;
      if (!media) media = await doc.box(pd.MediaBox);
      if (!crop) crop = await doc.box(pd.CropBox);
      parent = await doc.resolve(pd.Parent);
    }
    if (!media) return null;
    const own = crop ? intersect(media, crop) : media;
    if (!own || !sameBox(own, normalize(view as PdfBox))) return null;
    return { trim: await doc.box(d.TrimBox), bleed: await doc.box(d.BleedBox) };
  } catch {
    return null;
  }
}

function indexOfAscii(b: Uint8Array, s: string, from = 0, to = b.length): number {
  const first = s.charCodeAt(0);
  outer: for (let i = from; i + s.length <= to; i += 1) {
    if (b[i] !== first) continue;
    for (let k = 1; k < s.length; k += 1) if (b[i + k] !== s.charCodeAt(k)) continue outer;
    return i;
  }
  return -1;
}

export interface ChosenArtworkBox {
  /** What was measured: the TrimBox, a BleedBox with no TrimBox, or the whole page as before. */
  source: 'trimbox' | 'bleedbox' | 'page';
  /** The size to check against the product (turned when the page is rotated 90/270). */
  widthMm: number;
  heightMm: number;
  /** The file's bleed beyond its trim, when it says so (≥ 2.5 mm on every side); else 0 = unknown. */
  bleedMm: number;
  /** The whole page, marks and all. */
  pageWidthMm: number;
  pageHeightMm: number;
  /** What the preview should draw, in PDF user space: the trim plus its bleed, so the marks never show. */
  box: PdfBox;
}

/**
 * Which box this page should be measured by. A TrimBox counts only when it lies
 * inside the page and leaves something around it (more than 1 mm on some side):
 * a TrimBox equal to the page says nothing, and the page is measured as before.
 */
export function chooseArtworkBox(input: {
  view: number[];
  trim?: PdfBox | null;
  bleed?: PdfBox | null;
  userUnit?: number;
  rotate?: number;
}): ChosenArtworkBox {
  const view = normalize(input.view as PdfBox);
  const unit = (Number(input.userUnit) > 0 ? Number(input.userUnit) : 1) * (25.4 / 72);
  const turned = ((Number(input.rotate) || 0) % 180 + 180) % 180 === 90;
  const size = (b: PdfBox) => {
    const w = (b[2] - b[0]) * unit;
    const h = (b[3] - b[1]) * unit;
    return turned ? { w: h, h: w } : { w, h };
  };
  const page = size(view);
  const inside = (b: PdfBox) => {
    const cut = intersect(b, view);
    return cut && sameBox(cut, b) ? cut : null;
  };
  const leavesRoom = (b: PdfBox) =>
    (b[0] - view[0]) * unit > 1 || (b[1] - view[1]) * unit > 1 || (view[2] - b[2]) * unit > 1 || (view[3] - b[3]) * unit > 1;

  const trim = input.trim ? inside(normalize(input.trim)) : null;
  if (trim && leavesRoom(trim)) {
    let bleedMm = 0;
    const bleed = input.bleed ? intersect(normalize(input.bleed), view) : null;
    // A BleedBox equal to the page, around a smaller trim, is the page again — not a bleed.
    if (bleed && !sameBox(bleed, view)) {
      const margins = [trim[0] - bleed[0], trim[1] - bleed[1], bleed[2] - trim[2], bleed[3] - trim[3]].map((m) => m * unit);
      const least = Math.min(...margins);
      if (least >= 2.5) bleedMm = Math.round(least * 10) / 10;
    }
    const pad = bleedMm / unit;
    const drawn = intersect([trim[0] - pad, trim[1] - pad, trim[2] + pad, trim[3] + pad], view) ?? trim;
    const t = size(trim);
    return { source: 'trimbox', widthMm: t.w, heightMm: t.h, bleedMm, pageWidthMm: page.w, pageHeightMm: page.h, box: drawn };
  }
  const bleed = !trim && input.bleed ? inside(normalize(input.bleed)) : null;
  if (bleed && leavesRoom(bleed)) {
    const s = size(bleed);
    return { source: 'bleedbox', widthMm: s.w, heightMm: s.h, bleedMm: 0, pageWidthMm: page.w, pageHeightMm: page.h, box: bleed };
  }
  return { source: 'page', widthMm: page.w, heightMm: page.h, bleedMm: 0, pageWidthMm: page.w, pageHeightMm: page.h, box: view };
}
