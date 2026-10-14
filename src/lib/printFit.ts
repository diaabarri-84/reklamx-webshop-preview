/**
 * ONE A4 PAGE — "الفواتير والطلب تكون بحجم A4 وليس ورقتين، ورقة واحدة فقط".
 *
 * The documents (invoice, receipt, job sheet, packing slip, credit note) print
 * through `.rx-print-sheet` and the print rules in src/index.css. A compact print
 * style makes a normal order fit by itself; a long one (many lines, many
 * options, a long note) still would not. So, the moment before the browser lays
 * the page out for paper, each open sheet is MEASURED at the printed width with
 * the printed type size, and if it is taller than one A4 page it is zoomed down
 * by exactly as much as it needs — never up, and never below a floor that would
 * make it unreadable.
 *
 * WHY MEASURE IN `beforeprint`, WITH A CLASS: the print layout is computed by
 * the browser with print media, which script cannot observe. `html.rx-printing`
 * applies the same metrics on screen for the instant of the measurement (the
 * page's printed width, the printed root font size, no sheet padding), so the
 * number measured is the number that will print. index.css carries both.
 *
 * WHY `zoom` AND NOT `transform: scale()`: a transform does not change layout,
 * so the paper would still be cut after the unscaled height and page two would
 * come out blank. `zoom` shrinks the layout itself (Chrome, Edge, Safari, and
 * Firefox since 126).
 *
 * WHY ON THE SHEET'S CHILDREN, NOT THE SHEET: the sheet stays at zoom 1 and is
 * the thing measured. WebKit reports a zoomed element's OWN box unzoomed, so
 * measuring a zoomed sheet would read the same height at every zoom in Safari;
 * an unzoomed box around zoomed children reads true in every engine. Parts that
 * must keep their real size (the barcode, the signing boxes) opt out with
 * `.rx-fullsize` (a direct child) or `.rx-unzoom` (inside a zoomed child).
 */

/** A4 with the 10 mm margins of the @page rule, in CSS pixels (96 per inch). */
const MM = 96 / 25.4;
export const A4_CONTENT_WIDTH_PX = Math.floor((210 - 20) * MM); // 718
export const A4_CONTENT_HEIGHT_PX = Math.floor((297 - 20) * MM); // 1046

/**
 * The smallest zoom worth printing at — 0.6: the documents' smallest text (10 px)
 * comes out at 6 px, about 4.5 pt, the edge of what can be read on paper.
 *
 * It is also where the measurement stops being trustworthy. On SCREEN Chrome
 * holds zoomed text at 6 px or more; on PAPER it does not. Below 0.6 the
 * screen therefore measures a sheet taller than it prints — a 30-line job
 * sheet measured "does not fit" at 0.45 and then fitted on one page in a real
 * PDF. (Always in the safe direction — paper is never taller than measured —
 * but it made the "cannot fit" decision wrong.)
 */
export const MIN_PRINT_ZOOM = 0.6;

/** A few pixels of slack: rounding between measurement and paper must never spill a line. */
const SAFETY_PX = 12;

const floor3 = (n: number) => Math.floor(n * 1000) / 1000;

/**
 * The largest zoom at which the sheet fits one page, found by MEASURING — never
 * by arithmetic alone. Pure apart from `heightAt`, which lays the sheet out at a
 * zoom and returns its height on paper; tested with fakes.
 *
 * Why not just `page ÷ height`: a zoomed sheet keeps the paper's width, so its
 * text re-wraps into longer lines and it comes out SHORTER than height × zoom;
 * and on screen browsers keep zoomed text at a minimum size (Chrome's is 6 px),
 * so near the floor it can come out TALLER. Measured on the 2026-10 test
 * orders, the one-shot guess was wrong both ways: a 30-line receipt "fitted" at
 * 0.46 and printed on two sheets, while shorter orders were shrunk more than
 * they needed.
 *
 * So: step down from the guess until a measured height fits, then bisect back up
 * towards the last zoom that did not. Every zoom this returns below 1 was
 * measured to fit.
 *
 * A sheet that does not fit even at the floor (30 lines, each with six long
 * options) gets 1 — its normal size, on two pages with the table rows kept
 * whole and the invoice's column heads repeated — not the floor: the smallest
 * type on two pages anyway is the worst of both.
 */
