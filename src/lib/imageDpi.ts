/**
 * THE RESOLUTION, WRITTEN INTO THE FILE ITSELF — round 16, item 5 (review).
 *
 * A browser's canvas writes no physical size into the PNG or JPEG it makes:
 * no pHYs chunk in a PNG, and a JPEG's JFIF header gives only an aspect ratio.
 * Photoshop, Illustrator and a RIP then read the designer's 662-pixel sticker
 * file at 72 ppi, which is 233 mm wide instead of 56. An operator who places it
 * "at its own size" prints it four times too big. One who fits it to the line's
 * print size (the trim) prints the 3 mm bleed inside the product.
 *
 * These two functions put the real DPI into the bytes: a pHYs chunk right after
 * the PNG's IHDR (pixels per metre), and JFIF density in dots per inch. They
 * change nothing else in the file. Pure; scripts/test-design.mjs.
 */

let crcTable: Uint32Array | null = null;

function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const u32 = (out: Uint8Array, at: number, v: number) => {
  out[at] = (v >>> 24) & 0xff;
  out[at + 1] = (v >>> 16) & 0xff;
  out[at + 2] = (v >>> 8) & 0xff;
  out[at + 3] = v & 0xff;
};

/** The PNG with a pHYs chunk saying `dpi`, inserted after IHDR; anything else is returned unchanged. */
export function withPngDpi(png: Uint8Array, dpi: number): Uint8Array {
  if (png.length < 33 || PNG_SIGNATURE.some((b, i) => png[i] !== b)) return png;
  // IHDR is always first: 4 length + 4 type + 13 data + 4 CRC, from byte 8.
  const isIhdr = png[12] === 0x49 && png[13] === 0x48 && png[14] === 0x44 && png[15] === 0x52;
  if (!isIhdr) return png;
  const at = 33;
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  u32(chunk, 0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  u32(chunk, 8, ppm);
  u32(chunk, 12, ppm);
  chunk[16] = 1; // unit: the metre
  u32(chunk, 17, crc32(chunk.subarray(4, 17)));
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, at), 0);
  out.set(chunk, at);
  out.set(png.subarray(at), at + chunk.length);
  return out;
}

/** The JPEG with its JFIF density set to `dpi` (a JFIF header added when there is none). */
export function withJpegDpi(jpeg: Uint8Array, dpi: number): Uint8Array {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return jpeg;
  const d = Math.max(1, Math.min(65535, Math.round(dpi)));
  const isJfif =
    jpeg[2] === 0xff && jpeg[3] === 0xe0 && jpeg.length >= 18 &&
    jpeg[6] === 0x4a && jpeg[7] === 0x46 && jpeg[8] === 0x49 && jpeg[9] === 0x46 && jpeg[10] === 0x00;
  if (isJfif) {
    const out = jpeg.slice();
    out[13] = 1; // units: dots per inch
    out[14] = d >> 8;
    out[15] = d & 0xff;
    out[16] = d >> 8;
    out[17] = d & 0xff;
    return out;
  }
  const app0 = new Uint8Array([
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01,
    d >> 8, d & 0xff, d >> 8, d & 0xff, 0x00, 0x00,
  ]);
  const out = new Uint8Array(jpeg.length + app0.length);
  out.set(jpeg.subarray(0, 2), 0);
  out.set(app0, 2);
  out.set(jpeg.subarray(2), 2 + app0.length);
  return out;
}
