/**
 * QR CODES for the online designer — vector, so they are sharp at any size.
 *
 * The design keeps only what the code SAYS (`rxQr {text, ecc}`); the drawing is a
 * single path rebuilt from it, one sub-path per run of dark modules in a row. The
 * quiet zone (four modules of empty margin a scanner needs) is part of the path's
 * box, so moving the code never eats it. Pure: the `qrcode` package's matrix only.
 */
// The encoder's core only — the package's entry also pulls PNG and file renderers.
// (Browser-side only: what the server needs is in designQrSpec.ts, package-free.)
import { create as createQr } from 'qrcode/lib/core/qrcode';
import type { QrSpec } from './designQrSpec.js';

export { cleanQrSpec, QR_MAX_TEXT, type QrEcc, type QrSpec } from './designQrSpec.js';
/** Modules of empty margin around the code (the standard asks for four). */
export const QR_QUIET_ZONE = 4;
/** The smallest printed side worth offering, mm: below this phones struggle to focus. */
export const QR_MIN_PRINT_MM = 15;

/**
 * The code as one SVG path in MODULE units: `size` modules square including the
 * quiet zone, `d` drawing only the dark modules. Null when the text cannot be encoded.
 */
export function qrPath(spec: QrSpec): { size: number; d: string } | null {
  let matrix: { size: number; data: Uint8Array };
  try {
    matrix = createQr(spec.text, { errorCorrectionLevel: spec.ecc }).modules as unknown as { size: number; data: Uint8Array };
  } catch {
    return null;
  }
  const n = matrix.size;
  const q = QR_QUIET_ZONE;
  const parts: string[] = [];
  for (let y = 0; y < n; y += 1) {
    let x = 0;
    while (x < n) {
      if (!matrix.data[y * n + x]) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < n && matrix.data[y * n + x]) x += 1;
      parts.push(`M${start + q} ${y + q}h${x - start}v1h${start - x}z`);
    }
  }
  return { size: n + 2 * q, d: parts.join('') };
}
