/**
 * The class a form field needs to be READABLE on a dark bar — 15.1.1/15.1.2.
 *
 * Two admin screens put inputs inside a near-black bar: the supplier picker's
 * selection bar and the products bulk bar. Both carried `text-gray-900` with no
 * background class, and Tailwind v4's preflight sets `background-color:
 * transparent` on every input, select and textarea — so the field showed the
 * `bg-gray-900` bar straight through and the typed digits were painted in
 * exactly the colour behind them. Contrast 1.00:1. "The numbers are not
 * visible" was a literal description of it.
 *
 * The same class string looks correct everywhere else in the admin only because
 * those fields sit on a white card, which shows through instead.
 *
 * `bg-white` is the token that was missing; the rest is what a field on a dark
 * bar needs to behave like one — a visible edge, a placeholder that is grey
 * rather than invisible, and a focus ring offset against the bar instead of
 * drowning in it.
 *
 * One constant in one file, imported by both bars, so the next dark panel has
 * something to copy and `src/index.css` can carry the safety net underneath it.
 */
export const BAR_FIELD =
  'w-full px-3 py-2 rounded-xl text-xs font-bold bg-white text-gray-900 ' +
  'placeholder:text-gray-500 border border-white/25 outline-none ' +
  'focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 focus:ring-offset-gray-900';
