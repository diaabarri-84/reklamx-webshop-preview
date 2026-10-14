// The `qrcode` package's encoder core (src/lib/designQr.ts): its matrix only, no renderers.
declare module 'qrcode/lib/core/qrcode' {
  export function create(
    text: string,
    options?: { errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' },
  ): { modules: { size: number; data: Uint8Array } };
}
