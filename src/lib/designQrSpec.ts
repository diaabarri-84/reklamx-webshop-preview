/**
 * WHAT A QR CODE SAYS — its words and error level, cleaned. Apart from the encoder
 * (designQr.ts) because the SERVER needs this and only this (the design allowlist,
 * designSchema.ts): the encoder's `qrcode` package is a browser-side dependency the
 * live host does not install, and importing it from the server's bundle stopped the
 * shop from starting (2026-10-07). Keep this file free of packages.
 */
export type QrEcc = 'L' | 'M' | 'Q' | 'H';

export interface QrSpec {
  text: string;
  ecc: QrEcc;
}

/** Longest text accepted: a QR at level M holds ~2 300 bytes, but a printed code that dense is unreadable. */
export const QR_MAX_TEXT = 600;

const ECC = new Set<QrEcc>(['L', 'M', 'Q', 'H']);

export function cleanQrSpec(raw: unknown): QrSpec | null {
  const r = raw as Partial<QrSpec> | null;
  if (!r || typeof r !== 'object') return null;
  const text = String(r.text ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (!text || text.length > QR_MAX_TEXT) return null;
  const ecc = ECC.has(r.ecc as QrEcc) ? (r.ecc as QrEcc) : 'M';
  return { text, ecc };
}