export function findFitZoom(
  heightAt: (zoom: number) => number,
  pageHeightPx = A4_CONTENT_HEIGHT_PX,
  minZoom = MIN_PRINT_ZOOM,
): number {
  const room = pageHeightPx - SAFETY_PX;
  const fits = (h: number) => Number.isFinite(h) && h <= room;
  let height = heightAt(1);
  if (!Number.isFinite(height) || height <= 0 || height <= room) return 1;
  // A measurement that comes back as no number stops the search at 1.
  const broken = (h: number) => !Number.isFinite(h);

  let tooBig = 1; // the smallest zoom measured NOT to fit
  let zoom = 1;
  for (let i = 0; i < 12; i += 1) {
    // At least a step of 0.01, so a sheet a few pixels over still moves.
    zoom = Math.max(minZoom, Math.min(floor3(zoom - 0.01), floor3((zoom * room) / height)));
    height = heightAt(zoom);
    if (broken(height)) return 1;
    if (fits(height)) break;
    tooBig = zoom;
    if (zoom <= minZoom) return 1;
  }
  if (!fits(height)) return 1;

  for (let i = 0; i < 7 && tooBig - zoom > 0.005; i += 1) {
    const mid = floor3((zoom + tooBig) / 2);
    if (mid <= zoom) break;
    if (fits(heightAt(mid))) zoom = mid;
    else tooBig = mid;
  }
  return zoom;
}

function fitOpenSheets(): void {
  const sheets = Array.from(document.querySelectorAll<HTMLElement>('.rx-print-sheet'));
  if (sheets.length === 0) return;
  const root = document.documentElement;
  // The measuring class changes the whole page's type size for an instant, and
  // the window and the document's scroll box can be clamped while it is on:
  // remember where everything was scrolled, and put it back.
  const scrolled: Array<[HTMLElement, number, number]> = [];
  for (const sheet of sheets) {
    for (let el = sheet.parentElement; el; el = el.parentElement) {
      if (el.scrollTop || el.scrollLeft) scrolled.push([el, el.scrollLeft, el.scrollTop]);
    }
  }
  const [winX, winY] = [window.scrollX, window.scrollY];
  root.classList.add('rx-printing');
  try {
    sheets.forEach((sheet, i) => {
      // Two documents open at once: each starts a page of its own (index.css).
      if (i > 0) sheet.setAttribute('data-rx-break', '');
      else sheet.removeAttribute('data-rx-break');
      // With the class on, the sheet takes the paper's width and type size and
      // its children take --rx-print-zoom (index.css), so this height is the
      // printed one.
      const heightAt = (zoom: number) => {
        sheet.style.setProperty('--rx-print-zoom', String(zoom));
        return sheet.getBoundingClientRect().height;
      };
      sheet.style.setProperty('--rx-print-zoom', String(findFitZoom(heightAt)));
    });
  } finally {
    root.classList.remove('rx-printing');
    for (const [el, x, y] of scrolled) {
      el.scrollLeft = x;
      el.scrollTop = y;
    }
    window.scrollTo(winX, winY);
  }
}

function clearSheets(): void {
  document.querySelectorAll<HTMLElement>('.rx-print-sheet').forEach((s) => {
    s.style.removeProperty('--rx-print-zoom');
    s.removeAttribute('data-rx-break');
  });
}

/** Installed once, at the app's root. Returns the uninstall. */
export function installPrintFit(): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('beforeprint', fitOpenSheets);
  window.addEventListener('afterprint', clearSheets);
  return () => {
    window.removeEventListener('beforeprint', fitOpenSheets);
    window.removeEventListener('afterprint', clearSheets);
  };
}
