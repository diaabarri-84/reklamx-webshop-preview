import React from 'react';

/**
 * A real, scannable barcode drawn as inline SVG — no library, no network.
 *
 * WHY CODE 39
 * The shop's work order needs a number a warehouse scanner can read off paper.
 * Code 39 is the right trade for that: it is self-checking, needs no checksum
 * character, every handheld scanner reads it by default, and — the part that
 * matters here — its encoding table is small and verifiable, nine elements per
 * character with exactly three wide. Code 128 is denser, but a single wrong row
 * in its 107-entry pattern table produces a symbol that looks perfect and does
 * not scan, and there is no way to notice that from the screen.
 *
 * A Code 39 symbol is the characters of the value framed by '*' delimiters, each
 * character being five bars and four spaces, alternating, bar first. A wide
 * element is `ratio` times a narrow one; 2.5 is inside the 2.0–3.0 the spec
 * allows and is what most printers reproduce cleanly at this size.
 */

/** n = narrow, w = wide. Nine elements per character: bar, space, bar, … bar. */
const CODE39: Record<string, string> = {
  '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn',
  '4': 'nnnwwnnnw', '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw',
  '8': 'wnnwnnwnn', '9': 'nnwwnnwnn',
  A: 'wnnnnwnnw', B: 'nnwnnwnnw', C: 'wnwnnwnnn', D: 'nnnnwwnnw',
  E: 'wnnnwwnnn', F: 'nnwnwwnnn', G: 'nnnnnwwnw', H: 'wnnnnwwnn',
  I: 'nnwnnwwnn', J: 'nnnnwwwnn', K: 'wnnnnnnww', L: 'nnwnnnnww',
  M: 'wnwnnnnwn', N: 'nnnnwnnww', O: 'wnnnwnnwn', P: 'nnwnwnnwn',
  Q: 'nnnnnnwww', R: 'wnnnnnwwn', S: 'nnwnnnwwn', T: 'nnnnwnwwn',
  U: 'wwnnnnnnw', V: 'nwwnnnnnw', W: 'wwwnnnnnn', X: 'nwnnwnnnw',
  Y: 'wwnnwnnnn', Z: 'nwwnwnnnn',
  '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn',
  '$': 'nwnwnwnnn', '/': 'nwnwnnnwn', '+': 'nwnnnwnwn', '%': 'nnnwnwnwn',
  '*': 'nwnnwnwnn',
};

/**
 * Everything Code 39 can carry. Anything else is dropped rather than guessed at:
 * a barcode that encodes a different string than the one printed under it is
 * worse than no barcode.
 */
export function sanitiseForCode39(value: string): string {
  return String(value ?? '')
    .toUpperCase()
    .split('')
    .filter((ch) => ch !== '*' && CODE39[ch] !== undefined)
    .join('');
}

interface BarcodeProps {
  value: string;
  /** Width of one narrow bar, in px. */
  narrow?: number;
  height?: number;
  /** Print the encoded characters under the bars. */
  showText?: boolean;
  className?: string;
}

export default function Barcode({
  value,
  narrow = 2,
  height = 56,
  showText = true,
  className,
}: BarcodeProps): React.ReactElement | null {
  const encoded = sanitiseForCode39(value);
  if (!encoded) return null;

  const RATIO = 2.5;
  const wide = narrow * RATIO;
  const bars: { x: number; w: number }[] = [];
  let x = 0;

  for (const ch of `*${encoded}*`) {
    const pattern = CODE39[ch];
    for (let i = 0; i < pattern.length; i += 1) {
      const w = pattern[i] === 'w' ? wide : narrow;
      // Even index = bar, odd = space. Only the bars are drawn.
      if (i % 2 === 0) bars.push({ x, w });
      x += w;
    }
    // The inter-character gap is one narrow space and is part of the symbol.
    x += narrow;
  }

  // The trailing gap after the final '*' is not part of the symbol width.
  const width = x - narrow;
  const textHeight = showText ? 16 : 0;

  return (
    <svg
      className={className}
      width={width}
      height={height + textHeight}
      viewBox={`0 0 ${width} ${height + textHeight}`}
      role="img"
      aria-label={`Barcode ${encoded}`}
      // Quiet zones are the caller's margin; the symbol itself needs a white
      // ground or a scanner reads the page behind it.
      style={{ background: '#fff' }}
    >
      {bars.map((bar, i) => (
        <rect key={i} x={bar.x} y={0} width={bar.w} height={height} fill="#000" />
      ))}
      {showText && (
        <text
          x={width / 2}
          y={height + 13}
          textAnchor="middle"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          fontSize={13}
          letterSpacing={2}
          fill="#000"
        >
          {encoded}
        </text>
      )}
    </svg>
  );
}
