import type { Textbox } from 'fabric';

/**
 * A word wider than its box makes a fabric Textbox grow past the box, across the
 * cut line. The LARGEST type size, up to the one it has, that fits the width and,
 * when given, the height — found by halving. One step by the overflow took a name
 * that had wrapped onto a second line down to under half its size, when nine
 * tenths of it fitted on one. Tested in scripts/test-design.mjs.
 */
export function fitText(tb: Textbox, maxW: number, maxH?: number): void {
  const fits = () => tb.width <= maxW + 0.5 && (!maxH || tb.height <= maxH + 0.5);
  tb.set({ width: maxW });
  tb.initDimensions();
  if (fits()) return;
  let lo = 4;
  let hi = tb.fontSize;
  for (let i = 0; i < 12 && hi - lo > 0.05; i += 1) {
    const mid = (lo + hi) / 2;
    tb.set({ fontSize: mid, width: maxW });
    tb.initDimensions();
    if (fits()) lo = mid;
    else hi = mid;
  }
  tb.set({ fontSize: lo, width: maxW });
  tb.initDimensions();
}
