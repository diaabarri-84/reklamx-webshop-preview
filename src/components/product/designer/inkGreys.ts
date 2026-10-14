/**
 * A SIDE PRINTED IN BLACK (OR GREYS) ONLY IS MADE IN GREYS — its print file and the
 * picture of it the customer approves. The studio's toolbar offered only blacks and
 * greys on such a side, but a background, a pattern, a QR code, an element or a photo
 * kept its colours, and the customer approved a colour proof of a black-only job. Every
 * pixel becomes its luminance (Rec. 709), in strips, so a large tile never needs a
 * second full-size copy of itself.
 */
export function toGreys(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || !canvas.width || !canvas.height) return;
  const rows = Math.max(1, Math.floor((4 * 1024 * 1024) / canvas.width));
  for (let y = 0; y < canvas.height; y += rows) {
    const h = Math.min(rows, canvas.height - y);
    const strip = ctx.getImageData(0, y, canvas.width, h);
    const d = strip.data;
    for (let i = 0; i < d.length; i += 4) {
      const lum = Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
      d[i] = lum;
      d[i + 1] = lum;
      d[i + 2] = lum;
    }
    ctx.putImageData(strip, 0, y);
  }
}
